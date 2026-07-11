#!/usr/bin/env node
/*
 * insights-coverage-matrix.mjs — Prompt #2c Job A (READ-ONLY).
 *
 * For every active patient x page: does the stored ai-insights dashboard
 * carry the concise summary the assembler's slot 2 renders, and does the
 * patient actually have ingested data for that page's domain?
 *
 * Domain-with-data is computed two ways:
 *   pillar : the product definition handlePatientSummary uses (_worker.js)
 *   record : computeInputCoverage(assembleRecord(...)) — the EXACT rule the
 *            build guarantee enforces (same filters: approved reflective
 *            items, documents by kind, profile measurements).
 *
 * Usage: node scripts/insights-coverage-matrix.mjs   (DATABASE_URL from .env)
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { assembleRecord, computeInputCoverage } from "../lib/ai-insights.js";

function fromEnvFile(key) {
  try {
    const m = readFileSync(new URL("../.env", import.meta.url), "utf8")
      .match(new RegExp(`^${key}=["']?([^"'\n]+)`, "m"));
    return m ? m[1] : null;
  } catch { return null; }
}
const DATABASE_URL = process.env.DATABASE_URL || fromEnvFile("DATABASE_URL");
if (!DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const sql = neon(DATABASE_URL);

/* Product pillar definition (web/_worker.js handlePatientSummary). */
const PILLAR = {
  physical: ["lab_results", "imaging_studies", "medications", "supplements",
    "encounters", "prescriptions", "vitals_daily", "ecg_events", "pgx_findings",
    "surgeries", "injuries", "clinical_history"],
  mental: ["psych_items", "mood_entries", "panic_events", "risk_assessments", "writings"],
  spiritual: ["wheel_of_life_assessments", "life_events"],
};
const ALL_TABLES = [...new Set(Object.values(PILLAR).flat())];

const PAGES = [
  { page: "home", domain: null },
  { page: "physical", domain: "physical" },
  { page: "physical-vitals", domain: "physical" },
  { page: "physical-exams", domain: "physical" },
  { page: "physical-genetics", domain: "physical" },
  { page: "mental", domain: "mental" },
  { page: "spiritual", domain: "spiritual" },
];

const patients = await sql`
  SELECT id, clerk_user_id, full_name FROM users
  WHERE role = 'patient' AND archived_at IS NULL ORDER BY full_name`;

const counts = {}; // counts[table][patient_id] = n
const tableErrors = [];
for (const t of ALL_TABLES) {
  try {
    const rows = await sql(`SELECT patient_id, count(*)::int AS n FROM ${t} GROUP BY 1`);
    counts[t] = Object.fromEntries(rows.map(r => [r.patient_id, r.n]));
  } catch (e) {
    counts[t] = {};
    tableErrors.push(`${t}: ${String(e.message).slice(0, 60)}`);
  }
}

const dashRows = await sql`
  SELECT patient_id, section, generated_at,
         (cards_json IS NOT NULL) AS has_cards, cards_json
  FROM patient_dashboards`;
const dashBy = {};
for (const r of dashRows) (dashBy[r.patient_id] ||= []).push(r);

const hasBoth = o => !!(o && String(o.en || "").trim() && String(o.pt || "").trim());
const domainsOf = (def, pid) =>
  Object.fromEntries(Object.entries(def).map(([d, ts]) =>
    [d, ts.reduce((s, t) => s + (counts[t][pid] || 0), 0)]));

/* Record-derived coverage: the build's own rule, applied to the build's own
   assembled record — cannot diverge from what sanitize enforces. */
async function recordCoverage(pid) {
  return computeInputCoverage(await assembleRecord(sql, pid));
}

const gaps = [];
const W = s => String(s).padEnd(18);
console.log(`\nActive patients: ${patients.length}` +
  (tableErrors.length ? `\nTable errors (counted as 0): ${tableErrors.join("; ")}` : ""));

for (const p of patients) {
  const rows = dashBy[p.id] || [];
  const ai = rows.find(r => r.section === "ai-insights");
  const cj = ai?.cards_json || null;
  const pillar = domainsOf(PILLAR, p.id);
  const cov = await recordCoverage(p.id);
  const record = { physical: cov.physical ? 1 : 0, mental: cov.mental ? 1 : 0, spiritual: cov.spiritual ? 1 : 0 };
  const inline = Array.isArray(cj?.inline_insights) ? cj.inline_insights.length : 0;

  console.log(`\n=== ${p.full_name || "(no name)"} · ${p.clerk_user_id} ===`);
  console.log(`dashboard rows: ${rows.length} (${rows.map(r => r.section).sort().join(", ") || "none"})` +
    ` · ai-insights: ${ai ? "YES" : "NO"}` +
    (ai ? ` · generated_at: ${new Date(ai.generated_at).toISOString().slice(0, 16)}Z · inline cards: ${inline}` : ""));
  console.log(W("page") + W("data(pillar)") + W("data(record)") + W("data_sufficient") + W("summary en+pt") + "GAP?");

  for (const { page, domain } of PAGES) {
    let dataP, dataR, suff, summLabel, summ;
    const isSub = !!(cov.pages && Object.prototype.hasOwnProperty.call(cov.pages, page));
    if (page === "home") {
      dataP = Object.values(pillar).some(n => n > 0);
      dataR = Object.values(record).some(n => n > 0);
      suff = "-";
      summ = hasBoth(cj?.summary?.headline) && hasBoth(cj?.summary?.overview);
      summLabel = summ ? "YES" : "no";
    } else {
      dataP = pillar[domain] > 0;
      dataR = isSub ? !!cov.pages[page] : record[domain] > 0;
      const pg = cj?.pages?.[domain];
      suff = pg ? String(pg.data_sufficient === true) : "no-section";
      /* Depth ladder: a subpage's own page_overviews entry beats the pillar
         fallback; the label shows which one renders. */
      const own = isSub && hasBoth(cj?.page_overviews?.[page]);
      const fb = hasBoth(pg?.overview);
      summ = own || fb;
      summLabel = own ? "YES(page)" : (fb ? "YES(pillar)" : "no");
    }
    const gap = dataR && !summ;
    if (gap) gaps.push({ patient: p.full_name, clerk: p.clerk_user_id, page });
    console.log(W(page) +
      W(page === "home" ? (dataP ? "any:yes" : "any:no") : `${dataP} (${pillar[domain]})`) +
      W(page === "home" ? (dataR ? "any:yes" : "any:no") : String(dataR)) +
      W(suff) + W(summLabel) + (gap ? "<-- GAP" : ""));
  }
}

console.log(`\n${"=".repeat(60)}\nGAP LIST (data present per record-rule, no stored summary): ${gaps.length}`);
for (const g of gaps) console.log(`  ${g.patient} (${g.clerk}) · ${g.page}`);
console.log("");
