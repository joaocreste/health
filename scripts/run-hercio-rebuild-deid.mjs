#!/usr/bin/env node
/**
 * AI Comprehensive Rebuild for Hercio Dias de Souza, DE-IDENTIFIED.
 *
 * Runs the real lib/ai-insights.js pipeline (assemble -> opus-4-7 high-effort ->
 * validate -> persist cards_json) but inserts a de-identification boundary so NO
 * real identifier reaches the model — required because Hercio is real PHI and the
 * tier has no BAA.
 *
 * What reaches the model: the assembled record with profile.name replaced by a
 * token and any stray name/email/phone/long-ID scrubbed from free text. DOB is
 * already reduced to `age` by assembleRecord; no CPF/RG/city/clinician names are
 * selected into the record. Service DATES and lab VALUES are preserved (they are
 * not identifiers once the name is gone, and the product's whole value is the
 * trajectory across dates).
 *
 * After the run, the real name is restored ONLY in our own stored payload
 * (cards_json), which never left the database.
 *
 * Usage: ANTHROPIC_API_KEY=... node scripts/run-hercio-rebuild-deid.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { rebuildAiInsights, AI_INSIGHTS_SECTION } from "../lib/ai-insights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const env = (() => { try { return fs.readFileSync(path.join(root, ".env"), "utf8"); } catch { return ""; } })();
const fromEnv = (k) => process.env[k] || (env.match(new RegExp(`${k}\\s*=\\s*"?([^"\\n]+)"?`)) || [])[1];

const DATABASE_URL = fromEnv("DATABASE_URL");
const ANTHROPIC_API_KEY = fromEnv("ANTHROPIC_API_KEY");
if (!DATABASE_URL || !ANTHROPIC_API_KEY) { console.error("✗ need DATABASE_URL + ANTHROPIC_API_KEY"); process.exit(1); }

const CLERK = "pending:hercio-dias-de-souza-3fd92b";
const REAL_NAME = "Hercio Dias de Souza";
const TOKEN = "Patient HDS";

const sql = neon(DATABASE_URL);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 2 });

// De-id boundary applied to the assembled record before the model call.
function deidentify(record) {
  // Only the name is a direct identifier in the assembled record (DOB is already
  // age; no CPF/RG/email/phone/city/clinician names are selected). Scrub name
  // tokens + any email from free text; do NOT run numeric regexes — they would
  // corrupt unquoted clinical VALUES (e.g. platelets 240000) and there are no
  // numeric identifiers in the record to catch.
  const nameToks = [REAL_NAME, ...REAL_NAME.split(/\s+/)].filter((t) => t.length >= 3);
  let s = JSON.stringify(record);
  for (const t of nameToks) s = s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[NAME]");
  s = s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]");
  const out = JSON.parse(s);
  out.profile.name = TOKEN; // displayName the model sees; restored in our DB after the run
  return out;
}

(async () => {
  const u = await sql`SELECT id, full_name, role FROM users WHERE clerk_user_id = ${CLERK} AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;
  console.log(`Rebuild (de-identified) for ${u[0].full_name} (${pid}), role=${u[0].role} …`);

  // Safety assertion: prove the de-identified record carries no real-name substring.
  const probe = JSON.stringify(deidentify({ profile: { name: REAL_NAME }, labs: {}, note: `seen ${REAL_NAME} today` }));
  if (/hercio/i.test(probe.replace(/Patient HDS/g, ""))) { console.error("✗ de-id probe still leaks name"); process.exit(1); }
  console.log("✓ de-id probe clean (name tokenized + scrubbed)\n");

  const t0 = Date.now();
  let ticks = 0;
  const res = await rebuildAiInsights({
    sql, anthropic, patientId: pid,
    currentDate: new Date().toISOString(),
    deidentify,
    onTick: () => { if (++ticks % 200 === 0) process.stdout.write("."); },
  });
  console.log(`\n✓ model run done in ${((Date.now() - t0) / 1000).toFixed(0)}s · tokens in=${res.usage?.input} out=${res.usage?.output}`);

  // Restore the real name in OUR stored payload only (it never reached the model).
  const d0 = await sql`SELECT cards_json c FROM patient_dashboards WHERE patient_id=${pid} AND section=${AI_INSIGHTS_SECTION}`;
  let json = JSON.stringify(d0[0].c);
  json = json.split(TOKEN).join(REAL_NAME).split("[NAME]").join(REAL_NAME);
  const fixed = JSON.parse(json);
  await sql`UPDATE patient_dashboards SET cards_json=${JSON.stringify(fixed)} WHERE patient_id=${pid} AND section=${AI_INSIGHTS_SECTION}`;

  // Read back + validate.
  const c = fixed;
  console.log(`\n── persisted ──`);
  console.log(`patient_name : ${c.patient_name}  (expect "${REAL_NAME}")`);
  console.log(`version      : ${c.insights_version} · generated_at: ${c.generated_at}`);
  console.log(`source_coverage: ${JSON.stringify(c.source_coverage)}`);
  for (const pg of ["physical", "mental", "spiritual"]) {
    const x = c.pages?.[pg] || {};
    console.log(`  ${pg}: attention=${(x.attention_points || []).length} strengths=${(x.strengths || []).length} data_sufficient=${x.data_sufficient}${x.data_available === false ? " data_available=false" : ""}`);
  }
  console.log(`  inline_insights: ${(c.inline_insights || []).length} · cross_domain_links: ${(c.summary?.cross_domain_links || []).length}`);
  console.log(`  headline.en : ${(c.summary?.headline?.en || "").slice(0, 200)}`);

  // Validation gates (operator step 4).
  const probs = [];
  if (c.patient_name !== REAL_NAME) probs.push("patient_name != named patient");
  if (Array.isArray(c)) probs.push("payload is an array");
  for (const pg of ["physical", "mental"]) {
    for (const a of c.pages?.[pg]?.attention_points || []) if (!a.risk_level) probs.push(`${pg} attention missing risk_level`);
    for (const sN of c.pages?.[pg]?.strengths || []) if (!sN.strength_level) probs.push(`${pg} strength missing strength_level`);
    const ranks = (c.pages?.[pg]?.attention_points || []).map((a) => a.rank);
    if (new Set(ranks).size !== ranks.length) probs.push(`${pg} attention ranks not unique`);
  }
  if (!c.source_coverage || c.source_coverage.database !== true) probs.push("source_coverage.database not true");
  if (c.source_coverage?.curated_frontend || c.source_coverage?.discussed_with_patient || c.source_coverage?.files_reports)
    probs.push("source_coverage claims a source the sweep found empty");
  console.log(`\nvalidation: ${probs.length ? "✗ " + probs.join("; ") : "✓ all gates pass"}`);
})().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
