#!/usr/bin/env node
// Idempotent apply of migration 0025 (patient_source_watermark + built_against_watermark)
// to the live Neon DB. Safe to re-run. Usage: node scripts/apply-0025-watermark.mjs [--apply]
import fs from "node:fs"; import path from "node:path"; import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB = process.env.DATABASE_URL ||
  (fs.readFileSync(path.join(root, ".env"), "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/) || [])[1];
if (!DB) { console.error("no DATABASE_URL"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const sql = neon(DB);

async function main() {
  if (!APPLY) { console.log("DRY RUN — re-run with --apply. Would create patient_source_watermark + add built_against_watermark + baseline-seed."); return; }
  await sql`CREATE TABLE IF NOT EXISTS patient_source_watermark (
    patient_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    watermark  timestamptz NOT NULL DEFAULT now(),
    updated_by text,
    updated_at timestamptz NOT NULL DEFAULT now())`;
  await sql`ALTER TABLE patient_dashboards ADD COLUMN IF NOT EXISTS built_against_watermark timestamptz`;
  await sql`UPDATE patient_dashboards SET built_against_watermark = generated_at
            WHERE section = 'ai-insights' AND built_against_watermark IS NULL`;
  await sql`INSERT INTO patient_source_watermark (patient_id, watermark, updated_by)
            SELECT patient_id, generated_at, 'migration-0025-baseline'
            FROM patient_dashboards WHERE section = 'ai-insights'
            ON CONFLICT (patient_id) DO NOTHING`;
  const wm = await sql`SELECT count(*)::int n FROM patient_source_watermark`;
  const bd = await sql`SELECT count(*)::int n FROM patient_dashboards WHERE built_against_watermark IS NOT NULL`;
  console.log(`applied. patient_source_watermark rows: ${wm[0].n}  dashboards stamped: ${bd[0].n}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
