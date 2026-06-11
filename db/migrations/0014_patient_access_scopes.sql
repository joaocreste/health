-- 0014 — patient_access v2: scoped permissions.
--
-- Upgrades the binary doctor<->patient access model into scoped grants:
--   scopes          string[] (jsonb), validated in the Worker against the
--                   canonical taxonomy: profile_basic, imaging, labs, vitals,
--                   medications, clinical_history, genetics, mental, journal.
--                   profile_basic is implied by any grant; empty = invalid.
--   resource_filter e.g. { "imaging_study_ids": ["..."] } — narrows imaging
--                   to specific studies.
--   expires_at      NULL = NEVER expires (first-class, intentional state).
--                   Past timestamp = expired = treated as no grant at READ
--                   time. Rows are never auto-deleted on expiry so the audit
--                   trail of who had access remains intact.
--   reason          free-text grant rationale.
-- (granted_by already exists since 0000_init.)
--
-- Backfill: existing rows get the FULL taxonomy so current access behavior
-- is unchanged by this migration.
--
-- Hand-written idempotent SQL, matching the 0005-0013 precedent (plain SQL,
-- self-applied by scripts/apply-0014-patient-access-scopes.mjs).

ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "resource_filter" jsonb;
ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz;
ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "reason" text;

UPDATE "patient_access"
SET "scopes" = '["profile_basic","imaging","labs","vitals","medications","clinical_history","genetics","mental","journal"]'::jsonb
WHERE "scopes" = '[]'::jsonb;
