#!/usr/bin/env node
/**
 * Ingest Paulo Silotto Souza's CURRENT medications + supplements into Neon.
 *
 * Source: one photo of his medication boxes, read with vision
 *   (Patients/Paulo Silotto/Medication/WhatsApp Image 2026-06-23 at 19.03.02.jpeg).
 * Three boxes:
 *   1. Exforge HCT (Novartis) — valsartana 320 mg + hidroclorotiazida 25 mg +
 *      besilato de anlodipino 10 mg, comprimidos revestidos, via oral, Rx.
 *      Operator-confirmed: 1 tablet ONCE daily. A 3-active fixed-dose combo —
 *      stored as THREE per-active medication rows (operator's choice), each with
 *      its own structured daily_dose_amount, all noting they are the SAME single
 *      Exforge HCT tablet (not three separate pills).
 *   2. Cloreto de magnésio P.A 500 mg (twell) — "Suplemento alimentar".
 *      Operator-confirmed: 2 caps/day -> 1000 mg/day. -> supplements.
 *   3. Colflex Cúrcuma (Mantecorp) — colágeno tipo II + cúrcuma + vit. C,
 *      "Suplemento alimentar". Operator-confirmed: 1 tablet/day. -> supplements.
 *
 * For each medication we persist BOTH what the box literally says (per-unit
 * strength in `dose`, raw schedule in `frequency`) AND the computed TOTAL taken
 * per day (daily_dose_amount + daily_dose_unit):
 *     daily_dose = strength_per_unit × units_per_dose × doses_per_day
 *
 * Scope: writes ONLY `medications` and `supplements`, ONLY for this patient.
 *   - Additive semantics (operator showed three boxes, not an explicit complete
 *     list): upsert by name; existing rows absent here are left UNTOUCHED.
 *     Paulo currently has 0 meds / 0 supplements, so nothing is orphaned.
 *   - Idempotent — match on lowercased name; re-running does not duplicate rows.
 *
 * Also applies migration 0010 (daily-dose columns) idempotently before writing.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/ingest-paulo-meds.mjs           # dry run
 *   DATABASE_URL=postgres://... node scripts/ingest-paulo-meds.mjs --apply   # write
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
const SOURCE =
  "medication photo (Patients/Paulo Silotto/Medication/WhatsApp Image 2026-06-23 at 19.03.02.jpeg)";

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
// All three rows are the SAME single Exforge HCT tablet (1 tab once daily),
// split per active ingredient. daily = per-unit strength × 1 tab × 1/day.
const COMBO =
  "From the single Exforge HCT (Novartis) fixed-dose combination tablet — 1 tablet ONCE daily " +
  "(valsartana 320 mg + hidroclorotiazida 25 mg + besilato de anlodipino 10 mg). " +
  "Not three separate pills.";
const MEDS = [
  { name: "Valsartan (Exforge HCT)", dose: "320 mg/tablet (in Exforge HCT)", frequency: "1x/day",
    daily_amount: 320, daily_unit: "mg", drug_class: "ARB (angiotensin II receptor blocker)", status: "active",
    note: COMBO + " Valsartan component = 320 mg × 1 tab × 1/day = 320 mg/day. Source: " + SOURCE + "." },
  { name: "Hydrochlorothiazide (Exforge HCT)", dose: "25 mg/tablet (in Exforge HCT)", frequency: "1x/day",
    daily_amount: 25, daily_unit: "mg", drug_class: "Thiazide diuretic", status: "active",
    note: COMBO + " Hydrochlorothiazide component = 25 mg × 1 tab × 1/day = 25 mg/day. Source: " + SOURCE + "." },
  { name: "Amlodipine besylate (Exforge HCT)", dose: "10 mg/tablet (in Exforge HCT)", frequency: "1x/day",
    daily_amount: 10, daily_unit: "mg", drug_class: "Calcium channel blocker (dihydropyridine)", status: "active",
    note: COMBO + " Amlodipine component = 10 mg × 1 tab × 1/day = 10 mg/day. Source: " + SOURCE + "." },
];

// ── Supplements (→ supplements) ─────────────────────────────────────────────
// supplements has no normalized columns; the daily dose is written as a clean
// string into `dose` (the AI-insights engine reads it fine).
const SUPPS = [
  { name: "Magnesium chloride (cloreto de magnésio P.A, twell)",
    dose: "1000 mg/day (2 × 500 mg capsules/day; magnesium chloride salt — elemental Mg not stated on box)" },
  { name: "Collagen type II + curcumin + vitamin C (Colflex Cúrcuma, Mantecorp)",
    dose: "1 tablet/day (per-unit amounts not legible on the box — needs review)" },
];

function dailyStr(m) {
  if (m.daily_amount == null) return m.frequency === "weekly" ? "— (weekly)" : "— (needs review)";
  return m.daily_amount + " " + m.daily_unit + "/day";
}

function summarize() {
  console.log("── Paulo Silotto Souza — medications + supplements ──");
  console.log(`patient : ${CLERK}`);
  console.log(`source  : ${SOURCE}\n`);
  console.log("MEDICATIONS (→ medications):");
  for (const m of MEDS) {
    console.log(`  • ${m.name.padEnd(36)} ${m.dose.padEnd(30)} ${m.frequency.padEnd(8)} -> ${dailyStr(m)}`);
  }
  console.log("\nSUPPLEMENTS (→ supplements):");
  for (const s of SUPPS) console.log(`  • ${s.name.padEnd(56)} ${s.dose}`);
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

  for (const s of SUPPS) {
    const ex = suppByName.get(s.name.toLowerCase());
    if (ex) queries.push(sql`UPDATE supplements SET dose=${s.dose} WHERE id=${ex.id}`);
    else queries.push(sql`INSERT INTO supplements (patient_id, name, dose) VALUES (${pid}, ${s.name}, ${s.dose})`);
  }

  await sql.transaction(queries);

  await markSourceWritten(sql, pid, { writer: "ingest-paulo-meds" });

  const meds = await sql`SELECT name, dose, frequency, daily_dose_amount, daily_dose_unit, status
    FROM medications WHERE patient_id=${pid} ORDER BY (status='active') DESC, name ASC`;
  const supps = await sql`SELECT name, dose FROM supplements WHERE patient_id=${pid} ORDER BY name ASC`;
  console.log(`\npatient pid : ${pid}`);
  console.log(`medications : ${meds.length} rows`);
  console.log(`supplements : ${supps.length} rows`);
  console.log("✓ Paulo medications + supplements loaded.");
}

summarize();
if (APPLY) apply().catch((e) => { console.error("✗ apply failed:", e.message); process.exit(1); });
else console.log("\n(dry run — no DB writes. Re-run with --apply.)");
