#!/usr/bin/env node
/**
 * Record the Withings raw-file archive as pipeline pointer rows: one `imports`
 * row (source='admin_upload') + one `import_files` row per R2 object under
 * patients/{pid}/withings/. FULL REPLACEMENT of the patient's prior Withings
 * import rows, scoped by classified_as LIKE 'withings%'.
 *
 * Mirrors scripts/record-joao-apple-import.mjs. GPS-bearing files
 * (raw_location_*.csv, devices.csv) are excluded from R2 and so get no rows.
 *
 * Usage: node scripts/record-joao-withings-import.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const SRC = path.join(root, "Patients", "Joao Victor Creste", "Withings");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

function classify(name) {
  if (name === "weight.csv") return { cls: "withings_weight_csv", target: "vitals_daily", status: "parsed", mime: "text/csv" };
  if (name === "bp.csv") return { cls: "withings_bp_csv", target: "vitals_daily", status: "parsed", mime: "text/csv" };
  if (name === "signal.csv") return { cls: "withings_signal_csv", target: "ecg_events", status: "parsed", mime: "text/csv" };
  if (name.startsWith("raw_")) return { cls: "withings_raw_csv", target: null, status: "classified", mime: "text/csv" };
  if (name.endsWith(".csv")) return { cls: "withings_csv", target: null, status: "classified", mime: "text/csv" };
  if (name.endsWith(".txt")) return { cls: "withings_meta", target: null, status: "classified", mime: "text/plain" };
  if (/\.(jpe?g)$/i.test(name)) return { cls: "withings_meta", target: null, status: "classified", mime: "image/jpeg" };
  return { cls: "withings_meta", target: null, status: "classified", mime: "application/octet-stream" };
}

const EXCLUDE = (n) => n.startsWith("raw_location_") || n === "devices.csv" || n === ".DS_Store";
const files = fs.readdirSync(SRC).filter((f) => !EXCLUDE(f) && fs.statSync(path.join(SRC, f)).isFile()).sort()
  .map((f) => ({ rel: f, size: fs.statSync(path.join(SRC, f)).size, ...classify(f) }));

console.log(`files: ${files.length} (parsed: ${files.filter(f => f.status === "parsed").length}, classified: ${files.filter(f => f.status === "classified").length})`);
if (!APPLY) { console.log("(dry run — re-run with --apply.)"); process.exit(0); }

const sql = neon(loadDatabaseUrl());
const [patient] = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
const [admin] = await sql`SELECT id FROM users WHERE clerk_user_id='pending:admin' LIMIT 1`;
const pid = patient.id;
const prefix = `patients/${pid}/withings/`;

const old = await sql`
  SELECT DISTINCT i.id FROM imports i JOIN import_files f ON f.import_id=i.id
  WHERE i.patient_id=${pid} AND f.classified_as LIKE 'withings%'`;
for (const o of old) await sql`DELETE FROM imports WHERE id=${o.id}`;
console.log(`prior withings imports deleted: ${old.length}`);

const [imp] = await sql`
  INSERT INTO imports (patient_id, initiated_by, source, status, total_files, processed_files, failed_files, started_at, completed_at)
  VALUES (${pid}, ${admin?.id || null}, 'admin_upload', 'completed', ${files.length}, ${files.length}, 0, now(), now())
  RETURNING id`;

const CH = 50;
for (let i = 0; i < files.length; i += CH) {
  await sql.transaction(files.slice(i, i + CH).map((f) => sql`
    INSERT INTO import_files (import_id, original_path, mime_type, size_bytes, blob_key, classified_as, target_table, status)
    VALUES (${imp.id}, ${f.rel}, ${f.mime}, ${f.size}, ${prefix + f.rel}, ${f.cls}, ${f.target}, ${f.status})`));
}
const [n] = await sql`SELECT count(*)::int n FROM import_files WHERE import_id=${imp.id}`;
console.log(`✓ imports row ${imp.id} + ${n.n} import_files rows recorded.`);
