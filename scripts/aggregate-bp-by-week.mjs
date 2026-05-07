#!/usr/bin/env node
/* Bin every Withings blood-pressure reading into ISO weeks (Mon-Sun)
   and emit per-week
   [weekStart, count, sysMed, sysMean, sysSd, diaMed, diaMean, diaSd].
   Output is a JS const ready to paste into web/assets/data.js. */

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(
  process.argv[2]
  || '/Users/joaocreste/Claude Agent/Health WebbApp/data/Withings/bp.csv'
);

const txt = fs.readFileSync(SRC, 'utf8');
const lines = txt.split('\n');

/* CSV uses commas; the only quoted field is the header "Heart rate".
   Data rows are: "yyyy-mm-dd hh:mm:ss",hr,sys,dia,
   The leading timestamp is wrapped in double quotes. */
function parseRow(line) {
  if (!line) return null;
  const m = line.match(/^"([^"]+)",([^,]*),([^,]*),([^,]*),/);
  if (!m) return null;
  const ts  = m[1];
  const sys = parseFloat(m[3]);
  const dia = parseFloat(m[4]);
  if (!Number.isFinite(sys) || !Number.isFinite(dia)) return null;
  return { ts, sys, dia };
}

/* Monday-of-week as yyyy-mm-dd. Uses UTC to avoid TZ drift; the input
   timestamps are local-Lisbon but the date portion is what matters. */
function weekStart(yyyy_mm_dd) {
  const [y, m, d] = yyyy_mm_dd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();              // 0=Sun..6=Sat
  const back = (dow === 0) ? 6 : dow - 1;  // distance to Monday
  dt.setUTCDate(dt.getUTCDate() - back);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

const buckets = new Map();
let total = 0;
let firstDay = null;
let lastDay  = null;

for (let i = 1; i < lines.length; i++) {
  const row = parseRow(lines[i]);
  if (!row) continue;
  const day = row.ts.slice(0, 10);
  const wk  = weekStart(day);
  if (!buckets.has(wk)) buckets.set(wk, { sys: [], dia: [] });
  const b = buckets.get(wk);
  b.sys.push(row.sys);
  b.dia.push(row.dia);
  total++;
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

const weeks = [...buckets.keys()].sort();
const rows = weeks.map((wk) => {
  const { sys, dia } = buckets.get(wk);
  const sm = mean(sys),   sM = median(sys),   ss = sd(sys, sm);
  const dm = mean(dia),   dM = median(dia),   ds = sd(dia, dm);
  return [
    wk,
    sys.length,
    Number(sM.toFixed(1)), Number(sm.toFixed(2)), Number(ss.toFixed(2)),
    Number(dM.toFixed(1)), Number(dm.toFixed(2)), Number(ds.toFixed(2)),
  ];
});

const fmt = (r) =>
  `["${r[0]}",${r[1]},${r[2]},${r[3]},${r[4]},${r[5]},${r[6]},${r[7]}]`;

console.log(`/* BP_BY_WEEK — Withings BP, binned by ISO week (Mon-Sun).
   Source: data/Withings/bp.csv
   Window: ${firstDay} → ${lastDay}
   Weeks: ${rows.length} · Total readings: ${total}
   Row format: [weekStart, n, sysMed, sysMean, sysSd, diaMed, diaMean, diaSd] */`);
console.log(`const BP_BY_WEEK = [`);
console.log(rows.map(fmt).map((s, i) => `  ${s}${i < rows.length - 1 ? ',' : ''}`).join('\n'));
console.log(`];`);
