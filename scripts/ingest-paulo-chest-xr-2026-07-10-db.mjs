#!/usr/bin/env node
// imaging_studies row for Paulo's 2-view chest X-ray (2026-07-10, HURP).
// Idempotent: delete-by-blob_prefix then insert.
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const url = (process.env.DATABASE_URL ||
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8").match(/DATABASE_URL=(.*)/)[1])
  .trim().replace(/["']/g, "");
const sql = neon(url);

const PAULO = "pending:paulo-silotto-df3441";
const PREFIX = "scans/paulo-chest-xr-2026-07-10";

const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${PAULO} LIMIT 1`;
if (!u.length) throw new Error("Paulo user not found");
const pid = u[0].id;

await sql`DELETE FROM imaging_studies WHERE patient_id = ${pid} AND blob_prefix = ${PREFIX}`;
await sql`
  INSERT INTO imaging_studies
    (patient_id, modality, body_part, study_date, source_format, blob_prefix,
     manifest_blob_key, report_blob_key, jpeg_preview_prefix, file_count, notes,
     requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
  VALUES
    (${pid}, 'XR', 'Chest', '2026-07-10', 'DICOM', ${PREFIX},
     ${PREFIX + "/manifest.json"}, ${PREFIX + "/report.pdf"}, ${PREFIX}, 2,
     ${"Chest X-ray, 2 views (PA + lateral), HURP — Hospital Unimed Ribeirão Preto (Dr. Renato Campos Soares de Faria, CRM 82077; requested by Dr. Helton de Oliveira Couto). Performed 18:32, same visit as the 19:09 contrast chest CT. NORMAL STUDY: intact rib arches; normal hila and pulmonary vasculature; centered mediastinum without widening; lung parenchyma without opacities, consolidations or nodules; free costophrenic angles and diaphragmatic domes; aorta of normal morphology, dimensions and topography; cardiothoracic index within normal limits. Impression: radiologically normal chest. Accession 1056974; StudyInstanceUID 1.2.826.0.1.3680043.2.951.1905436."},
     'Helton de Oliveira Couto', 'Renato Campos Soares de Faria — CRM 82077',
     ${"HURP — Hospital Unimed Ribeirão Preto · Centro de Diagnóstico por Imagem"}, 'Ribeirão Preto', 'Brazil')`;
console.log("upserted", PREFIX);
await markSourceWritten(sql, pid, { writer: "ingest-paulo-chest-xr-2026-07-10-db" });
const chk = await sql`SELECT study_date, modality, body_part FROM imaging_studies WHERE patient_id = ${pid} AND study_date = '2026-07-10' ORDER BY modality`;
console.log(JSON.stringify(chk));
