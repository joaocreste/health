#!/usr/bin/env node
/**
 * Record the 2026-06-11 Apple Health raw-file archive as pipeline pointer rows:
 * one `imports` row (source='admin_upload') + one `import_files` row per R2
 * object under patients/{pid}/apple-health/. FULL REPLACEMENT of the patient's
 * prior Apple Health import rows (none existed before 2026-06-11 — the 06-02
 * run had no R2 token), scoped by classified_as LIKE 'apple_health%'.
 *
 * Usage: node scripts/record-joao-apple-import.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const SRC = path.join(root, "Patients", "Joao Victor Creste", "Apple Health");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

const sz = (p) => fs.statSync(path.join(SRC, p)).size;
const files = [
  { rel: "export.xml", blob: "export.xml.gz", mime: "application/gzip", cls: "apple_health_export_xml", target: "vitals_daily", status: "parsed" },
  { rel: "export_cda.xml", blob: "export_cda.xml.gz", mime: "application/gzip", cls: "apple_health_cda_xml", target: null, status: "classified" },
  ...fs.readdirSync(path.join(SRC, "electrocardiograms")).filter((f) => f.endsWith(".csv")).sort()
    .map((f) => ({ rel: `electrocardiograms/${f}`, blob: `electrocardiograms/${f}`, mime: "text/csv", cls: "apple_health_ecg_csv", target: "ecg_events", status: "parsed" })),
  ...fs.readdirSync(path.join(SRC, "workout-routes")).filter((f) => f.endsWith(".gpx")).sort()
    .map((f) => ({ rel: `workout-routes/${f}`, blob: `workout-routes/${f}`, mime: "application/gpx+xml", cls: "apple_health_gpx_route", target: null, status: "classified" })),
];

console.log(`files: ${files.length} (xml 2, ecg ${files.filter(f=>f.cls.includes("ecg")).length}, gpx ${files.filter(f=>f.cls.includes("gpx")).length})`);
if (!APPLY) { console.log("(dry run — re-run with --apply.)"); process.exit(0); }

const sql = neon(loadDatabaseUrl());
const [patient] = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
const [admin] = await sql`SELECT id FROM users WHERE clerk_user_id='pending:admin' LIMIT 1`;
const pid = patient.id;
const prefix = `patients/${pid}/apple-health/`;

// wipe prior Apple Health import rows for this patient (import_files cascade)
const old = await sql`
  SELECT DISTINCT i.id FROM imports i JOIN import_files f ON f.import_id=i.id
  WHERE i.patient_id=${pid} AND f.classified_as LIKE 'apple_health%'`;
for (const o of old) await sql`DELETE FROM imports WHERE id=${o.id}`;
console.log(`prior apple_health imports deleted: ${old.length}`);

const [imp] = await sql`
  INSERT INTO imports (patient_id, initiated_by, source, status, total_files, processed_files, failed_files, started_at, completed_at)
  VALUES (${pid}, ${admin?.id || null}, 'admin_upload', 'completed', ${files.length}, ${files.length}, 0, now(), now())
  RETURNING id`;

const CH = 50;
for (let i = 0; i < files.length; i += CH) {
  await sql.transaction(files.slice(i, i + CH).map((f) => sql`
    INSERT INTO import_files (import_id, original_path, mime_type, size_bytes, blob_key, classified_as, target_table, status)
    VALUES (${imp.id}, ${f.rel}, ${f.mime}, ${sz(f.blob === f.rel ? f.rel : f.blob)}, ${prefix + f.blob}, ${f.cls}, ${f.target}, ${f.status})`));
}
const [n] = await sql`SELECT count(*)::int n FROM import_files WHERE import_id=${imp.id}`;
console.log(`✓ imports row ${imp.id} + ${n.n} import_files rows recorded.`);
