#!/usr/bin/env node
/**
 * Wave 1 ingest for Patient Zero (Joao Victor Creste) into Neon.
 *
 * Loads the cleanly-structured sources and writes normalized rows:
 *   web/assets/data.js        WEIGHT, HRV_RHR, STEPS, BP  -> vitals_daily
 *                             GLUCOSE                     -> glucose_points
 *                             ECG                         -> ecg_events
 *   web/assets/metrics.json   medications                 -> medications
 *                             sleep.series (if per-night) -> vitals_daily.sleep_minutes
 *   Patients/.../wheel_of_life.csv                        -> wheel_of_life_assessments
 *
 * Wave 2 (labs, imaging, genetics/PGx, psych architecture) is a separate pass —
 * that data lives only in the bespoke HTML pages and needs LLM-assisted extraction.
 *
 * Usage:
 *   node scripts/ingest-joao-wave1.mjs            # dry run (default) — no DB writes
 *   node scripts/ingest-joao-wave1.mjs --apply    # writes to DATABASE_URL (from .env)
 *
 * Idempotent: scoped DELETE for this patient then INSERT, so re-running is safe.
 */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const VITALS_SOURCE = "aggregate"; // one merged daily row across Oura/Withings/Apple/manual

/* ───── Load sources ────────────────────────────────────────────── */

function loadDataJs() {
  const src = fs.readFileSync(path.join(root, "web/assets/data.js"), "utf8");
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(
    src + "\n;globalThis.__D={WEIGHT,HRV_RHR,STEPS,BP,ECG,GLUCOSE};",
    ctx
  );
  return ctx.__D;
}

const D = loadDataJs();
const METRICS = JSON.parse(fs.readFileSync(path.join(root, "web/assets/metrics.json"), "utf8"));

/* ───── Transformers ────────────────────────────────────────────── */

const num = (v) => (typeof v === "number" && isFinite(v) ? v : null);

// Merge every per-day metric into one row keyed by day.
function buildVitals() {
  const byDay = new Map();
  const row = (day) => {
    if (!byDay.has(day)) byDay.set(day, { day });
    return byDay.get(day);
  };
  for (const [day, w] of D.WEIGHT || []) row(day).weight_kg = num(w);
  for (const [day, hrv, rhr] of D.HRV_RHR || []) {
    const r = row(day); r.hrv_ms = num(hrv); r.resting_hr = num(rhr);
  }
  for (const [day, steps] of D.STEPS || []) row(day).steps = num(steps);
  for (const [day, sys, dia] of D.BP || []) {
    const r = row(day); r.blood_pressure_sys = num(sys); r.blood_pressure_dia = num(dia);
  }
  // Per-night sleep from metrics.sleep.series, when it carries [date, minutes|hours].
  const series = METRICS?.sleep?.series;
  if (Array.isArray(series)) {
    for (const pt of series) {
      let day = null, val = null;
      if (Array.isArray(pt)) { day = pt[0]; val = pt[1]; }
      else if (pt && typeof pt === "object") { day = pt.date || pt.day; val = pt.total ?? pt.minutes ?? pt.hours; }
      if (!day || val == null) continue;
      const mins = val > 24 ? Math.round(val) : Math.round(val * 60); // hours -> minutes heuristic
      row(String(day).slice(0, 10)).sleep_minutes = mins;
    }
  }
  return [...byDay.values()].filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.day));
}

function buildGlucose() {
  const out = [];
  for (const [ts, mg] of D.GLUCOSE || []) {
    const n = num(mg);
    if (n == null || !ts) continue;
    // "2026-04-26 15:30" -> ISO; treat as UTC for determinism.
    out.push({ ts: ts.replace(" ", "T") + ":00Z", mg_dl: n, source: "libre" });
  }
  return out;
}

const ECG_MAP = {
  "sinus rhythm": "sinus_rhythm",
  "high heart rate": "high_heart_rate",
  "low heart rate": "low_heart_rate",
  "atrial fibrillation": "atrial_fibrillation",
  "afib": "atrial_fibrillation",
  "poor recording": "poor_recording",
  "inconclusive": "inconclusive",
};
function buildEcg() {
  const out = [];
  for (const [day, label, file] of D.ECG || []) {
    if (!day) continue;
    const cls = ECG_MAP[String(label || "").trim().toLowerCase()] || "other";
    out.push({
      recorded_at: day + "T12:00:00Z",
      classification: cls,
      source: "apple_watch",
      blob_key: file || null,
      notes: label || null,
    });
  }
  return out;
}

function buildMeds() {
  return (METRICS.medications || []).map((m) => ({
    name: m.name,
    dose: m.dose || null,
    drug_class: m.class || null,
    status: m.status || "active",
    note: m.note || null,
  })).filter((m) => m.name);
}

function buildWheel() {
  const csv = fs.readFileSync(path.join(root, "Patients/Joao Victor Creste/wheel_of_life.csv"), "utf8")
    .replace(/^﻿/, "");
  const lines = csv.split(/\r?\n/).slice(1).filter(Boolean);
  const scores = {};
  for (const line of lines) {
    const [session, dimension, score] = line.split(",");
    if (!dimension) continue;
    scores[`${session.trim()} / ${dimension.trim()}`] = Number(score);
  }
  // CSV carries no date; use the metrics snapshot date and flag it.
  return { taken_on: METRICS.generated_at || "2026-05-26", scores, notes: "Imported from wheel_of_life.csv (date inferred from metrics snapshot)." };
}

/* ───── Assemble ────────────────────────────────────────────────── */

const vitals = buildVitals();
const glucose = buildGlucose();
const ecg = buildEcg();
const meds = buildMeds();
const wheel = buildWheel();

function summary() {
  console.log("── Wave 1 extraction summary ──");
  console.log(`vitals_daily   : ${vitals.length} days  (${vitals[0]?.day} … ${vitals[vitals.length - 1]?.day})`);
  console.log(`  sample        : ${JSON.stringify(vitals[vitals.length - 1])}`);
  console.log(`glucose_points : ${glucose.length} points  (${glucose[0]?.ts} … ${glucose[glucose.length - 1]?.ts})`);
  console.log(`ecg_events     : ${ecg.length}  e.g. ${JSON.stringify(ecg[0])}`);
  console.log(`medications    : ${meds.length}  ${meds.map((m) => m.name + " " + (m.dose || "")).join(", ")}`);
  console.log(`wheel_of_life  : ${Object.keys(wheel.scores).length} dimensions on ${wheel.taken_on}`);
}

/* ───── Apply ───────────────────────────────────────────────────── */

async function apply() {
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  let url = (fs.readFileSync(path.join(root, ".env"), "utf8")
    .split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL")) || "")
    .replace(/^DATABASE_URL=/, "").trim().replace(/^"|"$/g, "");
  if (!url) throw new Error("DATABASE_URL not found in .env");
  const pool = new Pool({ connectionString: url });
  try {
    const pr = await pool.query("SELECT id FROM users WHERE clerk_user_id=$1 AND role='patient' LIMIT 1", [CLERK]);
    if (!pr.rows.length) throw new Error(`patient ${CLERK} not found`);
    const pid = pr.rows[0].id;
    console.log(`patient_id = ${pid}`);

    // Idempotent: clear this patient's Wave-1 tables, then insert.
    await pool.query("BEGIN");
    await pool.query("DELETE FROM vitals_daily WHERE patient_id=$1 AND source=$2", [pid, VITALS_SOURCE]);
    await pool.query("DELETE FROM glucose_points WHERE patient_id=$1 AND source='libre'", [pid]);
    await pool.query("DELETE FROM ecg_events WHERE patient_id=$1 AND source='apple_watch'", [pid]);
    await pool.query("DELETE FROM medications WHERE patient_id=$1", [pid]);
    await pool.query("DELETE FROM wheel_of_life_assessments WHERE patient_id=$1", [pid]);

    for (const v of vitals) {
      await pool.query(
        `INSERT INTO vitals_daily (patient_id, day, source, steps, hrv_ms, resting_hr, sleep_minutes, weight_kg, blood_pressure_sys, blood_pressure_dia)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (patient_id, day, source) DO UPDATE SET
           steps=EXCLUDED.steps, hrv_ms=EXCLUDED.hrv_ms, resting_hr=EXCLUDED.resting_hr,
           sleep_minutes=EXCLUDED.sleep_minutes, weight_kg=EXCLUDED.weight_kg,
           blood_pressure_sys=EXCLUDED.blood_pressure_sys, blood_pressure_dia=EXCLUDED.blood_pressure_dia`,
        [pid, v.day, VITALS_SOURCE, v.steps ?? null, v.hrv_ms ?? null, v.resting_hr ?? null,
         v.sleep_minutes ?? null, v.weight_kg ?? null, v.blood_pressure_sys ?? null, v.blood_pressure_dia ?? null]
      );
    }
    // Glucose in chunks to keep statements small.
    for (let i = 0; i < glucose.length; i += 500) {
      const chunk = glucose.slice(i, i + 500);
      const vals = [];
      const params = [];
      chunk.forEach((g, j) => {
        const b = j * 3;
        vals.push(`($${b + 1},$${b + 2},$${b + 3})`);
        params.push(pid, g.ts, g.mg_dl);
      });
      await pool.query(
        `INSERT INTO glucose_points (patient_id, ts, mg_dl) VALUES ${vals.join(",")}
         ON CONFLICT (patient_id, ts) DO NOTHING`,
        params
      );
    }
    for (const e of ecg) {
      await pool.query(
        `INSERT INTO ecg_events (patient_id, recorded_at, classification, source, blob_key, notes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pid, e.recorded_at, e.classification, e.source, e.blob_key, e.notes]
      );
    }
    for (const m of meds) {
      await pool.query(
        `INSERT INTO medications (patient_id, name, dose, drug_class, status, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [pid, m.name, m.dose, m.drug_class, m.status, m.note]
      );
    }
    await pool.query(
      `INSERT INTO wheel_of_life_assessments (patient_id, taken_on, scores, notes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (patient_id, taken_on) DO UPDATE SET scores=EXCLUDED.scores, notes=EXCLUDED.notes`,
      [pid, wheel.taken_on, JSON.stringify(wheel.scores), wheel.notes]
    );
    await pool.query("COMMIT");
    console.log("✓ Wave 1 applied.");
  } catch (e) {
    await pool.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await pool.end();
  }
}

/* ───── Main ────────────────────────────────────────────────────── */

summary();
if (APPLY) {
  apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
} else {
  console.log("\n(dry run — no DB writes. Re-run with --apply once .env has the current DATABASE_URL.)");
}
