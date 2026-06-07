#!/usr/bin/env node
/**
 * Upsert Maria Regina Coury's imaging_studies rows (4 studies, Reading A).
 * Scoped idempotent full replacement: DELETE her imaging_studies, INSERT 4.
 * Manifests + previews are produced by scripts/build-mrc-imaging.py and served
 * from web/scans/; blob_prefix records the intended R2 path (originals not yet
 * uploaded — viewer reads the web manifests, not R2).
 *
 *   node scripts/ingest-mrc-imaging-rows.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:maria-regina-coury-0cfb1b";
const PSLUG = "maria-regina-coury";

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const e = fs.readFileSync(path.join(root, ".env"), "utf8");
  return e.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1];
}

// newest first
const rows = [
  { slug: "lumbar-mri-2026-05-14", modality: "MRI", body: "lumbar_spine", date: "2026-05-14",
    src: "DICOM", files: 168, report: true, notes: "Lumbar spine MRI (CD export). 8 sequences + key images." },
  { slug: "femur-mri-2026-05-14", modality: "MRI", body: "thigh", date: "2026-05-14",
    src: "DICOM", files: 322, report: true, notes: "Thigh/femur MRI (CD export). 6 sequences + key images." },
  { slug: "coronary-ct-2025-01-21", modality: "CT", body: "heart", date: "2025-01-21",
    src: "DICOM", files: 48, report: false,
    notes: "Cardiac CT: coronary calcium score (44 slices) + coronary CTA (4 secondary-capture key images; full angio volume not in export). Previews rendered from DICOM." },
  { slug: "echocardiogram-2025-01-21", modality: "US", body: "heart", date: "2025-01-21",
    src: "MIXED", files: 0, report: true, notes: "Transthoracic echocardiogram — report-only (no image series in export)." },
];

function rowFields(pid, r) {
  return {
    patient_id: pid,
    modality: r.modality,
    body_part: r.body,
    study_date: r.date,
    source_format: r.src,
    blob_prefix: `patients/${pid}/imaging/${r.slug}/`,          // intended R2 path (originals not yet uploaded)
    manifest_blob_key: `scans/${PSLUG}-${r.slug}-manifest.json`, // web-served manifest the viewer reads
    report_blob_key: r.report ? `scans/${PSLUG}-${r.slug}/report.pdf` : null,
    jpeg_preview_prefix: `scans/${PSLUG}-${r.slug}/`,
    file_count: r.files,
    notes: r.notes,
  };
}

async function main() {
  const sql = neon(dbUrl());
  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error("patient not found"); process.exit(1); }
  const pid = u[0].id;
  const before = (await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`)[0].n;
  console.log("patient:", pid, "| imaging_studies before:", before);
  for (const r of rows) console.log(`  ${r.slug}: ${r.modality}/${r.body}/${r.date} files=${r.files} report=${r.report}`);
  if (!APPLY) { console.log("\n(dry run — re-run with --apply)"); return; }
  const queries = [
    sql`DELETE FROM imaging_studies WHERE patient_id=${pid}`,
    ...rows.map((r) => {
      const f = rowFields(pid, r);
      return sql`INSERT INTO imaging_studies
        (patient_id, modality, body_part, study_date, source_format, blob_prefix,
         manifest_blob_key, report_blob_key, jpeg_preview_prefix, file_count, notes)
        VALUES (${f.patient_id}, ${f.modality}, ${f.body_part}, ${f.study_date}::date, ${f.source_format},
         ${f.blob_prefix}, ${f.manifest_blob_key}, ${f.report_blob_key}, ${f.jpeg_preview_prefix},
         ${f.file_count}, ${f.notes})`;
    }),
  ];
  await sql.transaction(queries);
  const after = await sql`SELECT modality, body_part, study_date, file_count, manifest_blob_key
    FROM imaging_studies WHERE patient_id=${pid} ORDER BY study_date DESC`;
  console.log(`\nimaging_studies ${before} -> ${after.length}:`);
  after.forEach((x) => console.log(`  ${x.study_date.toISOString?.().slice(0,10) || x.study_date} ${x.modality}/${x.body_part} files=${x.file_count} ${x.manifest_blob_key}`));
  console.log("✓ done.");
}
main().catch((e) => { console.error("✗", e.message); process.exit(1); });
