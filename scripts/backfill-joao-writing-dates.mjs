#!/usr/bin/env node
/**
 * Reflective v2 Gate 1 follow-up (operator-approved 2026-07-17): write the 12
 * recovered dates into writings.written_at for Joao's undated corpus. Dates and
 * their evidence bases come from .staging/joao-reflective/gate1-items.json
 * (date_recovery block) - recovery was evidence-only (in-text references,
 * dated citations in the clinical record, filename conventions); nothing is
 * fabricated, and the 3 writings with no defensible basis stay NULL.
 *
 * Only fills NULLs - never overwrites an existing written_at.
 * Dry-run by default; pass --apply to write.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");

function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const sql = neon(process.env.DATABASE_URL || fromEnv("DATABASE_URL"));

const staged = JSON.parse(fs.readFileSync(path.join(root, ".staging", "joao-reflective", "gate1-items.json"), "utf8"));
const PID = "d984faba-4a3a-45ff-9ef2-fd52606a02d3";
const recoveries = staged.date_recovery.filter(r => r.recovered_date);

console.log(`${recoveries.length} recovered dates to apply (${staged.date_recovery.length - recoveries.length} stay undated):`);
for (const r of recoveries) {
  const cur = await sql`select id, written_at::date::text d from writings where patient_id = ${PID} and title = ${r.writing}`;
  if (!cur.length) { console.log(`  ✗ NOT FOUND: ${r.writing}`); continue; }
  const state = cur[0].d ? `already ${cur[0].d} - SKIP` : `NULL -> ${r.recovered_date} [${r.date_source}/${r.confidence}]`;
  console.log(`  ${r.writing.padEnd(32)} ${state}`);
  if (APPLY && !cur[0].d) {
    await sql`update writings set written_at = ${r.recovered_date} where id = ${cur[0].id} and written_at is null`;
  }
}
const tally = await sql`select count(*)::int total, count(written_at)::int dated from writings where patient_id = ${PID}`;
console.log(`\n${APPLY ? "APPLIED." : "DRY RUN - pass --apply."} Corpus now: ${tally[0].dated}/${tally[0].total} dated.`);
