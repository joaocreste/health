#!/usr/bin/env node
/* Apply migration 0023 (patient_access.view_mode) to Neon.
   Idempotent — ADD COLUMN IF NOT EXISTS.
   Usage: node scripts/apply-0023-view-mode.mjs */
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

await sql`ALTER TABLE patient_access ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'navigation'`;

const rows = await sql`
  SELECT view_mode, count(*)::int AS n
  FROM patient_access GROUP BY view_mode ORDER BY view_mode`;
console.log("patient_access.view_mode applied:", rows);
