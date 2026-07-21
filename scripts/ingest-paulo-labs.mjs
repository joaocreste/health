#!/usr/bin/env node
/**
 * Mirror Paulo Silotto Souza's reconciled lab history into Neon `lab_results`.
 *
 * Paulo is a bespoke front-end patient: his labs RENDER from
 * web/assets/paulo-labs.js. This DB mirror exists ONLY so the AI-insight engine
 * (lib/ai-insights.js, Postgres-only) can see the blood/urine series — see the
 * project memory note "bespoke insights need DB backfill".
 *
 * Source: .staging/paulo-labs/db_rows.json (663 deduped analyte x date rows,
 * reconciled from 26 scanned PDFs; PHI, kept OUTSIDE git like Joao's labs).
 *
 * SCOPED + IDEMPOTENT: deletes ALL of Paulo's lab_results, then re-inserts.
 * No other patient or table is touched.
 *
 *   node scripts/ingest-paulo-labs.mjs            # dry run (counts only)
 *   node scripts/ingest-paulo-labs.mjs --apply    # delete + insert
 *   DATABASE_URL=... node scripts/ingest-paulo-labs.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:paulo-silotto-df3441";
const PAYLOAD = process.env.PAYLOAD ||
  path.join(root, ".staging/paulo-labs/db_rows.json");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    return m ? m[1] : null;
  } catch { return null; }
}

const rows = JSON.parse(fs.readFileSync(PAYLOAD, "utf8"));
const isDay = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "");

const DB = loadDatabaseUrl();
if (!DB) { console.error("No DATABASE_URL (env or .env)."); process.exit(1); }
const sql = neon(DB);

function num(x) { return (x === null || x === undefined || x === "") ? null : Number(x); }

async function main() {
  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} LIMIT 1`;
  if (!u.length) { console.error(`Paulo not found for clerk ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const existing = await sql`SELECT count(*)::int AS n FROM lab_results WHERE patient_id = ${pid}`;
  const clean = rows.filter((r) => isDay(r.taken_at) && (r.value !== null || r.value_text));
  const skipped = rows.length - clean.length;
  const dates = [...new Set(clean.map((r) => r.taken_at))].sort();
  const panels = [...new Set(clean.map((r) => r.panel))];

  console.log(`Patient ${pid}`);
  console.log(`Existing Paulo lab_results: ${existing[0].n}`);
  console.log(`Payload rows: ${rows.length}  insertable: ${clean.length}  skipped(no value): ${skipped}`);
  console.log(`Dates: ${dates.length} (${dates[0]} .. ${dates[dates.length - 1]})`);
  console.log(`Panels: ${panels.length} [${panels.join(", ")}]`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to delete+insert."); return; }

  await sql`DELETE FROM lab_results WHERE patient_id = ${pid}`;
  let n = 0;
  const B = 50;
  for (let i = 0; i < clean.length; i += B) {
    const batch = clean.slice(i, i + B);
    await Promise.all(batch.map((r) => sql`
      INSERT INTO lab_results
        (patient_id, panel, marker, value, value_text, unit, ref_low, ref_high,
         flag, taken_at, laboratory, lab_city, lab_country, requesting_doctor,
         performing_doctor, source_blob_key)
      VALUES
        (${pid}, ${r.panel}, ${r.marker}, ${num(r.value)}, ${r.value_text ?? null},
         ${r.unit ?? null}, ${num(r.ref_low)}, ${num(r.ref_high)}, ${r.flag ?? null},
         ${r.taken_at}, ${r.laboratory ?? null}, ${r.lab_city ?? null},
         ${r.lab_country ?? null}, ${r.requesting_doctor ?? null},
         ${r.performing_doctor ?? null}, ${r.source_blob_key ?? null})`));
    n += batch.length;
  }
  const after = await sql`SELECT count(*)::int AS n FROM lab_results WHERE patient_id = ${pid}`;
  console.log(`\nInserted ${n} rows. Paulo lab_results now: ${after[0].n}`);
  await markSourceWritten(sql, pid, { writer: "ingest-paulo-labs" });
}
main().catch((e) => { console.error(e); process.exit(1); });
