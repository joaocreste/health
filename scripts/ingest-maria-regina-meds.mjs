#!/usr/bin/env node
/**
 * Ingest Maria Regina Coury's CURRENT medications + supplements into Neon.
 *
 * Source: one photo of her medication boxes/strips/bottles
 *   (Patients/Maria Regina Coury/Medication.jpeg), read with vision, PLUS one
 *   typed addition (Mounjaro 10 mg, not pictured). Frequencies confirmed by the
 *   operator: all 1 capsule/day EXCEPT Omega-3 (2/day), Diltiazem (2/day),
 *   Valtrex (2/day) and Mounjaro (10 mg once weekly, subcutaneous).
 *
 * For each medication we persist BOTH what the box literally says (per-unit
 * strength in `dose`, raw schedule in `frequency`) AND the computed TOTAL taken
 * per day (daily_dose_amount + daily_dose_unit):
 *     daily_dose = strength_per_unit × units_per_dose × doses_per_day
 * PRN / weekly / non-daily meds carry a null daily total (Mounjaro: weekly).
 *
 * Scope: writes ONLY `medications` and `supplements`, ONLY for this patient.
 *   - "Complete current list" semantics for medications: upsert the actives by
 *     name; any previously-active med ABSENT from this list is marked
 *     status='needs-review' (NEVER hard-deleted — discontinued meds have value).
 *   - Supplements: upsert by name; existing ones absent here are left untouched.
 *   Idempotent — re-running does not duplicate rows.
 *
 * Also applies migration 0010 (daily-dose columns) idempotently before writing.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/ingest-maria-regina-meds.mjs           # dry run
 *   DATABASE_URL=postgres://... node scripts/ingest-maria-regina-meds.mjs --apply   # write
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:maria-regina-coury-0cfb1b";
const SOURCE = "medication photo (Patients/Maria Regina Coury/Medication.jpeg)";

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    if (m && m[1].trim()) return m[1].trim();
  } catch { /* no .env */ }
  return null;
}

// ── Medications (→ medications) ──────────────────────────────────────────────
// daily = per-unit strength × units/dose × doses/day. Mounjaro is weekly → null.
const MEDS = [
  { name: "Valacyclovir (Valtrex)", dose: "500 mg/tablet", frequency: "2x/day",
    daily_amount: 1000, daily_unit: "mg", drug_class: "Antiviral (guanosine analogue)", status: "active",
    note: "Brand Valtrex (GSK), cloridrato de valaciclovir. 500 mg/tablet × 2/day = 1000 mg/day. Source: " + SOURCE + "." },
  { name: "Diltiazem", dose: "30 mg/tablet", frequency: "2x/day",
    daily_amount: 60, daily_unit: "mg", drug_class: "Calcium channel blocker (non-dihydropyridine)", status: "active",
    note: "EMS generic, cloridrato de diltiazem. 30 mg × 2/day = 60 mg/day. Source: " + SOURCE + "." },
  { name: "Tirzepatide (Mounjaro)", dose: "10 mg/pen", frequency: "weekly",
    daily_amount: null, daily_unit: null, drug_class: "GIP / GLP-1 receptor agonist", status: "active",
    note: "Subcutaneous injection, 10 mg once weekly — no fixed daily total (weekly schedule). Source: typed by operator (not in photo)." },
  { name: "Calcium dobesilate (Dobeven)", dose: "500 mg/capsule", frequency: "1x/day",
    daily_amount: 500, daily_unit: "mg", drug_class: "Vasoprotective / venotonic", status: "active",
    note: "APSEN, dobesilato de cálcio. 500 mg × 1/day = 500 mg/day. Source: " + SOURCE + "." },
  { name: "Clopidogrel", dose: "75 mg/tablet", frequency: "1x/day",
    daily_amount: 75, daily_unit: "mg", drug_class: "Antiplatelet (P2Y12 inhibitor)", status: "active",
    note: "Sandoz generic, bissulfato de clopidogrel. 75 mg × 1/day = 75 mg/day. Source: " + SOURCE + "." },
  { name: "Losartan (Corus)", dose: "25 mg/tablet", frequency: "1x/day",
    daily_amount: 25, daily_unit: "mg", drug_class: "ARB (angiotensin II receptor blocker)", status: "active",
    note: "Aché, losartana potássica. 25 mg × 1/day = 25 mg/day. Source: " + SOURCE + "." },
  { name: "Fluoxetine (Verotina)", dose: "20 mg/tablet", frequency: "1x/day",
    daily_amount: 20, daily_unit: "mg", drug_class: "SSRI antidepressant", status: "active",
    note: "Libbs, cloridrato de fluoxetina. 20 mg × 1/day = 20 mg/day. Source: " + SOURCE + "." },
];

// ── Supplements (→ supplements) ─────────────────────────────────────────────
// supplements has no normalized columns; the daily dose is written as a clean
// string into `dose` (the AI-insights engine reads it fine).
const SUPPS = [
  { name: "Vitamin B12 (mecobalamin, Dozemast)", dose: "1000 mcg/day (1 sublingual tablet/day)" },
  { name: "Omega-3 fish oil (Equaliv)", dose: "2 g/day (2 × 1000 mg caps; 1080 mg EPA + 720 mg DHA/day)" },
  { name: "Vitamin D3 (Nature's Bounty)", dose: "5000 IU/day (125 mcg; 1 softgel/day)" },
  { name: "Magnesium dimalate (BORG)", dose: "1 capsule/day (elemental magnesium per cap not legible — needs review)" },
  { name: "Collagen type II + hyaluronic acid (Condres AH)", dose: "1 capsule/day (40 mg UC-II + 158 mg hyaluronic acid)" },
  { name: "Probiotic — Lactobacillus acidophilus NCFM (Prolive)", dose: "1 capsule/day (1 billion CFU)" },
  { name: "Flaxseed oil (Performance)", dose: "600 mg/day (1 capsule/day)" },
];

function dailyStr(m) {
  if (m.daily_amount == null) return m.frequency === "weekly" ? "— (weekly)" : "— (needs review)";
  return m.daily_amount + " " + m.daily_unit + "/day";
}

function summarize() {
  console.log("── Maria Regina Coury — medications + supplements ──");
  console.log(`patient : ${CLERK}`);
  console.log(`source  : ${SOURCE} (+ Mounjaro typed)\n`);
  console.log("MEDICATIONS (→ medications):");
  for (const m of MEDS) {
    console.log(`  • ${m.name.padEnd(34)} ${m.dose.padEnd(16)} ${m.frequency.padEnd(8)} -> ${dailyStr(m)}`);
  }
  console.log("\nSUPPLEMENTS (→ supplements):");
  for (const s of SUPPS) console.log(`  • ${s.name.padEnd(50)} ${s.dose}`);
}

async function apply() {
  const url = loadDatabaseUrl();
  if (!url) { console.error("\n✗ DATABASE_URL not set. Re-run with DATABASE_URL=postgres://... node scripts/ingest-maria-regina-meds.mjs --apply"); process.exit(1); }
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
  // Complete-list semantics: previously-active meds absent now -> needs-review (never deleted).
  const orphaned = existingMeds.filter((r) => r.status === "active" && !newMedNames.has(r.name.toLowerCase()));
  for (const r of orphaned) {
    queries.push(sql`UPDATE medications SET status='needs-review',
      note=COALESCE(note,'') || ' [absent from latest complete med list — review]' WHERE id=${r.id}`);
  }

  for (const s of SUPPS) {
    const ex = suppByName.get(s.name.toLowerCase());
    if (ex) queries.push(sql`UPDATE supplements SET dose=${s.dose} WHERE id=${ex.id}`);
    else queries.push(sql`INSERT INTO supplements (patient_id, name, dose) VALUES (${pid}, ${s.name}, ${s.dose})`);
  }

  await sql.transaction(queries);

  await markSourceWritten(sql, pid, { writer: "ingest-maria-regina-meds" });

  const meds = await sql`SELECT name, dose, frequency, daily_dose_amount, daily_dose_unit, status
    FROM medications WHERE patient_id=${pid} ORDER BY (status='active') DESC, name ASC`;
  const supps = await sql`SELECT name, dose FROM supplements WHERE patient_id=${pid} ORDER BY name ASC`;
  console.log(`\npatient pid : ${pid}`);
  console.log(`medications : ${meds.length} rows  (${orphaned.length} marked needs-review)`);
  console.log(`supplements : ${supps.length} rows`);
  console.log("✓ Maria Regina medications + supplements loaded.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
