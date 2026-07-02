#!/usr/bin/env node
/**
 * Ingest John Smith Jr's full longitudinal blood/urine history into Neon
 * `lab_results`.
 *
 * John Smith Jr (pending:john-smith-jr-dbef5f) is a generic DB-driven (Class C)
 * patient: no bespoke static page, no render<Name>PhysicalExams() branch. The
 * default renderer (patient-context.js renderExams) surfaces lab_results via
 * /api/patient-exams, so THIS DB LOAD IS the visible change on
 *   https://lumenhealth.io/physical-exams
 *
 * Sources (PHI, OUTSIDE git) — one collection date each, several labs/countries:
 *   Patients/Johh Smith Jr/Blood/{extracted-labs.json, out-*.json}
 * Each result[] row is mapped through web/assets/lab-taxonomy.js (same
 * canonicalization Joao / Maria Regina / Silvana use) so the time series merges
 * by canonical marker and each analyte lands in its standard panel.
 *
 * IDEMPOTENT FULL REPLACEMENT of John's labs:
 *   DELETE FROM lab_results WHERE patient_id=<john>
 *   then INSERT every row across all dates, in one transaction.
 * Only John's rows are touched — no other patient, no other table.
 *
 * Usage:
 *   node scripts/ingest-john-labs.mjs            # dry run
 *   node scripts/ingest-john-labs.mjs --apply    # delete+insert in a txn
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:john-smith-jr-dbef5f";
const BLOOD_DIR = path.join(root, "Patients/Johh Smith Jr/Blood");

// Every extraction artifact for John. extracted-labs.json wraps rows in
// {results:[...]}; the out-*.json agents emit a bare array.
const SOURCES = [
  "extracted-labs.json",
  "out-2023-04.json",
  "out-2024-04.json",
  "out-2026-04.json",
  "out-2026-05-02.json",
  "out-2026-05-20.json",
];

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

function loadResults() {
  const all = [];
  for (const name of SOURCES) {
    const p = path.join(BLOOD_DIR, name);
    if (!fs.existsSync(p)) { console.warn(`! missing source (skipped): ${name}`); continue; }
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    const rows = Array.isArray(parsed) ? parsed : (parsed.results || []);
    for (const r of rows) all.push(r);
  }
  return all;
}
const results = loadResults();

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

function buildRows() {
  const rows = [];
  const seen = new Set(); // (marker|date) guard: two raw spellings on one date
  let unmapped = 0, undated = 0;
  for (const r of results) {
    const date = r.collection_date;
    if (!isDay(date)) { undated++; continue; }
    const marker = TAX.canonicalMarker(r.canonical_analyte, r.unit_reported, r.category);
    const meta = TAX.MARKERS[marker];
    if (!meta) unmapped++;
    const panel = meta ? PANEL_EN[meta.panel] : (PANEL_EN.other || "Other markers");
    const key = marker + "|" + date;
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
      taken_at: date,
      laboratory: r.lab_name || null,
      lab_city: r.lab_city || null,
      lab_country: r.lab_country || null,
      requesting_doctor: r.requesting_doctor || null,
      performing_doctor: r.performing_doctor || null,
    });
  }
  rows._unmapped = unmapped;
  rows._undated = undated;
  return rows;
}

const rows = buildRows();

function summarize() {
  const panels = [...new Set(rows.map((r) => r.panel))];
  const markers = [...new Set(rows.map((r) => r.marker))];
  const dates = [...new Set(rows.map((r) => r.taken_at))].sort();
  const flagged = rows.filter((r) => r.flag);
  const byDate = {};
  for (const r of rows) byDate[r.taken_at] = (byDate[r.taken_at] || 0) + 1;
  console.log("── John Smith Jr lab_results extraction (all dates) ──");
  console.log(`sources         : ${SOURCES.join(", ")}`);
  console.log(`raw results     : ${results.length}`);
  console.log(`rows to load    : ${rows.length}  (after canonicalization + per-(marker,date) dedup)`);
  console.log(`distinct markers: ${markers.length}`);
  console.log(`unmapped->Other : ${rows._unmapped}  (review if high)`);
  console.log(`dropped (no date): ${rows._undated}`);
  console.log(`collection dates: ${dates.join(", ")}`);
  console.log(`  per date      : ${Object.entries(byDate).map(([d, n]) => `${d}:${n}`).join("  ")}`);
  console.log(`panels (${panels.length})     : ${panels.join(", ")}`);
  console.log(`out-of-range    : ${flagged.length} flagged`);
  for (const r of flagged) {
    console.log(`   * [${r.taken_at}] ${r.marker} = ${r.value ?? r.value_text} ${r.unit || ""} (ref ${r.ref_low}-${r.ref_high}) ${r.flag}`);
  }
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("x DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);
  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`x patient not found: ${CLERK}`); process.exit(1); }
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
  console.log(`total lab_results before -> after : ${before[0].n} -> ${after[0].n}  (${after[0].markers} markers, ${after[0].mn} … ${after[0].mx})`);
  console.log("✓ John Smith Jr lab_results fully loaded. No other patient touched.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("x apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
