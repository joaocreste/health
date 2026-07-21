#!/usr/bin/env node
/**
 * Ingest Joao Victor Creste's CONVERSATION WITH CLAUDE of 2026-07-17 —
 * "A conversation — on feeling alive again" — into Postgres so the AI
 * Insights / cross-domain synthesis pipeline (DB-only) and full-text search
 * can read it.
 *
 * Verbatim record of the day's exchange (Ribeirao Preto, 2026-07-17): the
 * first felt attraction in ~2 years, warmth without guilt, "eligible for a
 * second chance", the never-been-rejected disclosure, and the closing
 * commitment against numbness. It is the direct counterpoint to the
 * "acinzentando" point (4f) of the pre-consultation report of 2026-07-15
 * (see ingest-joao-preconsult-tischer.mjs) and continues the same
 * self-examination thread as the 18-questions transcript of 2026-07-14.
 * English. Stored so it is always available for future inference; NO
 * insights rebuild is triggered by this script.
 *
 * Source of truth on disk (gitignored PHI folder — the verbatim text is
 * deliberately NOT embedded in this committed script):
 *   Patients/Joao Victor Creste/Mental Health/Claude July 17 2026.txt
 * Also archived byte-identical to R2 at BLOB_KEY.
 *
 * Idempotent: deletes any prior writing at the same blob_key for Joao, then
 * inserts. Dry-run by default; pass --apply to write.
 *
 *   node scripts/ingest-joao-claude-conversation-2026-07-17.mjs            # dry run
 *   node scripts/ingest-joao-claude-conversation-2026-07-17.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

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

const CLERK    = "pending:joao";
const SRC      = path.join(root, "Patients", "Joao Victor Creste", "Mental Health", "Claude July 17 2026.txt");
const BLOB_KEY = "uploads/d984faba-4a3a-45ff-9ef2-fd52606a02d3/mental/claude-conversation-feeling-alive-again-2026-07-17.txt";
const TITLE    = "A conversation — on feeling alive again (with Claude, 2026-07-17, verbatim)";
const WRITTEN  = "2026-07-17";
const LANG     = "en";

if (!fs.existsSync(SRC)) { console.error(`✗ source transcript not found: ${SRC}`); process.exit(1); }
const text = fs.readFileSync(SRC, "utf8").trim();
const words = text.replace(/\s+/g, " ").trim().split(" ").length;

console.log(`Source          : ${path.relative(root, SRC)}`);
console.log(`Words           : ${words}`);
console.log(`Chars           : ${text.length}`);
console.log(`First 90 chars  : ${text.slice(0, 90)}…`);
console.log("");

const rows = await sql`select id, full_name from users where clerk_user_id = ${CLERK}`;
if (!rows.length) { console.error(`✗ patient not found for clerk ${CLERK}`); process.exit(1); }
const patientId = rows[0].id;
console.log(`Patient         : ${rows[0].full_name} (${patientId})`);
if (!BLOB_KEY.startsWith(`uploads/${patientId}/`)) {
  console.error(`✗ BLOB_KEY namespace does not match patient id ${patientId}`);
  process.exit(1);
}

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

const chk = await sql`select length(extracted_text) chars, (fts is not null) has_fts
                      from writings where id = ${ins[0].id}`;
console.log(`✓ stored ${chk[0].chars} chars · fts ${chk[0].has_fts ? "indexed" : "NULL"}`);

await markSourceWritten(sql, patientId, { writer: "ingest-joao-claude-conversation-2026-07-17" });
