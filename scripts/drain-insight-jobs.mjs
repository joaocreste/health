#!/usr/bin/env node
/**
 * Drain the AI-insight rebuild queue: rebuild insights for every patient whose
 * narrative is STALE — patient_source_watermark.watermark newer than
 * patient_dashboards.built_against_watermark (set by any markSourceWritten call).
 * Rebuilding stamps built_against = current watermark, clearing the "update pending"
 * banner and completing the queued insight_jobs.
 *
 * This is the SELF-HEALING half of the freshness architecture: ingest scripts only
 * ENQUEUE (they can't run the rebuild — it dies on the Cloudflare Pages wall-clock).
 * This runs the SAME lib/ai-insights.js pipeline LOCALLY (no wall-clock limit), so a
 * script-driven ingest converges without a manual rebuild. Intended for hourly cron.
 *
 *   ANTHROPIC_API_KEY=... node scripts/drain-insight-jobs.mjs           # dry run (list stale)
 *   ANTHROPIC_API_KEY=... node scripts/drain-insight-jobs.mjs --apply   # rebuild them
 *   ... --apply --limit 3                                               # cap patients per run
 * DATABASE_URL + ANTHROPIC_API_KEY are read from .env if not in the environment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { neon } from "@neondatabase/serverless";
import { rebuildAiInsights } from "../lib/ai-insights.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = (k) => {
  try { return (fs.readFileSync(path.join(root, ".env"), "utf8").match(new RegExp(`${k}\\s*=\\s*"?([^"\\n]+)"?`)) || [])[1] || null; }
  catch { return null; }
};
const APPLY = process.argv.includes("--apply");
const li = process.argv.indexOf("--limit");
const LIMIT = li >= 0 ? Math.max(1, parseInt(process.argv[li + 1], 10) || 10) : 10;

const DATABASE_URL = process.env.DATABASE_URL || envFile("DATABASE_URL");
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || envFile("ANTHROPIC_API_KEY");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
if (APPLY && !ANTHROPIC_API_KEY) { console.error("✗ ANTHROPIC_API_KEY not set (env or .env)"); process.exit(1); }

const sql = neon(DATABASE_URL);
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY, maxRetries: 4, timeout: 1_800_000 }) : null;

(async () => {
  const stale = await sql`
    SELECT d.patient_id, u.full_name, w.watermark, d.built_against_watermark
    FROM patient_dashboards d
    JOIN patient_source_watermark w ON w.patient_id = d.patient_id
    JOIN users u ON u.id = d.patient_id
    WHERE d.section = 'ai-insights'
      AND (d.built_against_watermark IS NULL OR w.watermark > d.built_against_watermark)
    ORDER BY w.watermark ASC`;

  console.log(`Stale patients (source data newer than narrative): ${stale.length}`);
  for (const p of stale) console.log(`  ${p.full_name}  watermark ${p.watermark} > built ${p.built_against_watermark}`);
  if (!stale.length) { console.log("Nothing to drain."); return; }
  if (!APPLY) { console.log(`\nDRY RUN — re-run with --apply (would rebuild up to ${LIMIT}).`); return; }

  let done = 0, failed = 0;
  for (const p of stale.slice(0, LIMIT)) {
    // Claim a pending job for this patient, or open one for the drain.
    const claimed = await sql`UPDATE insight_jobs SET status='running', stage='draining', updated_at=now()
      WHERE patient_id=${p.patient_id} AND status IN ('queued','running') RETURNING id`;
    if (!claimed.length) {
      await sql`INSERT INTO insight_jobs (patient_id, status, stage) VALUES (${p.patient_id}, 'running', 'draining')`;
    }
    try {
      const t0 = Date.now();
      const res = await rebuildAiInsights({ sql, anthropic, patientId: p.patient_id, currentDate: new Date().toISOString() });
      const ver = res?.insights_version ?? null;
      await sql`UPDATE insight_jobs SET status='succeeded', progress=100, insights_version=${ver}, finished_at=now(), updated_at=now()
        WHERE patient_id=${p.patient_id} AND status='running'`;
      console.log(`✓ ${p.full_name} rebuilt in ${((Date.now() - t0) / 1000).toFixed(0)}s (v${ver})`);
      done++;
    } catch (e) {
      await sql`UPDATE insight_jobs SET status='failed', error=${e.message}, finished_at=now(), updated_at=now()
        WHERE patient_id=${p.patient_id} AND status='running'`;
      console.error(`✗ ${p.full_name}: ${e.message}`);
      failed++;
    }
  }
  console.log(`\nDrained: ${done} rebuilt, ${failed} failed, ${Math.max(0, stale.length - LIMIT)} left for the next run.`);
})().catch((e) => { console.error(e); process.exit(1); });
