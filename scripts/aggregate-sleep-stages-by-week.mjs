#!/usr/bin/env node
/* Bin every Oura night into ISO weeks (Mon-Sun) and emit the weekly average
   composition of sleep stages as % of the night's four-stage sum
   (deep + light + rem + awake — Oura's own total_sleep_duration EXCLUDES
   awake time, so the four-stage sum is the only denominator that closes the
   stack at 100%). Weekly value = mean of per-night percentages (each night
   weighted equally), matching how a reader compares nights.

   Night filter mirrors the SLEEP_BOX boxplot exactly (bin/extract.py):
   type='long_sleep' AND total_sleep_duration >= 3 h.

   Each row also carries tst = weekly mean of Oura's total_sleep_duration in
   hours (the boxplot's "Total" figure — excludes awake), for the companion
   total-sleep timeline.

   Output is a single-line JS const ready to paste into web/assets/data.js:
   const SLEEP_STAGES_BY_WEEK = [{week:"2026-04-27",n:7,deep:14.2,light:52.1,rem:21.4,awake:12.3,tst:7.42},...]; */

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(
  process.argv[2]
  || '/Users/joaocreste/Claude Agent/Health WebbApp/Patients/Joao Victor Creste/Oura/App Data/sleepmodel.csv'
);

/* Monday-of-week as yyyy-mm-dd — same convention as aggregate-bp-by-week.mjs. */
function weekStart(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();              // 0=Sun..6=Sat
  const back = (dow === 0) ? 6 : dow - 1;  // distance to Monday
  dt.setUTCDate(dt.getUTCDate() - back);
  return dt.toISOString().slice(0, 10);
}

const lines = fs.readFileSync(SRC, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
const header = lines[0].split(';');
const col = (name) => header.indexOf(name);
const iDay = col('day'), iType = col('type'), iDeep = col('deep_sleep_duration'),
      iLight = col('light_sleep_duration'), iRem = col('rem_sleep_duration'),
      iAwake = col('awake_time'), iTotal = col('total_sleep_duration');

const buckets = new Map(); // weekStart -> [{deep,light,rem,awake} as % of night]
let nights = 0, firstDay = null, lastDay = null;

for (let i = 1; i < lines.length; i++) {
  const f = lines[i].split(';');
  if (f[iType] !== 'long_sleep') continue;
  const deep = Number(f[iDeep]), light = Number(f[iLight]),
        rem = Number(f[iRem]), awake = Number(f[iAwake]), total = Number(f[iTotal]);
  if (!Number.isFinite(total) || total < 3 * 3600) continue;       // boxplot's ≥3h filter
  const denom = deep + light + rem + awake;
  if (!Number.isFinite(denom) || denom <= 0) continue;
  const day = f[iDay];
  const wk = weekStart(day);
  if (!buckets.has(wk)) buckets.set(wk, []);
  buckets.get(wk).push({
    deep: deep / denom * 100, light: light / denom * 100,
    rem: rem / denom * 100, awake: awake / denom * 100,
    tst: total / 3600,
  });
  nights++;
  if (firstDay === null || day < firstDay) firstDay = day;
  if (lastDay === null || day > lastDay) lastDay = day;
}

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const weeks = [...buckets.keys()].sort();
const rows = weeks.map((wk) => {
  const ns = buckets.get(wk);
  return {
    week: wk, n: ns.length,
    deep:  Number(mean(ns.map((x) => x.deep)).toFixed(1)),
    light: Number(mean(ns.map((x) => x.light)).toFixed(1)),
    rem:   Number(mean(ns.map((x) => x.rem)).toFixed(1)),
    awake: Number(mean(ns.map((x) => x.awake)).toFixed(1)),
    tst:   Number(mean(ns.map((x) => x.tst)).toFixed(2)),
  };
});

const fmt = (r) => `{week:"${r.week}",n:${r.n},deep:${r.deep},light:${r.light},rem:${r.rem},awake:${r.awake},tst:${r.tst}}`;

console.log(`/* SLEEP_STAGES_BY_WEEK — Oura long_sleep nights (>=3h, same filter as SLEEP_BOX), ISO weeks (Mon-Sun). ${firstDay} -> ${lastDay} · ${rows.length} weeks · ${nights} nights · % of (deep+light+rem+awake), weekly mean of per-night %. */`);
console.log(`const SLEEP_STAGES_BY_WEEK = [${rows.map(fmt).join(',')}];`);
console.error(`\nsample first 3: ${rows.slice(0, 3).map(fmt).join(' ')}`);
console.error(`sample last 3 : ${rows.slice(-3).map(fmt).join(' ')}`);
console.error(`weeks=${rows.length} nights=${nights} window=${firstDay}..${lastDay}`);
