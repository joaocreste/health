#!/usr/bin/env node
/**
 * Ingest John Smith Jr's personal-writings corpus into `writings`.
 *
 * Source: Patients/Johh Smith Jr/Writtings/*.docx (journals/letters). Text is
 * pre-extracted to .staging/john-writings/<title>.txt via `textutil`. Each row:
 *   title           <- filename (no extension)
 *   written_at      <- best-effort date parsed from the filename, else NULL
 *   language        <- heuristic detect (en|pt|fr) from the text
 *   extracted_text  <- full plain text (primary source for AI Insights + psych synthesis)
 *   blob_key        <- R2 key of the original .docx (uploaded separately)
 *
 * Idempotent: full replacement of this patient's writings (delete + insert), since
 * the folder is the authoritative corpus. Narrative source — no clinician/exam
 * provenance (written_at + created_at only).
 *
 * Usage: node scripts/ingest-john-writings.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:john-smith-jr-dbef5f";
const SRC = path.join(root, "Patients", "Johh Smith Jr", "Writtings");
const TXT = path.join(root, ".staging", "john-writings");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

const MONTHS = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };
function parseDate(title) {
  // "Crisis Episode April 29 2026" / "March 13 2026"
  let m = title.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[3]}-${String(MONTHS[m[1].toLowerCase()]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
  // year only "The Book 2025"
  m = title.match(/\b(20\d{2})\b/);
  if (m) return `${m[1]}-01-01`;
  return null;
}

function detectLang(text) {
  const t = text.toLowerCase();
  const pt = (t.match(/\b(não|você|meu|minha|coração|pai|mãe|porque|vida|sempre|filho|tudo|nós)\b/g) || []).length;
  const fr = (t.match(/\b(je|tu|le|la|les|des|une|dans|avec|pour|mais|c'est|même|être)\b/g) || []).length;
  const en = (t.match(/\b(the|and|that|with|have|this|was|for|you|but|not|which)\b/g) || []).length;
  if (fr > en && fr > pt) return "fr";
  if (pt > en) return "pt";
  return "en";
}

const docx = fs.readdirSync(SRC).filter((f) => f.toLowerCase().endsWith(".docx"));
const rows = docx.map((f) => {
  const title = f.replace(/\.docx$/i, "");
  const txtPath = path.join(TXT, `${title}.txt`);
  const text = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf8").trim() : "";
  return {
    title, docxFile: f, text,
    written_at: parseDate(title),
    language: text ? detectLang(text) : null,
    chars: text.length,
    blob_key: null, // set below to the R2 key
  };
}).sort((a, b) => (a.written_at || "0").localeCompare(b.written_at || "0"));

const PID_PREFIX = "patients/__PID__/writings/";

console.log("── John Smith Jr writings ingest ──");
console.log(`docx files : ${docx.length}`);
for (const r of rows) console.log(`  ${(r.written_at||"        ")}  [${r.language||"?"}]  ${r.chars.toString().padStart(6)}c  ${r.title}${r.text?"":"  (EMPTY!)"}`);
const empty = rows.filter((r) => !r.text);
if (empty.length) console.log(`! ${empty.length} empty extractions — investigate`);

if (!APPLY) { console.log("\n(dry run — no DB writes. Re-run with --apply.)"); process.exit(0); }

const sql = neon(loadDatabaseUrl());
const u = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
if (!u.length) { console.error("✗ patient not found"); process.exit(1); }
const pid = u[0].id;

const before = await sql`SELECT count(*)::int n FROM writings WHERE patient_id=${pid}`;
await sql`DELETE FROM writings WHERE patient_id=${pid}`;
for (const r of rows) {
  const blobKey = `patients/${pid}/writings/${r.docxFile}`;
  await sql`INSERT INTO writings (patient_id, title, written_at, language, blob_key, extracted_text)
    VALUES (${pid}, ${r.title}, ${r.written_at}, ${r.language}, ${blobKey}, ${r.text || null})`;
}
const after = await sql`SELECT count(*)::int n, min(written_at) mn, max(written_at) mx FROM writings WHERE patient_id=${pid}`;
console.log(`\nwritings before -> after : ${before[0].n} -> ${after[0].n}  (dated ${after[0].mn} … ${after[0].mx})`);
console.log("✓ writings ingested.");
