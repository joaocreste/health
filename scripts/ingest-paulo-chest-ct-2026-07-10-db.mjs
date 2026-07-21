#!/usr/bin/env node
// imaging_studies rows for Paulo's two chest CTs:
//  - 2026-07-10 contrast CT (new ingest, HURP Ribeirão Preto)
//  - 2026-07-06 non-contrast CT (backfill — the study shipped front-end-only
//    and never got its DB row, violating the DB-is-source-of-truth invariant)
// Idempotent: delete-by-blob_prefix then insert (additive pattern — never
// touches other imaging rows).
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const url = (process.env.DATABASE_URL ||
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8").match(/DATABASE_URL=(.*)/)[1])
  .trim().replace(/["']/g, "");
const sql = neon(url);

const PAULO = "pending:paulo-silotto-df3441";

const ROWS = [
  {
    blob_prefix: "scans/paulo-chest-ct-2026-07-10",
    modality: "CT",
    body_part: "Chest",
    study_date: "2026-07-10",
    source_format: "DICOM",
    jpeg_preview_prefix: "scans/paulo-chest-ct-2026-07-10",
    manifest_blob_key: "scans/paulo-chest-ct-2026-07-10/manifest.json",
    report_blob_key: "scans/paulo-chest-ct-2026-07-10/report.pdf",
    file_count: 2216,
    requesting_doctor: "Helton de Oliveira Couto",
    performing_doctor: "Gregory Martins Garcia — CRM 184406",
    lab_name: "HURP — Hospital Unimed Ribeirão Preto · Centro de Diagnóstico por Imagem",
    lab_city: "Ribeirão Preto",
    lab_country: "Brazil",
    notes:
      "Chest CT with IV iodinated contrast, HURP — Hospital Unimed Ribeirão Preto (Dr. Gregory Martins Garcia, CRM 184406; requested by Dr. Helton de Oliveira Couto). Contrast follow-up to the 2026-07-06 non-contrast chest CT. Findings: bilateral bronchial wall thickening (bronchopathy); nonspecific 3 mm pulmonary micronodule in the left segment X (posterior-basal); aortic, supra-aortic and coronary atheromatosis; small left posterior fat-containing diaphragmatic hernia; degenerative spine changes. No pleural effusion or thickening; no mediastinal lymphadenopathy or masses; normal pulmonary vasculature; soft tissues unremarkable. Conclusion: bronchopathy; nonspecific left pulmonary micronodule. Canon Aquilion Lightning; accession 1056973; StudyInstanceUID 1.2.826.0.1.3680043.2.951.1905435. 13 series (2,216 instances); web viewer serves 11 diagnostic series (2,211 slices) as window x plane stacks (mediastinal 5mm / lung 3mm / MIP 20mm / thin 1mm axials); scout and dose summary excluded.",
  },
  {
    blob_prefix: "scans/paulo-chest-ct-2026-07-06",
    modality: "CT",
    body_part: "Chest",
    study_date: "2026-07-06",
    source_format: "DICOM",
    jpeg_preview_prefix: "scans/paulo-chest-ct-2026-07-06",
    manifest_blob_key: "scans/paulo-chest-ct-2026-07-06/manifest.json",
    report_blob_key: "scans/paulo-chest-ct-2026-07-06-report.pdf",
    file_count: 728,
    requesting_doctor: "Dra. Tereza Cristina Goes Fernandez",
    performing_doctor: null,
    lab_name: "Hospital São Luiz Campinas · Rede D'Or",
    lab_city: "Campinas",
    lab_country: "Brazil",
    notes:
      "Chest CT without IV contrast (inspiration + expiration), Hospital São Luiz Campinas, Rede D'Or (requested by Dra. Tereza Cristina Goes Fernandez). Findings: diffuse bronchial wall thickening; lungs normally aerated; no pleural effusion or pneumothorax; no mediastinal lymph-node enlargement; aorta and pulmonary trunk of preserved calibre with discrete diffuse atheromatosis including coronary; dorsal (thoracic) spondylosis; probable tiny right renal cyst. Conclusion: inflammatory bronchopathy. GE Revolution Maxima; accession 9000000249014098. Web viewer serves 6 diagnostic reconstructions (728 slices); dose sheet excluded.",
  },
];

const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${PAULO} LIMIT 1`;
if (!u.length) throw new Error("Paulo user not found");
const pid = u[0].id;

for (const r of ROWS) {
  await sql`DELETE FROM imaging_studies WHERE patient_id = ${pid} AND blob_prefix = ${r.blob_prefix}`;
  await sql`
    INSERT INTO imaging_studies
      (patient_id, modality, body_part, study_date, source_format, blob_prefix,
       manifest_blob_key, report_blob_key, jpeg_preview_prefix, file_count, notes,
       requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
    VALUES
      (${pid}, ${r.modality}, ${r.body_part}, ${r.study_date}, ${r.source_format}, ${r.blob_prefix},
       ${r.manifest_blob_key}, ${r.report_blob_key}, ${r.jpeg_preview_prefix}, ${r.file_count}, ${r.notes},
       ${r.requesting_doctor}, ${r.performing_doctor}, ${r.lab_name}, ${r.lab_city}, ${r.lab_country})`;
  console.log("upserted", r.blob_prefix);
}
await markSourceWritten(sql, pid, { writer: "ingest-paulo-chest-ct-2026-07-10-db" });
const chk = await sql`SELECT study_date, body_part, file_count FROM imaging_studies WHERE patient_id = ${pid} AND modality = 'CT' AND body_part = 'Chest' ORDER BY study_date DESC`;
console.log(JSON.stringify(chk));
