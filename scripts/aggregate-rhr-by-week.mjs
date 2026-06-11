#!/usr/bin/env node
/* Weekly average resting heart rate, Oura only, for the physical-vitals
   timeline. Source: Neon vitals_daily source='oura' rows (2025-10 ->),
   patient pending:joao. Apple Watch is deliberately excluded — its sparse,
   spot-check resting-HR days made the long timeline noisy and the device
   handover dominated the visual story.

   Days are binned into ISO weeks (Mon-Sun, same Monday-key convention as
   aggregate-bp-by-week.mjs) and averaged.

   Output: single-line const RHR_BY_WEEK ready to paste into web/assets/data.js:
   const RHR_BY_WEEK = [{week:"2025-10-13",n:2,rhr:67},...]; */

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
  SELECT v.day::text AS day, v.resting_hr
  FROM vitals_daily v JOIN users u ON u.id = v.patient_id
  WHERE u.clerk_user_id = ${CLERK} AND v.resting_hr IS NOT NULL
    AND v.source = 'oura'
  ORDER BY v.day`;

const byDay = new Map();
for (const r of rows) byDay.set(r.day, r);

const buckets = new Map(); // weekStart -> [rhr]
for (const [day, r] of byDay) {
  const wk = weekStart(day);
  if (!buckets.has(wk)) buckets.set(wk, []);
  buckets.get(wk).push(Number(r.resting_hr));
}

const out = [...buckets.keys()].sort().map((wk) => {
  const ds = buckets.get(wk);
  return {
    week: wk, n: ds.length,
    rhr: Number((ds.reduce((s, d) => s + d, 0) / ds.length).toFixed(1)),
  };
});

const days = [...byDay.keys()].sort();
const fmt = (r) => `{week:"${r.week}",n:${r.n},rhr:${r.rhr}}`;

console.log(`/* RHR_BY_WEEK — resting HR, weekly mean of Oura daily values (source='oura' only, Apple Watch excluded), ISO weeks (Mon-Sun). ${days[0]} -> ${days[days.length - 1]} · ${out.length} weeks · ${days.length} days. Source: Neon vitals_daily via scripts/aggregate-rhr-by-week.mjs. */`);
console.log(`const RHR_BY_WEEK = [${out.map(fmt).join(',')}];`);
console.error(`\nsample first 3: ${out.slice(0, 3).map(fmt).join(' ')}`);
console.error(`sample last 3 : ${out.slice(-3).map(fmt).join(' ')}`);
console.error(`weeks=${out.length} days=${days.length} window=${days[0]}..${days[days.length - 1]}`);
