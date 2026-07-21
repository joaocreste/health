#!/usr/bin/env node
// One-off ENMG ingestion: Paulo Silotto — Eletroneuromiografia de MMII, 2017-04-20.
//
// Generic typed-table path (no patient special-casing): applies migration 0018
// idempotently, runs the duplicate guard, then writes ONE electrodiagnostic_studies
// row + an audit_log entry in a single transaction, and reads the row back from
// Neon as proof. display_mode/requires_review per the human-approval gate.
//
//   DATABASE_URL=... node scripts/ingest-enmg-paulo.mjs
//
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { markSourceWritten } from "../lib/derived-freshness.js";

const DB = process.env.DATABASE_URL;
if (!DB) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = neon(DB);

const PATIENT_ID = "0d00fb30-7ea9-434d-bcd7-36330e7acede"; // resolved by lookup, confirmed
const SRC_PDF = "Patients/Paulo Silotto/New Exams/Electroneuromyography/Eletroneuromiografia (MMII) 30-04-2017 (2).pdf";
const EXAM_DATE = "2017-04-20"; // SOURCE form (cover/filename say 30-04 — conflict flagged)
const STUDY_TYPE = "ncs_emg";
const R2_KEY = `patients/${PATIENT_ID}/procedures/2017-04-20-enmg-mmii.pdf`;

const sourceSha = createHash("sha256").update(readFileSync(SRC_PDF)).digest("hex");

// ── Verbatim laudo (pt-BR, unaltered) ─────────────────────────────────────────
const REPORT_TEXT = `LAUDO ELETRONEUROMIOGRÁFICO

O estudo da condução sensitiva, realizado com eletrodos de superfície, demonstrou-se normal nos nervos surais e fibulares superficiais.

O estudo da condução nervosa evidenciou:
- Potencial de ação muscular composto (PAMC) do nervo peroneiro direito com amplitude reduzida, latência distal e velocidade de condução preservada;
- PAMC dos nervos peroneiro esquerdo e tibiais dentro da normalidade em todos os parâmetros avaliados.
- Ondas F do nervo peroneiro direito não detectadas e com latências mínimas preservadas nos demais nervos.

O exame com agulha monopolar apresentou:
- Atividade de inserção normal e silêncio elétrico em repouso em todos os músculos estudados;
- Durante a prova de contração muscular voluntária, foram observados potenciais de ação de unidade motora com características de desnervação nos músculos tibial anterior esquerdo, gastrocnêmio, extensor longo do hálux e bíceps femoral bilateral.

Dra. Caroline Germano (CRM 177.907)   Prof. Dr. Wilson Marques Jr. (CRM 46.441)`;

const CONCLUSION = `O exame eleroneuromiográfico dos membros inferiores evidenciou desnervação nos músculos de inervação segmentar L4-L5-S1 à esquerda, de grave intensidade e S1 à direita, de leve intensidade, crônicas e sem sinais de atividade bilateralmente. Tais achados, associados à normalidade da condução sensitiva, indicam um acometimento pré-ganglionar (radiculopatia).`;

// ── Structured blocks (transcribed from the tables, verbatim values) ──────────
const structured = {
  source_doc: {
    hospital_record_id: "33890", barcode: "1427389D",
    patient_name_on_doc: "Paulo Augusto S D de Souza", dob_on_doc: "1961-07-14",
    sex: "M", age_on_doc: "55y9m", refer_dept: "Orthopedics",
  },
  motor_ncs: [
    { nerve: "peroneal", side: "L", site: "ankle",          latency_ms: 5.45,  amplitude: 730.0, amplitude_unit: "uV", area: 2.79,  segment: "Ankle",                      distance_mm: null, interval_ms: 5.45, ncv_ms: null, ncv_nd: false },
    { nerve: "peroneal", side: "L", site: "head_of_fibula", latency_ms: 13.15, amplitude: 510.0, amplitude_unit: "uV", area: 3.18,  segment: "Ankle - Head of fibula",      distance_mm: 345,  interval_ms: 7.70, ncv_ms: 44.8, ncv_nd: false },
    { nerve: "peroneal", side: "L", site: "popliteal",      latency_ms: 14.7,  amplitude: 510.0, amplitude_unit: "uV", area: 2.58,  segment: "Head of fibula - Popliteal",  distance_mm: 80,   interval_ms: 1.55, ncv_ms: 51.6, ncv_nd: false },
    { nerve: "tibial",   side: "R", site: "ankle",          latency_ms: 4.0,   amplitude: 10.84, amplitude_unit: "mV", area: 26.92, segment: "Ankle",                      distance_mm: null, interval_ms: 4.00, ncv_ms: null, ncv_nd: false },
    { nerve: "tibial",   side: "R", site: "popliteal",      latency_ms: 13.2,  amplitude: 8.50,  amplitude_unit: "mV", area: 23.37, segment: "Ankle - Popliteal",          distance_mm: 440,  interval_ms: 9.20, ncv_ms: 47.8, ncv_nd: false },
    { nerve: "peroneal", side: "R", site: "ankle",          latency_ms: 3.6,   amplitude: 3.42,  amplitude_unit: "mV", area: 10.33, segment: "Ankle",                      distance_mm: null, interval_ms: 3.60, ncv_ms: null, ncv_nd: false },
    { nerve: "peroneal", side: "R", site: "head_of_fibula", latency_ms: 11.85, amplitude: 3.25,  amplitude_unit: "mV", area: 10.16, segment: "Ankle - Head of fibula",      distance_mm: 360,  interval_ms: 8.25, ncv_ms: 43.6, ncv_nd: false },
    { nerve: "peroneal", side: "R", site: "popliteal",      latency_ms: 13.55, amplitude: 3.13,  amplitude_unit: "mV", area: 14.33, segment: "Head of fibula - Popliteal",  distance_mm: 80,   interval_ms: 1.70, ncv_ms: 47.1, ncv_nd: false },
    { nerve: "tibial",   side: "L", site: "ankle",          latency_ms: 5.35,  amplitude: 11.90, amplitude_unit: "mV", area: 21.64, segment: "Ankle",                      distance_mm: null, interval_ms: 5.35, ncv_ms: null, ncv_nd: false },
    { nerve: "tibial",   side: "L", site: "popliteal",      latency_ms: 14.4,  amplitude: 11.90, amplitude_unit: "mV", area: 26.09, segment: "Ankle - Popliteal",          distance_mm: 455,  interval_ms: 9.05, ncv_ms: 50.3, ncv_nd: false },
  ],
  f_wave: [
    { nerve: "peroneal", side: "L", stim_site: null,    rec_site: null, m_latency_ms: null, m_amplitude_mv: null, distance_mm: null, f_occurrence: "0/16,0",  f_latency_min_ms: null, f_latency_max_ms: null, f_latency_mean_ms: null, f_amplitude_min_uv: null,  f_amplitude_max_uv: null,  f_amplitude_mean_uv: null,  f_lat_nd: true },
    { nerve: "tibial",   side: "R", stim_site: "ankle", rec_site: "AH", m_latency_ms: null, m_amplitude_mv: 5.1,  distance_mm: null, f_occurrence: "15/16,94", f_latency_min_ms: 52.2, f_latency_max_ms: 64.7, f_latency_mean_ms: 56.5, f_amplitude_min_uv: 170.0, f_amplitude_max_uv: 190.0, f_amplitude_mean_uv: 180.0, f_lat_nd: false },
    { nerve: "peroneal", side: "R", stim_site: null,    rec_site: null, m_latency_ms: null, m_amplitude_mv: null, distance_mm: null, f_occurrence: "7/16,44",  f_latency_min_ms: 52.7, f_latency_max_ms: 58.2, f_latency_mean_ms: 56.8, f_amplitude_min_uv: 180.0, f_amplitude_max_uv: 200.0, f_amplitude_mean_uv: 190.0, f_lat_nd: false },
    { nerve: "tibial",   side: "L", stim_site: "ankle", rec_site: "AH", m_latency_ms: null, m_amplitude_mv: 4.04, distance_mm: null, f_occurrence: "9/16,56",  f_latency_min_ms: 53.3, f_latency_max_ms: 59.2, f_latency_mean_ms: 55.9, f_amplitude_min_uv: 180.0, f_amplitude_max_uv: 340.0, f_amplitude_mean_uv: 238.0, f_lat_nd: false },
  ],
  sensory_ncs: [
    { nerve: "sural",                side: "L", site: "leg", latency_ms: 2.56, amplitude_uv: 10.20, area: 0.57, segment: "Leg",         distance_mm: 125, interval_ms: 2.56, ncv_ms: 48.8 },
    { nerve: "superficial_peroneal", side: "L", site: "leg", latency_ms: 2.1,  amplitude_uv: 7.10,  area: 0.29, segment: "Leg - Edema", distance_mm: 90,  interval_ms: 2.10, ncv_ms: 42.9 },
    { nerve: "sural",                side: "R", site: "leg", latency_ms: 3.22, amplitude_uv: 9.70,  area: 0.40, segment: "Leg",         distance_mm: 135, interval_ms: 3.22, ncv_ms: 41.9 },
    { nerve: "superficial_peroneal", side: "R", site: "leg", latency_ms: 2.52, amplitude_uv: 6.30,  area: 0.30, segment: "Leg",         distance_mm: 110, interval_ms: 2.52, ncv_ms: 43.7 },
  ],
  needle_emg: [
    { muscle: "tibialis_anterior",          side: "L", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 12.0, duration: "long",   recruitment: "reduced", interference_pattern: "2" },
    { muscle: "gastrocnemius_medial_head",  side: "L", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 8.0,  duration: "long",   recruitment: "reduced", interference_pattern: "3" },
    { muscle: "vastus_medialis",            side: "L", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 3.5,  duration: "normal", recruitment: "full",    interference_pattern: "5" },
    { muscle: "extensor_hallucis_longus",   side: "L", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 16.0, duration: "long",   recruitment: "reduced", interference_pattern: "2" },
    { muscle: "tibialis_anterior",          side: "R", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 5.0,  duration: "normal", recruitment: "full",    interference_pattern: "5" },
    { muscle: "gastrocnemius_medial_head",  side: "R", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 7.0,  duration: "long",   recruitment: "reduced", interference_pattern: "4" },
    { muscle: "extensor_hallucis_longus",   side: "R", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "+1", low_amp: 0, high_amp: 5.0,  duration: "long",   recruitment: "reduced", interference_pattern: "4" },
    { muscle: "vastus_medialis",            side: "R", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 4.0,  duration: "normal", recruitment: "full",    interference_pattern: "5" },
    { muscle: "gluteus_medius",             side: "L", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 14.0, duration: "long",   recruitment: "reduced", interference_pattern: "3" },
    { muscle: "biceps_femoris_long_head",   side: "L", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "N",  low_amp: 0, high_amp: 14.0, duration: "long",   recruitment: "reduced", interference_pattern: "3" },
    { muscle: "biceps_femoris_long_head",   side: "R", insertional_activity: "normal", fibrillations: 0, positive_waves: 0, fasciculations: 0, myotonic_discharge: 0, normal_mup: 0, polyphasic: "+1", low_amp: 0, high_amp: 4.0,  duration: "normal", recruitment: "full",    interference_pattern: "4/5" },
  ],
};

const severityFlags = [
  "desnervacao-grave-L4L5S1-esquerda",
  "radiculopatia-cronica-pre-ganglionar",
  "peroneal-esquerdo-CMAP-severamente-reduzido-0.73mV",
];

const extractionFlags = {
  exam_date_conflict: "cover/filename say 30-04-2017; source form shows 20/04/2017 (p2 Examination Date + p4 Date). Used source 2017-04-20.",
  duplicate: "possible-duplicate resolved: 4pp 'Eletroneuromiografia (MMII) 30-04-2017.pdf' (Index 041) is the subset of this 6pp '(2).pdf' (Index 042). Ingested the complete 6pp version; the 4pp file is subsumed (a-subsumed-by-b).",
  laterality_conflict: "laudo-body-laterality-conflicts-tables-and-conclusao: narrative body says peroneal RIGHT reduced + F-absent, but motor table shows peroneal LEFT CMAP 0.73mV (severe) and F-wave table shows peroneal LEFT 0/16 absent; CONCLUSAO agrees with the tables (denervation grave on the LEFT). Stored verbatim; flagged for human reviewer.",
  emg_poly_column: "emg-poly-column-low-confidence: 2 of 11 rows (+1) approximate due to scan skew; high_amp/duration/recruitment validated by deskew + clinical cross-check (vastus medialis spared bilaterally).",
  requesting_doctor: "triage cover OCR 'Varga' corrected to source 'Veiga'.",
  taxonomy: "taxonomy-extended-neurofisiologia-ENMG: new category; routed to typed electrodiagnostic_studies table, not lab_results.category.",
  extraction_tier: "non-covered-tier vision OCR of a scanned PHI report; consented test subject; de_identified=false.",
  source_pdf_sha256: sourceSha,
  subsumed_duplicate_file: "Patients/Paulo Silotto/New Exams/Electroneuromyography/Eletroneuromiografia (MMII) 30-04-2017.pdf",
};

async function main() {
  // 0) Confirm patient.
  const pr = await sql`SELECT id, full_name, clerk_user_id FROM users WHERE id = ${PATIENT_ID} LIMIT 1`;
  if (!pr.length) throw new Error("patient not found");
  console.log("Patient:", pr[0].full_name, "·", pr[0].clerk_user_id, "·", pr[0].id);

  // 1) Apply migration 0018 idempotently (enums, table, index) — discrete statements.
  await sql`DO $$ BEGIN CREATE TYPE electrodiagnostic_study_type AS ENUM ('ncs_emg','ncs','emg','evoked_potential','repetitive_stimulation','other'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  await sql`DO $$ BEGIN CREATE TYPE clinical_display_mode AS ENUM ('hidden','report_only','tables_only','full'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`;
  await sql`CREATE TABLE IF NOT EXISTS electrodiagnostic_studies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    import_id uuid REFERENCES imports(id),
    import_file_id uuid REFERENCES import_files(id),
    study_type electrodiagnostic_study_type NOT NULL DEFAULT 'ncs_emg',
    study_subtype text, body_region text, laterality text, exam_date date,
    ingested_at timestamptz NOT NULL DEFAULT now(),
    requesting_doctor text, performing_doctor text, lab text, city text, country text,
    conclusion text, report_text text,
    structured_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    source_language text DEFAULT 'pt-BR', r2_key text, source_sha text,
    display_mode clinical_display_mode NOT NULL DEFAULT 'hidden',
    de_identified boolean NOT NULL DEFAULT false,
    requires_review boolean NOT NULL DEFAULT true,
    severity_flags text[] DEFAULT '{}',
    confidence text, extraction_flags jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT electrodiagnostic_studies_dedup UNIQUE NULLS NOT DISTINCT (patient_id, exam_date, study_type))`;
  await sql`CREATE INDEX IF NOT EXISTS electrodiagnostic_studies_patient_date_idx ON electrodiagnostic_studies (patient_id, exam_date DESC)`;
  console.log("Migration 0018 applied (idempotent).");

  // 2) Duplicate guard — surface, never silently duplicate.
  const dup = await sql`SELECT id, ingested_at FROM electrodiagnostic_studies
    WHERE patient_id = ${PATIENT_ID} AND exam_date = ${EXAM_DATE} AND study_type = ${STUDY_TYPE} LIMIT 1`;
  if (dup.length) {
    console.log(`DUPLICATE EXISTS — row ${dup[0].id} ingested ${dup[0].ingested_at}. Aborting (no silent duplicate).`);
    return;
  }

  // 3) Transactional write: row + audit_log, atomic. Id pre-generated so the
  //    audit entry can reference the new row within the same transaction.
  const id = randomUUID();
  await sql.transaction([
    sql`INSERT INTO electrodiagnostic_studies (
      id, patient_id, study_type, study_subtype, body_region, laterality, exam_date,
      requesting_doctor, performing_doctor, lab, city, country, conclusion, report_text,
      structured_data, source_language, r2_key, source_sha, display_mode,
      de_identified, requires_review, severity_flags, confidence, extraction_flags
    ) VALUES (
      ${id}, ${PATIENT_ID}, ${STUDY_TYPE},
      'Eletroneuromiografia de MMII (estudo completo)', 'lower limbs / MMII', 'bilateral', ${EXAM_DATE},
      'Dr. Ivan G. Veiga', 'Prof. Dr. Wilson Marques Jr. (CRM 46.441); co-assinado Dra. Caroline Germano (CRM 177.907)',
      'HC FMRP-USP — Seção de Neurofisiologia Clínica (Setor de Eletroneuromiografia)',
      'Ribeirão Preto, SP', 'Brasil', ${CONCLUSION}, ${REPORT_TEXT},
      ${JSON.stringify(structured)}::jsonb, 'pt-BR', ${R2_KEY}, ${sourceSha}, 'report_only',
      false, true, ${severityFlags}, 'alta', ${JSON.stringify(extractionFlags)}::jsonb)`,
    sql`INSERT INTO audit_log (actor_user_id, action, target_table, target_id, patient_context, metadata)
      VALUES (NULL, 'ingest_electrodiagnostic_study', 'electrodiagnostic_studies', ${id}, ${PATIENT_ID},
        ${JSON.stringify({ source: "scripts/ingest-enmg-paulo.mjs", study_type: STUDY_TYPE, exam_date: EXAM_DATE, display_mode: "report_only", requires_review: true, de_identified: false, source_pdf_sha256: sourceSha })}::jsonb)`,
  ]);

  // 4) Read-back from Neon — THE gate.
  const [row] = await sql`SELECT id, patient_id, exam_date, study_type, study_subtype, display_mode,
      requires_review, de_identified, confidence, lab, requesting_doctor, performing_doctor,
      severity_flags, r2_key, source_sha,
      jsonb_array_length(structured_data->'motor_ncs')   AS motor_ncs_rows,
      jsonb_array_length(structured_data->'f_wave')       AS f_wave_rows,
      jsonb_array_length(structured_data->'sensory_ncs')  AS sensory_ncs_rows,
      jsonb_array_length(structured_data->'needle_emg')   AS needle_emg_rows,
      length(report_text) AS report_chars, length(conclusion) AS conclusion_chars, ingested_at
    FROM electrodiagnostic_studies WHERE id = ${id}`;
  const audit = await sql`SELECT id, action, target_table, target_id, at FROM audit_log
    WHERE target_id = ${id} AND target_table = 'electrodiagnostic_studies' ORDER BY at DESC LIMIT 1`;

  console.log("\n===== READ-BACK (proof) =====");
  console.log(JSON.stringify(row, null, 2));
  console.log("audit_log:", JSON.stringify(audit[0]));
  console.log("\nstructured_data block counts:",
    `motor_ncs=${row.motor_ncs_rows} f_wave=${row.f_wave_rows} sensory_ncs=${row.sensory_ncs_rows} needle_emg=${row.needle_emg_rows}`);

  await markSourceWritten(sql, PATIENT_ID, { writer: "ingest-enmg-paulo" });
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
