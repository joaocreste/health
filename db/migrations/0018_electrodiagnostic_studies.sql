-- 0018 — electrodiagnostic_studies: nerve conduction studies + needle EMG (ENMG).
--
-- An electrodiagnostic study (electroneuromyography / eletroneuromiografia)
-- bundles up to four structured data blocks — motor NCS, F-wave, sensory NCS,
-- needle EMG — plus a narrative laudo and CONCLUSAO. The structured tables and
-- the report are stored TOGETHER so the AI sees the complete clinical picture;
-- patient-facing display is decided per ingestion via display_mode and never
-- automatically (default 'hidden', requires_review = true).
--
-- The four data blocks live verbatim in structured_data (jsonb); the laudo lives
-- verbatim, original-language, in report_text/conclusion. Blobs (original report
-- PDF) live in R2 under patients/{patient_id}/procedures/ and are referenced by
-- r2_key; the DB never stores the binary.
--
-- patient_id references users(id) directly, matching the ecg_studies (0012) and
-- ergometric_studies (0016) precedent. Hand-written idempotent SQL, self-applied
-- by the ingestion path (matching those same migrations).

DO $$ BEGIN
  CREATE TYPE electrodiagnostic_study_type AS ENUM
    ('ncs_emg', 'ncs', 'emg', 'evoked_potential', 'repetitive_stimulation', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE clinical_display_mode AS ENUM ('hidden', 'report_only', 'tables_only', 'full');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "electrodiagnostic_studies" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"         uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "import_id"          uuid REFERENCES "imports"("id"),
  "import_file_id"     uuid REFERENCES "import_files"("id"),
  "study_type"         electrodiagnostic_study_type NOT NULL DEFAULT 'ncs_emg',
  "study_subtype"      text,                 -- "Eletroneuromiografia de MMII (estudo completo)"
  "body_region"        text,                 -- "lower limbs / MMII"
  "laterality"         text,                 -- "bilateral"
  "exam_date"          date,
  "ingested_at"        timestamptz NOT NULL DEFAULT now(),
  "requesting_doctor"  text,
  "performing_doctor"  text,
  "lab"                text,
  "city"               text,
  "country"            text,
  "conclusion"         text,                 -- the CONCLUSAO block, verbatim
  "report_text"        text,                 -- full laudo, verbatim, original language
  "structured_data"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_language"    text DEFAULT 'pt-BR',
  "r2_key"             text,                 -- patients/{id}/procedures/{exam_date}-enmg-{region}.pdf
  "source_sha"         text,                 -- sha256 of the original PDF (provenance / dedupe)
  "display_mode"       clinical_display_mode NOT NULL DEFAULT 'hidden',
  "de_identified"      boolean NOT NULL DEFAULT false,
  "requires_review"    boolean NOT NULL DEFAULT true,
  "severity_flags"     text[] DEFAULT '{}',
  "confidence"         text,                 -- alta / media / baixa
  "extraction_flags"   jsonb DEFAULT '{}'::jsonb,
  "created_at"         timestamptz NOT NULL DEFAULT now(),
  "updated_at"         timestamptz NOT NULL DEFAULT now(),
  -- Duplicate guard: one study per patient/date/type. Re-ingesting the same
  -- exam is a no-op rather than a silent duplicate.
  CONSTRAINT "electrodiagnostic_studies_dedup"
    UNIQUE NULLS NOT DISTINCT ("patient_id", "exam_date", "study_type")
);

CREATE INDEX IF NOT EXISTS "electrodiagnostic_studies_patient_date_idx"
  ON "electrodiagnostic_studies" ("patient_id", "exam_date" DESC);
