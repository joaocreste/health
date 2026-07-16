#!/usr/bin/env node
/**
 * ingest-paulo-bioimpedance.mjs — Paulo Silotto Souza, Tanita TBF-410
 * bioimpedance / body composition exam of 2026-07-15 (Longevitas, Americana SP).
 *
 * BACKEND ONLY. Persists structured values + provenance to Postgres, stores the
 * source PDF in R2, writes the documents row, reads everything back. Renders
 * nothing: the Vitals surface for this data needs a separate Build Prompt (see
 * the render-surface finding below).
 *
 * RENDER-SURFACE FINDING (step 0, recorded per spec):
 *   Paulo has NO bespoke Vitals renderer (only Silvana does; there is no
 *   pauloVitals provider). His physical-vitals page runs the DEFAULT registry.
 *   BUT the registry's vitals gates read /api/vitals-range, which hardcodes a
 *   device whitelist: weight <- source='withings_scale', bp <- 'withings_cuff',
 *   steps <- 'oura'; glucose has no series at all. So an honestly-sourced
 *   clinic row renders NOTHING today, and bioimpedance_exams is a new table no
 *   API reads. This ingest is therefore INVISIBLE until a Vitals Build Prompt
 *   widens the vitals-range source whitelist (or adds a clinic-spot series) and
 *   adds a body-composition reader. Mislabeling the Longevitas clinic cuff as a
 *   Withings home device would make it render today; that is provenance fraud
 *   and is deliberately NOT done.
 *
 * DEVICE: Tanita TBF-410 reports whole-body values only. FFM (fat-free mass =
 * muscle + bone + visceral/residual) is NOT skeletal muscle mass, so
 * skeletal_muscle_mass_kg stays NULL. The print-out carries NO segmental block,
 * so ZERO bioimpedance_segments rows are written (never fabricated).
 *
 * R2 KEY: the spec asked for patients/{id}/body-composition/... but no
 * available credential can write there (deploy token 403s on R2; S3 creds are
 * read-only). The only working write path is PUT /api/uploads/put as
 * pending:admin, which hard-enforces key.startsWith('uploads/{patient_id}/').
 * Key used is therefore under uploads/{patient_id}/body-composition/.
 *
 * Idempotent: exam upserts on (patient_id, exam_date, device_manufacturer,
 * device_model); vitals_daily on (patient_id, day, source); glucose_points on
 * (patient_id, ts); the documents row is matched on blob_key.
 *
 * Usage: node scripts/ingest-paulo-bioimpedance.mjs [--skip-r2]
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
neonConfig.webSocketConstructor = globalThis.WebSocket;
const pool = new Pool({ connectionString: env.DATABASE_URL });
const q = async (t, p = []) => (await pool.query(t, p)).rows;

const CLERK = "pending:paulo-silotto-df3441";
const PDF = "/Users/joaocreste/Downloads/Bioimpedancia.pdf";
const EXAM_DATE = "2026-07-15";
const SKIP_R2 = process.argv.includes("--skip-r2");

/* The report states a DATE ONLY (Data: 15/07/2026) with no clock time. Brazil
   has no DST since 2019, so America/Sao_Paulo is UTC-3 year-round; midnight
   local = 03:00Z. glucose_points.ts is NOT NULL with no precision flag, so the
   date is stored as local midnight per the date-only convention. The
   time-unknown fact is recorded in raw_extract + notes so no reader mistakes
   03:00Z for a measured 3am draw. */
const SPOT_TS = "2026-07-15T03:00:00Z";

/* Verbatim device print-out + form fields. PHI (patient name) deliberately
   excluded per the de-identification boundary: the row's patient_id FK is the
   only identity link. */
const RAW_EXTRACT = {
  device: { manufacturer: "Tanita", model: "TBF-410", analyzer_header: "TANITA BODY COMPOSITION ANALYZER TBF-410" },
  printout: {
    BODY_TYPE: "ATHLETIC", GENDER: "MALE", AGE: 65,
    HEIGHT: "180 cm", WEIGHT: "102.7 kg", BMI: 31.7,
    BMR: "8135 kJ / 1944 kcal", IMPEDANCE: "439 ohm",
    "FAT%": "21.3 %", FAT_MASS: "21.9 kg", FFM: "80.8 kg", TBW: "59.2 kg",
  },
  form_fields_verbatim: {
    "Idade": "65", "PA": "146x87", "Data": "15/07/2026", "Altura": "1,80",
    "Glicose Capilar": "91 (mg/dl)", "Circunferencia Abdominal": "112 (cm)",
    "Oximetria Digital": "95 %",
    "Massa Muscular": null,   // label printed on the form, left BLANK by the device
  },
  device_reference_ideal_fat_percent: {
    source: "Longevitas / Tanita print-out, page 2 'Gordura Ideal' table",
    by_age: {
      "up_to_19": { male: 15, female: 19 }, "20_29": { male: 16, female: 20 },
      "30_39": { male: 17, female: 21 }, "40_49": { male: 18, female: 22 },
      "50_59": { male: 19, female: 23 }, "60_plus": { male: 20, female: 24 },
    },
    caveat_verbatim: "Estas recomendacoes podem ser utilizadas para a grande maioria da populacao de modo geral. No entanto, em populacoes especiais como, por exemplo, atletas e obesos morbidos, os valores ideais (gordura % e/ou peso corporal) podem ser alternados de acordo com o criterio definido pelo profissional responsavel pelo avaliado.",
  },
  segmental: null,  // Tanita TBF-410 produces no segmental data
  time_precision: "date_only — report states no clock time; spot vitals stored at local midnight (UTC-3)",
};

/* Data-quality flags: FACTUAL observations only, no clinical interpretation.
   Clinical reading belongs to the AI-insight / synthesis step, never ingestion. */
const NOTES = [
  "Data-quality flags (factual, non-diagnostic):",
  "- BMI 31.7 is above the generic reference ceiling (25); the device classified BODY TYPE as ATHLETIC with FFM 80.8 kg. BMI does not distinguish fat from fat-free mass. Stored as measured; for clinician review.",
  "- BP 146/87 mmHg is above the typical adult reference; single clinic reading. Routed to vitals_daily (source clinic_spot). For clinician review.",
  "- Measured FAT% 21.3 vs the device's own printed 'ideal' of 20% for 60+ males. Device reference table stored verbatim in raw_extract; no judgment rendered here.",
  "- Height discrepancy: this exam records 180 cm; patient_profiles holds 182 cm. Not reconciled.",
  "- Weight discrepancy: this exam records 102.7 kg; patient_profiles holds 100 kg (likely stale profile).",
  "- patient_profiles.date_of_birth is NULL for this patient; the report states age 65, stored here as age_years.",
  "- Requesting professional is not stated anywhere on the report (NULL). Ask patient/clinic.",
  "- Device reports no skeletal muscle mass. FFM 80.8 kg is fat-free mass (muscle + bone + visceral/residual) and is NOT SMM; skeletal_muscle_mass_kg left NULL.",
  "- Report states date only (no clock time); spot vitals stored at local midnight (America/Sao_Paulo, UTC-3).",
].join("\n");

async function main() {
  // ── Identity ──────────────────────────────────────────────────
  const [u] = await q(`SELECT id, full_name FROM users WHERE clerk_user_id=$1 AND role='patient'`, [CLERK]);
  if (!u) throw new Error("patient not found: " + CLERK);
  const PID = u.id;
  console.log(`patient: ${u.full_name} (${CLERK}) -> ${PID}`);

  // ── R2: source PDF + documents row ────────────────────────────
  const R2_KEY = `uploads/${PID}/body-composition/${EXAM_DATE}-tanita-tbf410.pdf`;
  let documentId = null;

  if (!SKIP_R2) {
    const bytes = fs.readFileSync(PDF);
    const put = await fetch(
      `https://lumenhealth.io/api/uploads/put?patient=${encodeURIComponent(CLERK)}&key=${encodeURIComponent(R2_KEY)}`,
      { method: "PUT", headers: { "X-Viewer-Clerk": "pending:admin", "Content-Type": "application/pdf" }, body: bytes }
    );
    const putBody = await put.text();
    if (!put.ok) throw new Error(`R2 put failed ${put.status}: ${putBody}`);
    console.log(`R2 put ok: ${R2_KEY} (${(bytes.length / 1024).toFixed(0)} KB)`);

    const [existing] = await q(`SELECT id FROM documents WHERE patient_id=$1 AND blob_key=$2 LIMIT 1`, [PID, R2_KEY]);
    if (existing) {
      documentId = existing.id;
      console.log(`documents row exists: ${documentId}`);
    } else {
      const [doc] = await q(
        `INSERT INTO documents (patient_id, kind, title, original_filename, blob_key, mime_type, size_bytes, document_date, metadata)
         VALUES ($1,'body_composition',$2,'Bioimpedancia.pdf',$3,'application/pdf',$4,$5,$6) RETURNING id`,
        [PID, "Exame de Bioimpedancia — Tanita TBF-410 (Longevitas)", R2_KEY, bytes.length, EXAM_DATE,
         JSON.stringify({ device: "Tanita TBF-410", facility: "Longevitas", exam_type: "bioimpedance" })]
      );
      documentId = doc.id;
      console.log(`documents row inserted: ${documentId}`);
    }
  }

  // ── bioimpedance_exams upsert ─────────────────────────────────
  const [exam] = await q(
    `INSERT INTO bioimpedance_exams (
       patient_id, exam_date, device_manufacturer, device_model, body_type,
       sex, age_years, height_cm, weight_kg, bmi, bmr_kcal, bmr_kj, impedance_ohms,
       fat_percent, fat_mass_kg, ffm_kg, tbw_kg,
       waist_circumference_cm,
       requesting_professional, performing_professional,
       facility_name, facility_city, facility_country,
       source_document_id, raw_extract, notes
     ) VALUES (
       $1,$2,'Tanita','TBF-410','ATHLETIC',
       'male',65,180,102.7,31.7,1944,8135,439,
       21.3,21.9,80.8,59.2,
       112,
       NULL,$3,
       'Longevitas (Programa Longevitas)','Americana, SP','Brazil',
       $4,$5,$6
     )
     ON CONFLICT (patient_id, exam_date, device_manufacturer, device_model) DO UPDATE SET
       body_type=EXCLUDED.body_type, sex=EXCLUDED.sex, age_years=EXCLUDED.age_years,
       height_cm=EXCLUDED.height_cm, weight_kg=EXCLUDED.weight_kg, bmi=EXCLUDED.bmi,
       bmr_kcal=EXCLUDED.bmr_kcal, bmr_kj=EXCLUDED.bmr_kj, impedance_ohms=EXCLUDED.impedance_ohms,
       fat_percent=EXCLUDED.fat_percent, fat_mass_kg=EXCLUDED.fat_mass_kg,
       ffm_kg=EXCLUDED.ffm_kg, tbw_kg=EXCLUDED.tbw_kg,
       waist_circumference_cm=EXCLUDED.waist_circumference_cm,
       performing_professional=EXCLUDED.performing_professional,
       facility_name=EXCLUDED.facility_name, facility_city=EXCLUDED.facility_city,
       facility_country=EXCLUDED.facility_country,
       source_document_id=COALESCE(EXCLUDED.source_document_id, bioimpedance_exams.source_document_id),
       raw_extract=EXCLUDED.raw_extract, notes=EXCLUDED.notes
     RETURNING id`,
    [PID, EXAM_DATE, "Dr. Ruy Morando — CRM-SP 65135 (Cardiologista)", documentId,
     JSON.stringify(RAW_EXTRACT), NOTES]
  );
  console.log(`bioimpedance_exams upserted: ${exam.id}`);

  // Segmental: Tanita produces none. Assert zero rather than silently skipping.
  const segCount = await q(`SELECT count(*)::int c FROM bioimpedance_segments WHERE exam_id=$1`, [exam.id]);
  console.log(`bioimpedance_segments rows: ${segCount[0].c} (expected 0 — Tanita has no segmental block)`);

  // ── Co-located spot vitals -> existing tables ─────────────────
  // vitals_daily: real columns are blood_pressure_sys/dia and spo2_pct.
  // source 'clinic_spot' is a NEW value (existing: oura/apple_health/
  // withings_*/aggregate). vitals-resolve.js ranks unknown sources last via
  // order.indexOf() -> -1, so it cannot corrupt the resolved/aggregate rows.
  // Weight is NOT duplicated here: it belongs to the bioimpedance block.
  await q(
    `INSERT INTO vitals_daily (patient_id, day, source, blood_pressure_sys, blood_pressure_dia, spo2_pct, extras)
     VALUES ($1,$2,'clinic_spot',146,87,95,$3)
     ON CONFLICT (patient_id, day, source) DO UPDATE SET
       blood_pressure_sys=EXCLUDED.blood_pressure_sys,
       blood_pressure_dia=EXCLUDED.blood_pressure_dia,
       spo2_pct=EXCLUDED.spo2_pct, extras=EXCLUDED.extras`,
    [PID, EXAM_DATE, JSON.stringify({
      context: "clinician-captured spot readings co-located on a bioimpedance print-out",
      facility: "Longevitas (Programa Longevitas), Americana, SP",
      performing_professional: "Dr. Ruy Morando — CRM-SP 65135 (Cardiologista)",
      source_exam: `bioimpedance ${EXAM_DATE} Tanita TBF-410`,
      bp_verbatim: "PA: 146x87",
      spo2_verbatim: "Oximetria Digital: 95 %",
      time_precision: "date_only — no clock time on report",
    })]
  );
  console.log("vitals_daily upserted: BP 146/87, SpO2 95% (source clinic_spot)");

  // glucose_points: real columns are ts / mg_dl / source.
  await q(
    `INSERT INTO glucose_points (patient_id, ts, mg_dl, source)
     VALUES ($1,$2,91,'clinic_spot')
     ON CONFLICT (patient_id, ts) DO UPDATE SET mg_dl=EXCLUDED.mg_dl, source=EXCLUDED.source`,
    [PID, SPOT_TS]
  );
  console.log("glucose_points upserted: 91 mg/dL capillary (source clinic_spot)");

  // ── READ-BACK ─────────────────────────────────────────────────
  console.log("\n========== READ-BACK ==========");
  const [rb] = await q(
    `SELECT b.id, b.exam_date::text AS exam_date, b.device_manufacturer, b.device_model, b.body_type,
            b.sex::text, b.age_years, b.height_cm, b.weight_kg, b.bmi, b.bmr_kcal, b.bmr_kj,
            b.impedance_ohms, b.fat_percent, b.fat_mass_kg, b.ffm_kg, b.tbw_kg,
            b.skeletal_muscle_mass_kg, b.protein_kg, b.minerals_kg, b.visceral_fat_level,
            b.waist_circumference_cm, b.hip_circumference_cm, b.whr,
            b.requesting_professional, b.performing_professional,
            b.facility_name, b.facility_city, b.facility_country,
            b.source_document_id, d.blob_key, d.kind, d.size_bytes
     FROM bioimpedance_exams b LEFT JOIN documents d ON d.id = b.source_document_id
     WHERE b.patient_id=$1 AND b.exam_date=$2`, [PID, EXAM_DATE]);
  console.log("bioimpedance_exams:", JSON.stringify(rb, null, 1));

  console.log("segments:", JSON.stringify(await q(`SELECT * FROM bioimpedance_segments WHERE exam_id=$1`, [rb.id])));

  console.log("vitals_daily:", JSON.stringify(await q(
    `SELECT day::text, source, blood_pressure_sys, blood_pressure_dia, spo2_pct, weight_kg
     FROM vitals_daily WHERE patient_id=$1 AND day=$2`, [PID, EXAM_DATE]), null, 1));

  console.log("glucose_points:", JSON.stringify(await q(
    `SELECT ts, mg_dl, source FROM glucose_points WHERE patient_id=$1 AND ts=$2`, [PID, SPOT_TS])));

  const counts = await q(
    `SELECT (SELECT count(*)::int FROM bioimpedance_exams WHERE patient_id=$1) AS exams,
            (SELECT count(*)::int FROM bioimpedance_segments s JOIN bioimpedance_exams e ON e.id=s.exam_id WHERE e.patient_id=$1) AS segments,
            (SELECT count(*)::int FROM vitals_daily WHERE patient_id=$1) AS vitals,
            (SELECT count(*)::int FROM glucose_points WHERE patient_id=$1) AS glucose,
            (SELECT count(*)::int FROM documents WHERE patient_id=$1 AND kind='body_composition') AS docs`, [PID]);
  console.log("counts for patient:", JSON.stringify(counts[0]));
}

main().then(() => pool.end()).catch(async (e) => { console.error("FAILED:", e.message); await pool.end(); process.exit(1); });
