-- 0012 — ecg_studies: clinical ECG studies (12-lead / rhythm-strip + report).
--
-- The existing `ecg_events` table models per-event consumer captures (one row
-- per Apple Watch single-lead reading). A clinical ECG is a different object: a
-- full study with an ordering physician, a validated interpretation, machine
-- intervals, a source chart, and a doctor's report PDF. Overloading ecg_events'
-- free-text `notes` would make none of that queryable, so this is its own table.
--
-- Blobs (original chart, report PDF, generated Lumen SVG) live in R2 under
-- patients/{patient_id}/ecg/{study_date}/ and are referenced by *_key columns;
-- the DB never stores the binary. Dedupe is on (patient, study_date, source_sha)
-- so re-ingesting the same chart is a no-op.
--
-- Hand-written idempotent SQL, matching the 0005-0011 precedent (plain SQL,
-- self-applied by the ingestion path / Worker).

CREATE TABLE IF NOT EXISTS "ecg_studies" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "study_date"        date NOT NULL,
  "recorded_at"       timestamptz,                 -- full datetime when known
  "modality"          text NOT NULL DEFAULT '12-lead',
  "lead_layout"       text,                        -- e.g. '3x4+rhythm'
  "source_format"     text NOT NULL,               -- vector_pdf | dicom_waveform | raster_pdf | image
  "fidelity"          text,                        -- SVG honesty label
  "ordering_doctor"   text,
  "validating_doctor" text,
  "clinic"            text,
  "heart_rate"        integer,                     -- bpm
  "pr_ms"             integer,
  "qrs_ms"            integer,
  "qt_ms"             integer,
  "qtc_ms"            integer,
  "axis_p"            integer,
  "axis_qrs"          integer,
  "axis_t"            integer,
  "interpretation"    text,                        -- validated conclusion (headline)
  "report_text"       text,                        -- fuller description / conclusion
  "source_sha"        text,                        -- sha256 of the original chart (dedupe)
  "original_key"      text,                        -- R2 key: untouched source chart
  "report_key"        text,                        -- R2 key: doctor's report PDF
  "svg_key"           text,                        -- R2 key: generated Lumen SVG
  "created_at"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "ecg_studies_dedup"
    UNIQUE NULLS NOT DISTINCT ("patient_id", "study_date", "source_sha")
);

CREATE INDEX IF NOT EXISTS "ecg_studies_patient_date_idx"
  ON "ecg_studies" ("patient_id", "study_date" DESC);
