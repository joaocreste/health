#!/usr/bin/env node
// imaging_studies row for Silvana's thyroid ultrasound (2026-07-03, DMI Ribeirão
// Preto) — her first study with real pixel data + an interactive viewer (all her
// prior imaging is text-only transcription that feeds the AI engine). Newest in
// the longitudinal DMI thyroid series (2020 -> 2026).
//
// Idempotent: delete-by-blob_prefix then insert (additive — never touches her
// text-only backfill rows, which live under the `frontend-backfill/silvana/`
// namespace). See scripts/backfill-silvana-imaging.mjs and the Paulo
// imaging-backfill-clobber lesson.
import fs from "node:fs";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const url = (process.env.DATABASE_URL ||
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1])
  .trim().replace(/["']/g, "");
const sql = neon(url);

const SILVANA = "pending:silvana-creste-18ba19";

const ROW = {
  blob_prefix: "scans/silvana-thyroid-us-2026-07-03",
  modality: "US",
  body_part: "thyroid",
  study_date: "2026-07-03",
  source_format: "DICOM",
  jpeg_preview_prefix: "scans/silvana-thyroid-us-2026-07-03",
  manifest_blob_key: "scans/silvana-thyroid-us-2026-07-03-manifest.json",
  report_blob_key: "scans/silvana-thyroid-us-2026-07-03/report.pdf",
  file_count: 10,
  requesting_doctor: "Dr. José Roberto Chodraui",
  performing_doctor: "Dr. Ricardo Issa — CRM 67417/SP",
  lab_name: "DMI · Diagnóstico Médico Integrado",
  lab_city: "Ribeirão Preto",
  lab_country: "Brazil",
  notes:
    "Thyroid ultrasound with color Doppler — DMI · Diagnóstico Médico Integrado, Ribeirão Preto " +
    "(Dr. Ricardo Issa, CRM 67417/SP; requested by Dr. José Roberto Chodraui). Newest in the " +
    "longitudinal DMI thyroid series (2020 -> 2026). Findings: heterogeneous, reduced-volume " +
    "thyroid — right lobe 1.51 cm3, left lobe 1.71 cm3, isthmus 0.10 cm3, total 3.32 cm3; regular " +
    "contours; normal color-Doppler vascularization. Left lobe: superior-third heterogeneous nodule " +
    "with calcification 0.8 x 0.7 cm (Chammas III / TI-RADS 4, stable) and inferior-third hypoechoic " +
    "nodule 0.7 x 0.4 cm (Chammas III / TI-RADS 3, stable). Normal submandibular and parotid glands. " +
    "No significant sonographic change vs 30 Mar 2023. Impression: reduced-volume thyroid with stable " +
    "left-lobe nodules as described. Toshiba TUS-A300; 10 B-mode/Doppler captures; StudyInstanceUID " +
    "1.2.840.113663.1500.1.403154046.1.1.20260703.74005.89317; accession 89317.\n\n" +
    "[PT] Ultrassonografia da tireoide com Doppler colorido — DMI · Diagnóstico Médico Integrado, " +
    "Ribeirão Preto (Dr. Ricardo Issa, CRM 67417/SP; solicitado pelo Dr. José Roberto Chodraui). Mais " +
    "recente da série tireoidiana longitudinal do DMI (2020 -> 2026). Achados: tireoide heterogênea e " +
    "de dimensões reduzidas — lobo direito 1,51 cm³, lobo esquerdo 1,71 cm³, istmo 0,10 cm³, volume " +
    "total 3,32 cm³; contornos regulares; vascularização habitual ao Doppler colorido. Lobo esquerdo: " +
    "nódulo heterogêneo com calcificação no terço superior 0,8 x 0,7 cm (padrão III de Chammas / " +
    "TI-RADS 4, estável) e nódulo hipoecoico no terço inferior 0,7 x 0,4 cm (padrão III de Chammas / " +
    "TI-RADS 3, estável). Glândulas submandibulares e parótidas normais. Sem alterações ecográficas " +
    "significativas vs 30 mar 2023. Impressão: tireoide de dimensões reduzidas com nódulos estáveis no " +
    "lobo esquerdo conforme descrito.",
};

const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${SILVANA} LIMIT 1`;
if (!u.length) throw new Error("Silvana user not found");
const pid = u[0].id;
console.log(`Patient: ${u[0].full_name} (${pid})`);

await sql`DELETE FROM imaging_studies WHERE patient_id = ${pid} AND blob_prefix = ${ROW.blob_prefix}`;
await sql`
  INSERT INTO imaging_studies
    (patient_id, modality, body_part, study_date, source_format, blob_prefix,
     manifest_blob_key, report_blob_key, jpeg_preview_prefix, file_count, notes,
     requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
  VALUES
    (${pid}, ${ROW.modality}, ${ROW.body_part}, ${ROW.study_date}, ${ROW.source_format}, ${ROW.blob_prefix},
     ${ROW.manifest_blob_key}, ${ROW.report_blob_key}, ${ROW.jpeg_preview_prefix}, ${ROW.file_count}, ${ROW.notes},
     ${ROW.requesting_doctor}, ${ROW.performing_doctor}, ${ROW.lab_name}, ${ROW.lab_city}, ${ROW.lab_country})`;
console.log("upserted", ROW.blob_prefix);

await markSourceWritten(sql, pid, { writer: "ingest-silvana-thyroid-us-2026-07-03-db" });

const chk = await sql`
  SELECT study_date, modality, body_part, file_count, lab_name
  FROM imaging_studies WHERE patient_id = ${pid} AND body_part = 'thyroid'
  ORDER BY study_date DESC`;
console.log("thyroid imaging rows now:", JSON.stringify(chk, null, 1));
