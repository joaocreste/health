#!/usr/bin/env node
/**
 * Ingest Joao Victor Creste's 2026-06-08 Hospital Sírio-Libanês panel into
 * Neon `lab_results`.
 *
 * Source: laudos_08_06_2026.pdf (26 pages, single collection date), extracted
 * and normalized to the blood/urine ingestion schema. The extraction artifact
 * (PHI) lives OUTSIDE git at
 *   Patients/Joao Victor Creste/Blood/extracted-labs.json
 * This loader maps its `results[]` into lab_results via web/assets/lab-taxonomy.js
 * (same canonicalization Maria Regina / Silvana use) so the AI-insight engine
 * and renderExams() see the new draw in their proper panels.
 *
 * SCOPED, IDEMPOTENT, SINGLE-DATE replacement of Joao's labs for this one draw:
 *   DELETE FROM lab_results WHERE patient_id=<joao> AND taken_at='2026-06-08'
 *   then INSERT fresh. No other date, patient, or table is touched — Joao's
 *   prior history (Albert Einstein 2026-05-20, etc.) is preserved.
 *
 * Usage:
 *   node scripts/ingest-joao-labs-2026-06-08.mjs            # dry run
 *   node scripts/ingest-joao-labs-2026-06-08.mjs --apply    # delete+insert in a txn
 *   PAYLOAD=/path/to/extracted-labs.json node scripts/ingest-joao-labs-2026-06-08.mjs
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const TAKEN_AT = "2026-06-08";
const PAYLOAD_PATH = process.env.PAYLOAD ||
  path.join(root, "Patients/Joao Victor Creste/Blood/extracted-labs.json");

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
// same way the other ingest scripts load this browser asset, so the DB names
// stay in lockstep with what renderExams() shows.
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

const payload = JSON.parse(fs.readFileSync(PAYLOAD_PATH, "utf8"));
const results = payload.results || [];

const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

function buildRows() {
  const rows = [];
  const seen = new Set(); // (marker|date) guard against two raw spellings colliding on one date
  let unmapped = 0;
  for (const r of results) {
    if (!isDay(r.collection_date)) continue;
    if (r.collection_date !== TAKEN_AT) continue; // this loader is single-date by design
    const marker = TAX.canonicalMarker(r.canonical_analyte, r.unit_reported, r.category);
    const meta = TAX.MARKERS[marker];
    if (!meta) unmapped++;
    const panel = meta ? PANEL_EN[meta.panel] : (r.category ?? null);
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
      requesting_doctor: r.requesting_doctor || null,
    });
  }
  const kept = rows.filter((r) => r.marker);
  kept._unmapped = unmapped;
  return kept;
}

const rows = buildRows();

function summarize() {
  const panels = [...new Set(rows.map((r) => r.panel))];
  const markers = [...new Set(rows.map((r) => r.marker))];
  const flagged = rows.filter((r) => r.flag);
  console.log("── Joao Victor Creste lab_results extraction (2026-06-08) ──");
  console.log(`payload         : ${PAYLOAD_PATH}`);
  console.log(`rows            : ${rows.length}  (of ${results.length} results, after canonicalization + per-date dedup)`);
  console.log(`distinct markers: ${markers.length}`);
  console.log(`unmapped markers: ${rows._unmapped} (fell back to category panel — review if > 0)`);
  console.log(`collection date : ${TAKEN_AT}`);
  console.log(`panels (${panels.length})     : ${panels.join(", ")}`);
  console.log(`out-of-range    : ${flagged.length} flagged`);
  for (const r of flagged) {
    console.log(`   * ${r.marker} = ${r.value ?? r.value_text} ${r.unit || ""} (ref ${r.ref_low}–${r.ref_high}) ${r.flag}`);
  }
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("✗ DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);
  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const before = await sql`SELECT count(*)::int n FROM lab_results WHERE patient_id=${pid}`;
  const beforeDate = await sql`SELECT count(*)::int n FROM lab_results WHERE patient_id=${pid} AND taken_at=${TAKEN_AT}::date`;
  const queries = [
    sql`DELETE FROM lab_results WHERE patient_id=${pid} AND taken_at=${TAKEN_AT}::date`,
    ...rows.map((r) => sql`
      INSERT INTO lab_results
        (patient_id, panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at, laboratory, requesting_doctor)
      VALUES
        (${pid}, ${r.panel}, ${r.marker}, ${r.value}, ${r.value_text}, ${r.unit}, ${r.ref_low}, ${r.ref_high}, ${r.flag},
         ${r.taken_at}::date, ${r.laboratory}, ${r.requesting_doctor})`),
  ];
  await sql.transaction(queries);
  await markSourceWritten(sql, pid, { writer: "ingest-joao-labs-2026-06-08" });
  const after = await sql`SELECT count(*)::int n, count(DISTINCT marker)::int markers, min(taken_at) mn, max(taken_at) mx FROM lab_results WHERE patient_id=${pid}`;
  console.log(`\npatient pid : ${pid}`);
  console.log(`${TAKEN_AT} rows : ${beforeDate[0].n} -> ${rows.length} (deleted+reinserted)`);
  console.log(`total lab_results before -> after : ${before[0].n} -> ${after[0].n}  (${after[0].markers} markers, ${after[0].mn} … ${after[0].mx})`);
  console.log("✓ Joao 2026-06-08 lab_results loaded. Other dates untouched.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
