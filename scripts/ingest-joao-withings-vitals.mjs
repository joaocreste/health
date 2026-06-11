#!/usr/bin/env node
/**
 * Withings Health Mate export -> vitals_daily for one patient.
 *
 * Two per-source row families, matching the device hierarchy in lib/vitals-resolve.js:
 *   weight.csv -> source='withings_scale'  weight_kg = LAST reading of the day;
 *                 fat/bone/muscle/hydration kg ride in extras (no dedicated columns).
 *   bp.csv     -> source='withings_cuff'   blood_pressure_sys/_dia = daily MEAN (int);
 *                 the cuff pulse is a seated spot-check, NOT resting HR -> extras.
 *
 * FULL REPLACEMENT scoped to (patient) AND (Withings provenance): deletes
 * source IN ('withings','withings_body','withings_bp','withings_cuff','withings_scale')
 * (incl. legacy aliases the resolver normalizes), then reinserts fresh. The
 * oura / apple_health / aggregate / resolved rows are NEVER touched.
 *
 * Watch/tracker files (sleep.csv, manual_spo2.csv, aggregates_*) are deliberately
 * NOT loaded: the resolver has no sanctioned watch tag — they stay raw in R2.
 *
 * Usage:
 *   node scripts/ingest-joao-withings-vitals.mjs            # dry run
 *   node scripts/ingest-joao-withings-vitals.mjs --apply    # delete+insert
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const DIR = path.join(root, "Patients", "Joao Victor Creste", "Withings");
const DELETE_SOURCES = ["withings", "withings_body", "withings_bp", "withings_cuff", "withings_scale"];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

// Minimal CSV line parser (handles quoted fields; these files have no embedded newlines).
function parseCsv(file) {
  const lines = fs.readFileSync(path.join(DIR, file), "utf8").split("\n").filter((l) => l.trim());
  const split = (line) => {
    const out = []; let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const header = split(lines[0]);
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [header[i], v])));
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) && v !== "" ? n : null; };
const dayOf = (ts) => ts.slice(0, 10);

/* ── withings_scale rows from weight.csv (last reading of the day wins) ── */
const scale = new Map(); // day -> { ts, weight, fat, bone, muscle, hydration }
for (const r of parseCsv("weight.csv")) {
  const ts = r["Date"], d = dayOf(ts), w = num(r["Weight (kg)"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || w == null) continue;
  const prev = scale.get(d);
  if (!prev || ts > prev.ts) scale.set(d, {
    ts, weight: w,
    fat: num(r["Fat mass (kg)"]), bone: num(r["Bone mass (kg)"]),
    muscle: num(r["Muscle mass (kg)"]), hydration: num(r["Hydration (kg)"]),
  });
}
const scaleRows = [...scale.entries()].sort().map(([d, v]) => {
  const extras = {};
  if (v.fat != null) extras.fat_mass_kg = v.fat;
  if (v.bone != null) extras.bone_mass_kg = v.bone;
  if (v.muscle != null) extras.muscle_mass_kg = v.muscle;
  if (v.hydration != null) extras.hydration_kg = v.hydration;
  return { day: d, source: "withings_scale", weight_kg: v.weight, extras: Object.keys(extras).length ? extras : null };
});

/* ── withings_cuff rows from bp.csv (daily mean, int) ── */
const cuff = new Map(); // day -> { sysSum, diaSum, hrSum, hrN, n }
for (const r of parseCsv("bp.csv")) {
  const d = dayOf(r["Date"]), sys = num(r["Systolic"]), dia = num(r["Diastolic"]), hr = num(r["Heart rate"]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || sys == null || dia == null) continue;
  const b = cuff.get(d) || { sysSum: 0, diaSum: 0, hrSum: 0, hrN: 0, n: 0 };
  b.sysSum += sys; b.diaSum += dia; b.n++;
  if (hr != null) { b.hrSum += hr; b.hrN++; }
  cuff.set(d, b);
}
const cuffRows = [...cuff.entries()].sort().map(([d, b]) => ({
  day: d, source: "withings_cuff",
  blood_pressure_sys: Math.round(b.sysSum / b.n),
  blood_pressure_dia: Math.round(b.diaSum / b.n),
  extras: { bp_readings: b.n, ...(b.hrN ? { cuff_pulse: Math.round(b.hrSum / b.hrN) } : {}) },
}));

const all = [...scaleRows, ...cuffRows];
console.log("── Withings -> vitals_daily ──");
console.log(`withings_scale : ${scaleRows.length} days  (${scaleRows[0]?.day} … ${scaleRows[scaleRows.length - 1]?.day})`);
console.log(`withings_cuff  : ${cuffRows.length} days  (${cuffRows[0]?.day} … ${cuffRows[cuffRows.length - 1]?.day})`);
console.log(`sample scale   : ${JSON.stringify(scaleRows[scaleRows.length - 1])}`);
console.log(`sample cuff    : ${JSON.stringify(cuffRows[cuffRows.length - 1])}`);

if (!APPLY) { console.log("\n(dry run — no DB writes. Re-run with --apply.)"); process.exit(0); }

const sql = neon(loadDatabaseUrl());
const u = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
if (!u.length) { console.error("✗ patient not found"); process.exit(1); }
const pid = u[0].id;

const before = await sql`SELECT source, count(*)::int n FROM vitals_daily WHERE patient_id=${pid} GROUP BY source ORDER BY source`;
await sql`DELETE FROM vitals_daily WHERE patient_id=${pid} AND source = ANY(${DELETE_SOURCES})`;
const CH = 200;
for (let i = 0; i < all.length; i += CH) {
  await sql.transaction(all.slice(i, i + CH).map((v) => sql`
    INSERT INTO vitals_daily (patient_id, day, source, weight_kg, blood_pressure_sys, blood_pressure_dia, extras)
    VALUES (${pid}, ${v.day}, ${v.source}, ${v.weight_kg ?? null}, ${v.blood_pressure_sys ?? null}, ${v.blood_pressure_dia ?? null},
            ${v.extras ? JSON.stringify(v.extras) : null}::jsonb)
    ON CONFLICT (patient_id, day, source) DO UPDATE SET
      weight_kg=EXCLUDED.weight_kg, blood_pressure_sys=EXCLUDED.blood_pressure_sys,
      blood_pressure_dia=EXCLUDED.blood_pressure_dia, extras=EXCLUDED.extras`));
  process.stdout.write(`\r  inserted ${Math.min(i + CH, all.length)}/${all.length}…`);
}
process.stdout.write("\n");
const after = await sql`SELECT source, count(*)::int n, min(day)::text mn, max(day)::text mx FROM vitals_daily WHERE patient_id=${pid} GROUP BY source ORDER BY source`;
console.log(`before : ${JSON.stringify(before)}`);
console.log(`after  : ${JSON.stringify(after)}`);
console.log("✓ Withings vitals_daily replaced (non-Withings sources must be unchanged above).");
