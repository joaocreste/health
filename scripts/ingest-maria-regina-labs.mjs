#!/usr/bin/env node
/**
 * Ingest Maria Regina Coury's lab history into Neon `lab_results`.
 *
 * Source: 10 DASA "Laudo Completo" PDFs (2023-02-15 … 2026-02-02), extracted and
 * normalized to the blood/urine ingestion schema. The extraction artifact (PHI)
 * lives OUTSIDE git under Patients/<name>/Blood & Urine/extracted-labs.json; this
 * loader maps its `results[]` into the normalized DB so the AI-insight engine
 * (which reads the DB via assembleRecord) sees real data.
 *
 * Mapping results[] -> lab_results:
 *   panel             <- category (canonical "where it lives" group)
 *   marker            <- canonical_analyte; for analytes reported BOTH as % and as
 *                        an absolute count (the WBC differential) the % row keeps
 *                        the base name and the absolute row is suffixed " (abs)",
 *                        so the two never collide on (marker, taken_at).
 *   value / value_text<- value_numeric / value_text
 *   unit              <- unit_reported (verbatim)
 *   ref_low/ref_high  <- lab's printed range
 *   flag              <- low->L, critical_low->LL, high->H, critical_high->HH,
 *                        abnormal->A, normal/null -> null
 *   taken_at          <- collection_date
 *   laboratory        <- lab_name
 *   requesting_doctor <- requesting_doctor
 *
 * Scoped, idempotent FULL REPLACEMENT of Maria Regina's labs only:
 *   DELETE FROM lab_results WHERE patient_id = <mrc>  then INSERT fresh.
 *   No other patient and no other table is touched. Writes ONLY lab_results.
 *
 * Usage:
 *   node scripts/ingest-maria-regina-labs.mjs            # dry run
 *   node scripts/ingest-maria-regina-labs.mjs --apply    # delete+insert in a txn
 *   PAYLOAD=/path/to/extracted-labs.json node scripts/ingest-maria-regina-labs.mjs
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:maria-regina-coury-0cfb1b";
const PAYLOAD_PATH = process.env.PAYLOAD ||
  path.join(root, "Patients/Maria Regina Coury/Blood & Urine/extracted-labs.json");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  return m ? m[1] : null;
}

const FLAG_MAP = {
  low: "L", critical_low: "LL", high: "H", critical_high: "HH", abnormal: "A",
  normal: null, null: null,
};

// Single source of truth for marker normalization + panel grouping. Loaded the
// same way scripts/ingest-silvana-labs.mjs loads its browser asset, so the DB
// names stay in lockstep with what renderExams() shows.
function loadTaxonomy() {
  const src = fs.readFileSync(path.join(root, "web/assets/lab-taxonomy.js"), "utf8");
  const ctx = { window: {}, module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__T = window.LAB_TAXONOMY;", ctx);
  return ctx.__T;
}
const TAX = loadTaxonomy();
const PANEL_EN = {}; // panelKey -> EN title
for (const p of TAX.PANELS) PANEL_EN[p.key] = p.en;

// Route analytes the taxonomy doesn't recognize (rarer markers carried by the
// historical backfill: autoimmune, serology, cardiac, coagulation factors, etc.)
// into the SAME canonical panel buckets the mapped markers use, by category
// keyword. Without this they land under their raw category string and render as
// duplicate panels ("Lipid Profile" vs "Lipid Profile / Cardiovascular Risk")
// plus per-agent spelling drift. Falls back to the 'other' panel.
function categoryPanel(category) {
  const c = String(category || "").toLowerCase();
  if (/lipid/.test(c)) return PANEL_EN.lipids;
  if (/glucose|glyc|glic|diabet/.test(c)) return PANEL_EN.glycemia;
  if (/kidney|renal/.test(c)) return PANEL_EN.kidney;
  if (/liver|hepat/.test(c)) return PANEL_EN.liver;
  if (/electrolyt|mineral/.test(c)) return PANEL_EN.minerals;
  if (/iron|anemia/.test(c)) return PANEL_EN.iron;
  if (/thyroid/.test(c)) return PANEL_EN.thyroid;
  if (/hormon|endocrine/.test(c)) return PANEL_EN.hormonal;
  if (/inflammation|immune/.test(c)) return PANEL_EN.inflammation;
  if (/serology|infectious/.test(c)) return PANEL_EN.serology;
  if (/tumor/.test(c)) return PANEL_EN.tumor;
  if (/coagulation|clotting/.test(c)) return PANEL_EN.platelets;
  if (/urinalysis|urine/.test(c)) return PANEL_EN.urine;
  if (/vitamin|nutritional/.test(c)) return PANEL_EN.vitamins;
  if (/hematology|cbc/.test(c)) return PANEL_EN.cbc_leuko;
  return PANEL_EN.other;
}

const payload = JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
const results = payload.results || [];

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

function buildRows() {
  const rows = [];
  const seen = new Set(); // (marker|date) — guard against two raw spellings colliding on one date
  let unmapped = 0;
  for (const r of results) {
    if (!isDay(r.collection_date)) continue;
    const marker = TAX.canonicalMarker(r.canonical_analyte, r.unit_reported, r.category);
    const meta = TAX.MARKERS[marker];
    if (!meta) unmapped++;
    const panel = meta ? PANEL_EN[meta.panel] : categoryPanel(r.category);
    const key = marker + "|" + r.collection_date;
    if (seen.has(key)) continue;
    seen.add(key);
    const numeric = typeof r.value_numeric === "number" && isFinite(r.value_numeric);
    rows.push({
      panel,
      marker,
      value: numeric ? r.value_numeric : null,
      value_text: numeric ? null : (r.value_text ?? null),
      unit: r.unit_reported || null,
      ref_low: typeof r.ref_low === "number" ? r.ref_low : null,
      ref_high: typeof r.ref_high === "number" ? r.ref_high : null,
      flag: r.flag in FLAG_MAP ? FLAG_MAP[r.flag] : null,
      taken_at: r.collection_date,
      laboratory: r.lab_name || null,
      lab_city: r.lab_city || null,
      lab_country: r.lab_country || null,
      requesting_doctor: r.requesting_doctor || null,
      performing_doctor: r.performing_doctor || null,
    });
  }
  rows._unmapped = unmapped;
  return rows.filter((r) => r.marker);
}

const rows = buildRows();

function summarize() {
  const dates = [...new Set(rows.map((r) => r.taken_at))].sort();
  const panels = [...new Set(rows.map((r) => r.panel))];
  const markers = [...new Set(rows.map((r) => r.marker))];
  const flagged = rows.filter((r) => r.flag).length;
  console.log("── Maria Regina Coury lab_results extraction ──");
  console.log(`payload         : ${PAYLOAD_PATH}`);
  console.log(`rows            : ${rows.length}  (of ${results.length} results, after name-canonicalization + per-date dedup)`);
  console.log(`distinct markers: ${markers.length}  (canonicalized via lab-taxonomy.js)`);
  console.log(`unmapped markers: ${rows._unmapped} (fell back to category panel — review if > 0)`);
  console.log(`distinct dates  : ${dates.length}  (${dates[0]} … ${dates[dates.length - 1]})`);
  console.log(`panels (${panels.length})     : ${panels.join(", ")}`);
  console.log(`out-of-range    : ${flagged} flagged (H/L)`);
  console.log(`sample row      : ${JSON.stringify(rows[0])}`);
  console.log(`sample flagged  : ${JSON.stringify(rows.find((r) => r.flag) || null)}`);
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
        (patient_id, panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at, laboratory, lab_city, lab_country, requesting_doctor, performing_doctor)
      VALUES
        (${pid}, ${r.panel}, ${r.marker}, ${r.value}, ${r.value_text}, ${r.unit}, ${r.ref_low}, ${r.ref_high}, ${r.flag},
         ${r.taken_at}::date, ${r.laboratory}, ${r.lab_city}, ${r.lab_country}, ${r.requesting_doctor}, ${r.performing_doctor})`),
  ];
  await sql.transaction(queries);
  const after = await sql`SELECT count(*)::int n, count(DISTINCT marker)::int markers, min(taken_at) mn, max(taken_at) mx FROM lab_results WHERE patient_id=${pid}`;
  console.log(`\npatient pid : ${pid}`);
  console.log(`lab_results before -> after : ${before[0].n} -> ${after[0].n}  (${after[0].markers} markers, ${after[0].mn} … ${after[0].mx})`);
  console.log("✓ Maria Regina lab_results loaded.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
