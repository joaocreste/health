-- 0008 — insight_jobs: async job state for the "Update AI Insights" button.
--
-- One row per whole-patient AI Insight Update run. The click starts a job; the
-- page polls it. Scoped by patient_id (uuid -> users.id), like every other
-- patient-owned table. This table and patient_dashboards are the ONLY things the
-- rebuild writes to — it never touches clinical/source data.
--
-- Hand-written idempotent SQL, matching the 0005-0007 precedent (those dashboard
-- migrations are plain SQL, not in schema.ts or the drizzle _journal). The worker
-- also applies this DDL idempotently on first use (ensureInsightJobsTable) because
-- the live DB is only reachable through the deployed Worker's secret.

DO $$ BEGIN
  CREATE TYPE "insight_job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "insight_jobs" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "status"           "insight_job_status" NOT NULL DEFAULT 'queued',
  "progress"         integer NOT NULL DEFAULT 0,
  "stage"            text,                       -- stage key (UI maps to bilingual label)
  "error"            text,
  "insights_version" integer,                    -- the version this job is producing
  "started_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "finished_at"      timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "insight_jobs_patient_idx"        ON "insight_jobs" ("patient_id");
CREATE INDEX IF NOT EXISTS "insight_jobs_patient_status_idx" ON "insight_jobs" ("patient_id", "status");
CREATE INDEX IF NOT EXISTS "insight_jobs_started_idx"        ON "insight_jobs" ("patient_id", "started_at");
