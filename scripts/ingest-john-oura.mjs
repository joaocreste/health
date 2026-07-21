#!/usr/bin/env node
/**
 * Oura full-replacement ingest for one patient into Neon `vitals_daily`.
 *
 * Loads the daily Oura metrics from an Oura *app export* folder and writes one
 * normalized row per day tagged `source = 'oura'`:
 *
 *   sleepmodel.csv   (long_sleep, main night per day) -> hrv_ms, resting_hr,
 *                                                          sleep_minutes,
 *                                                          deep_sleep_minutes,
 *                                                          rem_sleep_minutes
 *   dailyactivity.csv                                 -> steps, calories_active,
 *                                                          calories_passive
 *   dailyspo2.csv                                     -> spo2_pct
 *
 * FULL REPLACEMENT, scoped to (this patient) AND (source='oura'):
 *   the run wipes the patient's prior source='oura' rows and reinserts fresh.
 *   The merged source='aggregate' row (Withings weight/BP, Apple steps) is NEVER
 *   touched — Oura lives in its own per-source rows, which the schema's
 *   (patient_id, day, source) unique index is built for. Weight/BP/blood-pressure
 *   columns are left NULL on oura rows (Oura has no such signal).
 *
 * Usage:
 *   node scripts/ingest-joao-oura.mjs                 # dry run — no DB writes
 *   node scripts/ingest-joao-oura.mjs --apply         # delete+insert in a txn
 *
 * Requires DATABASE_URL (current Neon secret) in the environment or .env.
 * The local .env password may be STALE (rotated) — refresh from the Neon
 * dashboard if --apply reports `password authentication failed`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

const CLERK = "pending:john-smith-jr-dbef5f";
const SOURCE = "oura";
const OURA_DIR = path.join(root, "Patients", "Johh Smith Jr", "Oura", "App Data");

/* ───── DATABASE_URL (env or .env) ──────────────────────────────── */
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    return m ? m[1] : null;
  } catch { return null; }
}

/* ───── quote-aware CSV parser (Oura uses ';') ─────────────────── */
function parseCSV(file, delim = ";") {
  const txt = fs.readFileSync(path.join(OURA_DIR, file), "utf8");
  const rows = [];
  let i = 0, field = "", row = [], inq = false;
  const pushF = () => { row.push(field); field = ""; };
  const pushR = () => { rows.push(row); row = []; };
  while (i < txt.length) {
    const c = txt[i];
    if (inq) {
      if (c === '"') { if (txt[i + 1] === '"') { field += '"'; i += 2; continue; } inq = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inq = true; i++; continue; }
    if (c === delim) { pushF(); i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { pushF(); pushR(); i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { pushF(); pushR(); }
  const header = rows.shift();
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, j) => [h, r[j]])));
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : null; };
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

/* ───── Build one oura row per day ──────────────────────────────── */
function buildRows() {
  const byDay = new Map();
  const row = (day) => { if (!byDay.has(day)) byDay.set(day, { day, source: SOURCE }); return byDay.get(day); };

  // Sleep — main night = the long_sleep period with the largest total_sleep_duration that day.
  const sm = parseCSV("sleepmodel.csv").filter((r) => r.type === "long_sleep" && isDay(r.day));
  const mainByDay = new Map();
  for (const r of sm) {
    const dur = int(r.total_sleep_duration) || 0;
    const cur = mainByDay.get(r.day);
    if (!cur || dur > (int(cur.total_sleep_duration) || 0)) mainByDay.set(r.day, r);
  }
  for (const [day, r] of mainByDay) {
    const x = row(day);
    x.hrv_ms = num(r.average_hrv);
    x.resting_hr = num(r.lowest_heart_rate);
    x.sleep_minutes = r.total_sleep_duration != null ? Math.round(num(r.total_sleep_duration) / 60) : null;
    x.deep_sleep_minutes = r.deep_sleep_duration != null ? Math.round(num(r.deep_sleep_duration) / 60) : null;
    x.rem_sleep_minutes = r.rem_sleep_duration != null ? Math.round(num(r.rem_sleep_duration) / 60) : null;
  }

  // Activity — steps + calories.
  for (const r of parseCSV("dailyactivity.csv")) {
    if (!isDay(r.day)) continue;
    const x = row(r.day);
    x.steps = int(r.steps);
    const active = int(r.active_calories);
    const total = int(r.total_calories);
    x.calories_active = active;
    x.calories_passive = (active != null && total != null) ? Math.max(0, total - active) : null;
  }

  // SpO2 — nightly average (JSON {"average": <pct>}).
  for (const r of parseCSV("dailyspo2.csv")) {
    if (!isDay(r.day)) continue;
    let avg = null;
    try { avg = num(JSON.parse(r.spo2_percentage).average); } catch { /* ignore */ }
    if (avg != null) row(r.day).spo2_pct = Number(avg.toFixed(2));
  }

  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

const rows = buildRows();

function summarize() {
  const days = rows.map((r) => r.day);
  const cnt = (k) => rows.filter((r) => r[k] != null).length;
  console.log("── Oura vitals_daily extraction (source='oura') ──");
  console.log(`rows           : ${rows.length} days  (${days[0]} … ${days[days.length - 1]})`);
  console.log(`  with hrv_ms      : ${cnt("hrv_ms")}`);
  console.log(`  with resting_hr  : ${cnt("resting_hr")}`);
  console.log(`  with sleep_min   : ${cnt("sleep_minutes")}`);
  console.log(`  with steps       : ${cnt("steps")}`);
  console.log(`  with spo2_pct    : ${cnt("spo2_pct")}`);
  console.log(`  first sample     : ${JSON.stringify(rows[0])}`);
  console.log(`  last  sample     : ${JSON.stringify(rows[rows.length - 1])}`);
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("✗ DATABASE_URL not set (env or .env)."); process.exit(1); }
  const sql = neon(url);

  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const before = await sql`SELECT count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source=${SOURCE}`;
  const beforeAgg = await sql`SELECT count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source='aggregate'`;

  // Atomic: wipe prior oura rows, then insert fresh. The 'aggregate' row is untouched.
  const queries = [
    sql`DELETE FROM vitals_daily WHERE patient_id=${pid} AND source=${SOURCE}`,
    ...rows.map((v) => sql`
      INSERT INTO vitals_daily (patient_id, day, source, steps, calories_active, calories_passive,
        hrv_ms, resting_hr, sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, spo2_pct)
      VALUES (${pid}, ${v.day}, ${SOURCE}, ${v.steps ?? null}, ${v.calories_active ?? null}, ${v.calories_passive ?? null},
        ${v.hrv_ms ?? null}, ${v.resting_hr ?? null}, ${v.sleep_minutes ?? null}, ${v.deep_sleep_minutes ?? null}, ${v.rem_sleep_minutes ?? null}, ${v.spo2_pct ?? null})
      ON CONFLICT (patient_id, day, source) DO UPDATE SET
        steps=EXCLUDED.steps, calories_active=EXCLUDED.calories_active, calories_passive=EXCLUDED.calories_passive,
        hrv_ms=EXCLUDED.hrv_ms, resting_hr=EXCLUDED.resting_hr, sleep_minutes=EXCLUDED.sleep_minutes,
        deep_sleep_minutes=EXCLUDED.deep_sleep_minutes, rem_sleep_minutes=EXCLUDED.rem_sleep_minutes, spo2_pct=EXCLUDED.spo2_pct`),
  ];
  await sql.transaction(queries);

  await markSourceWritten(sql, pid, { writer: "ingest-john-oura" });

  const after = await sql`SELECT count(*)::int n, min(day) mn, max(day) mx FROM vitals_daily WHERE patient_id=${pid} AND source=${SOURCE}`;
  const afterAgg = await sql`SELECT count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source='aggregate'`;

  console.log(`\npatient pid          : ${pid}`);
  console.log(`oura rows  before→after : ${before[0].n} → ${after[0].n}  (${after[0].mn} … ${after[0].mx})`);
  console.log(`aggregate rows (guard)  : ${beforeAgg[0].n} → ${afterAgg[0].n}  (must be UNCHANGED)`);
  if (beforeAgg[0].n !== afterAgg[0].n) { console.error("✗✗ aggregate row count changed — investigate!"); process.exit(1); }
  console.log("✓ Oura vitals_daily replaced.");
}

/* ───── Main ────────────────────────────────────────────────────── */
summarize();
if (APPLY) {
  apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
} else {
  console.log("\n(dry run — no DB writes. Re-run with --apply once DATABASE_URL is current.)");
}
