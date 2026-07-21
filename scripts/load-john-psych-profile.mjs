#!/usr/bin/env node
/**
 * Load John Smith Jr's psychological profile (built by the Opus synthesis pass
 * over his writings corpus) into psych_items + psych_evidence + life_events.
 *
 * Source: .staging/john-writings/PROFILE.json  { archetype, psych_items[], life_events[] }
 * Full replacement of THIS patient's psych_items (cascades psych_evidence) and
 * life_events — the writings folder is the authoritative source (option i).
 *
 * The Jungian archetype is stored as the rank-0 psych_item under 'identity'.
 * Evidence quotes link to the psych_item and (by title) to the writings row.
 * life_events with no date in the source get a defensible coarse anchor, marked
 * "(approx)" in the description — never a fabricated precise date.
 *
 * Usage: node scripts/load-john-psych-profile.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
const CLERK = "pending:john-smith-jr-dbef5f";
const GENBY = "llm:opus-4-8";
const PROFILE = path.join(root, ".staging", "john-writings", "PROFILE.json");

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  return fs.readFileSync(path.join(root, ".env"), "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}

// Coarse anchors for the 7 undatable life events (transparently marked approx).
// Birth is exact (known DOB); the rest are defensible era anchors, NOT precise claims.
const DATE_OVERRIDES = {
  "Born in Brazil to Italian-descended families": { d: "1992-10-17", approx: false },
  "Discovered absolute pitch; began piano (~age 5)": { d: "1997-01-01", approx: true },
  "Bullied through much of childhood": { d: "2002-01-01", approx: true },
  "Married Leticia ('Le')": { d: "2020-01-01", approx: true },
  "Couples counseling (Sociedade Crista de Psicologia)": { d: "2023-01-01", approx: true },
  "Divorce from Leticia": { d: "2024-06-01", approx: true },
  "Began ESCP MBA (Paris + London cohorts)": { d: "2024-09-01", approx: true },
};

const prof = JSON.parse(fs.readFileSync(PROFILE, "utf8"));
const a = prof.archetype || {};

// Archetype -> rank-0 identity item.
const archetypeItem = {
  dimension_id: "identity",
  title: `Jungian archetype: ${a.primary_en}`,
  synthesis: `${a.summary_en}\n\nShadow: ${a.shadow_en}.` +
    (a.primary_pt ? `\n\n[PT] Arquetipo: ${a.primary_pt}. ${a.summary_pt || ""}` : ""),
  rank: 0,
  evidence: [],
};
const items = [archetypeItem, ...prof.psych_items];

const events = prof.life_events.map((e) => {
  let d = e.occurred_on, approx = e.date_precision === "year" || e.date_precision === "month";
  if (!d) { const o = DATE_OVERRIDES[e.title]; d = o ? o.d : null; approx = o ? o.approx : true; }
  let desc = e.description || "";
  if (approx && !/approx/i.test(desc)) desc += (desc ? " " : "") + "(date approximate)";
  return { ...e, occurred_on: d, description: desc };
}).filter((e) => e.occurred_on);
const dropped = prof.life_events.length - events.length;

console.log("── John psych profile load ──");
console.log(`archetype   : ${a.primary_en}`);
console.log(`psych_items : ${items.length} (incl. archetype)`);
console.log(`evidence    : ${items.reduce((s, i) => s + (i.evidence?.length || 0), 0)} quotes`);
console.log(`life_events : ${events.length}${dropped ? ` (dropped ${dropped} undatable)` : ""}`);

if (!APPLY) { console.log("\n(dry run — no DB writes. Re-run with --apply.)"); process.exit(0); }

const sql = neon(loadDatabaseUrl());
const u = await sql`SELECT id FROM users WHERE clerk_user_id=${CLERK} AND archived_at IS NULL LIMIT 1`;
if (!u.length) { console.error("✗ patient not found"); process.exit(1); }
const pid = u[0].id;

// writing title -> id (for evidence linkage)
const wr = await sql`SELECT id, title FROM writings WHERE patient_id=${pid}`;
const wid = new Map(wr.map((w) => [w.title.toLowerCase().trim(), w.id]));

// Full replacement (psych_evidence cascades from psych_items).
await sql`DELETE FROM psych_items WHERE patient_id=${pid}`;
await sql`DELETE FROM life_events WHERE patient_id=${pid}`;

// per-dimension rank counter
const rankByDim = {};
let nItems = 0, nEv = 0;
for (const it of items) {
  const rank = it.rank != null ? it.rank : (rankByDim[it.dimension_id] = (rankByDim[it.dimension_id] || 0) + 1);
  const [row] = await sql`
    INSERT INTO psych_items (patient_id, dimension_id, title, synthesis, rank, generated_at, generated_by)
    VALUES (${pid}, ${it.dimension_id}, ${it.title}, ${it.synthesis}, ${rank}, now(), ${GENBY})
    RETURNING id`;
  nItems++;
  const ev = it.evidence || [];
  for (let k = 0; k < ev.length; k++) {
    const e = ev[k];
    const w = e.writing ? wid.get(String(e.writing).toLowerCase().trim()) : null;
    await sql`
      INSERT INTO psych_evidence (psych_item_id, writing_id, quote, source_filename, rank)
      VALUES (${row.id}, ${w || null}, ${e.quote}, ${e.writing ? e.writing + ".docx" : null}, ${k + 1})`;
    nEv++;
  }
}

let nEvents = 0;
for (const e of events) {
  await sql`
    INSERT INTO life_events (patient_id, occurred_on, category, title, description, significance)
    VALUES (${pid}, ${e.occurred_on}::date, ${e.category}, ${e.title}, ${e.description || null}, ${e.significance ?? null})`;
  nEvents++;
}

await markSourceWritten(sql, pid, { writer: "load-john-psych-profile" });

const chk = await sql`SELECT
  (SELECT count(*)::int FROM psych_items WHERE patient_id=${pid}) pi,
  (SELECT count(*)::int FROM psych_evidence pe JOIN psych_items p ON p.id=pe.psych_item_id WHERE p.patient_id=${pid}) ev,
  (SELECT count(*)::int FROM life_events WHERE patient_id=${pid}) le`;
console.log(`\ninserted: psych_items=${nItems} psych_evidence=${nEv} life_events=${nEvents}`);
console.log(`DB check: psych_items=${chk[0].pi} psych_evidence=${chk[0].ev} life_events=${chk[0].le}`);
console.log("✓ psych profile loaded.");
