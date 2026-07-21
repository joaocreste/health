#!/usr/bin/env node
/**
 * Gate 1 persist for Joao's Reflective Portrait v2 (Mental Reflective Portrait
 * v2 spec): loads the structured items authored from the mental corpus at
 *   .staging/joao-reflective/gate1-items.json   (gitignored - carries PHI)
 * and upserts them into reflective_items with status='pending_review'.
 *
 * Items only render after the operator flips status to 'approved' (Gate 4).
 * distress_flag=true rows are stored for the clinical/resource path and are
 * never rendered as portrait or Evolution content regardless of status.
 *
 * Idempotent: deletes prior rows whose item_key starts with 'joao-v2-', then
 * inserts the staged set. Dry-run by default; pass --apply to write.
 *
 *   node scripts/ingest-joao-reflective.mjs            # dry run
 *   node scripts/ingest-joao-reflective.mjs --apply
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

const STAGED = path.join(root, ".staging", "joao-reflective", "gate1-items.json");
const KEY_PREFIX = "joao-v2-";
const STATUS = "pending_review";

const staged = JSON.parse(fs.readFileSync(STAGED, "utf8"));
const items = staged.items;
const CLERK = staged.patient;

const rows = await sql`select id, full_name from users where clerk_user_id = ${CLERK}`;
if (!rows.length) { console.error(`✗ patient not found for clerk ${CLERK}`); process.exit(1); }
const patientId = rows[0].id;

const bySource = {}, byQuad = {}, byCat = {};
let flagged = 0, dated = 0;
for (const it of items) {
  bySource[it.source] = (bySource[it.source] || 0) + 1;
  byQuad[it.quadrant] = (byQuad[it.quadrant] || 0) + 1;
  byCat[it.category] = (byCat[it.category] || 0) + 1;
  if (it.distress_flag) flagged++;
  if (it.source_meta?.entry_date) dated++;
}
console.log(`Patient   : ${rows[0].full_name} (${patientId})`);
console.log(`Items     : ${items.length} (${flagged} distress-flagged, ${dated} dated / ${items.length - dated} undated)`);
console.log(`By source : ${JSON.stringify(bySource)}`);
console.log(`By quadrant: ${JSON.stringify(byQuad)}`);
console.log(`By category: ${JSON.stringify(byCat)}`);

if (!APPLY) {
  const existing = await sql`select count(*)::int n from reflective_items where patient_id = ${patientId} and item_key like ${KEY_PREFIX + "%"}`;
  console.log(`\nExisting joao-v2 rows: ${existing[0].n}`);
  console.log("DRY RUN - pass --apply to write.");
  process.exit(0);
}

const del = await sql`delete from reflective_items where patient_id = ${patientId} and item_key like ${KEY_PREFIX + "%"} returning id`;
let inserted = 0;
for (const it of items) {
  await sql`
    insert into reflective_items (patient_id, item_key, source, source_meta, quadrant, category,
                                  content_en, content_pt, evidence, distress_flag, sort_rank, status)
    values (${patientId}, ${it.item_key}, ${it.source}, ${JSON.stringify(it.source_meta)}, ${it.quadrant},
            ${it.category}, ${it.content_en}, ${it.content_pt}, ${it.evidence}, ${it.distress_flag},
            ${it.sort_rank}, ${STATUS})`;
  inserted++;
}
console.log(`\n✓ deleted ${del.length} prior row(s); inserted ${inserted} rows with status='${STATUS}'`);

await markSourceWritten(sql, patientId, { writer: "ingest-joao-reflective" });

// Blocking read-back proof (spec Gate 1): counts from the DB, not from the file.
const chk = await sql`select source, quadrant, category, count(*)::int n,
                             count(*) filter (where distress_flag)::int flagged,
                             count(*) filter (where source_meta->>'entry_date' is not null)::int dated
                      from reflective_items
                      where patient_id = ${patientId} and item_key like ${KEY_PREFIX + "%"}
                      group by 1,2,3 order by 1,2,3`;
console.table(chk);
const fl = await sql`select item_key, left(content_en, 70) label from reflective_items
                     where patient_id = ${patientId} and item_key like ${KEY_PREFIX + "%"} and distress_flag
                     order by sort_rank`;
console.log("Distress-flagged rows (clinical path only):");
fl.forEach(r => console.log("  ", r.item_key, "-", r.label));
