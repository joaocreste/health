#!/usr/bin/env node
/**
 * Additive ingestion of Paulo Augusto Silotto's 8 report-only imaging studies
 * (the "New Exams/Imagery" drop: 2013-2025). These are PDF doctor reports with
 * no source imagery — they render as report cards in web/assets/patient-context.js
 * (buildPauloOtherStudiesSection, eyebrows 4F-4M) and are mirrored here into
 * imaging_studies so the AI Insights pipeline (lib/ai-insights.js, DB-only) sees
 * them.
 *
 * ADDITIVE + IDEMPOTENT BY DESIGN. Unlike backfill-paulo-clinical.mjs (which
 * DELETEs *all* of Paulo's imaging rows and re-inserts WITHOUT provenance), this
 * script only touches the 8 rows it owns (matched by blob_prefix) so the
 * provenance already backfilled onto the other 10 rows is never clobbered.
 * Each of these 8 rows carries its own provenance, read from the report covers.
 *
 * Usage:  node scripts/ingest-paulo-imagery-wave.mjs [--apply]
 *   (dry-run by default; pass --apply to write)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const DATABASE_URL = process.env.DATABASE_URL || fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
const sql = neon(DATABASE_URL);
const CLERK = "pending:paulo-silotto-df3441";

// modality enum: MRI | CT | PET | US | XR | EEG | ECG | OTHER
const STUDIES = [
  {
    slug: "paulo-abdomen-us-2013-07-27",
    modality: "US", body_part: "Abdomen", study_date: "2013-07-27",
    requesting_doctor: "Dr. Fernando Luiz de Almeida Galante",
    performing_doctor: "Dr. Paulo Tadeu de C. Prado (CRM 04233)",
    lab_name: "Instituto de Radiologia", lab_city: null, lab_country: "Brasil",
    notes:
      "Abdominal ultrasound, Instituto de Radiologia (Dr. Paulo Tadeu de C. Prado, CRM 04233; req. Dr. Fernando Luiz de Almeida Galante). EARLIEST study on file. Hepatomegaly (right lobe 16.0 cm, left lobe 8.9 cm) with diffusely increased echogenicity and beam attenuation. Pancreas, spleen, kidneys, biliary tree, gallbladder, bladder, prostate and seminal vesicles normal. No abdominal mass. IMPRESSION: mild hepatic steatosis with hepatomegaly. (Report-only.)",
  },
  {
    slug: "paulo-chest-xr-2019-01-23",
    modality: "XR", body_part: "Chest", study_date: "2019-01-23",
    requesting_doctor: "Dr. Jimy Israel Haenke Montenegro",
    performing_doctor: "Dr. Auro Giorgi Ferreira Nobre (CRM 112526)",
    lab_name: "Unimed - Diagnóstico por Imagem", lab_city: null, lab_country: "Brasil",
    notes:
      "Chest X-ray, Unimed Diagnóstico por Imagem (Dr. Auro Giorgi Ferreira Nobre, CRM 112526; req. Dr. Jimy Israel Haenke Montenegro). Normal pleuropulmonary fields, preserved cardiac area and great vessels, intact bone and soft tissues, clear costophrenic sinuses. IMPRESSION: radiologically normal chest. (Report-only.)",
  },
  {
    slug: "paulo-chest-sinus-xr-2019-03-05",
    modality: "XR", body_part: "Chest & sinuses", study_date: "2019-03-05",
    requesting_doctor: "Cláudia Lenza Rodrigues da Cunha (CRM 46626)",
    performing_doctor: "Dr. Diego Armando Effio Solis (CRM 161584)",
    lab_name: "Diagnóstico por Imagem - Hospital São Paulo", lab_city: "Ribeirão Preto, SP", lab_country: "Brasil",
    notes:
      "Chest + paranasal sinus X-ray, Diagnóstico por Imagem - Hospital São Paulo, Ribeirão Preto (Dr. Diego Armando Effio Solis, CRM 161584; req. Cláudia Lenza Rodrigues da Cunha, CRM 46626; bundled 02-Feb-2019 films read by Dra. Beatriz de Almeida Prado, CRM 162326). Chest PA+lateral: normal hila/vasculature, no opacity or consolidation, clear costophrenic sinuses, normal cardiac area - radiologically normal. Sinus series (3 views): intact regional bone, normal sinus transparency, tortuous nasal septum. IMPRESSION: normal chest; no evidence of sinus disease (septal deviation only). (Report-only.)",
  },
  {
    slug: "paulo-chest-ct-2019-03-15",
    modality: "CT", body_part: "Chest", study_date: "2019-03-15",
    requesting_doctor: "Dr. Fabio A. W. Rabelo",
    performing_doctor: "Dr. José Álvaro Gonçalves Júnior (CRM 38510); double-read Dr. José Álvaro Gonçalves Neto (CRM 116379)",
    lab_name: "Instituto de Radiologia", lab_city: null, lab_country: "Brasil",
    notes:
      "Chest CT without contrast, Instituto de Radiologia (Dr. José Álvaro Gonçalves Júnior, CRM 38510; double-read Dr. José Álvaro Gonçalves Neto, CRM 116379; req. Dr. Fábio A. W. Rabelo). Indication: cough. Normal lung parenchyma, no pleural effusion or thickening, patent airways. Small paratracheal, infracarinal and aortopulmonary-window lymph nodes up to 0.7 cm; no adenomegaly. Normal aorta, mediastinal vessels and cardiac area; no pericardial effusion. Dorsal spondyloarthrosis. IMPRESSION: reactive mediastinal lymph nodes. (Report-only.)",
  },
  {
    slug: "paulo-abdomen-prostate-us-2022-03-24",
    modality: "US", body_part: "Abdomen & prostate", study_date: "2022-03-24",
    requesting_doctor: "Dr. Fabio A. S. Watanabe",
    performing_doctor: "Dr. Rogério Ximenes (CRM 78585 SP)",
    lab_name: "Rossetti Diagnóstico por Imagem", lab_city: null, lab_country: "Brasil",
    notes:
      "Abdominal + prostate ultrasound (suprapubic), Rossetti Diagnóstico por Imagem (Dr. Rogério Ximenes, CRM 78585-SP; req. Dr. Fábio A. S. Watanabe). Enlarged prostate 4.0x4.4x4.7 cm, 44.2 cm3 (~48.6 g), heterogeneous; post-void residual 62 cm3. Liver normal size with diffusely increased echogenicity (steatosis) and focal-sparing areas near the gallbladder; well-defined 40x45 mm hypoechoic area in deep medial left lobe (segment I) - nodule vs focal sparing, to clarify. Gallbladder, pancreas, spleen, kidneys and bladder normal. IMPRESSION: benign prostatic enlargement with post-void residual; hepatic steatosis; left-lobe nodular area to characterise. (Report-only.)",
  },
  {
    slug: "paulo-kidneys-us-2022-08-25",
    modality: "US", body_part: "Kidneys & urinary tract", study_date: "2022-08-25",
    requesting_doctor: "Fabio A. S. Watanabe (CRM 104832)",
    performing_doctor: "Dr. Paulo Zanello (CRM 25.363)",
    lab_name: "Clínica Zanello - Diagnóstico por Imagem", lab_city: null, lab_country: "Brasil",
    notes:
      "Kidneys + urinary tract ultrasound, Clínica Zanello (Dr. Paulo Zanello, CRM 25.363; req. Fábio A. S. Watanabe, CRM 104832). Right kidney 12.6x6.0x6.8 cm with a small 0.7 cm exophytic cortical simple cyst (mid third), normal cortex. Left kidney 12.4x7.1x5.7 cm normal. No pelvicalyceal dilation or calculi. Bladder normal capacity and wall. IMPRESSION: small simple cyst in the right kidney; otherwise normal. (Report-only.)",
  },
  {
    slug: "paulo-urinary-prostate-us-2023-02-13",
    modality: "US", body_part: "Urinary tract & prostate", study_date: "2023-02-13",
    requesting_doctor: "Antônio C. Maychak",
    performing_doctor: "Dr. Rafael Azevedo Maychak (CRM-SP 149339)",
    lab_name: "Dr. Rafael Azevedo Maychak - Ultrassonografista", lab_city: "Santa Bárbara D'Oeste, SP", lab_country: "Brasil",
    notes:
      "Urinary tract + prostate ultrasound, Dr. Rafael Azevedo Maychak (CRM-SP 149339), Santa Bárbara D'Oeste, SP (req. Antônio C. Maychak). Both kidneys topical, normal size and echotexture (right 12.1 cm, left 11.4 cm). Bladder normal. Prostate finely heterogeneous, regular contours, ~32.5 cm3. Post-void residual ~76.9 cm3 (up from 62 cm3 in Mar 2022). IMPRESSION: usual appearance; benign prostatic obstruction with rising post-void residual. (Report-only.)",
  },
  {
    slug: "paulo-right-hand-mri-2025-06-12",
    modality: "MRI", body_part: "Right hand", study_date: "2025-06-12",
    requesting_doctor: "Renan Radael de Figueiredo",
    performing_doctor: null,
    lab_name: "São Luiz (Campinas)", lab_city: "Campinas, SP", lab_country: "Brasil",
    notes:
      "Right hand MRI without contrast, Hospital São Luiz, Campinas (req. Renan Radael de Figueiredo; performing radiologist not stated). Degenerative change at the thumb metacarpophalangeal joint (joint-space narrowing, cartilage thinning, subchondral oedema/sclerosis, small effusion) and carpometacarpal narrowing between capitate and 3rd metacarpal with a small osteophyte. Signal change with vascular-channel appearance in the heads of the 2nd and 3rd metacarpals; no fracture or aggressive lesion. Flexor tendinopathy of the 2nd finger; flexor tenosynovitis of the 4th finger. Ligaments intact. IMPRESSION: degenerative MCP/CMC change of the right hand; flexor tendinopathy and tenosynovitis. (Report-only.)",
  },
];

function row(pid, s) {
  return {
    patient_id: pid,
    modality: s.modality,
    body_part: s.body_part,
    study_date: s.study_date,
    source_format: "JPEG",            // no PDF enum value; report-only -> file_count 0 (matches existing report-only rows)
    blob_prefix: "scans/" + s.slug,
    report_blob_key: "scans/" + s.slug + "-report.pdf",
    jpeg_preview_prefix: null,
    file_count: 0,
    notes: s.notes,
    requesting_doctor: s.requesting_doctor,
    performing_doctor: s.performing_doctor,
    lab_name: s.lab_name,
    lab_city: s.lab_city,
    lab_country: s.lab_country,
  };
}

const main = async () => {
  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id=${CLERK} AND role='patient' LIMIT 1`;
  if (!u.length) { console.error("✗ Paulo not found for clerk", CLERK); process.exit(1); }
  const pid = u[0].id;
  console.log(`Patient: ${u[0].full_name} (${pid})`);

  const before = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`;
  console.log(`Existing imaging_studies rows: ${before[0].n}`);
  for (const s of STUDIES) {
    console.log(`  + ${s.study_date}  ${s.modality}/${s.body_part}  (${s.notes.length} chars)  lab=${s.lab_name}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — pass --apply to write. Would upsert 8 rows (delete-by-blob_prefix then insert).");
    return;
  }

  const prefixes = STUDIES.map((s) => "scans/" + s.slug);
  const del = await sql`DELETE FROM imaging_studies WHERE patient_id=${pid} AND blob_prefix = ANY(${prefixes})`;
  console.log(`Cleared ${del.length ?? 0} pre-existing wave rows (idempotent re-run).`);

  for (const s of STUDIES) {
    const r = row(pid, s);
    await sql`INSERT INTO imaging_studies
      (patient_id, modality, body_part, study_date, source_format, blob_prefix,
       report_blob_key, jpeg_preview_prefix, file_count, notes,
       requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
      VALUES (${r.patient_id}, ${r.modality}, ${r.body_part}, ${r.study_date}, ${r.source_format}, ${r.blob_prefix},
       ${r.report_blob_key}, ${r.jpeg_preview_prefix}, ${r.file_count}, ${r.notes},
       ${r.requesting_doctor}, ${r.performing_doctor}, ${r.lab_name}, ${r.lab_city}, ${r.lab_country})`;
  }

  const after = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`;
  console.log(`✓ Done. imaging_studies rows now: ${after[0].n} (was ${before[0].n}).`);
};

main().catch((e) => { console.error("✗", e.message); process.exit(1); });
