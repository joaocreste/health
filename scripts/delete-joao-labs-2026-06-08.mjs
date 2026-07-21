#!/usr/bin/env node
/**
 * Delete Joao Victor Creste's 2026-06-08 Hospital Sírio-Libanês panel from Neon
 * `lab_results`. Reverses scripts/ingest-joao-labs-2026-06-08.mjs.
 *
 * SCOPED, IDEMPOTENT, SINGLE-DATE delete of Joao's labs for this one draw:
 *   DELETE FROM lab_results WHERE patient_id=<joao> AND taken_at='2026-06-08'
 * No other date, patient, or table is touched — prior history is preserved.
 *
 * Usage:
 *   node scripts/delete-joao-labs-2026-06-08.mjs            # dry run
 *   node scripts/delete-joao-labs-2026-06-08.mjs --apply    # delete in a txn
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const TAKEN_AT = "2026-06-08";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  return m ? m[1] : null;
}

async function main() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("✗ DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);
  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const before = await sql`SELECT count(*)::int n FROM lab_results WHERE patient_id=${pid}`;
  const beforeDate = await sql`SELECT count(*)::int n FROM lab_results WHERE patient_id=${pid} AND taken_at=${TAKEN_AT}::date`;
  console.log("── Joao Victor Creste lab_results delete (2026-06-08) ──");
  console.log(`patient pid     : ${pid}`);
  console.log(`${TAKEN_AT} rows : ${beforeDate[0].n} (to delete)`);
  console.log(`total before    : ${before[0].n}`);

  if (!APPLY) { console.log("\n(dry run — no DB writes. Re-run with --apply.)"); return; }

  await sql`DELETE FROM lab_results WHERE patient_id=${pid} AND taken_at=${TAKEN_AT}::date`;
  await markSourceWritten(sql, pid, { writer: "delete-joao-labs-2026-06-08" });
  const after = await sql`SELECT count(*)::int n, count(DISTINCT marker)::int markers, count(DISTINCT taken_at)::int dates, min(taken_at) mn, max(taken_at) mx FROM lab_results WHERE patient_id=${pid}`;
  console.log(`\ntotal after     : ${after[0].n}  (${after[0].markers} markers, ${after[0].dates} dates, ${after[0].mn} … ${after[0].mx})`);
  console.log("✓ Joao 2026-06-08 lab_results deleted. Other dates untouched.");
}

main().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
