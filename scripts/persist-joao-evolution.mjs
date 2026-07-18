#!/usr/bin/env node
/**
 * Reflective v2 Gate 1b persist (operator-approved dimensions, rubric and
 * chapter names, 2026-07-17): stores the Evolution payload - epochs, dimension
 * rubric, score matrix, chapters, then/now pairs - in
 * patient_dashboards (section='evolution', cards_json) for Joao.
 *
 * The stored rubric governs all future scoring runs (calibration check
 * against two re-scored epochs before any republish). Source of truth file:
 * .staging/joao-reflective/gate1b-evolution.json (gitignored - PHI).
 * Idempotent upsert on (patient_id, section).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const sql = neon(process.env.DATABASE_URL || fromEnv("DATABASE_URL"));

const PID = "d984faba-4a3a-45ff-9ef2-fd52606a02d3";
const payload = JSON.parse(fs.readFileSync(path.join(root, ".staging", "joao-reflective", "gate1b-evolution.json"), "utf8"));
const summary = "Reflective Portrait v2 Evolution - 6 corpus-derived dimensions, six 2-year bins (2019-22 gap), 3 operator-approved chapters, 4 then/now pairs. Rubric persisted; future runs must calibrate against it.";

const del = await sql`delete from patient_dashboards where patient_id = ${PID} and section = 'evolution' returning generated_at`;
const ins = await sql`
  insert into patient_dashboards (patient_id, section, summary_md, cards_json, model, generated_at)
  values (${PID}, 'evolution', ${summary}, ${JSON.stringify(payload)}, 'claude-fable-5', now())
  returning generated_at`;
console.log(`✓ replaced ${del.length} prior row(s); evolution persisted at ${ins[0].generated_at}`);
const chk = await sql`select length(cards_json::text) chars from patient_dashboards where patient_id = ${PID} and section = 'evolution'`;
console.log(`✓ read-back: ${chk[0].chars} chars in cards_json`);
