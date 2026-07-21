#!/usr/bin/env node
/**
 * Apple Watch ECG CSVs -> ecg_events (source='apple_watch') for one patient.
 *
 * Reads each electrocardiograms/*.csv header (Recorded Date + Classification),
 * and FULL-REPLACES the patient's Apple-Health-sourced ECG rows:
 *   DELETE FROM ecg_events WHERE patient_id=<p> AND source='apple_watch'  then INSERT.
 * No other source (e.g. kardia/withings) and no other table is touched.
 *
 * Usage: node scripts/ingest-joao-apple-ecg.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const SOURCE = "apple_watch";
const DIR = path.join(root, "Patients", "Joao Victor Creste", "Apple Health", "electrocardiograms");

const CLASS_MAP = {
  "sinus rhythm": "sinus_rhythm",
  "high heart rate": "high_heart_rate",
  "low heart rate": "low_heart_rate",
  "atrial fibrillation": "atrial_fibrillation",
  "afib": "atrial_fibrillation",
  "poor recording": "poor_recording",
  "inconclusive": "inconclusive",
};

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

function parseCsvHeader(file) {
  // Read just the head; the metadata lines are at the very top.
  const head = fs.readFileSync(path.join(DIR, file), "utf8").slice(0, 2048);
  const rec = head.match(/Recorded Date,([^\n\r]+)/);
  const cls = head.match(/Classification,([^\n\r]+)/);
  const ahr = head.match(/Average Heart Rate,\s*"?(\d+)/i);
  const rawDate = rec ? rec[1].trim() : null;
  const iso = rawDate ? new Date(rawDate.replace(" ", "T").replace(/\s([+-]\d{4})$/, "$1")).toISOString() : null;
  const label = cls ? cls[1].trim() : null;
  const classification = label ? (CLASS_MAP[label.toLowerCase()] || "other") : "other";
  return { recorded_at: iso, classification, average_hr: ahr ? Number(ahr[1]) : null, label, file };
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".csv")).sort();
const rows = files.map(parseCsvHeader).filter((r) => r.recorded_at);

function summarize() {
  const byClass = {};
  rows.forEach((r) => { byClass[r.classification] = (byClass[r.classification] || 0) + 1; });
  const dates = rows.map((r) => r.recorded_at.slice(0, 10)).sort();
  console.log("── Apple ECG -> ecg_events ──");
  console.log(`csv files     : ${files.length}  parsed: ${rows.length}`);
  console.log(`date range    : ${dates[0]} … ${dates[dates.length - 1]}`);
  console.log(`by class      : ${JSON.stringify(byClass)}`);
  console.log(`sample        : ${JSON.stringify(rows[0])}`);
}

async function apply() {
  const url = loadDatabaseUrl();
  const sql = neon(url);
  const u = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
  const pid = u[0].id;
  const before = await sql`SELECT count(*)::int n FROM ecg_events WHERE patient_id=${pid} AND source=${SOURCE}`;
  await sql.transaction([
    sql`DELETE FROM ecg_events WHERE patient_id=${pid} AND source=${SOURCE}`,
    ...rows.map((r) => sql`
      INSERT INTO ecg_events (patient_id, recorded_at, classification, average_hr, source, blob_key, notes)
      VALUES (${pid}, ${r.recorded_at}, ${r.classification}, ${r.average_hr}, ${SOURCE},
              ${"patients/" + pid + "/apple-health/electrocardiograms/" + r.file}, ${r.label})`),
  ]);
  const after = await sql`SELECT count(*)::int n, min(recorded_at)::date mn, max(recorded_at)::date mx FROM ecg_events WHERE patient_id=${pid} AND source=${SOURCE}`;
  const other = await sql`SELECT count(*)::int n FROM ecg_events WHERE patient_id=${pid} AND source<>${SOURCE}`;
  console.log(`apple_watch ecg before->after : ${before[0].n} -> ${after[0].n}  (${after[0].mn} … ${after[0].mx})`);
  console.log(`non-apple ecg rows (untouched): ${other[0].n}`);
  await markSourceWritten(sql, pid, { writer: "ingest-joao-apple-ecg" });
  console.log("✓ Apple ECG ecg_events replaced.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
