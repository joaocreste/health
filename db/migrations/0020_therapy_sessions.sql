-- 0020 — therapy_sessions: longitudinal psychotherapy-session ingestion.
--
-- A therapy session is a distinct clinical object from a journal writing or a
-- mood entry: a dated encounter between a therapist and one or more patients,
-- whose content is mined for recurring THEMES (the analytical backbone for
-- "most recurring theme this month"), theoretical-lens readings (Freudian /
-- Jungian / Lacanian / attachment), strengths & growth areas, affect,
-- interventions, and — when present — SAFETY RISK flags. Each session is one
-- point in a per-patient time series; every child row denormalises session_date
-- so rolling-window queries ("last 30 days") never need a join.
--
-- Provenance vs clinical time are kept strictly separate everywhere:
--   session_date  = when the session happened   (clinical x-axis)
--   ingested_at   = when we wrote the row        (audit)
-- Append-only: re-ingesting the same session no-ops on content_hash; it never
-- mutates a prior session's interpretation.
--
-- AI inference is queryable, not assumed: anything interpreted (summaries, lens
-- readings, inferred strengths, theme salience) carries is_ai_inference = true;
-- transcribed/extracted facts (who spoke, the date, an assigned homework) carry
-- is_ai_inference = false. The future frontend applies the amber .ai-pill to the
-- former; this migration makes the distinction a column.
--
-- SAFETY: therapy_risk_flags rows are written with requires_human_review = true,
-- carry the clinical signal and severity but NEVER method/means detail, and are
-- gated to clinician callers only at the Worker boundary — never the patient's
-- own view, never the chatbot, never a digest.
--
-- FK CONVENTION (repo, not the prompt): patient_id references users(id) ON
-- DELETE CASCADE, matching psych_items / mood_entries / panic_events /
-- encounters / sleep_studies. The prompt's "-> patient_profiles" is overridden
-- by the live schema per the source-of-truth rule.
--
-- Blobs (raw audio/video + derived transcript) live in EU R2 under
-- patients/{patient_id}/therapy/{session_date}__{slug}/ and are referenced by
-- source_r2_key / transcript_r2_key; the DB never stores the bytes.
--
-- Hand-written idempotent SQL, matching the 0012/0016/0018/0019 precedent
-- (plain SQL, self-applied by the ingestion path; drizzle-kit's journal lags at
-- 0004 in this repo). Numbered 0020 because 0008 (the prompt's suggestion) is
-- already taken by 0008_insight_jobs.

DO $$ BEGIN
  CREATE TYPE therapy_modality AS ENUM ('individual', 'couples', 'family', 'group');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE therapy_session_type AS ENUM
    ('intake', 'routine', 'crisis', 'termination', 'follow_up', 'assessment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE therapy_source_format AS ENUM
    ('audio_recording', 'video_recording', 'transcript', 'text_archive', 'clinician_notes', 'mixed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE therapy_participant_role AS ENUM
    ('therapist', 'patient', 'partner', 'family_member', 'co_therapist', 'interpreter', 'other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE therapy_lens AS ENUM
    ('freudian', 'jungian', 'lacanian', 'attachment', 'general_clinical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE theme_valence AS ENUM ('positive', 'negative', 'neutral', 'ambivalent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE salience_level AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE sw_polarity AS ENUM ('strength', 'growth_area');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_type AS ENUM
    ('suicidality', 'self_harm', 'harm_to_others', 'substance_use', 'crisis', 'safeguarding', 'none');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE risk_severity AS ENUM ('none', 'low', 'moderate', 'high', 'imminent');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Container ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "therapy_sessions" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"             uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "session_date"           date NOT NULL,                         -- clinical x-axis
  "session_time"           time,
  "session_sequence"       integer,                               -- Nth session, if known
  "modality"               therapy_modality NOT NULL DEFAULT 'individual',
  "session_type"           therapy_session_type NOT NULL DEFAULT 'routine',
  "therapist_name"         text,                                  -- initials/redaction allowed
  "therapist_credentials"  text,
  "therapist_approach"     text,
  "duration_minutes"       integer,
  "language"               text,
  "source_format"          therapy_source_format NOT NULL,
  "source_r2_key"          text,                                  -- raw blob (audio/video/original)
  "transcript_r2_key"      text,                                  -- derived/normalised transcript
  "transcription_method"   text,
  "diarization_confidence" numeric(4,3),                          -- 0..1
  "consent_status"         text,
  "un_deidentified"        boolean NOT NULL DEFAULT false,        -- content reached the model un-de-identified
  "session_summary"        text,                                  -- is_ai_inference TRUE
  "summary_pt"             text,                                  -- bilingual companion summary
  "patient_overall_affect" text,
  "content_hash"           text,                                  -- idempotent re-ingest
  "reviewed_by"            text,
  "reviewed_at"            timestamptz,
  "occurred_at"            timestamptz,
  "source_file_name"       text,
  "ingested_at"            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "therapy_sessions_dedup" UNIQUE NULLS NOT DISTINCT ("patient_id", "content_hash")
);
CREATE INDEX IF NOT EXISTS "therapy_sessions_patient_date_idx"
  ON "therapy_sessions" ("patient_id", "session_date" DESC);

-- ── Participants ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "therapy_participants" (
  "id"                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"             uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"             uuid REFERENCES "users"("id") ON DELETE SET NULL, -- set iff a tracked patient
  "role"                   therapy_participant_role NOT NULL,
  "display_name"           text,
  "speaker_label"          text,                                  -- raw diarization label
  "attribution_confidence" numeric(4,3),
  "is_tracked_patient"     boolean NOT NULL DEFAULT false,
  "consent_on_file"        boolean,
  "ingested_at"            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_participants_session_idx"
  ON "therapy_participants" ("session_id");

-- ── Themes (analytical backbone) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "therapy_themes" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"        uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "canonical_label"   text NOT NULL,                              -- normalized key for cross-session GROUP BY
  "display_label_en"  text,
  "display_label_pt"  text,
  "category"          text,                                       -- maps to psych dimension ids where possible
  "salience"          salience_level NOT NULL DEFAULT 'medium',
  "valence"           theme_valence NOT NULL DEFAULT 'neutral',
  "description"       text,
  "evidence_anchor"   text,                                       -- SHORT de-identified pointer
  "psych_item_id"     uuid REFERENCES "psych_items"("id") ON DELETE SET NULL,
  "is_ai_inference"   boolean NOT NULL DEFAULT true,
  "session_date"      date NOT NULL,                              -- denormalised for range queries
  "ingested_at"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_themes_patient_date_idx"
  ON "therapy_themes" ("patient_id", "session_date");
CREATE INDEX IF NOT EXISTS "therapy_themes_patient_label_date_idx"
  ON "therapy_themes" ("patient_id", "canonical_label", "session_date");

-- ── Theoretical-lens interpretations (always AI inference) ───────────────────
CREATE TABLE IF NOT EXISTS "therapy_lens_interpretations" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"          uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"          uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "lens"                therapy_lens NOT NULL,
  "construct"           text NOT NULL,                            -- shadow | transference | objet_petit_a ...
  "construct_label_en"  text,
  "construct_label_pt"  text,
  "observation"         text NOT NULL,
  "evidence_anchor"     text,
  "confidence"          numeric(4,3),                             -- 0..1
  "is_ai_inference"     boolean NOT NULL DEFAULT true,            -- always true here
  "session_date"        date NOT NULL,
  "ingested_at"         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_lens_patient_lens_date_idx"
  ON "therapy_lens_interpretations" ("patient_id", "lens", "session_date");

-- ── Strengths & growth areas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "therapy_strengths_growth" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"      uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "polarity"        sw_polarity NOT NULL,
  "label"           text NOT NULL,
  "description"     text,
  "evidence_anchor" text,
  "confidence"      numeric(4,3),
  "is_ai_inference" boolean NOT NULL DEFAULT true,
  "session_date"    date NOT NULL,
  "ingested_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_strengths_patient_date_idx"
  ON "therapy_strengths_growth" ("patient_id", "session_date");

-- ── Interventions / homework (usually extracted fact) ────────────────────────
CREATE TABLE IF NOT EXISTS "therapy_interventions" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"        uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "intervention_type" text NOT NULL,                              -- homework | technique | referral | psychoeducation | medication_discussion
  "description"       text NOT NULL,
  "assigned_to_role"  therapy_participant_role,
  "is_ai_inference"   boolean NOT NULL DEFAULT false,
  "session_date"      date NOT NULL,
  "ingested_at"       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_interventions_patient_date_idx"
  ON "therapy_interventions" ("patient_id", "session_date");

-- ── Risk flags (safety; clinician-gated) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS "therapy_risk_flags" (
  "id"                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"            uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"            uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "risk_type"             risk_type NOT NULL,
  "severity"              risk_severity NOT NULL,
  "description"           text,                                   -- factual, careful, NO method/means detail
  "requires_human_review" boolean NOT NULL DEFAULT true,
  "reviewed_by"           text,
  "reviewed_at"           timestamptz,
  "session_date"          date NOT NULL,
  "ingested_at"           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_risk_patient_date_idx"
  ON "therapy_risk_flags" ("patient_id", "session_date");

-- ── Short verbatim/paraphrase quote anchors (de-identified) ──────────────────
CREATE TABLE IF NOT EXISTS "therapy_quotes" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "session_id"      uuid NOT NULL REFERENCES "therapy_sessions"("id") ON DELETE CASCADE,
  "patient_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "speaker_role"    therapy_participant_role,
  "quote_text"      text NOT NULL,                                -- SHORT, de-identified; never bulk transcript
  "context_note"    text,
  "linked_theme_id" uuid REFERENCES "therapy_themes"("id") ON DELETE SET NULL,
  "is_ai_inference" boolean NOT NULL DEFAULT false,
  "session_date"    date NOT NULL,
  "ingested_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "therapy_quotes_patient_date_idx"
  ON "therapy_quotes" ("patient_id", "session_date");

-- ── Optional cached period digests ("month in review") ───────────────────────
CREATE TABLE IF NOT EXISTS "therapy_period_digests" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"      uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "period_start"    date NOT NULL,
  "period_end"      date NOT NULL,
  "top_themes_json" jsonb,
  "trajectory_note" text,                                         -- is_ai_inference TRUE
  "sessions_count"  integer,
  "generated_at"    timestamptz NOT NULL DEFAULT now(),
  "reviewed_by"     text,
  "reviewed_at"     timestamptz
);
CREATE INDEX IF NOT EXISTS "therapy_digests_patient_period_idx"
  ON "therapy_period_digests" ("patient_id", "period_start", "period_end");
