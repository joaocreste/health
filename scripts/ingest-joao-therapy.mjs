#!/usr/bin/env node
/**
 * Ingest Joao Victor Creste's psychotherapy sessions into Neon (migration 0020).
 *
 * Per the Therapy-Sessions ingestion contract:
 *   - Storage + read-API job only; NO frontend rendering here.
 *   - Append-only, idempotent: session deduped on (patient_id, content_hash).
 *     Re-running the same session is a no-op; it never mutates prior history.
 *   - is_ai_inference is set per row (interpretation vs extracted fact).
 *   - Safety: therapy_risk_flags rows carry the signal + severity, NEVER method
 *     detail, requires_human_review = true, and are clinician-gated at the Worker.
 *   - Nothing interpretive or risk-related is auto-marked reviewed.
 *
 * FK convention: patient_id -> users.id (repo standard; the prompt's
 * "-> patient_profiles" is overridden by the live schema).
 *
 * Blobs: the raw source transcript + a derived normalised copy are stored in EU
 * R2 under patients/{patient_id}/therapy/{session_date}__{slug}/. This script
 * RECORDS the R2 keys on the session row and (with --upload-r2) pushes the blobs
 * via `wrangler r2 object put --jurisdiction eu` (the house out-of-band pattern;
 * the Pages deploy token can't write R2, so this uses your wrangler OAuth login).
 *
 *   node scripts/ingest-joao-therapy.mjs                  # dry run (planned writes)
 *   node scripts/ingest-joao-therapy.mjs --apply          # migrate + insert rows
 *   node scripts/ingest-joao-therapy.mjs --apply --upload-r2   # + push blobs to R2
 *   DATABASE_URL=... node scripts/ingest-joao-therapy.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { neon, Pool } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const UPLOAD_R2 = process.argv.includes("--upload-r2");

const CLERK = "pending:joao";
const R2_BUCKET = "jc-health-uploads";
const R2_JURISDICTION = "eu";
const STAGE = path.join(root, ".staging/therapy-joao");
const TRANSCRIPT_DIR = path.join(root, "Patients/Joao Victor Creste/Therapy Sessions");
const MIGRATION = path.join(root, "db/migrations/0020_therapy_sessions.sql");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    return m ? m[1] : null;
  } catch { return null; }
}

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

// Build a FACTUAL, non-interpretive, risk-free breadcrumb for the documents row.
// documents.metadata.classifier.summary is read by lib/ai-insights.js and the
// chatbot; interpretive synthesis and safety flags must NOT travel through it
// (they are review-gated). It lists topics only and points to the gated surface.
function docSummary(s, themes) {
  const topics = themes.map((t) => t.display_label_en).join("; ");
  return [
    `Psychotherapy session on ${s.session_date} (${s.modality}, ${s.session_type})`,
    `with ${s.therapist_name || "therapist not stated"}${s.therapist_credentials ? " (" + s.therapist_credentials + ")" : ""}.`,
    `Topics discussed: ${topics}.`,
    `Interpretive synthesis (themes, theoretical-lens readings, strengths/growth) and any safety flags`,
    `are review-gated and exposed only via the clinician-facing therapy API, not here.`,
  ].join(" ");
}

async function main() {
  const dsn = loadDatabaseUrl();
  if (!dsn) { console.error("No DATABASE_URL (env or .env)."); process.exit(1); }
  const sql = neon(dsn);

  // ── Resolve patient ──────────────────────────────────────────────────────
  const prow = await sql`SELECT id, full_name FROM users
    WHERE clerk_user_id = ${CLERK} AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
  if (!prow.length) { console.error(`Patient ${CLERK} not found.`); process.exit(1); }
  const pid = prow[0].id;
  console.log(`Patient: ${prow[0].full_name}  (users.id ${pid})`);

  // ── Load the staged extraction + the raw transcript ──────────────────────
  const stagePath = path.join(STAGE, "2026-06-23.json");
  const data = JSON.parse(fs.readFileSync(stagePath, "utf8"));
  const s = data.session;
  const rawPath = path.join(TRANSCRIPT_DIR, data.source_file_name);
  const rawBuf = fs.readFileSync(rawPath);
  const contentHash = sha256(rawBuf);

  // Derived/normalised transcript artifact (verbatim-cleaned copy + provenance
  // header). The bulk transcript lives in R2, never the DB.
  const derived = [
    `# Lumen therapy transcript (derived)`,
    `patient_clerk: ${CLERK}`,
    `session_date: ${s.session_date}`,
    `therapist: ${s.therapist_name} ${s.therapist_credentials || ""}`.trim(),
    `source_file: ${data.source_file_name}`,
    `source_sha256: ${contentHash}`,
    `transcription_method: ${s.transcription_method}`,
    `un_deidentified: ${s.un_deidentified}`,
    ``,
    `---`,
    ``,
    rawBuf.toString("utf8"),
  ].join("\n");

  const slug = "clean-transcript";
  const prefix = `patients/${pid}/therapy/${s.session_date}__${slug}/`;
  const sourceKey = `${prefix}source.txt`;
  const transcriptKey = `${prefix}transcript.md`;

  // ── Resolve psych_item links (legacy_anchor -> uuid) ─────────────────────
  const anchors = new Set();
  for (const t of data.themes) if (t.psych_legacy_anchor) anchors.add(t.psych_legacy_anchor);
  for (const sgItem of data.strengths_growth) if (sgItem.psych_legacy_anchor) anchors.add(sgItem.psych_legacy_anchor);
  const anchorMap = {};
  if (anchors.size) {
    const rows = await sql`SELECT id, legacy_anchor FROM psych_items
      WHERE patient_id = ${pid} AND legacy_anchor = ANY(${Array.from(anchors)})`;
    for (const r of rows) anchorMap[r.legacy_anchor] = r.id;
  }

  // ── Plan summary ─────────────────────────────────────────────────────────
  console.log(`\nPlanned writes for session ${s.session_date}:`);
  console.log(`  content_hash      ${contentHash.slice(0, 16)}...`);
  console.log(`  participants      ${data.participants.length}`);
  console.log(`  themes            ${data.themes.length} (psych_item links: ${Object.keys(anchorMap).length}/${anchors.size})`);
  console.log(`  lens reads        ${data.lens_interpretations.length}`);
  console.log(`  strengths/growth  ${data.strengths_growth.length}`);
  console.log(`  interventions     ${data.interventions.length}`);
  console.log(`  risk flags        ${data.risk_flags.length}  (clinician-gated, requires_human_review)`);
  console.log(`  quotes            ${data.quotes.length}  (${data.quotes_note || ""})`);
  console.log(`  R2 source         ${sourceKey}`);
  console.log(`  R2 transcript     ${transcriptKey}`);
  if (anchors.size !== Object.keys(anchorMap).length) {
    const missing = Array.from(anchors).filter((a) => !anchorMap[a]);
    console.log(`  NOTE unresolved psych anchors (stored as NULL link): ${missing.join(", ")}`);
  }

  if (!APPLY) {
    console.log("\n[dry run] No writes. Re-run with --apply (and --upload-r2 to push blobs).");
    return;
  }

  // ── Apply migration (self-applying, idempotent) ──────────────────────────
  // The migration contains DO $$ ... $$; blocks whose internal semicolons defeat
  // naive splitting, so run the whole file as one multi-statement simple query
  // via the WebSocket Pool (the neon HTTP driver is single-statement only).
  console.log("\nApplying migration 0020_therapy_sessions ...");
  const pool = new Pool({ connectionString: dsn });
  try {
    await pool.query(fs.readFileSync(MIGRATION, "utf8"));
  } finally {
    await pool.end();
  }
  console.log("  tables + enums + indexes ensured.");

  // ── Upload blobs to EU R2 (out-of-band, via wrangler OAuth) ──────────────
  if (UPLOAD_R2) {
    const tmpSrc = path.join(STAGE, "_r2_source.txt");
    const tmpDer = path.join(STAGE, "_r2_transcript.md");
    fs.writeFileSync(tmpSrc, rawBuf);
    fs.writeFileSync(tmpDer, derived, "utf8");
    for (const [key, file, ct] of [
      [sourceKey, tmpSrc, "text/plain"],
      [transcriptKey, tmpDer, "text/markdown"],
    ]) {
      console.log(`  R2 put ${key}`);
      // --remote is REQUIRED: without it wrangler writes to the local miniflare
      // R2, not the production EU bucket (PHI would silently never leave disk).
      execFileSync("npx", ["wrangler", "r2", "object", "put",
        `${R2_BUCKET}/${key}`, "--file", file,
        "--content-type", ct, "--jurisdiction", R2_JURISDICTION, "--remote",
      ], { cwd: root, stdio: "inherit" });
    }
    fs.rmSync(tmpSrc, { force: true });
    fs.rmSync(tmpDer, { force: true });
  } else {
    console.log("  [--upload-r2 not set] R2 keys recorded on the row; blobs NOT pushed.");
  }

  // ── Insert session (append-only; no-op on content_hash) ──────────────────
  const sessRows = await sql`
    INSERT INTO therapy_sessions
      (patient_id, session_date, session_time, session_sequence, modality, session_type,
       therapist_name, therapist_credentials, therapist_approach, duration_minutes, language,
       source_format, source_r2_key, transcript_r2_key, transcription_method, diarization_confidence,
       consent_status, un_deidentified, session_summary, summary_pt, patient_overall_affect,
       content_hash, source_file_name)
    VALUES
      (${pid}, ${s.session_date}, ${s.session_time}, ${s.session_sequence}, ${s.modality}, ${s.session_type},
       ${s.therapist_name}, ${s.therapist_credentials}, ${s.therapist_approach}, ${s.duration_minutes}, ${s.language},
       ${s.source_format}, ${sourceKey}, ${transcriptKey}, ${s.transcription_method}, ${s.diarization_confidence},
       ${s.consent_status}, ${s.un_deidentified}, ${s.session_summary}, ${s.summary_pt}, ${s.patient_overall_affect},
       ${contentHash}, ${data.source_file_name})
    ON CONFLICT (patient_id, content_hash) DO NOTHING
    RETURNING id`;

  if (!sessRows.length) {
    console.log("\nSession with this content_hash already ingested -> no-op (append-only). Done.");
    return;
  }
  const sessionId = sessRows[0].id;
  console.log(`\nInserted session ${sessionId}`);

  // ── Children ─────────────────────────────────────────────────────────────
  for (const p of data.participants) {
    await sql`INSERT INTO therapy_participants
      (session_id, patient_id, role, display_name, speaker_label, attribution_confidence, is_tracked_patient, consent_on_file)
      VALUES (${sessionId}, ${p.is_self ? pid : null}, ${p.role}, ${p.display_name || null},
              ${p.speaker_label || null}, ${p.attribution_confidence ?? null},
              ${!!p.is_tracked_patient}, ${p.consent_on_file ?? null})`;
  }

  const themeIdByLabel = {};
  for (const t of data.themes) {
    const r = await sql`INSERT INTO therapy_themes
      (session_id, patient_id, canonical_label, display_label_en, display_label_pt, category,
       salience, valence, description, evidence_anchor, psych_item_id, is_ai_inference, session_date)
      VALUES (${sessionId}, ${pid}, ${t.canonical_label}, ${t.display_label_en}, ${t.display_label_pt}, ${t.category},
              ${t.salience}, ${t.valence}, ${t.description}, ${t.evidence_anchor},
              ${t.psych_legacy_anchor ? anchorMap[t.psych_legacy_anchor] || null : null},
              ${t.is_ai_inference ?? true}, ${s.session_date})
      RETURNING id`;
    themeIdByLabel[t.canonical_label] = r[0].id;
  }

  for (const l of data.lens_interpretations) {
    await sql`INSERT INTO therapy_lens_interpretations
      (session_id, patient_id, lens, construct, construct_label_en, construct_label_pt,
       observation, evidence_anchor, confidence, is_ai_inference, session_date)
      VALUES (${sessionId}, ${pid}, ${l.lens}, ${l.construct}, ${l.construct_label_en}, ${l.construct_label_pt},
              ${l.observation}, ${l.evidence_anchor}, ${l.confidence ?? null}, true, ${s.session_date})`;
  }

  for (const g of data.strengths_growth) {
    await sql`INSERT INTO therapy_strengths_growth
      (session_id, patient_id, polarity, label, description, evidence_anchor, confidence, is_ai_inference, session_date)
      VALUES (${sessionId}, ${pid}, ${g.polarity}, ${g.label}, ${g.description}, ${g.evidence_anchor},
              ${g.confidence ?? null}, ${g.is_ai_inference ?? true}, ${s.session_date})`;
  }

  for (const i of data.interventions) {
    await sql`INSERT INTO therapy_interventions
      (session_id, patient_id, intervention_type, description, assigned_to_role, is_ai_inference, session_date)
      VALUES (${sessionId}, ${pid}, ${i.intervention_type}, ${i.description}, ${i.assigned_to_role || null},
              ${i.is_ai_inference ?? false}, ${s.session_date})`;
  }

  for (const r of data.risk_flags) {
    await sql`INSERT INTO therapy_risk_flags
      (session_id, patient_id, risk_type, severity, description, requires_human_review, session_date)
      VALUES (${sessionId}, ${pid}, ${r.risk_type}, ${r.severity}, ${r.description}, true, ${s.session_date})`;
  }

  for (const q of data.quotes) {
    await sql`INSERT INTO therapy_quotes
      (session_id, patient_id, speaker_role, quote_text, context_note, linked_theme_id, is_ai_inference, session_date)
      VALUES (${sessionId}, ${pid}, ${q.speaker_role || null}, ${q.quote_text}, ${q.context_note || null},
              ${q.linked_theme ? themeIdByLabel[q.linked_theme] || null : null}, ${q.is_ai_inference ?? false}, ${s.session_date})`;
  }

  // ── documents row (provenance + risk-free factual breadcrumb) ────────────
  const summaryText = docSummary(s, data.themes);
  const meta = {
    source_pdf_key: null,
    source_r2_key: sourceKey,
    transcript_r2_key: transcriptKey,
    source_sha256: contentHash,
    therapy_session_id: sessionId,
    un_deidentified: s.un_deidentified,
    review_gated: true,
    classifier: { kind: "therapy_session", summary: summaryText },
  };
  await sql`DELETE FROM documents WHERE patient_id = ${pid} AND metadata->>'source_r2_key' = ${sourceKey}`;
  await sql`INSERT INTO documents
    (patient_id, kind, title, original_filename, blob_key, mime_type, document_date, metadata)
    VALUES (${pid}, 'therapy_session', ${`Therapy session ${s.session_date}`},
            ${data.source_file_name}, ${sourceKey}, 'text/plain', ${s.session_date}, ${JSON.stringify(meta)}::jsonb)`;

  console.log("Children + documents row written.");
}

main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
