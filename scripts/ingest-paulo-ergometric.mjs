#!/usr/bin/env node
/**
 * Ingest Paulo Silotto Souza's 4 ergometric (exercise stress) tests into Neon.
 *
 * Paulo is a bespoke front-end patient: his ergometric series RENDERS from
 * web/assets/paulo-ergometric.js. This DB ingestion is the proper backend
 * store so the data is queryable AND the AI-insight engine (lib/ai-insights.js,
 * Postgres-only) can see it — see project memories "ergometric pipeline" and
 * "bespoke insights need DB backfill".
 *
 * Writes TWO things, both scoped to Paulo and idempotent:
 *   1. ergometric_studies  — dedicated structured table (migration 0016, applied
 *      here via CREATE TABLE IF NOT EXISTS). One row per exam, full record in
 *      exam_json. Dedup on (patient_id, exam_date).
 *   2. documents           — one kind='doctor_report' row per exam, carrying a
 *      dense clinical summary at metadata.classifier.summary. THIS is the only
 *      channel lib/ai-insights.js reads (SELECT metadata->'classifier'->>'summary').
 *
 * Source of truth: the per-exam JSONs in .staging/ergometric-paulo/ (also the
 * canonical copies live in R2 at patients/<clerk>/ergometric/). No other patient
 * or table is touched.
 *
 *   node scripts/ingest-paulo-ergometric.mjs            # dry run (counts only)
 *   node scripts/ingest-paulo-ergometric.mjs --apply    # migrate + delete + insert
 *   DATABASE_URL=... node scripts/ingest-paulo-ergometric.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:paulo-silotto-df3441";
const STAGE = path.join(root, ".staging/ergometric-paulo");
const MIGRATION = path.join(root, "db/migrations/0016_ergometric_studies.sql");
const PDF_DIR = path.join(root, "Patients/Paulo Silotto/New Exams/Ergometric and stress test");

// exam_date -> the actual source PDF filename on disk (for sha + size + filename)
const PDF_BY_DATE = {
  "2011-02-25": "Teste Ergométrico 25-02-2011.pdf",
  "2015-05-12": "Teste Ergométrico + Eco + Doppler Carótidas 12-05-2015.pdf",
  "2017-03-31": "Teste Ergométrico 31-03-2017.pdf",
  "2023-04-04": "Teste Ergométrico 04-04-2023.pdf",
};

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

// Dense, model-facing clinical summary -> metadata.classifier.summary (what the
// AI-insight engine actually reads). English with key PT terms kept.
function summaryOf(e) {
  const sm = e.summary_metrics, p = e.provenance, d = e.demographics_at_exam, c = e.conclusion;
  const bundled = (e.bundled_exams || [])
    .map((b) => `${b.category}: ${b.conclusion_verbatim}`).join("  ");
  const isch = c.ischemia === "negative"
    ? "NEGATIVE for ischaemia (ST segment)"
    : `${String(c.ischemia || "indeterminate").toUpperCase()} for ischaemia`;
  return [
    `${e.protocol.name} ${e.protocol.ergometer || "treadmill"} exercise stress test on ${p.exam_date} (age ${d.age_years}, ${d.weight_kg} kg, BMI ${d.bmi}); ${p.lab || "lab not stated"}${p.city ? ", " + p.city : ""}; ${p.performing_doctor || ""}.`,
    `Peak HR ${sm.fc_max_bpm} bpm (${sm.fc_max_pct_predicted}% predicted), VO2 ${sm.vo2_max_ml_kg_min} ml/kg/min, ${sm.met_max} METs, peak SBP ${sm.pas_max_mmhg} mmHg (rest ${sm.pas_rest_mmhg}), rate-pressure product ${sm.dp_max}, duration ${sm.duration_hms}.`,
    `${isch}; ${c.test_quality} test. Fitness ${sm.aha_fitness || "n/a"} (AHA), NYHA ${sm.nyha_functional_class || "n/a"}.`,
    `Medications: ${(e.medications || []).join(", ") || "none recorded"}.`,
    `Conclusion (verbatim): ${c.verbatim}`,
    bundled ? `Bundled same-visit exams — ${bundled}` : "",
  ].filter(Boolean).join(" ");
}

// Apply migration 0016 (idempotent). The neon http driver is tagged-template
// only, so the DDL is run as literal tagged statements here; db/migrations/
// 0016_ergometric_studies.sql remains the canonical record of the same schema.
async function applyMigration(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS "ergometric_studies" (
      "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "patient_id"            uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
      "exam_date"             date NOT NULL,
      "exam_time"             text,
      "protocol"              text,
      "ergometer"             text,
      "requesting_doctor"     text,
      "performing_doctor"     text,
      "performing_doctor_crm" text,
      "lab"                   text,
      "city"                  text,
      "age_years"             integer,
      "height_cm"             integer,
      "weight_kg"             numeric(5,1),
      "bmi"                   numeric(4,1),
      "fc_max_bpm"            integer,
      "fc_max_predicted_bpm"  integer,
      "fc_max_pct_predicted"  numeric(5,1),
      "vo2_max_ml_kg_min"     numeric(5,2),
      "met_max"               numeric(5,2),
      "pas_rest_mmhg"         integer,
      "pas_max_mmhg"          integer,
      "dp_max"                integer,
      "duration_s"            integer,
      "distance_km"           numeric(5,3),
      "ischemia"              text,
      "test_quality"          text,
      "aha_fitness"           text,
      "nyha_class"            text,
      "conclusion_verbatim"   text,
      "exam_json"             jsonb,
      "source_pdf_key"        text,
      "source_sha"            text,
      "created_at"            timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "ergometric_studies_dedup"
        UNIQUE NULLS NOT DISTINCT ("patient_id", "exam_date")
    )`;
  await sql`
    CREATE INDEX IF NOT EXISTS "ergometric_studies_patient_date_idx"
      ON "ergometric_studies" ("patient_id", "exam_date" DESC)`;
  return 2;
}

async function main() {
  const DB = loadDatabaseUrl();
  if (!DB) { console.error("No DATABASE_URL (env or .env)."); process.exit(1); }
  const sql = neon(DB);

  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${CLERK} LIMIT 1`;
  if (!u.length) { console.error(`Paulo not found for clerk ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  // Load the 4 per-exam JSONs (skip _series.json), sorted by date asc.
  const files = fs.readdirSync(STAGE)
    .filter((f) => f.endsWith("-teste-ergometrico.json"))
    .sort();
  const exams = files.map((f) => {
    const e = JSON.parse(fs.readFileSync(path.join(STAGE, f), "utf8"));
    const pdf = PDF_BY_DATE[e.provenance.exam_date];
    const { sha, size } = pdf ? shaAndSize(path.join(PDF_DIR, pdf)) : { sha: null, size: null };
    return { e, pdfName: pdf || null, sha, size };
  });

  console.log(`Patient ${pid} (${u[0].full_name})`);
  console.log(`Exams found: ${exams.length}`);
  for (const { e, pdfName, sha } of exams) {
    const sm = e.summary_metrics;
    console.log(`  ${e.provenance.exam_date}  ${e.protocol.name.padEnd(9)} FCmax ${sm.fc_max_bpm}  VO2 ${sm.vo2_max_ml_kg_min}  MET ${sm.met_max}  ${e.conclusion.ischemia}  pdf=${pdfName ? "ok" : "MISSING"} sha=${sha ? sha.slice(0, 8) : "—"}`);
  }

  if (!APPLY) {
    const existS = await sql`SELECT count(*)::int n FROM ergometric_studies WHERE patient_id=${pid}`.catch(() => [{ n: "table-absent" }]);
    const existD = await sql`SELECT count(*)::int n FROM documents WHERE patient_id=${pid} AND metadata->>'exam_type'='ergometric_stress_test'`;
    console.log(`\nExisting ergometric_studies: ${existS[0].n} | existing ergometric documents: ${existD[0].n}`);
    console.log("DRY RUN — re-run with --apply to migrate + delete + insert.");
    return;
  }

  const nStmt = await applyMigration(sql);
  console.log(`\nMigration 0016 applied (${nStmt} statements).`);

  // Scoped, idempotent rebuild.
  await sql`DELETE FROM ergometric_studies WHERE patient_id=${pid}`;
  await sql`DELETE FROM documents WHERE patient_id=${pid} AND metadata->>'exam_type'='ergometric_stress_test'`;

  for (const { e, pdfName, sha, size } of exams) {
    const sm = e.summary_metrics, p = e.provenance, d = e.demographics_at_exam, c = e.conclusion;
    await sql`
      INSERT INTO ergometric_studies
        (patient_id, exam_date, exam_time, protocol, ergometer, requesting_doctor,
         performing_doctor, performing_doctor_crm, lab, city, age_years, height_cm,
         weight_kg, bmi, fc_max_bpm, fc_max_predicted_bpm, fc_max_pct_predicted,
         vo2_max_ml_kg_min, met_max, pas_rest_mmhg, pas_max_mmhg, dp_max, duration_s,
         distance_km, ischemia, test_quality, aha_fitness, nyha_class,
         conclusion_verbatim, exam_json, source_pdf_key, source_sha)
      VALUES
        (${pid}, ${p.exam_date}, ${p.exam_time}, ${e.protocol.name}, ${e.protocol.ergometer},
         ${p.requesting_doctor}, ${p.performing_doctor}, ${p.performing_doctor_crm}, ${p.lab}, ${p.city},
         ${d.age_years}, ${d.height_cm}, ${d.weight_kg}, ${d.bmi},
         ${sm.fc_max_bpm}, ${sm.fc_max_predicted_bpm}, ${sm.fc_max_pct_predicted},
         ${sm.vo2_max_ml_kg_min}, ${sm.met_max}, ${sm.pas_rest_mmhg}, ${sm.pas_max_mmhg},
         ${sm.dp_max}, ${sm.duration_s}, ${sm.distance_km}, ${c.ischemia}, ${c.test_quality},
         ${sm.aha_fitness}, ${sm.nyha_functional_class}, ${c.verbatim},
         ${JSON.stringify(e)}::jsonb, ${e.source.source_pdf_r2_key}, ${sha})`;

    const metadata = {
      exam_type: "ergometric_stress_test",
      classifier: {
        category: "Ergometric/StressTest",
        confidence: e.extraction?.confidence || "high",
        summary: summaryOf(e),
      },
      ergometric: e,
      series_ref: "patients/" + CLERK + "/ergometric/_series.json",
    };
    const title = `Teste ergométrico (${e.protocol.name}) — ${ddmmyyyy(p.exam_date)}`;
    await sql`
      INSERT INTO documents
        (patient_id, kind, title, original_filename, blob_key, mime_type,
         size_bytes, document_date, metadata)
      VALUES
        (${pid}, 'doctor_report', ${title}, ${pdfName}, ${e.source.source_pdf_r2_key},
         'application/pdf', ${size}, ${p.exam_date}, ${JSON.stringify(metadata)}::jsonb)`;
  }

  const s = await sql`SELECT count(*)::int n FROM ergometric_studies WHERE patient_id=${pid}`;
  const docs = await sql`SELECT count(*)::int n FROM documents WHERE patient_id=${pid} AND metadata->>'exam_type'='ergometric_stress_test'`;
  console.log(`\nInserted ergometric_studies: ${s[0].n}  documents: ${docs[0].n}`);
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
