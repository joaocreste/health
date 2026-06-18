-- 0015 — Provenance columns across clinician-ordered ingestion tables.
--
-- Captures WHERE an exam was performed and WHO ordered/performed it, on the
-- three clinician-ordered tables. The system-set ingestion timestamp is the
-- EXISTING `created_at` column on every table (reused as `ingested_at`, no
-- duplicate added); the exam-date is the existing NOT NULL `taken_at`/
-- `study_date`. Only the missing facts are added here.
--
-- The five provenance facts (per the canonical contract):
--   exam_date          — already: lab_results.taken_at / imaging|ecg.study_date
--   ingested_at        — already: created_at (DEFAULT now())
--   requesting_doctor  — added where missing (name + reg ID inline)
--   performing_doctor  — added where missing (name + reg ID inline)
--   lab_name/city/country — added where missing (original spelling)
--
-- Existing aliases kept as-is (NOT renamed):
--   lab_results.laboratory  = lab_name
--   ecg_studies.clinic      = lab_name
--   ecg_studies.ordering_doctor   = requesting_doctor
--   ecg_studies.validating_doctor = performing_doctor
--
-- Hand-written idempotent SQL, matching the 0005-0014 precedent (plain SQL +
-- ADD COLUMN IF NOT EXISTS; drizzle-kit's journal lags at 0004 in this repo).
-- All columns nullable so thin data never blocks ingestion. Pure additive.

-- lab_results: laboratory + requesting_doctor already exist (0000 / 0007).
ALTER TABLE "lab_results"     ADD COLUMN IF NOT EXISTS "performing_doctor" text;
ALTER TABLE "lab_results"     ADD COLUMN IF NOT EXISTS "lab_city" text;
ALTER TABLE "lab_results"     ADD COLUMN IF NOT EXISTS "lab_country" text;

-- imaging_studies: had no provenance fields beyond study_date.
ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "requesting_doctor" text;
ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "performing_doctor" text;
ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "lab_name" text;
ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "lab_city" text;
ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "lab_country" text;

-- ecg_studies: ordering/validating doctor + clinic already exist (0012).
ALTER TABLE "ecg_studies"     ADD COLUMN IF NOT EXISTS "lab_city" text;
ALTER TABLE "ecg_studies"     ADD COLUMN IF NOT EXISTS "lab_country" text;
