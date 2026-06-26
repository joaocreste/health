-- 0021 — uploads.tags: patient-applied exam-type tags on the upload portal.
--
-- When a patient uploads a file or folder they can self-tag what it is (blood,
-- urine, MRI, CT, colonoscopy, endoscopy, stress test, Apple Watch / Oura /
-- Withings vitals, blood pressure, alcohol patterns, …). The admin review queue
-- surfaces these tags per upload so ingestion can pick the right prompt without
-- re-classifying the blob. Tags are advisory metadata only — they do NOT parse or
-- write any clinical row (ingestion stays manual; see 0009_uploads.sql).
--
-- Stable ID set lives in two places kept in sync: ALLOWED_UPLOAD_TAGS in
-- web/_worker.js and web/assets/exam-tags.js (the shared front-end vocabulary).
--
-- Idempotent — the Worker also applies this in ensureUploadsTables() on first use.

ALTER TABLE "uploads" ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT '{}';
