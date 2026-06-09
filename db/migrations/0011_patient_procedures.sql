-- 0011 — patient_procedures: unified injuries / surgeries / procedures history.
--
-- Joao's injury & surgical history lived ONLY in static front-end HTML
-- (web/home.html § "04 · Cross-cutting context") and was never persisted. The
-- legacy `surgeries` / `injuries` tables can't represent the wider event set
-- (Procedure / Diagnostic / Hospitalization) and lack a `type` discriminator
-- and a `date_raw` slot for partial/unknown dates — so this supersedes them
-- with a single typed table.
--
-- Postgres variant of the supplied D1 spec (this backend is Neon Postgres, and
-- the spec says "swap to Neon if the backend is already Postgres"):
--   * event_date is a real DATE (NULL when the date is genuinely unknown);
--   * date_raw keeps the original string so partial dates (YYYY-MM, YYYY) and
--     "Unknown" survive verbatim for display;
--   * UNIQUE NULLS NOT DISTINCT so a re-run can't duplicate rows whose location
--     or event_date is NULL (PG would otherwise treat NULLs as distinct).
--
-- Hand-written idempotent SQL, matching the 0005-0010 precedent (plain SQL,
-- self-applied by the ingestion script / Worker). CREATE ... IF NOT EXISTS so
-- re-application is a no-op.

CREATE TABLE IF NOT EXISTS "patient_procedures" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "event_date"  date,                 -- ISO date; NULL when unknown
  "date_raw"    text,                 -- original string as provided
  "type"        text NOT NULL,        -- Injury | Surgery | Procedure | Diagnostic | Hospitalization | Other
  "location"    text,                 -- anatomical site / body region
  "description" text NOT NULL,
  "notes"       text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "patient_procedures_dedup"
    UNIQUE NULLS NOT DISTINCT ("patient_id", "event_date", "type", "location", "description")
);

CREATE INDEX IF NOT EXISTS "patient_procedures_patient_date_idx"
  ON "patient_procedures" ("patient_id", "event_date" DESC);
