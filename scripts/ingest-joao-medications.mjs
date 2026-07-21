#!/usr/bin/env node
/**
 * Medication ingest for Patient Zero (Joao Victor Creste, pending:joao) into Neon.
 *
 * Source: Patients/Joao Victor Creste/medications.csv — a patient-confirmed list
 * of CURRENT medications, each line giving the TOTAL amount taken per day. The CSV
 * states daily totals directly (e.g. "Valium,32.5mg/day"), so the daily dose is the
 * source figure; per-unit strength and frequency are NOT broken out in the source
 * and are therefore left null rather than fabricated.
 *
 * Writes structured rows to `medications`:
 *   dose                -> source-faithful literal string ("1000mg/day")
 *   frequency           -> null (source gives a daily total, not a schedule)
 *   daily_dose_amount   -> parsed numeric total
 *   daily_dose_unit     -> 'mg' (all five read cleanly in mg)
 *   drug_class, status  -> filled (active)
 *
 * Treated as the patient's COMPLETE current active list: upsert each, and mark any
 * previously-active med absent from the CSV as needs-review. Never hard-deletes.
 * Idempotent: matches on (patient_id + lower(name)) and upserts.
 *
 * Usage:  node scripts/ingest-joao-medications.mjs [--apply]   (dry-run by default)
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
const SOURCE = "Patients/Joao Victor Creste/medications.csv";
// R2 key of the source CSV. Uploaded via the deployed Worker's PUT
// /api/uploads/put (admin viewer) — the endpoint enforces the
// uploads/{patient_id}/ namespace, and neither the deploy token nor the local
// S3 creds can write R2 directly (read-only). Stamped on every row.
const SOURCE_BLOB_KEY = "uploads/d984faba-4a3a-45ff-9ef2-fd52606a02d3/medications/medications.csv";

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

// Parsed + normalized from the CSV. brand = name as written; generic + class added
// from clinical knowledge (drug_class aids the insights engine's polypharmacy reasoning).
const MEDS = [
  { name: "Depakote ER",       generic: "divalproex sodium (extended-release)", dose: "1250mg/day", amount: 1250, unit: "mg", drugClass: "Anticonvulsant / mood stabilizer" },
  { name: "Lyrica",            generic: "pregabalin",                           dose: "325mg/day",  amount: 325,  unit: "mg", drugClass: "Gabapentinoid (anticonvulsant / neuropathic pain)" },
  { name: "Quetiapine",        generic: "quetiapine (Seroquel)",                dose: "50mg/day",   amount: 50,   unit: "mg", drugClass: "Atypical antipsychotic" },
  { name: "Valium",            generic: "diazepam",                             dose: "27.5mg/day", amount: 27.5, unit: "mg", drugClass: "Benzodiazepine" },
  { name: "Revia (Naltrexone)",generic: "naltrexone",                           dose: "50mg/day",   amount: 50,   unit: "mg", drugClass: "Opioid antagonist" },
];

const main = async () => {
  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${CLERK}`;
  if (!u[0]) { console.error("✗ patient not found:", CLERK); process.exit(1); }
  const pid = u[0].id;
  console.log(`Patient: ${u[0].full_name} (${CLERK}) ${pid}`);
  console.log(`Source : ${SOURCE}`);
  console.log(`Mode   : ${APPLY ? "APPLY" : "DRY-RUN"}\n`);

  const existing = await sql`SELECT id, name, status FROM medications WHERE patient_id = ${pid}`;
  const csvNames = new Set(MEDS.map((m) => m.name.toLowerCase()));

  for (const m of MEDS) {
    const note = `Generic: ${m.generic}. Daily total per patient-confirmed list; per-dose strength/frequency not specified in source.`;
    const match = existing.find((e) => e.name.toLowerCase() === m.name.toLowerCase());
    console.log(`${match ? "UPSERT" : "INSERT"}  ${m.name}  ->  ${m.amount} ${m.unit}/day  [${m.drugClass}]`);
    if (!APPLY) continue;
    if (match) {
      await sql`UPDATE medications SET
          name = ${m.name}, dose = ${m.dose}, frequency = ${null},
          daily_dose_amount = ${m.amount}, daily_dose_unit = ${m.unit},
          drug_class = ${m.drugClass}, status = 'active', note = ${note},
          source_blob_key = ${SOURCE_BLOB_KEY}
        WHERE id = ${match.id}`;
    } else {
      await sql`INSERT INTO medications
          (patient_id, name, dose, frequency, daily_dose_amount, daily_dose_unit, drug_class, status, note, source_blob_key)
        VALUES (${pid}, ${m.name}, ${m.dose}, ${null}, ${m.amount}, ${m.unit}, ${m.drugClass}, 'active', ${note}, ${SOURCE_BLOB_KEY})`;
    }
  }

  // Complete-list semantics: any previously-active med not in the CSV -> needs-review (never deleted).
  const orphans = existing.filter((e) => !csvNames.has(e.name.toLowerCase()) && e.status === "active");
  for (const o of orphans) {
    console.log(`NEEDS-REVIEW  ${o.name}  (active in DB, absent from CSV)`);
    if (APPLY) await sql`UPDATE medications SET status = 'needs-review' WHERE id = ${o.id}`;
  }
  if (!orphans.length) console.log("\nNo orphaned active meds — DB set matches the CSV.");
  if (APPLY) await markSourceWritten(sql, pid, { writer: "ingest-joao-medications" });
  console.log(`\n${APPLY ? "✓ Applied." : "Dry-run complete. Re-run with --apply to write."}`);
};

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
