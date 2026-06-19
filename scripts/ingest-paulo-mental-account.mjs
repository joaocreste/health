#!/usr/bin/env node
/**
 * Ingest Paulo Augusto Silotto's MENTAL-HEALTH collateral family account into
 * Postgres so the AI Insights / cross-domain synthesis pipeline (DB-only) and
 * full-text search can read it.
 *
 * The account is a ~20-minute spoken narrative given by Paulo's SON
 * (João Victor Creste) about his father, recorded 2026-06-19 in English. It is
 * stored verbatim — no edits, no summary — as a single `writings` row attached
 * to Paulo. This mirrors web/assets/paulo-mental.js (front-end source of truth);
 * both are generated from the same raw transcript so the text is byte-identical.
 *
 * Source transcript:
 *   Patients/Paulo Silotto/Mental/Family Accounts.txt
 *
 * Idempotent: deletes any prior writing at the same blob_key for Paulo, then
 * inserts. Dry-run by default; pass --apply to write.
 *
 *   node scripts/ingest-paulo-mental-account.mjs            # dry run
 *   node scripts/ingest-paulo-mental-account.mjs --apply
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
const DATABASE_URL = process.env.DATABASE_URL || fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
const sql = neon(DATABASE_URL);

const CLERK    = "pending:paulo-silotto-df3441";
const SRC      = path.join(root, "Patients", "Paulo Silotto", "Mental", "Family Accounts.txt");
const BLOB_KEY = "patients/pending:paulo-silotto-df3441/mental/family-account-son-2026-06-19.txt";
const TITLE    = "Collateral family account — son's narrative (verbatim)";
const WRITTEN  = "2026-06-19";
const LANG     = "en";

// Reflow the raw transcript into paragraphs WITHOUT changing a single word.
// Same break points as web/assets/paulo-mental.js (verified 2526/2526 words).
const BREAKS = [9,20,29,37,41,49,60,72,86,98,110,139,165,187,203,235,258,288,
                314,372,435,459,501,540,582,608,664,711,759,796,818,833];
function reflow() {
  const segs = fs.readFileSync(SRC, "utf8").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const paras = []; let start = 0;
  for (const b of BREAKS) { paras.push(segs.slice(start, b).join(" ")); start = b; }
  if (start < segs.length) paras.push(segs.slice(start).join(" "));
  return { paras, segCount: segs.length };
}

const { paras, segCount } = reflow();
const text = paras.join("\n\n");
const words = text.replace(/\s+/g, " ").trim().split(" ").length;

console.log(`Source segments : ${segCount}`);
console.log(`Paragraphs      : ${paras.length}`);
console.log(`Words           : ${words}`);
console.log(`First 90 chars  : ${text.slice(0, 90)}…`);
console.log("");

const rows = await sql`select id, full_name from users where clerk_user_id = ${CLERK}`;
if (!rows.length) { console.error(`✗ patient not found for clerk ${CLERK}`); process.exit(1); }
const patientId = rows[0].id;
console.log(`Patient         : ${rows[0].full_name} (${patientId})`);

if (!APPLY) {
  const existing = await sql`select id, title, written_at, length(extracted_text) chars
                             from writings where patient_id = ${patientId} and blob_key = ${BLOB_KEY}`;
  console.log(`Existing rows at blob_key: ${existing.length}`);
  console.log("\nDRY RUN — pass --apply to write. Would upsert one writings row:");
  console.log(`  title       : ${TITLE}`);
  console.log(`  written_at  : ${WRITTEN}`);
  console.log(`  language    : ${LANG}`);
  console.log(`  blob_key    : ${BLOB_KEY}`);
  console.log(`  extracted   : ${words} words / ${text.length} chars`);
  process.exit(0);
}

const del = await sql`delete from writings where patient_id = ${patientId} and blob_key = ${BLOB_KEY} returning id`;
const ins = await sql`
  insert into writings (patient_id, title, written_at, language, blob_key, extracted_text)
  values (${patientId}, ${TITLE}, ${WRITTEN}, ${LANG}, ${BLOB_KEY}, ${text})
  returning id, created_at`;
console.log(`\n✓ deleted ${del.length} prior row(s); inserted writing ${ins[0].id} at ${ins[0].created_at}`);

// Confirm FTS populated by the trigger.
const chk = await sql`select length(extracted_text) chars, (fts is not null) has_fts
                      from writings where id = ${ins[0].id}`;
console.log(`✓ stored ${chk[0].chars} chars · fts ${chk[0].has_fts ? "indexed" : "NULL"}`);
