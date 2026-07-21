#!/usr/bin/env node
/**
 * Apple Health export.xml -> vitals_daily (source='apple_health') for one patient.
 *
 * Streams the (large) export.xml with a chunked reader (never loads it whole),
 * extracts <Record> opening tags, aggregates samples to the DAILY grain, and
 * maps onto existing vitals_daily columns. Apple Health gets its OWN per-source
 * rows; the merged 'aggregate' row and the 'oura' rows are NEVER touched
 * (schema unique index is (patient_id, day, source)).
 *
 * Daily reductions:
 *   StepCount               -> steps              (sum)
 *   ActiveEnergyBurned      -> calories_active    (sum, kcal)
 *   BasalEnergyBurned       -> calories_passive   (sum, kcal)
 *   RestingHeartRate        -> resting_hr         (mean)
 *   HeartRateVariabilitySDNN-> hrv_ms             (mean)
 *   OxygenSaturation        -> spo2_pct           (mean, fraction->%)
 *   BodyMass                -> weight_kg          (last of day, lb->kg)
 *   BloodPressureSystolic   -> blood_pressure_sys (mean)
 *   BloodPressureDiastolic  -> blood_pressure_dia (mean)
 *   SleepAnalysis           -> sleep_minutes / deep_sleep_minutes / rem_sleep_minutes
 *                              (sum of asleep stage durations, attributed to wake day)
 *   RespiratoryRate         -> extras.respiratory_rate (mean) [no dedicated column]
 *
 * Usage:
 *   node scripts/ingest-joao-apple-vitals.mjs            # dry run
 *   node scripts/ingest-joao-apple-vitals.mjs --apply    # delete+insert in chunks
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
const SOURCE = "apple_health";
const XML = path.join(root, "Patients", "Joao Victor Creste", "Apple Health", "export.xml");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  return m ? m[1] : null;
}

const day = new Map(); // day -> aggregates
function bucket(d) {
  if (!day.has(d)) day.set(d, {
    steps: 0, hasSteps: false,
    actCal: 0, hasAct: false,
    basCal: 0, hasBas: false,
    rhrSum: 0, rhrN: 0,
    hrvSum: 0, hrvN: 0,
    spo2Sum: 0, spo2N: 0,
    respSum: 0, respN: 0,
    sysSum: 0, sysN: 0,
    diaSum: 0, diaN: 0,
    weight: null, weightTs: null,
    sleepMin: 0, deepMin: 0, remMin: 0, hasSleep: false,
  });
  return day.get(d);
}

const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
};
const dayOf = (dt) => (dt ? dt.slice(0, 10) : null);
const minutesBetween = (a, b) => {
  const t0 = Date.parse(a.replace(" ", "T")), t1 = Date.parse(b.replace(" ", "T"));
  return (Number.isFinite(t0) && Number.isFinite(t1)) ? (t1 - t0) / 60000 : 0;
};

const ASLEEP = new Set([
  "HKCategoryValueSleepAnalysisAsleepUnspecified",
  "HKCategoryValueSleepAnalysisAsleepCore",
  "HKCategoryValueSleepAnalysisAsleepDeep",
  "HKCategoryValueSleepAnalysisAsleepREM",
]);

let total = 0, used = 0;
function handleRecord(tag) {
  total++;
  const type = attr(tag, "type");
  if (!type) return;
  const start = attr(tag, "startDate");
  const end = attr(tag, "endDate");
  const valStr = attr(tag, "value");
  const unit = attr(tag, "unit");
  const v = valStr != null ? Number(valStr) : null;

  switch (type) {
    case "HKQuantityTypeIdentifierStepCount": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.steps += v; b.hasSteps = true; used++; } break;
    }
    case "HKQuantityTypeIdentifierActiveEnergyBurned": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.actCal += v; b.hasAct = true; used++; } break;
    }
    case "HKQuantityTypeIdentifierBasalEnergyBurned": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.basCal += v; b.hasBas = true; used++; } break;
    }
    case "HKQuantityTypeIdentifierRestingHeartRate": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.rhrSum += v; b.rhrN++; used++; } break;
    }
    case "HKQuantityTypeIdentifierHeartRateVariabilitySDNN": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.hrvSum += v; b.hrvN++; used++; } break;
    }
    case "HKQuantityTypeIdentifierOxygenSaturation": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.spo2Sum += (v <= 1 ? v * 100 : v); b.spo2N++; used++; } break;
    }
    case "HKQuantityTypeIdentifierRespiratoryRate": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.respSum += v; b.respN++; used++; } break;
    }
    case "HKQuantityTypeIdentifierBloodPressureSystolic": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.sysSum += v; b.sysN++; used++; } break;
    }
    case "HKQuantityTypeIdentifierBloodPressureDiastolic": {
      const b = bucket(dayOf(start)); if (Number.isFinite(v)) { b.diaSum += v; b.diaN++; used++; } break;
    }
    case "HKQuantityTypeIdentifierBodyMass": {
      const b = bucket(dayOf(start));
      if (Number.isFinite(v)) { const kg = (unit === "lb") ? v * 0.45359237 : v; if (!b.weightTs || start > b.weightTs) { b.weight = kg; b.weightTs = start; } used++; }
      break;
    }
    case "HKCategoryTypeIdentifierSleepAnalysis": {
      const d = dayOf(end) || dayOf(start);
      const b = bucket(d);
      const mins = minutesBetween(start, end);
      if (ASLEEP.has(valStr)) { b.sleepMin += mins; b.hasSleep = true; used++; }
      if (valStr === "HKCategoryValueSleepAnalysisAsleepDeep") b.deepMin += mins;
      if (valStr === "HKCategoryValueSleepAnalysisAsleepREM") b.remMin += mins;
      break;
    }
    default: break;
  }
}

function buildRows() {
  const rows = [];
  for (const [d, b] of day) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const extras = {};
    if (b.respN) extras.respiratory_rate = Number((b.respSum / b.respN).toFixed(1));
    const row = {
      day: d, source: SOURCE,
      steps: b.hasSteps ? Math.round(b.steps) : null,
      calories_active: b.hasAct ? Math.round(b.actCal) : null,
      calories_passive: b.hasBas ? Math.round(b.basCal) : null,
      resting_hr: b.rhrN ? Number((b.rhrSum / b.rhrN).toFixed(1)) : null,
      hrv_ms: b.hrvN ? Number((b.hrvSum / b.hrvN).toFixed(1)) : null,
      spo2_pct: b.spo2N ? Number((b.spo2Sum / b.spo2N).toFixed(2)) : null,
      weight_kg: b.weight != null ? Number(b.weight.toFixed(2)) : null,
      blood_pressure_sys: b.sysN ? Math.round(b.sysSum / b.sysN) : null,
      blood_pressure_dia: b.diaN ? Math.round(b.diaSum / b.diaN) : null,
      sleep_minutes: b.hasSleep ? Math.round(b.sleepMin) : null,
      deep_sleep_minutes: b.hasSleep ? Math.round(b.deepMin) : null,
      rem_sleep_minutes: b.hasSleep ? Math.round(b.remMin) : null,
      extras: Object.keys(extras).length ? extras : null,
    };
    // skip wholly-empty days
    const hasAny = ["steps","calories_active","calories_passive","resting_hr","hrv_ms","spo2_pct","weight_kg","blood_pressure_sys","sleep_minutes"].some((k) => row[k] != null) || row.extras;
    if (hasAny) rows.push(row);
  }
  return rows.sort((a, b) => a.day.localeCompare(b.day));
}

async function streamParse() {
  return new Promise((resolve, reject) => {
    const stream = fs.createReadStream(XML, { encoding: "utf8", highWaterMark: 1 << 20 });
    let buf = "";
    let bytes = 0;
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      buf += chunk;
      // process every complete <Record ...> opening tag
      let idx;
      while ((idx = buf.indexOf("<Record ")) !== -1) {
        const close = buf.indexOf(">", idx);
        if (close === -1) break; // tag spans chunk boundary; wait for more
        handleRecord(buf.slice(idx, close + 1));
        buf = buf.slice(close + 1);
      }
      // keep only a small tail (a partial '<Record' could be split)
      if (buf.length > 1 << 16) buf = buf.slice(-(1 << 12));
      if (total && total % 500000 === 0) process.stdout.write(`\r  parsed ${total} records (${(bytes/1e6).toFixed(0)} MB)…`);
    });
    stream.on("end", () => { process.stdout.write("\n"); resolve(); });
    stream.on("error", reject);
  });
}

async function main() {
  console.log(`Streaming ${path.basename(XML)} …`);
  await streamParse();
  const rows = buildRows();
  const dates = rows.map((r) => r.day);
  const cnt = (k) => rows.filter((r) => r[k] != null).length;
  console.log("── Apple Health vitals_daily (source='apple_health') ──");
  console.log(`records scanned : ${total}  (used: ${used})`);
  console.log(`days            : ${rows.length}  (${dates[0]} … ${dates[dates.length-1]})`);
  console.log(`  steps:${cnt("steps")} act_cal:${cnt("calories_active")} rhr:${cnt("resting_hr")} hrv:${cnt("hrv_ms")} spo2:${cnt("spo2_pct")} bp:${cnt("blood_pressure_sys")} sleep:${cnt("sleep_minutes")} weight:${cnt("weight_kg")}`);
  console.log(`  sample first : ${JSON.stringify(rows[0])}`);
  console.log(`  sample last  : ${JSON.stringify(rows[rows.length-1])}`);

  if (!APPLY) { console.log("\n(dry run — no DB writes. Re-run with --apply.)"); return; }

  const url = loadDatabaseUrl();
  if (!url) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
  const sql = neon(url);
  const u = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error("✗ patient not found"); process.exit(1); }
  const pid = u[0].id;

  const beforeApple = await sql`SELECT count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source=${SOURCE}`;
  const beforeOther = await sql`SELECT source, count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source<>${SOURCE} GROUP BY source`;

  await sql`DELETE FROM vitals_daily WHERE patient_id=${pid} AND source=${SOURCE}`;
  // chunked inserts
  const CH = 200;
  for (let i = 0; i < rows.length; i += CH) {
    const slice = rows.slice(i, i + CH);
    await sql.transaction(slice.map((v) => sql`
      INSERT INTO vitals_daily (patient_id, day, source, steps, calories_active, calories_passive,
        hrv_ms, resting_hr, sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, spo2_pct, weight_kg,
        blood_pressure_sys, blood_pressure_dia, extras)
      VALUES (${pid}, ${v.day}, ${SOURCE}, ${v.steps}, ${v.calories_active}, ${v.calories_passive},
        ${v.hrv_ms}, ${v.resting_hr}, ${v.sleep_minutes}, ${v.deep_sleep_minutes}, ${v.rem_sleep_minutes}, ${v.spo2_pct}, ${v.weight_kg},
        ${v.blood_pressure_sys}, ${v.blood_pressure_dia}, ${v.extras ? JSON.stringify(v.extras) : null}::jsonb)
      ON CONFLICT (patient_id, day, source) DO UPDATE SET
        steps=EXCLUDED.steps, calories_active=EXCLUDED.calories_active, calories_passive=EXCLUDED.calories_passive,
        hrv_ms=EXCLUDED.hrv_ms, resting_hr=EXCLUDED.resting_hr, sleep_minutes=EXCLUDED.sleep_minutes,
        deep_sleep_minutes=EXCLUDED.deep_sleep_minutes, rem_sleep_minutes=EXCLUDED.rem_sleep_minutes,
        spo2_pct=EXCLUDED.spo2_pct, weight_kg=EXCLUDED.weight_kg,
        blood_pressure_sys=EXCLUDED.blood_pressure_sys, blood_pressure_dia=EXCLUDED.blood_pressure_dia, extras=EXCLUDED.extras`));
    process.stdout.write(`\r  inserted ${Math.min(i+CH, rows.length)}/${rows.length}…`);
  }
  process.stdout.write("\n");
  const afterApple = await sql`SELECT count(*)::int n, min(day) mn, max(day) mx FROM vitals_daily WHERE patient_id=${pid} AND source=${SOURCE}`;
  const afterOther = await sql`SELECT source, count(*)::int n FROM vitals_daily WHERE patient_id=${pid} AND source<>${SOURCE} GROUP BY source`;
  console.log(`apple_health rows before->after : ${beforeApple[0].n} -> ${afterApple[0].n}  (${afterApple[0].mn} … ${afterApple[0].mx})`);
  console.log(`other sources before : ${JSON.stringify(beforeOther)}`);
  console.log(`other sources after  : ${JSON.stringify(afterOther)}  (must be UNCHANGED)`);
  await markSourceWritten(sql, pid, { writer: "ingest-joao-apple-vitals" });
  console.log("✓ Apple Health vitals_daily replaced.");
}

main().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
