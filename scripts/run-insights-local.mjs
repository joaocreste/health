#!/usr/bin/env node
/**
 * Run the AI Insight Update LOCALLY for one patient.
 *
 * Why local: the production path (POST /api/patient-dashboard-build) runs the
 * Opus high-effort generation inside a Cloudflare Pages isolate via
 * ctx.waitUntil, which hits the Pages wall-clock limit on large records
 * (e.g. Silvana's 193-lab history) and dies mid-generation. Running the SAME
 * lib/ai-insights.js pipeline here has no such limit.
 *
 * It calls rebuildAiInsights() — identical assemble -> fill -> opus-4-7
 * (adaptive thinking, effort high) -> validate -> persist as the Worker — so the
 * output and persistence are exactly what the endpoint would have written
 * (cards_json on patient_dashboards, section 'ai-insights', version bumped).
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/run-insights-local.mjs <patient_clerk>
 *   (or put ANTHROPIC_API_KEY in .env). DATABASE_URL is read from .env.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { rebuildAiInsights } from "../lib/ai-insights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}

const CLERK = process.argv[2];
if (!CLERK) { console.error("usage: node scripts/run-insights-local.mjs <patient_clerk>"); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL || fromEnvFile("DATABASE_URL");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || fromEnvFile("ANTHROPIC_API_KEY");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("✗ ANTHROPIC_API_KEY not set (env or .env)"); process.exit(1); }

const sql = neon(DATABASE_URL);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 2 });

(async () => {
  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${CLERK} AND role='patient' AND archived_at IS NULL LIMIT 1`;
  if (!u.length) { console.error(`✗ patient not found: ${CLERK}`); process.exit(1); }
  const pid = u[0].id;
  console.log(`Running AI Insight Update for ${u[0].full_name} (${pid}) …`);
  const t0 = Date.now();
  let ticks = 0;
  const res = await rebuildAiInsights({
    sql, anthropic, patientId: pid,
    currentDate: new Date().toISOString(),
    onTick: () => { if (++ticks % 200 === 0) process.stdout.write("."); },
  });
  console.log(`\n✓ done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // read back + validate
  const d = await sql`SELECT cards_json c FROM patient_dashboards WHERE patient_id=${pid} AND section='ai-insights'`;
  const c = d[0].c;
  console.log(`version: ${c.insights_version} · generated_at: ${c.generated_at}`);
  for (const pg of ["physical", "mental", "spiritual"]) {
    const x = c.pages?.[pg] || {};
    console.log(`  ${pg}: attention=${(x.attention_points || []).length} strengths=${(x.strengths || []).length} data_sufficient=${x.data_sufficient}${x.data_available === false ? " data_available=false" : ""}`);
  }
  console.log(`  inline_insights: ${(c.inline_insights || []).length} · cross_domain_links: ${(c.summary?.cross_domain_links || []).length}`);
  console.log(`  headline.en: ${(c.summary?.headline?.en || "").slice(0, 160)}`);
  if (res?.usage) console.log(`  tokens: in=${res.usage.input} out=${res.usage.output}`);
})().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
