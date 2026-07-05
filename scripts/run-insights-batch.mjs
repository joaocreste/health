#!/usr/bin/env node
/**
 * Run the AI Insight Update for one or MORE patients via the Message Batches
 * API — 50% off all token usage vs the live path (scripts/run-insights-local.mjs).
 *
 * Trade-off: asynchronous. Most batches complete well within the hour (hard
 * ceiling 24h); this script polls every 60s until done, then persists each
 * patient's payload exactly as the live path would (cards_json on
 * patient_dashboards, section 'ai-insights', version bumped per patient).
 *
 * Failures are per-patient and leave that patient's previous insights intact;
 * rerun any failed patient via the live path:
 *   node scripts/run-insights-local.mjs <patient_clerk>
 *
 * Usage:
 *   node scripts/run-insights-batch.mjs <patient_clerk> [<patient_clerk> ...]
 *   node scripts/run-insights-batch.mjs --all      # every active patient
 *   (ANTHROPIC_API_KEY and DATABASE_URL from env or .env)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { rebuildAiInsightsBatch } from "../lib/ai-insights.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}

const args = process.argv.slice(2);
if (!args.length) {
  console.error("usage: node scripts/run-insights-batch.mjs <patient_clerk> [...] | --all");
  process.exit(1);
}

const DATABASE_URL = process.env.DATABASE_URL || fromEnvFile("DATABASE_URL");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || fromEnvFile("ANTHROPIC_API_KEY");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("✗ ANTHROPIC_API_KEY not set (env or .env)"); process.exit(1); }

const sql = neon(DATABASE_URL);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 4 });

(async () => {
  let patients;
  if (args[0] === "--all") {
    patients = await sql`
      SELECT id, full_name, clerk_user_id FROM users
      WHERE role='patient' AND archived_at IS NULL ORDER BY full_name`;
  } else {
    patients = await sql`
      SELECT id, full_name, clerk_user_id FROM users
      WHERE clerk_user_id = ANY(${args}) AND role='patient' AND archived_at IS NULL`;
    const found = new Set(patients.map((p) => p.clerk_user_id));
    for (const a of args) if (!found.has(a)) console.error(`✗ patient not found (skipping): ${a}`);
  }
  if (!patients.length) { console.error("✗ no patients to run"); process.exit(1); }

  console.log(`Submitting batch AI Insight Update for ${patients.length} patient(s):`);
  for (const p of patients) console.log(`  · ${p.full_name} (${p.clerk_user_id})`);

  const t0 = Date.now();
  const { batchId, outcomes } = await rebuildAiInsightsBatch({
    sql, anthropic,
    patientIds: patients.map((p) => p.id),
    currentDate: new Date().toISOString(),
    onStatus: (s) => {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      if (s.phase === "submitted") console.log(`✓ batch submitted: ${s.batchId} (${s.count} requests) — polling every 60s`);
      else console.log(`  [${mins}m] ${s.status} — processing=${s.counts?.processing} succeeded=${s.counts?.succeeded} errored=${s.counts?.errored}`);
    },
  });

  console.log(`\n✓ batch ${batchId} ended in ${((Date.now() - t0) / 60000).toFixed(1)}m`);
  const nameById = new Map(patients.map((p) => [p.id, p.full_name]));
  let okCount = 0;
  for (const o of outcomes) {
    const name = nameById.get(o.patientId) || o.patientId;
    if (o.ok) {
      okCount++;
      console.log(`  ✓ ${name}: v${o.insights_version} — tokens in=${o.usage.input} out=${o.usage.output} (billed at 50%)`);
    } else {
      console.log(`  ✗ ${name}: ${o.error} — previous insights untouched; rerun live:`);
      const clerk = patients.find((p) => p.id === o.patientId)?.clerk_user_id;
      console.log(`      node scripts/run-insights-local.mjs ${clerk}`);
    }
  }
  console.log(`\n${okCount}/${outcomes.length} patients updated.`);
  process.exit(okCount === outcomes.length ? 0 : 1);
})().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
