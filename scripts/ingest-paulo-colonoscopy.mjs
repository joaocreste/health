#!/usr/bin/env node
/**
 * Additive ingestion of Paulo Augusto Silotto's 2013 total colonoscopy
 * (the "New Exams/Colonoscopy" drop). A report-only study (PDF doctor report,
 * no source imagery) — it renders as a report card in
 * web/assets/patient-context.js (buildPauloOtherStudiesSection, eyebrow 4N) and
 * is mirrored here into imaging_studies so the AI Insights pipeline
 * (lib/ai-insights.js, DB-only) sees it.
 *
 * ADDITIVE + IDEMPOTENT BY DESIGN. Like ingest-paulo-imagery-wave.mjs (and unlike
 * backfill-paulo-clinical.mjs, which DELETEs *all* of Paulo's imaging rows and
 * re-inserts WITHOUT provenance), this script only touches the single row it owns
 * (matched by blob_prefix), so the provenance on the other rows is never clobbered.
 *
 * Usage:  node scripts/ingest-paulo-colonoscopy.mjs [--apply]
 *   (dry-run by default; pass --apply to write)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const DATABASE_URL = process.env.DATABASE_URL || fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
const sql = neon(DATABASE_URL);
const CLERK = "pending:paulo-silotto-df3441";

// modality enum: MRI | CT | PET | US | XR | EEG | ECG | OTHER
const STUDIES = [
  {
    slug: "paulo-colonoscopy-2013-09-10",
    modality: "OTHER", body_part: "Colon / lower GI", study_date: "2013-09-10",
    requesting_doctor: "Dr. Fernando Galante",
    performing_doctor: "Dr. Marcelo de Mello Torquato (CRM 59859); co-signed Dr. Roberto Minoru Naito (CRM 65194)",
    lab_name: "Endofasno Imagem", lab_city: "Ribeirão Preto, SP", lab_country: "Brasil",
    notes:
      "Total colonoscopy, Endofasno Imagem, Ribeirão Preto-SP (Dr. Marcelo de Mello Torquato, CRM 59859; co-signed Dr. Roberto Minoru Naito, CRM 65194; req. Dr. Fernando Galante). Oral 20% mannitol prep (1000 ml) with good cleansing; Pentax EC-380 scope; IV sedation (midazolam 2.5 mg, meperidine 50 mg). Digital rectal exam: normotonic sphincter, no other changes. Ileocecal valve, cecum, ascending colon, hepatic flexure, transverse colon, splenic flexure, descending colon, sigmoid and rectum all macroscopically normal. IMPRESSION: NORMAL TOTAL COLONOSCOPY. No biopsies. Only endoscopic / lower-GI study on file; the descending colon and sigmoid — normal here in 2013 — were later found to harbour diverticulosis on the 2022 abdomen/pelvis CT, dating that change to the intervening decade. (Report-only.)",
  },
];

function row(pid, s) {
  return {
    patient_id: pid,
    modality: s.modality,
    body_part: s.body_part,
    study_date: s.study_date,
    source_format: "JPEG",            // no PDF enum value; report-only -> file_count 0 (matches existing report-only rows)
    blob_prefix: "scans/" + s.slug,
    report_blob_key: "scans/" + s.slug + "-report.pdf",
    jpeg_preview_prefix: null,
    file_count: 0,
    notes: s.notes,
    requesting_doctor: s.requesting_doctor,
    performing_doctor: s.performing_doctor,
    lab_name: s.lab_name,
    lab_city: s.lab_city,
    lab_country: s.lab_country,
  };
}

const main = async () => {
  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id=${CLERK} AND role='patient' LIMIT 1`;
  if (!u.length) { console.error("✗ Paulo not found for clerk", CLERK); process.exit(1); }
  const pid = u[0].id;
  console.log(`Patient: ${u[0].full_name} (${pid})`);

  const before = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`;
  console.log(`Existing imaging_studies rows: ${before[0].n}`);
  for (const s of STUDIES) {
    console.log(`  + ${s.study_date}  ${s.modality}/${s.body_part}  (${s.notes.length} chars)  lab=${s.lab_name}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write. Would upsert 1 row (delete-by-blob_prefix then insert).");
    return;
  }

  const prefixes = STUDIES.map((s) => "scans/" + s.slug);
  const del = await sql`DELETE FROM imaging_studies WHERE patient_id=${pid} AND blob_prefix = ANY(${prefixes})`;
  console.log(`Cleared ${del.length ?? 0} pre-existing row(s) (idempotent re-run).`);

  for (const s of STUDIES) {
    const r = row(pid, s);
    await sql`INSERT INTO imaging_studies
      (patient_id, modality, body_part, study_date, source_format, blob_prefix,
       report_blob_key, jpeg_preview_prefix, file_count, notes,
       requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
      VALUES (${r.patient_id}, ${r.modality}, ${r.body_part}, ${r.study_date}, ${r.source_format}, ${r.blob_prefix},
       ${r.report_blob_key}, ${r.jpeg_preview_prefix}, ${r.file_count}, ${r.notes},
       ${r.requesting_doctor}, ${r.performing_doctor}, ${r.lab_name}, ${r.lab_city}, ${r.lab_country})`;
  }

  await markSourceWritten(sql, pid, { writer: "ingest-paulo-colonoscopy" });

  const after = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`;
  console.log(`✓ Done. imaging_studies rows now: ${after[0].n} (was ${before[0].n}).`);
};

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
