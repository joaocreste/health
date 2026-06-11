#!/usr/bin/env node
/**
 * Backfill the per-day raw series that /api/vitals-range needs but the
 * original ingests didn't store, patient pending:joao.
 *
 *  1. oura vitals_daily extras  +=
 *       sleep_periods    [{hrv,rhr,deep,rem,light,awake,total}]  (hours, 3dp —
 *                        long_sleep periods >= 3h, same filter/rounding as
 *                        bin/extract.py so range aggregates match data.js)
 *       stress_min, recovery_min, stress_summary   (dailystress.csv, minutes)
 *       resilience_score, resilience_level         (dailyresilience.csv;
 *                        score = mean of the three contributors, 1dp)
 *  2. withings_cuff vitals_daily extras +=
 *       bp_list  [["HH:MM",sys,dia,pulse], ...]    (bp.csv per-reading rows —
 *                        extras.bp_readings stays the count it always was)
 *  3. hr_readings table (migration 0013, applied here) — full replacement of
 *       this patient's source='oura' rows from heartrate.csv (~286k readings).
 *
 * Extras are MERGED (extras || patch), never replaced — existing keys survive.
 * NOTE: scripts/ingest-joao-oura.mjs is a full-replacement ingest that DROPS
 * oura rows (and these extras) — re-run this script after any Oura re-ingest.
 *
 * Usage:
 *   node scripts/backfill-joao-vitals-range.mjs           # dry run
 *   node scripts/backfill-joao-vitals-range.mjs --apply
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

const CLERK = "pending:joao";
const DATA = path.join(root, "Patients", "Joao Victor Creste");
const OURA = path.join(DATA, "Oura", "App Data");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
  } catch { return null; }
}

/* quote-aware CSV parser (Oura uses ';', Withings ',') */
function parseCSV(file, delim) {
  const txt = fs.readFileSync(file, "utf8");
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

/* Empty CSV fields must be null, NOT 0 — bp.csv has pulse-only rows with
   blank Systolic/Diastolic that would otherwise become 0/0 readings. */
const num = (v) => { if (v == null || v === "") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");
const h3 = (sec) => Math.round((sec / 3600) * 1000) / 1000;

/* ───── 1. Oura extras patches ──────────────────────────────────── */
function buildOuraPatches() {
  const byDay = new Map();
  const patch = (day) => { if (!byDay.has(day)) byDay.set(day, {}); return byDay.get(day); };

  // Sleep periods — long_sleep >= 3h, hours at 3dp (extract.py parity).
  for (const r of parseCSV(path.join(OURA, "sleepmodel.csv"), ";")) {
    if (r.type !== "long_sleep" || !isDay(r.day)) continue;
    const total = num(r.total_sleep_duration);
    if (total == null || total < 3 * 3600) continue;
    const p = patch(r.day);
    (p.sleep_periods ||= []).push({
      hrv:   num(r.average_hrv),
      rhr:   num(r.lowest_heart_rate),
      deep:  h3(num(r.deep_sleep_duration) ?? 0),
      rem:   h3(num(r.rem_sleep_duration) ?? 0),
      light: h3(num(r.light_sleep_duration) ?? 0),
      awake: h3(num(r.awake_time) ?? 0),
      total: h3(total),
    });
  }

  // Daily stress — seconds -> minutes (1dp), like extract_stress().
  for (const r of parseCSV(path.join(OURA, "dailystress.csv"), ";")) {
    if (!isDay(r.day)) continue;
    const p = patch(r.day);
    p.stress_min = Math.round(((num(r.stress_high) ?? 0) / 60) * 10) / 10;
    p.recovery_min = Math.round(((num(r.recovery_high) ?? 0) / 60) * 10) / 10;
    const summary = (r.day_summary || "").trim();
    if (summary) p.stress_summary = summary;
  }

  // Resilience — level + mean of the three contributors.
  for (const r of parseCSV(path.join(OURA, "dailyresilience.csv"), ";")) {
    if (!isDay(r.day)) continue;
    const p = patch(r.day);
    const level = (r.level || "").trim();
    if (level) p.resilience_level = level;
    try {
      const c = JSON.parse(r.contributors);
      const vs = [c.daytime_recovery, c.sleep_recovery, c.stress].filter((v) => typeof v === "number");
      if (vs.length) p.resilience_score = Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 10) / 10;
    } catch { /* no contributors */ }
  }

  return byDay;
}

/* ───── 2. Withings BP per-reading lists ────────────────────────── */
/* bp.csv also carries 42 strays from a 2015-2021 device era; the cuff series
   (and its vitals_daily rows) start Nov 2025, so only patch the current era. */
const BP_ERA_FROM = "2025-10-01";
function buildBpPatches() {
  const byDay = new Map();
  for (const r of parseCSV(path.join(DATA, "Withings", "bp.csv"), ",")) {
    const ts = r.Date || "";
    const day = ts.slice(0, 10);
    if (!isDay(day) || day < BP_ERA_FROM) continue;
    const sys = num(r.Systolic), dia = num(r.Diastolic);
    if (sys == null || dia == null) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push([ts.slice(11, 16), sys, dia, num(r["Heart rate"])]);
  }
  for (const list of byDay.values()) list.sort((a, b) => a[0].localeCompare(b[0]));
  return byDay;
}

/* ───── 3. heartrate.csv rows ───────────────────────────────────── */
function loadHrReadings() {
  const out = [];
  for (const r of parseCSV(path.join(OURA, "heartrate.csv"), ";")) {
    const bpm = num(r.bpm);
    if (bpm == null || !r.timestamp) continue;
    out.push([r.timestamp, Math.round(bpm)]);
  }
  return out;
}

/* ───── Main ────────────────────────────────────────────────────── */
const ouraPatches = buildOuraPatches();
const bpPatches = buildBpPatches();
const hr = loadHrReadings();

const nPeriods = [...ouraPatches.values()].reduce((s, p) => s + (p.sleep_periods?.length || 0), 0);
const nBp = [...bpPatches.values()].reduce((s, l) => s + l.length, 0);
console.log(`oura extras patches : ${ouraPatches.size} days · ${nPeriods} sleep periods`);
console.log(`bp_list patches     : ${bpPatches.size} days · ${nBp} readings`);
console.log(`hr_readings         : ${hr.length} rows (${hr[0]?.[0]} … ${hr[hr.length - 1]?.[0]})`);

if (!APPLY) {
  console.log("\n(dry run — no DB writes. Re-run with --apply.)");
  process.exit(0);
}

const sql = neon(loadDatabaseUrl());
const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
const pid = u[0].id;

// Migration 0013 — idempotent, self-applied like 0005-0012 (statements
// mirrored from db/migrations/0013_hr_readings.sql; keep the two in sync).
await sql`
  CREATE TABLE IF NOT EXISTS "hr_readings" (
    "id"         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "patient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "ts"         timestamptz NOT NULL,
    "bpm"        smallint NOT NULL,
    "source"     text NOT NULL DEFAULT 'oura'
  )`;
await sql`
  CREATE INDEX IF NOT EXISTS "hr_readings_patient_ts_idx"
    ON "hr_readings" ("patient_id", "ts")`;
console.log("✓ migration 0013 applied");

// 1+2. extras merges — extras = COALESCE(extras,'{}') || patch. Insert the row
// if the day has no row for that source yet (other columns stay NULL).
const merge = (source, day, patch) => sql`
  INSERT INTO vitals_daily (patient_id, day, source, extras)
  VALUES (${pid}, ${day}, ${source}, ${JSON.stringify(patch)}::jsonb)
  ON CONFLICT (patient_id, day, source) DO UPDATE
  SET extras = COALESCE(vitals_daily.extras, '{}'::jsonb) || EXCLUDED.extras`;

const ouraQueries = [...ouraPatches].map(([day, p]) => merge("oura", day, p));
const bpQueries = [...bpPatches].map(([day, list]) => merge("withings_cuff", day, { bp_list: list }));
await sql.transaction([...ouraQueries, ...bpQueries]);
console.log(`✓ extras merged: ${ouraQueries.length} oura days, ${bpQueries.length} cuff days`);

// 3. hr_readings — full replacement for this patient+source, chunked unnest.
await sql`DELETE FROM hr_readings WHERE patient_id = ${pid} AND source = 'oura'`;
const CHUNK = 10000;
for (let i = 0; i < hr.length; i += CHUNK) {
  const slice = hr.slice(i, i + CHUNK);
  await sql`
    INSERT INTO hr_readings (patient_id, ts, bpm, source)
    SELECT ${pid}, t, b, 'oura'
    FROM unnest(${slice.map((r) => r[0])}::timestamptz[], ${slice.map((r) => r[1])}::smallint[]) AS x(t, b)`;
  process.stdout.write(`\r  hr_readings inserted: ${Math.min(i + CHUNK, hr.length)}/${hr.length}`);
}
console.log();

const chk = await sql`SELECT count(*)::int n, min(ts) mn, max(ts) mx FROM hr_readings WHERE patient_id=${pid} AND source='oura'`;
const chk2 = await sql`SELECT count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source='oura' AND extras ? 'sleep_periods'`;
const chk3 = await sql`SELECT count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source='withings_cuff' AND extras ? 'bp_list'`;
console.log(`✓ hr_readings: ${chk[0].n} rows (${chk[0].mn} … ${chk[0].mx})`);
console.log(`✓ oura days with sleep_periods: ${chk2[0].n} · cuff days with bp_list: ${chk3[0].n}`);
