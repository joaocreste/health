#!/usr/bin/env node
/**
 * Ingest Silvana Aparecida Creste's CURRENT medications + supplements into Neon.
 *
 * Source: Patients/Silvana Creste/medications.csv (operator-provided list,
 *   2026-06-26). The CSV's `dose` column conflates two things: for oral pills it
 *   is the DAILY amount ("10mg/dia" = 10 mg/day), for eye drops it is the
 *   frequency ("3x/dia") or the concentration ("0.3%/dia"). We split those out.
 *
 * Operator confirmations (2026-06-26):
 *   - This CSV is Silvana's COMPLETE current regimen (authoritative active set):
 *     upsert these, and mark any of her existing ACTIVE medications NOT present
 *     here as 'needs-review' (never hard-deleted — discontinued meds have value).
 *     supplements has no status column, so orphan-flagging applies to meds only.
 *   - Write BOTH medications and supplements.
 *   - "Dutosterida 20mg/dia" was an eyeballed daily rounding. True schedule:
 *     50 mg/pill, 3 days/week (= 150 mg/week). Stored as a non-daily schedule
 *     with a clearly-labelled weekly-AVERAGED daily equivalent (150 / 7 = 21.4
 *     mg/day). She does NOT take it every day. 50 mg is far above the standard
 *     0.5 mg dutasteride formulation (likely a compounded hair-loss capsule) —
 *     flagged in the note for verification, kept active per operator.
 *
 * For each medication we persist BOTH what the source literally says (per-unit
 * strength in `dose`, raw schedule in `frequency`) AND the computed TOTAL taken
 * per day (daily_dose_amount + daily_dose_unit):
 *     daily_dose = strength_per_unit x units_per_dose x doses_per_day
 * Eye drops keep their clinical unit (drops/day), not grams.
 *
 * Scope: writes ONLY `medications` and `supplements`, ONLY for this patient.
 *   Idempotent — match on lowercased name; re-running does not duplicate rows.
 *   Applies migration 0010 (daily-dose columns) idempotently before writing.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/ingest-silvana-meds.mjs           # dry run
 *   DATABASE_URL=postgres://... node scripts/ingest-silvana-meds.mjs --apply   # write
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:silvana-creste-18ba19";
const SOURCE = "operator-provided list (Patients/Silvana Creste/medications.csv, 2026-06-26)";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* no .env */ }
  return null;
}

// ── Medications (-> medications) ─────────────────────────────────────────────
const MEDS = [
  {
    name: "Rosuvastatin (Rosucor)",
    dose: "10 mg/tablet", frequency: "1x/day",
    daily_amount: 10, daily_unit: "mg",
    drug_class: "Statin (HMG-CoA reductase inhibitor)", status: "active",
    note: "10 mg x 1 tab x 1/day = 10 mg/day. CSV stated the daily total directly ('10mg/dia'). Source: " + SOURCE + ".",
  },
  {
    name: "Dutasteride (Dutosterida)",
    dose: "50 mg/pill", frequency: "3 days/week (~150 mg/week)",
    daily_amount: 21.4, daily_unit: "mg",
    drug_class: "5-alpha-reductase inhibitor", status: "active",
    note:
      "NON-DAILY schedule: 50 mg/pill taken 3 days/week = 150 mg/week. daily_dose_amount (21.4 mg) is a " +
      "WEEKLY-AVERAGED equivalent (150 / 7), NOT a dose she takes every day — actual schedule is 50 mg on 3 days/week, " +
      "nothing the other 4 days. FLAG: 50 mg is ~100x the standard 0.5 mg dutasteride formulation; likely a compounded " +
      "hair-loss preparation — verify the per-pill strength. Operator confirmed the 50 mg x 3/week schedule. Source: " + SOURCE + ".",
  },
  {
    name: "Tacrolimus ophthalmic (Tacrolimus colirio)",
    dose: "0.3% (concentration as written; usual ophthalmic tacrolimus is 0.03% - verify)", frequency: "1x/day",
    daily_amount: 1, daily_unit: "drops",
    drug_class: "Topical calcineurin inhibitor (immunomodulator), ophthalmic", status: "active",
    note:
      "Eye drop. Frequency read as once daily from the CSV's '/dia'; 1 drop/day assumed (per-eye vs total not specified). " +
      "FLAG: CSV concentration '0.3%' is 10x the usual 0.03% ophthalmic tacrolimus - possible transcription slip, kept as written. Source: " + SOURCE + ".",
  },
  {
    name: "Epithelize (ocular lubricant/healing drops)",
    dose: "ophthalmic lubricant (per-unit strength not stated)", frequency: "3x/day",
    daily_amount: 3, daily_unit: "drops",
    drug_class: "Ocular lubricant / wound-healing eye drop (ophthalmic)", status: "active",
    note: "Eye drop, 3 drops/day (1 drop x 3/day; per-eye vs total not specified). Routed to medications (ophthalmic route), not supplements. Source: " + SOURCE + ".",
  },
  {
    name: "Systane (artificial tears)",
    dose: "ophthalmic lubricant / artificial tears (per-unit strength not stated)", frequency: "5x/day",
    daily_amount: 5, daily_unit: "drops",
    drug_class: "Ocular lubricant / artificial tears (ophthalmic, OTC)", status: "active",
    note: "Eye drop, 5 drops/day (1 drop x 5/day; per-eye vs total not specified). OTC lubricant, routed to medications (ophthalmic route). Source: " + SOURCE + ".",
  },
];

// ── Supplements (-> supplements) ─────────────────────────────────────────────
// supplements has no normalized columns; the daily dose is written as a clean
// string into `dose` (the AI-insights engine reads it fine).
const SUPPS = [
  { name: "Omega-3 + lutein eye supplement (Omega Vision, Essential Nutrition)",
    dose: "2 capsules/day (omega-3 + lutein eye-health supplement; per-unit mg not stated on label)" },
  { name: "Biotin (Biotina, vitamin B7)", dose: "5 mg/day (= 5000 mcg)" },
  { name: "Pantothenic acid (Acido Pantotenico, vitamin B5)", dose: "30 mg/day" },
  { name: "Keratin (Queratina)", dose: "30 mg/day" },
  { name: "Cucumis melo extract (Dimpless)", dose: "50 mg/day (anti-cellulite nutraceutical, melon SOD)" },
  { name: "Orthosilicic acid / silicon (Nutricolin)", dose: "100 mg/day (hair/skin/nails)" },
  { name: "Saw palmetto (Saw Palmeto, Serenoa repens)", dose: "160 mg/day (botanical)" },
  { name: "Magnesium malate (Malato de Magnesio)", dose: "400 mg/day (1 capsule x 400 mg)" },
];

function dailyStr(m) {
  if (m.daily_amount == null) return "— (needs review)";
  return m.daily_amount + " " + m.daily_unit + "/day";
}

function summarize() {
  console.log("── Silvana Aparecida Creste — medications + supplements ──");
  console.log(`patient : ${CLERK}`);
  console.log(`source  : ${SOURCE}`);
  console.log(`scope   : COMPLETE current list (orphan active meds -> needs-review)\n`);
  console.log("MEDICATIONS (-> medications):");
  for (const m of MEDS) {
    console.log(`  • ${m.name.padEnd(46)} ${m.dose.slice(0, 34).padEnd(34)} ${m.frequency.padEnd(24)} -> ${dailyStr(m)}`);
  }
  console.log("\nSUPPLEMENTS (-> supplements):");
  for (const s of SUPPS) console.log(`  • ${s.name.padEnd(58)} ${s.dose}`);
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("\n✗ DATABASE_URL not set."); process.exit(1); }
  const sql = neon(url);

  // Migration 0010 — idempotent daily-dose columns.
  await sql`ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "frequency"         text`;
  await sql`ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "daily_dose_amount" real`;
  await sql`ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "daily_dose_unit"   text`;

  const u = await sql`SELECT id FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;

  const existingMeds = await sql`SELECT id, name, status FROM medications WHERE patient_id = ${pid}`;
  const existingSupps = await sql`SELECT id, name FROM supplements WHERE patient_id = ${pid}`;
  const medByName = new Map(existingMeds.map((r) => [r.name.toLowerCase(), r]));
  const suppByName = new Map(existingSupps.map((r) => [r.name.toLowerCase(), r]));
  const newMedNames = new Set(MEDS.map((m) => m.name.toLowerCase()));

  const queries = [];

  for (const m of MEDS) {
    const ex = medByName.get(m.name.toLowerCase());
    if (ex) {
      queries.push(sql`UPDATE medications SET
        dose=${m.dose}, frequency=${m.frequency}, daily_dose_amount=${m.daily_amount},
        daily_dose_unit=${m.daily_unit}, drug_class=${m.drug_class}, status=${m.status}, note=${m.note}
        WHERE id=${ex.id}`);
    } else {
      queries.push(sql`INSERT INTO medications
        (patient_id, name, dose, frequency, daily_dose_amount, daily_dose_unit, drug_class, status, note)
        VALUES (${pid}, ${m.name}, ${m.dose}, ${m.frequency}, ${m.daily_amount}, ${m.daily_unit},
                ${m.drug_class}, ${m.status}, ${m.note})`);
    }
  }

  // Complete-list semantics: any pre-existing ACTIVE med NOT in this CSV is now
  // unconfirmed -> mark needs-review (never hard-delete).
  let orphaned = 0;
  for (const ex of existingMeds) {
    if (newMedNames.has(ex.name.toLowerCase())) continue;
    if ((ex.status || "").toLowerCase() !== "active") continue;
    orphaned++;
    queries.push(sql`UPDATE medications
      SET status='needs-review',
          note=coalesce(note,'') || ' [auto ${new Date().toISOString().slice(0, 10)}: absent from operator-confirmed complete list (Silvana CSV) — status set needs-review, not deleted.]'
      WHERE id=${ex.id}`);
  }

  for (const s of SUPPS) {
    const ex = suppByName.get(s.name.toLowerCase());
    if (ex) queries.push(sql`UPDATE supplements SET dose=${s.dose} WHERE id=${ex.id}`);
    else queries.push(sql`INSERT INTO supplements (patient_id, name, dose) VALUES (${pid}, ${s.name}, ${s.dose})`);
  }

  await sql.transaction(queries);

  await markSourceWritten(sql, pid, { writer: "ingest-silvana-meds" });

  const meds = await sql`SELECT name, dose, frequency, daily_dose_amount, daily_dose_unit, status
    FROM medications WHERE patient_id=${pid} ORDER BY (status='active') DESC, name ASC`;
  const supps = await sql`SELECT name, dose FROM supplements WHERE patient_id=${pid} ORDER BY name ASC`;
  console.log(`\npatient pid     : ${pid}`);
  console.log(`medications     : ${meds.length} rows (${orphaned} pre-existing active marked needs-review)`);
  console.log(`supplements     : ${supps.length} rows`);
  console.log("\nMedications now on file:");
  for (const m of meds) {
    const d = m.daily_dose_amount == null ? "—" : `${m.daily_dose_amount} ${m.daily_dose_unit}/day`;
    console.log(`  • [${m.status}] ${m.name.padEnd(46)} ${String(m.frequency || "").padEnd(24)} -> ${d}`);
  }
  console.log("✓ Silvana medications + supplements loaded.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
