#!/usr/bin/env node
/* Apply migration 0015 (provenance columns on clinician-ordered tables) to Neon.
   Idempotent — every statement is ADD COLUMN IF NOT EXISTS.
   Usage: node scripts/apply-0015-provenance-columns.mjs */
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

await sql`ALTER TABLE "lab_results"     ADD COLUMN IF NOT EXISTS "performing_doctor" text`;
await sql`ALTER TABLE "lab_results"     ADD COLUMN IF NOT EXISTS "lab_city" text`;
await sql`ALTER TABLE "lab_results"     ADD COLUMN IF NOT EXISTS "lab_country" text`;

await sql`ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "requesting_doctor" text`;
await sql`ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "performing_doctor" text`;
await sql`ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "lab_name" text`;
await sql`ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "lab_city" text`;
await sql`ALTER TABLE "imaging_studies" ADD COLUMN IF NOT EXISTS "lab_country" text`;

await sql`ALTER TABLE "ecg_studies"     ADD COLUMN IF NOT EXISTS "lab_city" text`;
await sql`ALTER TABLE "ecg_studies"     ADD COLUMN IF NOT EXISTS "lab_country" text`;

// Read back the resulting column set as proof.
const cols = await sql`
  SELECT table_name, column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND ((table_name = 'lab_results'     AND column_name IN ('performing_doctor','lab_city','lab_country','laboratory','requesting_doctor','taken_at','created_at'))
      OR (table_name = 'imaging_studies' AND column_name IN ('requesting_doctor','performing_doctor','lab_name','lab_city','lab_country','study_date','created_at'))
      OR (table_name = 'ecg_studies'     AND column_name IN ('lab_city','lab_country','clinic','ordering_doctor','validating_doctor','study_date','created_at')))
  ORDER BY table_name, column_name`;
console.log("provenance columns present:");
for (const c of cols) console.log(`  ${c.table_name}.${c.column_name}`);
