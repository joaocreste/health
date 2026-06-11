#!/usr/bin/env node
/**
 * Withings signal.csv ECG traces -> ecg_events (source='withings') for one patient.
 *
 * signal.csv mixes two trace types: 'Electrocardiogram' (ScanWatch wrist ECG,
 * 512 Hz / 30 s) and 'ADC pressure' (the BPM cuff's pressure-transducer trace,
 * one per BP measurement — NOT an ECG, skipped). The export carries no device
 * classification (doctor_assessment empty, AFib result file header-only), so
 * `classification` is left NULL with an explanatory note.
 *
 * FULL REPLACEMENT scoped to (patient) AND (source='withings'):
 *   DELETE FROM ecg_events WHERE patient_id=<p> AND source='withings'  then INSERT.
 * apple_watch / kardia rows and all other tables are untouched. blob_key points
 * at the archived signal.csv in R2 (all traces live in that one file).
 *
 * Usage: node scripts/ingest-joao-withings-ecg.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const SOURCE = "withings";
const FILE = path.join(root, "Patients", "Joao Victor Creste", "Withings", "signal.csv");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

function parseCsv(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim());
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

const WEAR = { 0: "right wrist", 1: "left wrist", 2: "right arm", 3: "left arm" };
const traces = parseCsv(FILE);
const rows = traces
  .filter((r) => r.type === "Electrocardiogram")
  .map((r) => ({
    recorded_at: new Date(r.date).toISOString(),
    duration_seconds: Number(r.duration) || null,
    notes: `ScanWatch ECG, ${r.frequency} Hz, ${WEAR[r.wearposition] || "unknown position"}; no device classification in Health Mate export`,
  }))
  .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at));

console.log("── Withings signal.csv -> ecg_events ──");
console.log(`traces in file : ${traces.length}  (ECG: ${rows.length}, ADC pressure skipped: ${traces.length - rows.length})`);
console.log(`date range     : ${rows[0]?.recorded_at.slice(0, 10)} … ${rows[rows.length - 1]?.recorded_at.slice(0, 10)}`);
console.log(`sample         : ${JSON.stringify(rows[0])}`);

if (!APPLY) { console.log("\n(dry run — no DB writes. Re-run with --apply.)"); process.exit(0); }

const sql = neon(loadDatabaseUrl());
const u = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
const pid = u[0].id;
const blobKey = `patients/${pid}/withings/signal.csv`;
const before = await sql`SELECT count(*)::int n FROM ecg_events WHERE patient_id=${pid} AND source=${SOURCE}`;
await sql.transaction([
  sql`DELETE FROM ecg_events WHERE patient_id=${pid} AND source=${SOURCE}`,
  ...rows.map((r) => sql`
    INSERT INTO ecg_events (patient_id, recorded_at, classification, duration_seconds, source, blob_key, notes)
    VALUES (${pid}, ${r.recorded_at}, NULL, ${r.duration_seconds}, ${SOURCE}, ${blobKey}, ${r.notes})`),
]);
const after = await sql`SELECT count(*)::int n, min(recorded_at)::date::text mn, max(recorded_at)::date::text mx FROM ecg_events WHERE patient_id=${pid} AND source=${SOURCE}`;
const other = await sql`SELECT source, count(*)::int n FROM ecg_events WHERE patient_id=${pid} AND source<>${SOURCE} GROUP BY source`;
console.log(`withings ecg before->after : ${before[0].n} -> ${after[0].n}  (${after[0].mn} … ${after[0].mx})`);
console.log(`other ecg sources (untouched): ${JSON.stringify(other)}`);
console.log("✓ Withings ecg_events replaced.");
