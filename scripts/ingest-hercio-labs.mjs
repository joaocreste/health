#!/usr/bin/env node
/**
 * Ingest Hercio Dias de Souza's lab panel into Neon `lab_results`.
 *
 * Source: DASA / Previlab "Laudo Completo" (17 pp), collection 2026-06-19,
 *   Patients/Hercio Dias de Souza/DOC-20260625-WA0111..pdf
 *
 * Hercio is a Class C (generic DB-driven) patient: no bespoke renderer, no
 * static page. renderExams() in patient-context.js surfaces lab_results
 * automatically, regrouped via web/assets/lab-taxonomy.js — so the DB load IS
 * the visible change.
 *
 * Scope (per the blood/urine ingestion contract):
 *   - CURRENT panel (2026-06-19): every analyte, full provenance + ranges + flags.
 *   - HISTORICAL points: ONLY the exact printed comparison TABLES (total
 *     cholesterol, HDL, triglycerides, uric acid, vitamin D). Graph-read values
 *     are deliberately excluded (transcription risk). Historical rows carry
 *     value + unit only; their per-date provenance is not printed -> NULL (n/a),
 *     never back-attributed from the 2026-06-19 collection.
 *
 * Marker names below ARE the canonical lab-taxonomy.js keys; the script asserts
 * each one exists so the time series merges instead of splitting on a typo.
 *
 * Idempotent, scoped FULL REPLACEMENT of Hercio's labs only:
 *   DELETE FROM lab_results WHERE patient_id=<hercio> then INSERT fresh.
 *   No other patient and no other table is touched.
 *
 * Usage:
 *   node scripts/ingest-hercio-labs.mjs            # dry run
 *   node scripts/ingest-hercio-labs.mjs --apply    # delete+insert in a txn
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:hercio-dias-de-souza-3fd92b";

// ── Provenance for the 2026-06-19 collection (shared by every current row) ──
const COLL = "2026-06-19";
const REQ = "Dr(a) Nivaldo da Silva Lavoura Junior";
const PERF = "Dr. Claudio Romulo Siqueira Filho - CRM-SP 161293";
const LAB = "Previlab (DASA)";
const CITY = "Barueri";
const COUNTRY = "Brasil";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  return m ? m[1] : null;
}

function loadTaxonomy() {
  const src = fs.readFileSync(path.join(root, "web/assets/lab-taxonomy.js"), "utf8");
  const ctx = { window: {}, module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__T = window.LAB_TAXONOMY;", ctx);
  return ctx.__T;
}
const TAX = loadTaxonomy();
const PANEL_EN = {};
for (const p of TAX.PANELS) PANEL_EN[p.key] = p.en;

// ── CURRENT panel rows: [marker, value, valueText, unit, refLow, refHigh, flag] ──
// value xor valueText. flag: 'H' | 'L' | null (as printed on the laudo).
const CUR = [
  // Hemograma — Eritrograma
  ["RBC", 4.60, null, "10^6/µL", 4.50, 5.50, null],
  ["Hemoglobin", 14.4, null, "g/dL", 13.0, 17.0, null],
  ["Hematocrit", 43.7, null, "%", 40.0, 50.0, null],
  ["MCV", 95.1, null, "fL", 83.0, 101.0, null],
  ["MCH", 31.3, null, "pg", 27.0, 32.0, null],
  ["MCHC", 33.0, null, "g/dL", 31.0, 35.0, null],
  ["RDW", 13.1, null, "%", 11.6, 14.0, null],
  // Hemograma — Leucograma
  ["WBC", 5240, null, "/µL", 4000, 10000, null],
  ["Neutrophils", 63.6, null, "%", 40.0, 80.0, null],
  ["Neutrophils (abs)", 3333, null, "/µL", 1800, 7800, null],
  ["Eosinophils", 4.8, null, "%", 1.0, 6.0, null],
  ["Eosinophils (abs)", 252, null, "/µL", 20, 500, null],
  ["Basophils", 0.6, null, "%", 0.0, 2.0, null],
  ["Basophils (abs)", 31, null, "/µL", 20, 100, null],
  ["Lymphocytes", 22.4, null, "%", 20.0, 40.0, null],
  ["Lymphocytes (abs)", 1174, null, "/µL", 1000, 3000, null],
  ["Monocytes", 8.6, null, "%", 2.0, 10.0, null],
  ["Monocytes (abs)", 451, null, "/µL", 200, 1000, null],
  // Plaquetas
  ["Platelets", 240000, null, "/µL", 150000, 450000, null],
  ["MPV", 8.7, null, "fL", 8.3, 12.5, null],
  // Ferro
  ["Ferritin", 53.0, null, "ng/mL", 30.0, 400.0, null],
  // Função renal
  ["Creatinine", 1.21, null, "mg/dL", 0.70, 1.30, null],
  ["eGFR", 66, null, "mL/min/1.73m²", 90, null, "L"],   // ref: superior a 90
  ["Uric acid", 4.9, null, "mg/dL", 3.4, 7.0, null],
  // Glicemia e diabetes
  ["Fasting glucose", 102, null, "mg/dL", 70, 99, "H"],
  ["HbA1c", 5.2, null, "%", null, 5.7, null],            // ref: normal inferior a 5,7%
  ["Estimated average glucose", 101, null, "mg/dL", null, null, null],
  // Lipidograma
  ["Total cholesterol", 199, null, "mg/dL", null, 190, null], // desejável < 190
  ["LDL-C", 107, null, "mg/dL", null, null, null],            // alvo risco-estratificado
  ["HDL-C", 75, null, "mg/dL", 40, null, null],               // desejável > 40
  ["VLDL", 17, null, "mg/dL", null, null, null],
  ["Triglycerides", 80, null, "mg/dL", null, 150, null],      // com jejum < 150
  // Tireoide
  ["TSH", 5.06, null, "µUI/mL", 0.40, 5.80, null],
  // Hormônios
  ["Prolactin", 24.20, null, "ng/mL", 4.00, 15.20, "H"],     // repetido e confirmado
  ["Testosterone (total)", 588.0, null, "ng/dL", 193.0, 740.0, null], // ref masc +50a
  // Vitaminas
  ["Vitamin D (25-OH)", 42, null, "ng/mL", 30, 60, null],    // >60a / grupos de risco: 30–60
  // Marcadores tumorais
  ["PSA total", 2.31, null, "ng/mL", null, 4.00, null],
  // Urina Tipo I
  ["Specific gravity (urine)", 1.012, null, null, 1.005, 1.035, null],
  ["pH (urine)", 6.0, null, null, 4.5, 7.5, null],
  ["Color (urine)", null, "Amarelo Claro", null, null, null, null],
  ["Protein (urine)", null, "Negativo", null, null, null, null],
  ["Glucose (urine)", null, "Negativo", null, null, null, null],
  ["Ketones (urine)", null, "Negativo", null, null, null, null],
  ["Bilirubin (urine)", null, "Negativo", null, null, null, null],
  ["Nitrite (urine)", null, "Negativo", null, null, null, null],
  ["Blood (urine)", null, "Negativo", null, null, null, null],
  ["Leukocytes (urine)", 1000, null, "/mL", null, 25000, null],
  ["Erythrocytes (urine)", 5300, null, "/mL", null, 23000, null],
  ["Epithelial cells (urine)", null, "Negativo", null, null, null, null],
];

// ── HISTORICAL points from the exact printed tables: [marker, unit, [[date,value],...]] ──
// Provenance NULL (per-date provenance not printed). The 2026-06-19 column is the
// current panel above and is excluded here to avoid a (marker,date) duplicate.
const HIST = [
  ["Total cholesterol", "mg/dL", [["2022-07-23", 150], ["2022-08-15", 173], ["2025-01-11", 184], ["2026-01-06", 185]]],
  ["HDL-C", "mg/dL", [["2022-07-23", 68], ["2022-08-15", 62], ["2025-01-11", 72], ["2026-01-06", 69]]],
  ["Triglycerides", "mg/dL", [["2022-07-23", 64], ["2022-08-15", 102], ["2025-01-11", 79], ["2026-01-06", 99]]],
  ["Uric acid", "mg/dL", [["2022-08-15", 5.5], ["2025-01-11", 6.0], ["2026-01-06", 4.8]]],
  ["Vitamin D (25-OH)", "ng/mL", [["2022-08-15", 25], ["2024-02-08", 52], ["2025-01-11", 44], ["2026-01-06", 54]]],
];

function panelFor(marker) {
  const meta = TAX.MARKERS[marker];
  if (!meta) { console.error(`✗ marker not in taxonomy: "${marker}"`); process.exit(1); }
  return PANEL_EN[meta.panel];
}

function buildRows() {
  const rows = [];
  const seen = new Set();
  // current panel — full provenance
  for (const [marker, value, valueText, unit, refLow, refHigh, flag] of CUR) {
    const key = marker + "|" + COLL;
    if (seen.has(key)) { console.error(`✗ dup in CUR: ${key}`); process.exit(1); }
    seen.add(key);
    rows.push({
      panel: panelFor(marker), marker, value, value_text: valueText, unit,
      ref_low: refLow, ref_high: refHigh, flag, taken_at: COLL,
      laboratory: LAB, lab_city: CITY, lab_country: COUNTRY,
      requesting_doctor: REQ, performing_doctor: PERF,
    });
  }
  // historical points — value + unit only, provenance NULL
  for (const [marker, unit, points] of HIST) {
    panelFor(marker); // validate
    for (const [date, value] of points) {
      const key = marker + "|" + date;
      if (seen.has(key)) continue; // skip if it collides with the current panel
      seen.add(key);
      rows.push({
        panel: panelFor(marker), marker, value, value_text: null, unit,
        ref_low: null, ref_high: null, flag: null, taken_at: date,
        laboratory: null, lab_city: null, lab_country: null,
        requesting_doctor: null, performing_doctor: null,
      });
    }
  }
  return rows;
}

const rows = buildRows();

function summarize() {
  const dates = [...new Set(rows.map((r) => r.taken_at))].sort();
  const panels = [...new Set(rows.map((r) => r.panel))];
  const flagged = rows.filter((r) => r.flag);
  console.log("── Hercio Dias de Souza lab_results extraction ──");
  console.log(`rows            : ${rows.length} (${CUR.length} current + ${rows.length - CUR.length} historical)`);
  console.log(`distinct dates  : ${dates.length} (${dates.join(", ")})`);
  console.log(`panels (${panels.length})     : ${panels.join(", ")}`);
  console.log(`flagged (H/L)   : ${flagged.map((r) => `${r.marker}=${r.value}${r.flag}`).join(", ")}`);
  console.log(`sample current  : ${JSON.stringify(rows[0])}`);
  console.log(`sample historic : ${JSON.stringify(rows[CUR.length])}`);
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("✗ DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);
  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const before = await sql`SELECT count(*)::int n FROM lab_results WHERE patient_id=${pid}`;
  const queries = [
    sql`DELETE FROM lab_results WHERE patient_id=${pid}`,
    ...rows.map((r) => sql`
      INSERT INTO lab_results
        (patient_id, panel, marker, value, value_text, unit, ref_low, ref_high, flag,
         taken_at, laboratory, lab_city, lab_country, requesting_doctor, performing_doctor)
      VALUES
        (${pid}, ${r.panel}, ${r.marker}, ${r.value}, ${r.value_text}, ${r.unit},
         ${r.ref_low}, ${r.ref_high}, ${r.flag}, ${r.taken_at}::date,
         ${r.laboratory}, ${r.lab_city}, ${r.lab_country}, ${r.requesting_doctor}, ${r.performing_doctor})`),
  ];
  await sql.transaction(queries);
  const after = await sql`SELECT count(*)::int n, count(DISTINCT marker)::int markers, min(taken_at) mn, max(taken_at) mx FROM lab_results WHERE patient_id=${pid}`;
  console.log(`\npatient pid : ${pid}`);
  console.log(`lab_results before -> after : ${before[0].n} -> ${after[0].n} (${after[0].markers} markers, ${after[0].mn} … ${after[0].mx})`);
  console.log("✓ Hercio lab_results loaded.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
