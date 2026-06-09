#!/usr/bin/env node
/**
 * Ingest Joao Victor Creste's injuries / surgeries / procedures history into
 * Neon `patient_procedures` (migration 0011).
 *
 * This data previously lived ONLY in static front-end HTML (web/home.html). The
 * loader reads the operator-supplied CSV, normalizes per the ingestion spec, and
 * does a SCOPED, IDEMPOTENT full replace of THIS patient's rows:
 *   DELETE FROM patient_procedures WHERE patient_id=<joao>  then INSERT fresh.
 * (Full replace — not INSERT-OR-IGNORE — so edits and removals in a re-supplied
 * CSV are honoured, not just additions. No other patient is touched.)
 *
 * Input CSV — UTF-8, header row. Delimiter (comma or semicolon) is auto-detected
 * and columns are mapped BY HEADER NAME, so column order does not matter:
 *   DATE, TYPE, DESCRIPTION, LOCATION, NOTES   (any order; TYPE may be plural)
 * The CSV is PHI and lives OUTSIDE git, matching the labs convention:
 *   Patients/Joao Victor Creste/Injuries & Procedures.csv   (default)
 *   CSV=/path/to/file.csv node scripts/ingest-joao-procedures.mjs
 *
 * Usage:
 *   node scripts/ingest-joao-procedures.mjs            # dry run — parse + summary only
 *   node scripts/ingest-joao-procedures.mjs --apply    # create table (if needed) + replace in a txn
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:joao";
const CSV_PATH = process.env.CSV ||
  path.join(root, "Patients/Joao Victor Creste/Injuries & Procedures.csv");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
  return m ? m[1] : null;
}

// ── CSV parse ──────────────────────────────────────────────────────────────
// Semicolon-delimited with optional double-quoted fields (a quoted field may
// contain semicolons / newlines; "" is an escaped quote).
function parseCsv(text, delim = ";") {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  const src = text.replace(/^﻿/, ""); // strip BOM
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c === "\r") { /* ignore */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// ── Date normalization (spec §3) ─────────────────────────────────────────────
// Returns { event_date: 'YYYY-MM-DD'|null, partial: bool, unparseable: bool }.
// Partial dates (YYYY-MM, YYYY) get a sortable event_date but are flagged so the
// front end shows date_raw verbatim. Truly unknown -> event_date NULL.
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };
function normalizeDate(raw) {
  const s = (raw || "").trim();
  // Explicit "no date" sentinels are allowed (spec §2), not parse failures.
  if (!s || /^(unknown|n\/a|na|none|-|\?)$/i.test(s)) return { event_date: null, partial: false, unparseable: false };
  let m;
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/)))          // YYYY-MM-DD
    return { event_date: `${m[1]}-${m[2]}-${m[3]}`, partial: false, unparseable: false };
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)))    // DD/MM/YYYY
    return { event_date: `${m[3]}-${pad(m[2])}-${pad(m[1])}`, partial: false, unparseable: false };
  if ((m = s.match(/^(\d{4})-(\d{2})$/)))                  // YYYY-MM (partial)
    return { event_date: `${m[1]}-${m[2]}-01`, partial: true, unparseable: false };
  if ((m = s.match(/^(\d{1,2})\/(\d{4})$/)))               // MM/YYYY (partial)
    return { event_date: `${m[2]}-${pad(m[1])}-01`, partial: true, unparseable: false };
  if ((m = s.match(/^([A-Za-z]{3,})\.?\s+(\d{4})$/))) {    // "Mar 2012" / "September 2014" (partial)
    const mo = MONTHS[m[1].slice(0, 3).toLowerCase()];
    if (mo) return { event_date: `${m[2]}-${pad(mo)}-01`, partial: true, unparseable: false };
  }
  if ((m = s.match(/^(\d{4})$/)))                          // YYYY (partial)
    return { event_date: `${m[1]}-01-01`, partial: true, unparseable: false };
  return { event_date: null, partial: false, unparseable: true };
}
const pad = (n) => String(n).padStart(2, "0");

// ── TYPE mapping (spec §3.5) ─────────────────────────────────────────────────
const PREFERRED = ["Injury", "Surgery", "Procedure", "Diagnostic", "Hospitalization", "Other"];
// Tolerate plurals / common spellings ("Injuries" -> "Injury", "Op" -> "Surgery").
const TYPE_ALIAS = {
  injuries: "Injury", injury: "Injury",
  surgeries: "Surgery", surgery: "Surgery", surgical: "Surgery", operation: "Surgery", op: "Surgery",
  procedures: "Procedure", procedure: "Procedure",
  diagnostics: "Diagnostic", diagnostic: "Diagnostic",
  hospitalizations: "Hospitalization", hospitalization: "Hospitalization", hospitalisation: "Hospitalization",
};
function mapType(raw) {
  const s = (raw || "").trim();
  if (!s) return { type: "Other", offSet: true };
  const alias = TYPE_ALIAS[s.toLowerCase()];
  if (alias) return { type: alias, offSet: false };
  const hit = PREFERRED.find((p) => p.toLowerCase() === s.toLowerCase());
  return hit ? { type: hit, offSet: false } : { type: s, offSet: true };
}

const nz = (v) => { const t = (v ?? "").trim(); return t.length ? t : null; };

// ── Build normalized row set ─────────────────────────────────────────────────
function buildRows() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`✗ CSV not found: ${CSV_PATH}\n  Provide it (DATE;TYPE;LOCATION;DESCRIPTION;NOTES) or set CSV=…`);
    process.exit(1);
  }
  const text = fs.readFileSync(CSV_PATH, "utf8");
  // Auto-detect delimiter from the header line (comma vs semicolon).
  const firstLine = text.replace(/^﻿/, "").split(/\r?\n/)[0] || "";
  const delim = (firstLine.split(";").length > firstLine.split(",").length) ? ";" : ",";
  const raw = parseCsv(text, delim);
  // Map columns BY HEADER NAME so order/extra columns don't matter.
  const header = (raw.shift() || []).map((h) => (h || "").trim().toLowerCase());
  const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
  const iDate = col("date"), iType = col("type"), iDesc = col("description", "desc"),
        iLoc = col("location"), iNotes = col("notes", "note");
  if (iDate < 0 || iType < 0 || iDesc < 0) {
    console.error(`✗ CSV header must include DATE, TYPE, DESCRIPTION. Found: ${header.join(", ")}`);
    process.exit(1);
  }
  const stats = { received: 0, badDate: [], offSetTypes: new Set(), dropped: 0 };
  const seen = new Set();
  const rows = [];
  for (const r of raw) {
    if (r.every((c) => !c || !c.trim())) continue;               // blank row
    stats.received++;
    const dateRaw = r[iDate], typeRaw = r[iType], descRaw = r[iDesc];
    const locationRaw = iLoc >= 0 ? r[iLoc] : null, notesRaw = iNotes >= 0 ? r[iNotes] : null;
    const description = nz(descRaw);
    if (!description) { stats.dropped++; continue; }             // DESCRIPTION required
    const d = normalizeDate(dateRaw);
    const t = mapType(typeRaw);
    if (t.offSet) stats.offSetTypes.add((typeRaw || "(empty)").trim());
    if (d.unparseable && nz(dateRaw)) stats.badDate.push(`${nz(dateRaw)} — ${description}`);
    const row = {
      event_date: d.event_date,
      date_raw: nz(dateRaw),
      type: t.type,
      location: nz(locationRaw),
      description,
      notes: nz(notesRaw),
    };
    const key = [row.event_date, row.type, (row.location || "").toLowerCase(), row.description.toLowerCase()].join("|");
    if (seen.has(key)) continue;                                 // dedup (spec §3.6)
    seen.add(key);
    rows.push(row);
  }
  // Sort most-recent-first; unknown dates fall to the bottom (spec §3.7).
  rows.sort((a, b) => {
    if (a.event_date && b.event_date) return a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : 0;
    if (a.event_date) return -1;
    if (b.event_date) return 1;
    return 0;
  });
  rows._stats = stats;
  return rows;
}

const rows = buildRows();

function summarize() {
  const s = rows._stats;
  const byType = {};
  for (const r of rows) byType[r.type] = (byType[r.type] || 0) + 1;
  console.log("── Joao Victor Creste · patient_procedures ingest ──");
  console.log(`csv             : ${CSV_PATH}`);
  console.log(`rows received   : ${s.received}`);
  console.log(`rows to insert  : ${rows.length}  (after dedup; ${s.received - rows.length - s.dropped} duplicates, ${s.dropped} dropped for missing description)`);
  console.log(`by type         : ${Object.entries(byType).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  console.log(`unknown/partial : ${rows.filter((r) => !r.event_date).length} unknown-date (sorted last)`);
  if (s.offSetTypes.size) console.log(`TYPE off-set    : ${[...s.offSetTypes].join(", ")}  (stored verbatim — review vs preferred set)`);
  if (s.badDate.length) {
    console.log(`unparseable date: ${s.badDate.length} (stored event_date=NULL, date_raw kept):`);
    for (const b of s.badDate) console.log(`   * ${b}`);
  }
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("✗ DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);

  // Self-apply migration 0011 (idempotent), matching the 0005-0010 precedent.
  await sql`CREATE TABLE IF NOT EXISTS patient_procedures (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_date date, date_raw text, type text NOT NULL,
    location text, description text NOT NULL, notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT patient_procedures_dedup
      UNIQUE NULLS NOT DISTINCT (patient_id, event_date, type, location, description))`;
  await sql`CREATE INDEX IF NOT EXISTS patient_procedures_patient_date_idx
    ON patient_procedures (patient_id, event_date DESC)`;

  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const before = await sql`SELECT count(*)::int n FROM patient_procedures WHERE patient_id=${pid}`;
  const queries = [
    sql`DELETE FROM patient_procedures WHERE patient_id=${pid}`,
    ...rows.map((r) => sql`
      INSERT INTO patient_procedures
        (patient_id, event_date, date_raw, type, location, description, notes)
      VALUES
        (${pid}, ${r.event_date}::date, ${r.date_raw}, ${r.type}, ${r.location}, ${r.description}, ${r.notes})`),
  ];
  await sql.transaction(queries);
  const after = await sql`SELECT count(*)::int n, min(event_date) mn, max(event_date) mx FROM patient_procedures WHERE patient_id=${pid}`;
  console.log(`\npatient pid : ${pid}`);
  console.log(`patient_procedures before -> after : ${before[0].n} -> ${after[0].n}  (${after[0].mn} … ${after[0].mx})`);
  console.log("✓ Joao patient_procedures loaded (scoped full replace). No other patient touched.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply once the CSV is in place.)");
