-- 0025 — derived-data freshness: per-patient source high-water mark + insight fingerprint.
--
-- Enables read-time staleness detection so a page can never SILENTLY show an AI
-- narrative built against older source data than what is now in the DB.
--   * patient_source_watermark.watermark  — advanced by markSourceWritten() on ANY
--     write to a patient's clinical source tables (denormalized so read-time is O(1)
--     instead of UNION-maxing ~25 tables).
--   * patient_dashboards.built_against_watermark — the watermark value the current
--     AI narrative was built against; stamped by persistInsights() at build start.
-- stale  <=>  watermark > built_against_watermark.

CREATE TABLE IF NOT EXISTS "patient_source_watermark" (
  "patient_id"  uuid PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "watermark"   timestamptz NOT NULL DEFAULT now(),
  "updated_by"  text,
  "updated_at"  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE "patient_dashboards"
  ADD COLUMN IF NOT EXISTS "built_against_watermark" timestamptz;

-- Baseline so nobody shows falsely-stale on day 1: seed each existing dashboard's
-- watermark AND built_against to its generated_at (=> watermark == built_against ==
-- not stale). The first source write after this migration advances the watermark
-- past built_against, flipping the patient to "pending rebuild" until refreshed.
UPDATE "patient_dashboards"
   SET "built_against_watermark" = "generated_at"
 WHERE "section" = 'ai-insights' AND "built_against_watermark" IS NULL;

INSERT INTO "patient_source_watermark" ("patient_id", "watermark", "updated_by")
SELECT "patient_id", "generated_at", 'migration-0025-baseline'
  FROM "patient_dashboards"
 WHERE "section" = 'ai-insights'
ON CONFLICT ("patient_id") DO NOTHING;
