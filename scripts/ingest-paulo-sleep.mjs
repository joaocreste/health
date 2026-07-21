#!/usr/bin/env node
/**
 * Ingest Paulo Augusto Silotto Dias de Souza's two sleep-medicine exams into Neon.
 *
 *   A) PSG  2017-05-05 (INCEF, Dr. João Espir Filho)  -> sleep_studies (migration
 *      0019, applied here via CREATE TABLE IF NOT EXISTS) + a documents row.
 *   B) DISE 2019-09-26 (Dr. Fábio Rabelo)             -> imaging_studies (report-
 *      only, modality OTHER, colonoscopy precedent) + a documents row.
 *
 * Every exam ALSO gets one documents row (kind='doctor_report') carrying a dense
 * English model-facing summary at metadata.classifier.summary — THE only channel
 * lib/ai-insights.js reads (SELECT metadata->'classifier'->>'summary'). The full
 * lumen.sleep_study.v1 record (verbatim PT narrative + reconciliation) is kept in
 * exam_json (sleep_studies) / notes (imaging_studies) / metadata (documents).
 *
 * Source of truth: the per-exam JSONs in .staging/sleep-paulo/ — sourced verbatim
 * from the ORIGINAL report pages, never the Lumen triage cover. Idempotent:
 *   - sleep_studies  dedup (patient_id, exam_date, subtype)
 *   - imaging_studies delete-by blob_prefix (scoped, additive — never clobbers
 *                     other imaging rows' provenance)
 *   - documents       delete-by metadata->>'source_pdf_key'
 *
 *   node scripts/ingest-paulo-sleep.mjs            # dry run (planned writes only)
 *   node scripts/ingest-paulo-sleep.mjs --apply    # migrate + delete + insert
 *   DATABASE_URL=... node scripts/ingest-paulo-sleep.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:paulo-silotto-df3441";
const STAGE = path.join(root, ".staging/sleep-paulo");
const PDF_DIR = path.join(root, "Patients/Paulo Silotto/New Exams/Sleep Studies");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    return m ? m[1] : null;
  } catch { return null; }
}

function ddmmyyyy(iso) { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; }

function shaAndSize(file) {
  try {
    const buf = fs.readFileSync(file);
    return { sha: crypto.createHash("sha256").update(buf).digest("hex"), size: buf.length };
  } catch { return { sha: null, size: null }; }
}

const n = (v) => (v === null || v === undefined ? "—" : v);

// ── Dense, model-facing clinical summaries -> metadata.classifier.summary ──────
function summaryPSG(e) {
  const m = e.metrics, p = e.provenance, d = e.demographics_at_exam;
  return [
    `Whole-night polysomnography on ${p.exam_date} (age ${d.age_years}, ${d.weight_kg} kg, BMI ${d.bmi}); ${p.lab || "lab not stated"}${p.city ? ", " + p.city : ""}; ${p.performing_doctor || "physician not stated"}.`,
    `AHI/IAH ${m.ahi_iah}/h (obstructive ${m.ahi_obstructive}, hypopnoea ${m.ahi_hypopnea}); ${m.ventilatory_events_total} ventilatory events (${m.ventilatory_events_obstructive} obstructive, ${m.ventilatory_events_central} central, ${m.ventilatory_events_mixed} mixed, ${m.ventilatory_events_hypopnea} hypopnoea); ${m.rera_count} RERA; max event ${m.max_event_duration_s} s.`,
    `Sleep efficiency ${m.sleep_efficiency_pct}%, TST ${m.total_sleep_time_min} min, WASO ${m.waso_min} min; N-REM latency ${m.nrem_latency_min} min, REM latency ${m.rem_latency_min} min; stages N1 ${m.stage_n1_pct}% / N2 ${m.stage_n2_pct}% / N3 (R&K 3+4) ${m.stage_n34_pct}% / REM ${m.stage_rem_pct}%; arousal index ${m.arousal_index}/h (${m.awakenings_count} awakenings, ${m.micro_arousals_count} micro-arousals).`,
    `Snore index ${m.snore_index}/h (${m.snore_count_total} snores). Oximetry: baseline ${m.spo2_baseline}%, mean ${m.spo2_mean}%, max ${m.spo2_max}%, nadir ${m.spo2_nadir}%; ${m.time_below_90_min} min (${m.time_below_90_pct}%) below 90%; ${m.desaturation_count} desaturations; ODI not stated as an index.`,
    `Severity: ${m.severity} ${m.severity_type} obstructive sleep apnoea.`,
    `Conclusion (verbatim PT): ${e.narrative_verbatim.conclusao.replace(/\n/g, " ")}`,
  ].join(" ");
}

function summaryDISE(e) {
  const p = e.provenance, s = e.procedure, v = e.vote;
  const vote = `Velum ${v.velum.degree}${v.velum.config || ""} (${v.velum.config_label_en}), Oropharynx ${v.oropharynx.degree}${v.oropharynx.config || ""} (${v.oropharynx.config_label_en}), Tongue base ${v.tongue_base.degree}${v.tongue_base.config || ""} (${v.tongue_base.config_label_en}), Epiglottis ${v.epiglottis.degree} (${v.epiglottis.config_label_en})`;
  const man = e.maneuvers.map((x) => `${x.maneuver_en} — ${x.result_en}`).join("; ");
  return [
    `Drug-induced sleep endoscopy (DISE) on ${p.exam_date} (age ${e.demographics_at_exam.age_years}); requested by ${p.requesting_doctor || "not stated"}; lab/city not stated; attendance ${p.attendance || "n/a"}.`,
    `${s.route} under ${s.sedation_agent}, effect-site ${s.sedation_effect_conc}, BIS ${s.bis_range}, no topical anaesthetic.`,
    `VOTE (Kezirian 2011): ${vote}. Complete (grade 2) multilevel collapse at velum, oropharynx and tongue base; epiglottis normal.`,
    `Manoeuvres: ${man}.`,
    `Findings (verbatim PT): ${e.narrative_verbatim.descricao_sumaria.replace(/\n/g, " ")}`,
  ].join(" ");
}

// Dense imaging_studies.notes for the DISE row (also read by ai-insights).
function notesDISE(e) {
  return summaryDISE(e) + " (Report-only — drug-induced sleep endoscopy of the upper airway; no source imagery.)";
}

// Apply migration 0019 (idempotent). neon http driver is tagged-template only, so
// the DDL runs as a literal tagged statement; db/migrations/0019_sleep_studies.sql
// remains the canonical record of the same schema.
async function applyMigration(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS "sleep_studies" (
      "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "patient_id"               uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "exam_date"                date NOT NULL,
      "exam_datetime"            timestamptz,
      "subtype"                  text NOT NULL DEFAULT 'PSG',
      "requesting_doctor"        text,
      "performing_doctor"        text,
      "lab"                      text,
      "city"                     text,
      "country"                  text,
      "attendance"               text,
      "age_years"                integer,
      "weight_kg"                numeric(5,1),
      "height_cm"                integer,
      "bmi"                      numeric(4,1),
      "ahi_iah"                  numeric(5,2),
      "ahi_obstructive"          numeric(5,2),
      "ahi_hypopnea"             numeric(5,2),
      "rdi_itv"                  numeric(5,2),
      "events_total"             integer,
      "events_obstructive"       integer,
      "events_central"           integer,
      "events_mixed"             integer,
      "events_hypopnea"          integer,
      "rera_count"               integer,
      "max_event_duration_s"     numeric(6,2),
      "sleep_efficiency_pct"     numeric(5,2),
      "total_sleep_time_min"     numeric(6,1),
      "waso_min"                 numeric(6,1),
      "wake_time_min"            numeric(6,1),
      "nrem_latency_min"         numeric(6,1),
      "rem_latency_min"          numeric(6,1),
      "stage_n1_pct"             numeric(5,2),
      "stage_n2_pct"             numeric(5,2),
      "stage_n34_pct"            numeric(5,2),
      "stage_rem_pct"            numeric(5,2),
      "staging_system"           text,
      "awakenings_count"         integer,
      "micro_arousals_count"     integer,
      "arousal_index"            numeric(5,2),
      "snore_index"              numeric(6,2),
      "snore_count_total"        integer,
      "spo2_baseline"            numeric(5,2),
      "spo2_mean"                numeric(5,2),
      "spo2_max"                 numeric(5,2),
      "spo2_nadir"               numeric(5,2),
      "time_below_90_min"        numeric(6,2),
      "time_below_90_pct"        numeric(5,2),
      "desaturation_count"       integer,
      "odi_ido"                  numeric(5,2),
      "severity"                 text,
      "severity_type"            text,
      "comments_verbatim"        text,
      "conclusion_verbatim"      text,
      "exam_json"                jsonb,
      "source_pdf_key"           text,
      "source_sha"               text,
      "created_at"               timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "sleep_studies_dedup"
        UNIQUE NULLS NOT DISTINCT ("patient_id", "exam_date", "subtype")
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS "sleep_studies_patient_date_idx"
      ON "sleep_studies" ("patient_id", "exam_date" DESC)`;
}

async function insertDocument(sql, pid, e, summary, pdfName, size) {
  const metadata = {
    exam_type: "sleep_study",
    subtype: e.subtype,
    category: e.subtype === "PSG" ? "Polysomnography/SleepApnea" : "Sleep Endoscopy (DISE)",
    classifier: { category: e.subtype === "PSG" ? "Polysomnography/SleepApnea" : "Sleep Endoscopy (DISE)", confidence: "high", summary },
    source_pdf_key: e.source.source_pdf_r2_key,
    report_scan_key: e.source.report_scan_key,
    provenance: e.provenance,
    reconciliation: e.reconciliation,
    sleep_study: e,
  };
  const title = `${e.title_en} — ${ddmmyyyy(e.provenance.exam_date)}`;
  await sql`
    INSERT INTO documents
      (patient_id, kind, title, original_filename, blob_key, mime_type,
       size_bytes, document_date, metadata)
    VALUES
      (${pid}, 'doctor_report', ${title}, ${pdfName}, ${e.source.source_pdf_r2_key},
       'application/pdf', ${size}, ${e.provenance.exam_date}, ${JSON.stringify(metadata)}::jsonb)`;
}

async function main() {
  const DB = loadDatabaseUrl();
  if (!DB) { console.error("✗ No DATABASE_URL (env or .env)."); process.exit(1); }
  const sql = neon(DB);

  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${CLERK} AND role='patient' LIMIT 1`;
  if (!u.length) { console.error(`✗ Paulo not found for clerk ${CLERK}`); process.exit(1); }
  const pid = u[0].id;
  console.log(`Patient: ${u[0].full_name} (${pid})\n`);

  const psg = JSON.parse(fs.readFileSync(path.join(STAGE, "2017-05-05-polissonografia.json"), "utf8"));
  const dise = JSON.parse(fs.readFileSync(path.join(STAGE, "2019-09-26-sonoendoscopia-do-sono.json"), "utf8"));
  const psgPdf = shaAndSize(path.join(PDF_DIR, psg.source.original_filename));
  const disePdf = shaAndSize(path.join(PDF_DIR, dise.source.original_filename));

  const m = psg.metrics;
  console.log("── A) PSG -> sleep_studies + documents ───────────────────────────");
  console.log(`   ${psg.provenance.exam_date}  AHI ${m.ahi_iah}/h (obstr ${m.ahi_obstructive}, hyp ${m.ahi_hypopnea})  events ${m.ventilatory_events_total} (${m.ventilatory_events_obstructive}o/${m.ventilatory_events_central}c/${m.ventilatory_events_mixed}m/${m.ventilatory_events_hypopnea}h)`);
  console.log(`   eff ${m.sleep_efficiency_pct}%  TST ${m.total_sleep_time_min}min  arousal ${m.arousal_index}/h  snore ${m.snore_index}/h  SpO2 nadir ${m.spo2_nadir}%  desat ${m.desaturation_count}  ODI ${n(m.odi_ido)}  severity ${m.severity}/${m.severity_type}`);
  console.log(`   lab ${psg.provenance.lab}  exec ${psg.provenance.performing_doctor}  req ${n(psg.provenance.requesting_doctor)}  pdf ${psgPdf.sha ? "ok " + psgPdf.sha.slice(0, 8) : "MISSING"}`);
  console.log(`   R2 key ${psg.source.source_pdf_r2_key}`);

  const v = dise.vote;
  console.log("\n── B) DISE -> imaging_studies (modality OTHER) + documents ───────");
  console.log(`   ${dise.provenance.exam_date}  VOTE V${v.velum.degree}${v.velum.config} O${v.oropharynx.degree}${v.oropharynx.config} T${v.tongue_base.degree}${v.tongue_base.config} E${v.epiglottis.degree}  propofol ${dise.procedure.sedation_effect_conc} BIS ${dise.procedure.bis_range}`);
  console.log(`   req ${dise.provenance.requesting_doctor}  exec ${dise.provenance.performing_doctor}  lab ${n(dise.provenance.lab)}  attendance ${dise.provenance.attendance}  pdf ${disePdf.sha ? "ok " + disePdf.sha.slice(0, 8) : "MISSING"}`);
  console.log(`   blob_prefix scans/${dise.source.slug}  R2 key ${dise.source.source_pdf_r2_key}`);

  console.log("\n── Reconciliation (original wins) ────────────────────────────────");
  for (const r of [...psg.reconciliation, ...dise.reconciliation])
    console.log(`   [${psg.reconciliation.includes(r) ? "PSG" : "DISE"}] ${r.field}: cover='${r.cover_value}' -> original='${r.original_value}' (kept ${r.kept})`);

  if (!APPLY) {
    const sExist = await sql`SELECT count(*)::int n FROM sleep_studies WHERE patient_id=${pid}`.catch(() => [{ n: "table-absent" }]);
    const iExist = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid} AND blob_prefix=${"scans/" + dise.source.slug}`;
    const dExist = await sql`SELECT count(*)::int n FROM documents WHERE patient_id=${pid} AND metadata->>'exam_type'='sleep_study'`;
    console.log(`\nExisting: sleep_studies=${sExist[0].n}  this-DISE-imaging=${iExist[0].n}  sleep documents=${dExist[0].n}`);
    console.log("\nDRY RUN — re-run with --apply to migrate + delete + insert.");
    return;
  }

  await applyMigration(sql);
  console.log("\nMigration 0019 applied (sleep_studies).");

  // A) PSG — sleep_studies (dedup on patient+date+subtype) + documents
  await sql`DELETE FROM sleep_studies WHERE patient_id=${pid} AND exam_date=${psg.provenance.exam_date} AND subtype=${psg.subtype}`;
  await sql`DELETE FROM documents WHERE patient_id=${pid} AND metadata->>'source_pdf_key'=${psg.source.source_pdf_r2_key}`;
  {
    const p = psg.provenance, d = psg.demographics_at_exam;
    await sql`
      INSERT INTO sleep_studies
        (patient_id, exam_date, exam_datetime, subtype, requesting_doctor, performing_doctor,
         lab, city, country, attendance, age_years, weight_kg, height_cm, bmi,
         ahi_iah, ahi_obstructive, ahi_hypopnea, rdi_itv, events_total, events_obstructive,
         events_central, events_mixed, events_hypopnea, rera_count, max_event_duration_s,
         sleep_efficiency_pct, total_sleep_time_min, waso_min, wake_time_min, nrem_latency_min,
         rem_latency_min, stage_n1_pct, stage_n2_pct, stage_n34_pct, stage_rem_pct, staging_system,
         awakenings_count, micro_arousals_count, arousal_index, snore_index, snore_count_total,
         spo2_baseline, spo2_mean, spo2_max, spo2_nadir, time_below_90_min, time_below_90_pct,
         desaturation_count, odi_ido, severity, severity_type, comments_verbatim, conclusion_verbatim,
         exam_json, source_pdf_key, source_sha)
      VALUES
        (${pid}, ${p.exam_date}, ${p.exam_datetime}, ${psg.subtype}, ${p.requesting_doctor}, ${p.performing_doctor},
         ${p.lab}, ${p.city}, ${p.country}, ${p.attendance}, ${d.age_years}, ${d.weight_kg}, ${d.height_cm}, ${d.bmi},
         ${m.ahi_iah}, ${m.ahi_obstructive}, ${m.ahi_hypopnea}, ${m.rdi_itv}, ${m.ventilatory_events_total}, ${m.ventilatory_events_obstructive},
         ${m.ventilatory_events_central}, ${m.ventilatory_events_mixed}, ${m.ventilatory_events_hypopnea}, ${m.rera_count}, ${m.max_event_duration_s},
         ${m.sleep_efficiency_pct}, ${m.total_sleep_time_min}, ${m.waso_min}, ${m.wake_time_min}, ${m.nrem_latency_min},
         ${m.rem_latency_min}, ${m.stage_n1_pct}, ${m.stage_n2_pct}, ${m.stage_n34_pct}, ${m.stage_rem_pct}, ${m.staging_system},
         ${m.awakenings_count}, ${m.micro_arousals_count}, ${m.arousal_index}, ${m.snore_index}, ${m.snore_count_total},
         ${m.spo2_baseline}, ${m.spo2_mean}, ${m.spo2_max}, ${m.spo2_nadir}, ${m.time_below_90_min}, ${m.time_below_90_pct},
         ${m.desaturation_count}, ${m.odi_ido}, ${m.severity}, ${m.severity_type}, ${psg.narrative_verbatim.comentarios}, ${psg.narrative_verbatim.conclusao},
         ${JSON.stringify(psg)}::jsonb, ${psg.source.source_pdf_r2_key}, ${psgPdf.sha})`;
    await insertDocument(sql, pid, psg, summaryPSG(psg), psg.source.original_filename, psgPdf.size);
  }

  // B) DISE — imaging_studies (additive, delete-by blob_prefix) + documents
  const disePrefix = "scans/" + dise.source.slug;
  await sql`DELETE FROM imaging_studies WHERE patient_id=${pid} AND blob_prefix=${disePrefix}`;
  await sql`DELETE FROM documents WHERE patient_id=${pid} AND metadata->>'source_pdf_key'=${dise.source.source_pdf_r2_key}`;
  {
    const p = dise.provenance;
    await sql`
      INSERT INTO imaging_studies
        (patient_id, modality, body_part, study_date, source_format, blob_prefix,
         report_blob_key, jpeg_preview_prefix, file_count, notes,
         requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
      VALUES
        (${pid}, 'OTHER', 'Upper airway (velum / oropharynx / tongue base / epiglottis)', ${p.exam_date}, 'JPEG', ${disePrefix},
         ${disePrefix + "-report.pdf"}, NULL, 0, ${notesDISE(dise)},
         ${p.requesting_doctor}, ${p.performing_doctor}, ${p.lab}, ${p.city}, ${p.country})`;
    await insertDocument(sql, pid, dise, summaryDISE(dise), dise.source.original_filename, disePdf.size);
  }

  const s = await sql`SELECT count(*)::int n FROM sleep_studies WHERE patient_id=${pid}`;
  const i = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid} AND blob_prefix=${disePrefix}`;
  const docs = await sql`SELECT count(*)::int n FROM documents WHERE patient_id=${pid} AND metadata->>'exam_type'='sleep_study'`;
  console.log(`\n✓ Inserted — sleep_studies(PSG): ${s[0].n}  imaging_studies(DISE): ${i[0].n}  sleep documents: ${docs[0].n}`);
  await markSourceWritten(sql, pid, { writer: "ingest-paulo-sleep" });
  console.log("Done.");
}

main().catch((e) => { console.error("✗", e); process.exit(1); });
