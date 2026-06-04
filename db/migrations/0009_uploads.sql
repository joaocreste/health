-- 0009 — uploads + upload_objects: patient-facing upload portal & admin review queue.
--
-- An `upload` is one reviewable unit the patient pushed straight to R2 (a single
-- file OR a whole folder). It stores ONLY raw-blob metadata + a review status —
-- it does NOT parse, classify, or write any clinical row. Ingestion stays manual
-- and terminal-driven (see "Ingestion Prompts/"). Deliberately separate from
-- imports/import_files, which model the parse pipeline.
--
-- Hand-written idempotent SQL, matching the 0005-0008 precedent (those migrations
-- are plain SQL, applied through the deployed Worker because the live DB is only
-- reachable via the Worker's secret). The Worker also applies this DDL idempotently
-- on first use (ensureUploadsTables in web/_worker.js).
--
-- R2 key scheme: uploads/{patient_id}/{upload_id}/{relative_path}
-- patient_id and upload_id are assigned server-side; the client never chooses them.

DO $$ BEGIN
  CREATE TYPE "upload_status" AS ENUM ('pending_review', 'ingested', 'data_error');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "uploads" (
  "id"               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "doc_ref"          text NOT NULL UNIQUE,            -- short human-readable display ID
  "patient_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "uploader_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "original_name"    text NOT NULL,                   -- file name or top-level folder name
  "kind"             text NOT NULL,                   -- 'file' | 'folder'
  "r2_prefix"        text NOT NULL,                   -- R2 key (file) or key prefix (folder)
  "file_count"       integer NOT NULL DEFAULT 0,
  "total_bytes"      bigint NOT NULL DEFAULT 0,
  "content_type"     text,                            -- single files only
  "status"           "upload_status" NOT NULL DEFAULT 'pending_review',
  "error_note"       text,                            -- admin's reason when status='data_error'
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "reviewed_at"      timestamp with time zone,
  "reviewed_by"      uuid REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "upload_objects" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "upload_id"      uuid NOT NULL REFERENCES "uploads"("id") ON DELETE CASCADE,
  "r2_key"         text NOT NULL,
  "relative_path"  text NOT NULL,                     -- preserves folder structure
  "bytes"          bigint,
  "content_type"   text
);

CREATE INDEX IF NOT EXISTS "uploads_patient_created_idx" ON "uploads" ("patient_id", "created_at");
CREATE INDEX IF NOT EXISTS "uploads_status_idx"          ON "uploads" ("status");
CREATE INDEX IF NOT EXISTS "upload_objects_upload_idx"   ON "upload_objects" ("upload_id");
