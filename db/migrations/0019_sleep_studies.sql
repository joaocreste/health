-- 0019 — sleep_studies: whole-night polysomnography (PSG) and other numeric
-- sleep-medicine studies.
--
-- A polysomnogram is a distinct clinical object from an ECG or a stress test: a
-- whole-night recording producing an apnoea-hypopnoea index (AHI/IAH), an event
-- breakdown (obstructive / central / mixed / hypopnoea), sleep architecture
-- (efficiency, TST, stage %, latencies), arousal/snore indices and an oximetry
-- profile (baseline / mean / nadir SpO2, time < 90%, desaturations). Each exam
-- is one point in a per-patient time series, so the structured summary columns
-- below are kept queryable rather than buried in free text. The full per-exam
-- record (verbatim Comentários + Conclusão, reconciliation notes, all derived
-- fields) is preserved verbatim in exam_json.
--
-- Drug-induced sleep endoscopy (DISE) is a PROCEDURE, not a numeric study, and
-- is NOT stored here — it lands in imaging_studies (modality OTHER, report-only)
-- following the colonoscopy precedent. Only numeric sleep studies (PSG, and any
-- future MSLT / MWT / titration) use this table; `subtype` discriminates them.
--
-- Blobs (original report PDF) live in R2 under patients/{patient_id}/sleep/ and
-- are referenced by source_pdf_key; the DB never stores the binary. Dedupe is on
-- (patient_id, exam_date, subtype) so re-ingesting the same exam is a no-op.
--
-- Hand-written idempotent SQL, matching the 0012/0016 precedent (plain SQL,
-- self-applied by the ingestion path; drizzle-kit's journal lags at 0004 in this
-- repo). All metric columns nullable so thin/older reports never block ingestion.

CREATE TABLE IF NOT EXISTS "sleep_studies" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"               uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exam_date"                date NOT NULL,
  "exam_datetime"            timestamptz,
  "subtype"                  text NOT NULL DEFAULT 'PSG',  -- PSG | MSLT | MWT | titration

  -- provenance (five-field contract; nulls = genuinely not stated in report)
  "requesting_doctor"        text,
  "performing_doctor"        text,
  "lab"                      text,
  "city"                     text,
  "country"                  text,
  "attendance"               text,

  -- demographics captured at exam
  "age_years"                integer,
  "weight_kg"                numeric(5,1),
  "height_cm"                integer,
  "bmi"                      numeric(4,1),

  -- respiratory indices
  "ahi_iah"                  numeric(5,2),
  "ahi_obstructive"          numeric(5,2),
  "ahi_hypopnea"             numeric(5,2),
  "rdi_itv"                  numeric(5,2),
  "events_total"             integer,
  "events_obstructive"       integer,
  "events_central"           integer,
  "events_mixed"             integer,
  "events_hypopnea"          integer,
  "rera_count"               integer,
  "max_event_duration_s"     numeric(6,2),

  -- sleep architecture
  "sleep_efficiency_pct"     numeric(5,2),
  "total_sleep_time_min"     numeric(6,1),
  "waso_min"                 numeric(6,1),
  "wake_time_min"            numeric(6,1),
  "nrem_latency_min"         numeric(6,1),
  "rem_latency_min"          numeric(6,1),
  "stage_n1_pct"             numeric(5,2),
  "stage_n2_pct"             numeric(5,2),
  "stage_n34_pct"            numeric(5,2),
  "stage_rem_pct"            numeric(5,2),
  "staging_system"           text,                 -- 'R&K' | 'AASM'
  "awakenings_count"         integer,
  "micro_arousals_count"     integer,
  "arousal_index"            numeric(5,2),

  -- snoring
  "snore_index"              numeric(6,2),
  "snore_count_total"        integer,

  -- oximetry
  "spo2_baseline"            numeric(5,2),
  "spo2_mean"                numeric(5,2),
  "spo2_max"                 numeric(5,2),
  "spo2_nadir"               numeric(5,2),
  "time_below_90_min"        numeric(6,2),
  "time_below_90_pct"        numeric(5,2),
  "desaturation_count"       integer,
  "odi_ido"                  numeric(5,2),         -- NULL unless the report states an index

  -- verdict
  "severity"                 text,                 -- normal | mild | moderate | severe
  "severity_type"            text,                 -- obstructive | central | mixed

  -- verbatim narrative (original Portuguese, untranslated)
  "comments_verbatim"        text,
  "conclusion_verbatim"      text,

  "exam_json"                jsonb,                -- full lumen.sleep_study.v1 record
  "source_pdf_key"           text,                 -- R2 key: original report PDF
  "source_sha"               text,                 -- sha256 of the original PDF (dedupe)
  "created_at"               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "sleep_studies_dedup"
    UNIQUE NULLS NOT DISTINCT ("patient_id", "exam_date", "subtype")
);

CREATE INDEX IF NOT EXISTS "sleep_studies_patient_date_idx"
  ON "sleep_studies" ("patient_id", "exam_date" DESC);
