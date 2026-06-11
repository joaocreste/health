#!/usr/bin/env node
/* Weekly average resting heart rate across ALL available data, for the
   physical-vitals timeline. Source: Neon vitals_daily per-device rows
   (apple_health 2018 ->, oura 2025-10 ->), patient pending:joao.

   Per the device hierarchy in lib/vitals-resolve.js, when both sources report
   resting_hr on the same day Oura wins (rank 1) over Apple Watch (rank 2) —
   no blending. Days are then binned into ISO weeks (Mon-Sun, same Monday-key
   convention as aggregate-bp-by-week.mjs) and averaged.

   Each row carries n (days) and src ('oura' | 'apple_watch' | 'mixed') so the
   chart can annotate the device handover instead of letting a source switch
   read as a physiological event.

   Output: single-line const RHR_BY_WEEK ready to paste into web/assets/data.js:
   const RHR_BY_WEEK = [{week:"2018-03-26",n:2,rhr:55.5,src:"apple_watch"},...]; */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { neon } from '@neondatabase/serverless';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLERK = 'pending:joao';

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, '.env'), 'utf8');
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

/* Monday-of-week as yyyy-mm-dd — same convention as aggregate-bp-by-week.mjs. */
function weekStart(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  dt.setUTCDate(dt.getUTCDate() - ((dow === 0) ? 6 : dow - 1));
  return dt.toISOString().slice(0, 10);
}

const sql = neon(loadDatabaseUrl());
const rows = await sql`
  SELECT v.day::text AS day, v.source, v.resting_hr
  FROM vitals_daily v JOIN users u ON u.id = v.patient_id
  WHERE u.clerk_user_id = ${CLERK} AND v.resting_hr IS NOT NULL
    AND v.source IN ('apple_health', 'oura')
  ORDER BY v.day`;

/* Resolve per day: oura beats apple_health (hierarchy rank 1 vs 2). */
const byDay = new Map();
for (const r of rows) {
  const prev = byDay.get(r.day);
  if (!prev || (r.source === 'oura' && prev.source !== 'oura')) byDay.set(r.day, r);
}

const buckets = new Map(); // weekStart -> [{rhr, source}]
for (const [day, r] of byDay) {
  const wk = weekStart(day);
  if (!buckets.has(wk)) buckets.set(wk, []);
  buckets.get(wk).push({ rhr: Number(r.resting_hr), source: r.source });
}

const out = [...buckets.keys()].sort().map((wk) => {
  const ds = buckets.get(wk);
  const srcs = new Set(ds.map((d) => d.source));
  const src = srcs.size > 1 ? 'mixed' : (srcs.has('oura') ? 'oura' : 'apple_watch');
  return {
    week: wk, n: ds.length,
    rhr: Number((ds.reduce((s, d) => s + d.rhr, 0) / ds.length).toFixed(1)),
    src,
  };
});

const days = [...byDay.keys()].sort();
const ouraFrom = out.find((r) => r.src !== 'apple_watch')?.week || null;
const fmt = (r) => `{week:"${r.week}",n:${r.n},rhr:${r.rhr},src:"${r.src}"}`;

console.log(`/* RHR_BY_WEEK — resting HR, weekly mean of resolved per-day values (oura > apple_watch on overlap, lib/vitals-resolve.js hierarchy), ISO weeks (Mon-Sun). ${days[0]} -> ${days[days.length - 1]} · ${out.length} weeks · ${days.length} days · Oura from ${ouraFrom}. Source: Neon vitals_daily via scripts/aggregate-rhr-by-week.mjs. */`);
console.log(`const RHR_BY_WEEK = [${out.map(fmt).join(',')}];`);
console.error(`\nsample first 3: ${out.slice(0, 3).map(fmt).join(' ')}`);
console.error(`sample last 3 : ${out.slice(-3).map(fmt).join(' ')}`);
console.error(`weeks=${out.length} days=${days.length} window=${days[0]}..${days[days.length - 1]} oura-from=${ouraFrom}`);
