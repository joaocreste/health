-- 0016 — ergometric_studies: cardiac exercise stress tests (teste ergométrico).
--
-- A stress test is a distinct clinical object from an ECG (ecg_studies): a
-- timed exercise protocol (Bruce / Rampa / Ellestad / ...) producing a peak-HR
-- / VO2 / METs / blood-pressure response, an ischaemia verdict, and a stage
-- table. Each exam is one point in a per-patient time series — the comparison
-- across exams is the clinically meaningful artefact, so the structured summary
-- columns below are kept queryable rather than buried in free text. The full
-- per-exam record (stage table, ECG comments, extended metrics, bundled exams)
-- is preserved verbatim in exam_json.
--
-- Blobs (original report PDF) live in R2 under
-- patients/{patient_id}/ergometric/ and are referenced by source_pdf_key; the
-- DB never stores the binary. Dedupe is on (patient, exam_date) so re-ingesting
-- the same exam is a no-op.
--
-- Hand-written idempotent SQL, matching the 0012 ecg_studies precedent (plain
-- SQL, self-applied by the ingestion path / Worker).

CREATE TABLE IF NOT EXISTS "ergometric_studies" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"            uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exam_date"             date NOT NULL,
  "exam_time"             text,
  "protocol"              text,                    -- Bruce | Rampa | Ellestad | Naughton | other
  "ergometer"             text,                    -- Esteira (treadmill) | Bicicleta | ...
  "requesting_doctor"     text,
  "performing_doctor"     text,
  "performing_doctor_crm" text,
  "lab"                   text,
  "city"                  text,
  "age_years"             integer,
  "height_cm"             integer,
  "weight_kg"             numeric(5,1),
  "bmi"                   numeric(4,1),
  "fc_max_bpm"            integer,
  "fc_max_predicted_bpm"  integer,
  "fc_max_pct_predicted"  numeric(5,1),
  "vo2_max_ml_kg_min"     numeric(5,2),
  "met_max"               numeric(5,2),
  "pas_rest_mmhg"         integer,
  "pas_max_mmhg"          integer,
  "dp_max"                integer,                 -- rate-pressure product (duplo produto)
  "duration_s"            integer,
  "distance_km"           numeric(5,3),
  "ischemia"              text,                    -- negative | positive | inconclusive
  "test_quality"          text,                    -- maximal | submaximal | inconclusive
  "aha_fitness"           text,
  "nyha_class"            text,
  "conclusion_verbatim"   text,
  "exam_json"             jsonb,                   -- full ergometric.v1 record
  "source_pdf_key"        text,                    -- R2 key: original report PDF
  "source_sha"            text,                    -- sha256 of the original PDF (dedupe)
  "created_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ergometric_studies_dedup"
    UNIQUE NULLS NOT DISTINCT ("patient_id", "exam_date")
);

CREATE INDEX IF NOT EXISTS "ergometric_studies_patient_date_idx"
  ON "ergometric_studies" ("patient_id", "exam_date" DESC);
