#!/usr/bin/env node
/* Bin every Oura heart-rate reading into one of 288 five-minute slots
   of the local Europe/London day, then emit per-slot
   [count, median, mean, sd]. Output is a JS const ready to paste into
   web/assets/data.js. */

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(
  process.argv[2]
  || '/Users/joaocreste/Claude Agent/Health WebbApp/data/Oura/App Data/heartrate.csv'
);

const txt = fs.readFileSync(SRC, 'utf8');
const lines = txt.split('\n');

const N = 288;
const slots = Array.from({ length: N }, () => []);

// Europe/London DST boundaries that fall inside the export window.
// Last Sunday of October at 01:00 UTC → BST ends.
// Last Sunday of March  at 01:00 UTC → BST begins.
const BST_END_2025   = Date.UTC(2025, 9, 26, 1, 0, 0);  // Oct 26 2025 01:00 UTC
const BST_START_2026 = Date.UTC(2026, 2, 29, 1, 0, 0);  // Mar 29 2026 01:00 UTC

let total = 0;
let firstDay = null;
let lastDay  = null;

for (let i = 1; i < lines.length; i++) {
  const line = lines[i];
  if (!line || line[0] === '#') continue;
  const s1 = line.indexOf(';');
  const s2 = line.indexOf(';', s1 + 1);
  if (s1 < 0 || s2 < 0) continue;
  const ts  = line.slice(0, s1);
  const bpm = parseInt(line.slice(s1 + 1, s2), 10);
  if (!Number.isFinite(bpm)) continue;

  const utcMs = Date.parse(ts);
  if (!Number.isFinite(utcMs)) continue;

  let offsetMin;
  if      (utcMs <  BST_END_2025)   offsetMin = 60;  // BST
  else if (utcMs <  BST_START_2026) offsetMin =  0;  // GMT
  else                              offsetMin = 60;  // BST

  const local = new Date(utcMs + offsetMin * 60_000);
  const h = local.getUTCHours();
  const m = local.getUTCMinutes();
  const k = Math.floor((h * 60 + m) / 5);
  if (k >= 0 && k < N) slots[k].push(bpm);

  total++;
  const day = ts.slice(0, 10);
  if (firstDay === null || day < firstDay) firstDay = day;
  if (lastDay  === null || day > lastDay)  lastDay  = day;
}

const median = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = (a) => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const sd   = (a, m) => {
  if (a.length < 2) return 0;
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
  return Math.sqrt(v);
};

const out = [];
for (let i = 0; i < N; i++) {
  const a = slots[i];
  if (a.length === 0) { out.push([0, null, null, 0]); continue; }
  const me = mean(a);
  const md = median(a);
  const s  = sd(a, me);
  out.push([a.length, Math.round(md), Number(me.toFixed(2)), Number(s.toFixed(2))]);
}

let body = '';
for (let i = 0; i < N; i++) {
  const [n, md, m, s] = out[i];
  body += `  [${n},${md ?? 'null'},${m ?? 'null'},${s}]${i < N - 1 ? ',' : ''}\n`;
}

console.log(`/* HR_BY_TOD — Oura wrist-band heart-rate, binned by local-London time of day.
   Source: data/Oura/App Data/heartrate.csv
   Window: ${firstDay} → ${lastDay}
   Total readings: ${total.toLocaleString('en-US')}
   Slots: ${N} × 5-min · row format: [count, median_bpm, mean_bpm, sd_bpm] */`);
console.log(`const HR_BY_TOD = [`);
process.stdout.write(body);
console.log(`];`);
