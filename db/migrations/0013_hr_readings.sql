-- 0013 — hr_readings: per-reading wearable heart rate (Oura wrist HR).
--
-- vitals_daily holds one row per (patient, day, source) — fine for daily
-- aggregates, useless for the heart-rate-by-time-of-day chart, which needs
-- every individual reading so medians/SDs can be recomputed over an arbitrary
-- date range (/api/vitals-range). ~286k rows per patient-year is trivial for
-- Postgres; percentile_cont over an indexed range scan returns in well under
-- a second on Neon.
--
-- Loaded by scripts/backfill-joao-vitals-range.mjs (full replacement per
-- patient+source). Hand-written idempotent SQL, matching the 0005-0012
-- precedent (plain SQL, self-applied by the ingestion path).

CREATE TABLE IF NOT EXISTS "hr_readings" (
  "id"         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "patient_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "ts"         timestamptz NOT NULL,
  "bpm"        smallint NOT NULL,
  "source"     text NOT NULL DEFAULT 'oura'
);

CREATE INDEX IF NOT EXISTS "hr_readings_patient_ts_idx"
  ON "hr_readings" ("patient_id", "ts");
