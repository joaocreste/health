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
 *   node scripts/ingest-joao-wave1.mjs --apply    # POSTs to the live Worker seed endpoint
 *
 * Writes go through POST /api/admin/seed-clinical on the deployed Worker (which
 * holds the live DATABASE_URL secret), so no local Neon credentials are needed.
 * Idempotent: the endpoint does a scoped DELETE then INSERT per table.
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

/* ───── Apply (via the live Worker seed endpoint) ───────────────── */

const BASE = process.env.LUMEN_BASE || "https://lumenhealth.io";
const ADMIN = process.env.LUMEN_ADMIN_CLERK || "pending:admin";

async function seed(table, rows) {
  const resp = await fetch(`${BASE}/api/admin/seed-clinical`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Viewer-Clerk": ADMIN },
    body: JSON.stringify({ patient_clerk: CLERK, table, rows }),
  });
  const text = await resp.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text.slice(0, 300) }; }
  if (!resp.ok || !j.ok) throw new Error(`${table}: HTTP ${resp.status} ${JSON.stringify(j)}`);
  console.log(`  ✓ ${table}: inserted ${j.inserted}`);
}

async function apply() {
  console.log(`\nApplying via ${BASE} (admin=${ADMIN}) …`);
  await seed("vitals_daily", vitals.map((v) => ({ ...v, source: VITALS_SOURCE })));
  await seed("glucose_points", glucose);
  await seed("ecg_events", ecg);
  await seed("medications", meds);
  await seed("wheel_of_life_assessments", [wheel]);
  console.log("✓ Wave 1 applied.");
}

/* ───── Main ────────────────────────────────────────────────────── */

summary();
if (APPLY) {
  apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
} else {
  console.log("\n(dry run — no DB writes. Re-run with --apply once .env has the current DATABASE_URL.)");
}
