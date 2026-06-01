#!/usr/bin/env node
/**
 * Wave 2 — blood/urine labs for Patient Zero.
 * Parses the 83-marker / 13-panel Albert Einstein report embedded in
 * web/physical-exams.html (structured .lab-test markup) into lab_results rows.
 *
 *   node scripts/parse-joao-labs.mjs            # dry run — prints all parsed rows
 *   node scripts/parse-joao-labs.mjs --apply
 */
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.LUMEN_BASE || "https://lumenhealth.io";
const ADMIN = process.env.LUMEN_ADMIN_CLERK || "pending:admin";
const CLERK = "pending:joao";
const TAKEN_AT = "2026-05-20";
const LAB = "Albert Einstein";
const DOCTOR = "Dr. Eduardo Tisher";

const decode = (s) => (s == null ? s : String(s)
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " "));

// Brazilian number formatting: "," is decimal, "." is thousands — but the
// value field also uses "." as decimal for small numbers (13.8). Resolve:
function brNum(s) {
  if (s == null) return null;
  s = String(s).trim();
  if (!s || !/[0-9]/.test(s)) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", "."); // 3.600,5 -> 3600.5 ; 4,59 -> 4.59
  else {
    const m = s.match(/^\d+\.(\d+)$/);
    if (m && m[1].length === 3) s = s.replace(/\./g, ""); // 3.600 -> 3600 (thousands), but 13.8 stays
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

// A token like "2.316" is structurally ambiguous (decimal 2.316 vs thousands 2316).
// Disambiguate against the reference range when available.
function resolveValue(raw, refLow, refHigh) {
  if (raw == null) return null;
  raw = String(raw).trim();
  if (!/^\d{1,3}\.\d{3}$/.test(raw)) return brNum(raw); // not ambiguous
  const dec = parseFloat(raw);
  const thou = parseFloat(raw.replace(/\./g, ""));
  if (refLow != null || refHigh != null) {
    const lo = (refLow ?? 0) * 0.5, hi = (refHigh ?? thou) * 2;
    const inRange = (v) => v >= lo && v <= hi;
    if (inRange(thou) && !inRange(dec)) return thou;
    if (inRange(dec) && !inRange(thou)) return dec;
  }
  return dec; // default to decimal when refs don't disambiguate
}

const html = fs.readFileSync(new URL("../web/physical-exams.html", import.meta.url), "utf8");

// Panel boundaries: name + char offset.
const panels = [];
const pRe = /<span class="lab-panel-title"><span class="lang-en">([^<]+)<\/span>/g;
let pm;
while ((pm = pRe.exec(html))) panels.push({ name: decode(pm[1].replace(/\s+/g, " ").trim()), at: pm.index });
const panelFor = (idx) => {
  let name = null;
  for (const p of panels) { if (p.at <= idx) name = p.name; else break; }
  return name;
};

const PILL_FLAG = { ok: null, watch: "watch", flag: "flag", info: null };

const rows = [];
const tRe = /<div class="lab-test (lab-test-[a-z]+)">([\s\S]*?)(?=<div class="lab-test |<\/div>\s*<\/details>|<details |$)/g;
let tm;
while ((tm = tRe.exec(html))) {
  const block = tm[2];
  const at = tm.index;
  const nameM = block.match(/<div class="lab-test-name">([\s\S]*?)<\/div>/);
  if (!nameM) continue;
  const marker = decode(nameM[1]
    .replace(/<span class="lang-pt">[\s\S]*?<\/span>/g, "")
    .replace(/<span class="lab-name-pt">[\s\S]*?<\/span>/g, "")
    .replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  if (!marker) continue;
  const valM = block.match(/<span class="lab-val-num">([^<]*)<\/span>/);
  const unitM = block.match(/<span class="lab-val-unit">([^<]*)<\/span>/);
  const minM = block.match(/min\s*([0-9.,]+)/);
  const maxM = block.match(/max\s*([0-9.,]+)/);

  const ref_low = minM ? brNum(minM[1]) : null;
  const ref_high = maxM ? brNum(maxM[1]) : null;

  const rawVal = valM ? decode(valM[1].trim()) : null;
  let value = null, value_text = null;
  if (rawVal && /[<>]/.test(rawVal)) value_text = rawVal;            // "> 60", "< 0.21"
  else { value = resolveValue(valM ? valM[1].trim() : null, ref_low, ref_high); if (value === null && rawVal) value_text = rawVal; } // qualitative

  // Directional flag strictly from value vs reference range.
  let flag = null;
  if (value !== null && ref_low !== null && value < ref_low) flag = "L";
  else if (value !== null && ref_high !== null && value > ref_high) flag = "H";

  rows.push({
    panel: panelFor(at),
    marker,
    value,
    value_text,
    unit: unitM ? decode(unitM[1].trim()) : null,
    ref_low,
    ref_high,
    flag,
    taken_at: TAKEN_AT,
    laboratory: LAB,
    requesting_doctor: DOCTOR,
  });
}

console.log(`parsed ${rows.length} lab markers across ${new Set(rows.map((r) => r.panel)).size} panels`);
console.log(`flagged: ${rows.filter((r) => r.flag).length}`);
for (const r of rows) {
  console.log(`  [${r.panel || "?"}] ${r.marker} = ${r.value ?? r.value_text} ${r.unit || ""} (ref ${r.ref_low}–${r.ref_high})${r.flag ? " *" + r.flag : ""}`);
}

if (!APPLY) { console.log("\n(dry run — pass --apply to POST)"); process.exit(0); }

const resp = await fetch(`${BASE}/api/admin/seed-clinical`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Viewer-Clerk": ADMIN },
  body: JSON.stringify({ patient_clerk: CLERK, table: "lab_results", rows }),
});
console.log(resp.status, (await resp.text()).slice(0, 300));
