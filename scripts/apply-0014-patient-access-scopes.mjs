#!/usr/bin/env node
/* Apply migration 0014 (patient_access scoped permissions) to Neon.
   Idempotent — statements are ADD COLUMN IF NOT EXISTS + a guarded backfill.
   Usage: node scripts/apply-0014-patient-access-scopes.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}
const sql = neon(loadDatabaseUrl());

await sql`ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "scopes" jsonb NOT NULL DEFAULT '[]'::jsonb`;
await sql`ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "resource_filter" jsonb`;
await sql`ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz`;
await sql`ALTER TABLE "patient_access" ADD COLUMN IF NOT EXISTS "reason" text`;
const upd = await sql`
  UPDATE "patient_access"
  SET "scopes" = '["profile_basic","imaging","labs","vitals","medications","clinical_history","genetics","mental","journal"]'::jsonb
  WHERE "scopes" = '[]'::jsonb
  RETURNING user_id`;
const chk = await sql`
  SELECT count(*)::int AS total,
         count(*) FILTER (WHERE scopes != '[]'::jsonb)::int AS scoped,
         count(*) FILTER (WHERE expires_at IS NULL)::int AS permanent
  FROM patient_access`;
console.log(`backfilled ${upd.length} rows; patient_access: ${JSON.stringify(chk[0])}`);
