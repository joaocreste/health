/**
 * ingest-leo-from-joao.mjs — make Leo Keller an INDEPENDENT, DB-backed patient.
 *
 * Leo was a front-end skin over Patient Zero (Joao) via leo-mode.js. The user
 * wants a "full mirror minus the removed items" in Postgres so a full AI re-run
 * can read his record. Joao's data already lives in the DB, so this clones
 * Joao's rows into Leo's patient_id, applying the Leo deltas:
 *
 *   - imaging: drop the 6 removed studies (cervical MRI, forehead US, CT facial
 *     sinuses, US-guided biopsy, coronary CT, 2022 brain MRI); keep 7.
 *   - medications: Perindopril 4 mg/day only (not Joao's polypharmacy).
 *   - suicidality / overdose / benzodiazepine / AUDIT scrubbed:
 *       * psych: drop the whole risk_protective dimension + any flagged item.
 *       * therapy_*: dropped entirely (every session is crisis-centred).
 *       * writings: drop the 2 crisis writings; extracted_text on the rest is
 *         regenerated from kept (non-suicidal) quotes only.
 *       * procedures: drop the 29-Apr overdose row.
 *       * documents: drop therapy_session docs.
 *   - demographics: DOB 1990-07-17 (Leo).
 *
 * Idempotent: deletes Leo's rows first, then re-clones. Reads DATABASE_URL/.env.
 */
import { Pool, neon, neonConfig } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
neonConfig.webSocketConstructor = globalThis.WebSocket; // Node 25 global WS
const pool = new Pool({ connectionString: env.DATABASE_URL });
const sql = neon(env.DATABASE_URL);
const q = async (text, params = []) => (await pool.query(text, params)).rows;
const J = "d984faba-4a3a-45ff-9ef2-fd52606a02d3"; // Joao (source)
const L = "37fc9137-3597-474b-ad8c-36bdc00657f8"; // Leo  (dest)

const SUI = /suicid|overdose|self-?harm|self-?poison|benzodiazep|diazepam|valium|alprazolam|xanax|29 april 2026|29 abril|29 de abril de 2026|twenty-six pills|26 diazepam|26 pills|no longer care whether i live|i did not care about the consequences|quasi-suicid|despair and suicidal|risk of suicide|risco de suicíd|idea[cç][aã]o suicida|autoles|auto-?les[aã]o|tentativa de suic[ií]dio|AUDIT/i;
const FLAGGED_WRITINGS = new Set(["Crisis_Episode_April_29_2026.txt", "I_Still_Need_You_to_Live.txt"]);

const IMG_FILTER =
  "AND NOT (body_part IN ('cervical_spine','forehead','facial_sinuses','left_frontal_soft_tissue','heart_coronary') " +
  "OR (body_part='brain' AND study_date < '2023-01-01'))";
const PROC_FILTER =
  "AND NOT (lower(coalesce(description,'')||' '||coalesce(notes,'')) LIKE '%overdose%' OR lower(coalesce(description,'')) LIKE '%suicide%')";
const DOC_FILTER = "AND kind <> 'therapy_session'";

// Simple clones (no FK dependents) — [table, extra WHERE filter].
const SIMPLE = [
  ["lab_results", ""], ["vitals_daily", ""], ["hr_readings", ""], ["glucose_points", ""],
  ["pgx_findings", ""], ["ecg_studies", ""], ["ecg_events", ""], ["wheel_of_life_assessments", ""],
  ["imaging_studies", IMG_FILTER], ["patient_procedures", PROC_FILTER], ["documents", DOC_FILTER],
];
const THERAPY = ["therapy_interventions", "therapy_lens_interpretations", "therapy_participants",
  "therapy_period_digests", "therapy_quotes", "therapy_risk_flags", "therapy_sessions",
  "therapy_strengths_growth", "therapy_themes"];

async function colsOf(t) {
  return (await q(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1 AND column_name NOT IN ('id','fts')
    ORDER BY ordinal_position`, [t])).map((r) => r.column_name);
}

async function main() {
  // ── 1. Idempotent cleanup of Leo's rows (FK-safe order) ──
  await q(`DELETE FROM psych_evidence WHERE psych_item_id IN (SELECT id FROM psych_items WHERE patient_id=$1)`, [L]);
  await q(`DELETE FROM psych_items WHERE patient_id=$1`, [L]);
  await q(`DELETE FROM writings WHERE patient_id=$1`, [L]);
  for (const t of THERAPY) { try { await q(`DELETE FROM "${t}" WHERE patient_id=$1`, [L]); } catch (e) {} }
  for (const [t] of SIMPLE) await q(`DELETE FROM "${t}" WHERE patient_id=$1`, [L]);
  await q(`DELETE FROM medications WHERE patient_id=$1`, [L]);
  console.log("cleared Leo's existing rows");

  // ── 2. Simple table clones ──
  for (const [t, filter] of SIMPLE) {
    const cols = await colsOf(t);
    const ins = cols.map((c) => `"${c}"`).join(",");
    const sel = cols.map((c) => (c === "patient_id" ? `'${L}'::uuid` : `"${c}"`)).join(",");
    // uuid PKs get an explicit gen_random_uuid(); serial/bigint PKs are left to
    // their sequence default (omit id entirely).
    const idType = (await q(`SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name='id'`, [t]))[0]?.data_type;
    if (idType === "uuid") {
      await q(`INSERT INTO "${t}" (id,${ins}) SELECT gen_random_uuid(),${sel} FROM "${t}" WHERE patient_id='${J}'::uuid ${filter}`);
    } else {
      await q(`INSERT INTO "${t}" (${ins}) SELECT ${sel} FROM "${t}" WHERE patient_id='${J}'::uuid ${filter}`);
    }
    const n = (await q(`SELECT count(*)::int n FROM "${t}" WHERE patient_id='${L}'::uuid`))[0].n;
    console.log(`${t.padEnd(26)} -> ${n}`);
  }

  // ── 3. Medications: Perindopril only ──
  await q(`INSERT INTO medications (id,patient_id,name,dose,drug_class,status,started_at,frequency,daily_dose_amount,daily_dose_unit,created_at)
    VALUES (gen_random_uuid(), $1, 'Perindopril', '4 mg/day', 'ACE inhibitor', 'active', '2026-05-25', 'once daily', 4, 'mg', now())`, [L]);
  console.log("medications              -> 1 (Perindopril)");

  // ── 4. psych_items + writings + psych_evidence (FK remap, suicidality-scrubbed) ──
  const items = await q(`SELECT id,dimension_id,legacy_anchor,title,synthesis,rank,generated_at,generated_by,created_at
    FROM psych_items WHERE patient_id=$1 AND dimension_id <> 'risk_protective'`, [J]);
  const keptItems = items.filter((it) => !SUI.test((it.synthesis || "") + " " + (it.title || "")));
  const itemMap = new Map();
  for (const it of keptItems) {
    const nid = randomUUID(); itemMap.set(it.id, nid);
    await q(`INSERT INTO psych_items (id,patient_id,dimension_id,legacy_anchor,title,synthesis,rank,generated_at,generated_by,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [nid, L, it.dimension_id, it.legacy_anchor, it.title, it.synthesis, it.rank, it.generated_at, it.generated_by, it.created_at]);
  }

  const ev = await q(`SELECT e.*, w.title AS wtitle FROM psych_evidence e
    JOIN psych_items pi ON pi.id=e.psych_item_id
    LEFT JOIN writings w ON w.id=e.writing_id
    WHERE pi.patient_id=$1`, [J]);
  const keptEv = ev.filter((e) => itemMap.has(e.psych_item_id) && !SUI.test(e.quote || "")
    && !(e.wtitle && FLAGGED_WRITINGS.has(e.wtitle)));

  const keptWritingIds = new Set(keptEv.map((e) => e.writing_id).filter(Boolean));
  const writings = await q(`SELECT id,title,written_at,language,blob_key,created_at FROM writings WHERE patient_id=$1`, [J]);
  const keptWritings = writings.filter((w) => keptWritingIds.has(w.id) && !FLAGGED_WRITINGS.has(w.title));
  const wMap = new Map();
  const quotesByWriting = new Map();
  for (const e of keptEv) {
    if (!e.writing_id) continue;
    const arr = quotesByWriting.get(e.writing_id) || []; arr.push(e); quotesByWriting.set(e.writing_id, arr);
  }
  for (const w of keptWritings) {
    const nid = randomUUID(); wMap.set(w.id, nid);
    const qs = (quotesByWriting.get(w.id) || [])
      .sort((a, b) => (a.source_paragraph || "").localeCompare(b.source_paragraph || "") || (a.rank || 0) - (b.rank || 0));
    const seen = new Set(); const passages = [];
    for (const e of qs) { const tt = (e.quote || "").trim(); if (tt && !seen.has(tt)) { seen.add(tt); passages.push(tt); } }
    const text = passages.length
      ? `[Cited passages from "${w.title}" — ${passages.length} excerpt(s) referenced in the record.]\n\n` + passages.join("\n\n")
      : null;
    await q(`INSERT INTO writings (id,patient_id,title,written_at,language,blob_key,extracted_text,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [nid, L, w.title, w.written_at, w.language, w.blob_key, text, w.created_at]);
  }

  let evN = 0;
  for (const e of keptEv) {
    const newItem = itemMap.get(e.psych_item_id);
    const newWriting = e.writing_id ? wMap.get(e.writing_id) : null;
    if (e.writing_id && !newWriting) continue;
    await q(`INSERT INTO psych_evidence (id,psych_item_id,writing_id,quote,source_filename,source_paragraph,is_translated,original_language,rank,created_at)
      VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [newItem, newWriting, e.quote, e.source_filename, e.source_paragraph, e.is_translated, e.original_language, e.rank, e.created_at]);
    evN++;
  }
  console.log(`psych_items              -> ${keptItems.length} (dropped ${items.length - keptItems.length} flagged + all risk_protective)`);
  console.log(`writings                 -> ${keptWritings.length}`);
  console.log(`psych_evidence           -> ${evN}`);

  // ── 5. Demographics ──
  await q(`UPDATE patient_profiles SET date_of_birth='1990-07-17', native_language='en', country_of_residence='FR', updated_at=now() WHERE user_id=$1`, [L]);
  console.log("patient_profiles         -> DOB 1990-07-17, en, FR");

  // ── 6. Sanity: no suicidality leaked into Leo's text columns ──
  const leak = await q(`
    SELECT 'psych_items' src, count(*)::int n FROM psych_items WHERE patient_id=$1 AND (synthesis ILIKE '%suicid%' OR synthesis ILIKE '%overdose%' OR synthesis ILIKE '%benzodiazep%')
    UNION ALL SELECT 'psych_evidence', count(*)::int FROM psych_evidence e JOIN psych_items pi ON pi.id=e.psych_item_id WHERE pi.patient_id=$1 AND (e.quote ILIKE '%suicid%' OR e.quote ILIKE '%overdose%')
    UNION ALL SELECT 'writings', count(*)::int FROM writings WHERE patient_id=$1 AND (extracted_text ILIKE '%suicid%' OR extracted_text ILIKE '%overdose%' OR extracted_text ILIKE '%benzodiazep%')
    UNION ALL SELECT 'imaging_removed', count(*)::int FROM imaging_studies WHERE patient_id=$1 AND body_part IN ('cervical_spine','forehead','facial_sinuses','left_frontal_soft_tissue','heart_coronary')
    UNION ALL SELECT 'procedures_od', count(*)::int FROM patient_procedures WHERE patient_id=$1 AND lower(coalesce(description,'')) LIKE '%overdose%'`, [L]);
  console.log("\nLEAK CHECK (all must be 0):");
  console.log(JSON.stringify(leak));
  console.log("\nDONE.");
  await markSourceWritten(sql, L, { writer: "ingest-leo-from-joao" });
  await pool.end();
}
main().catch(async (e) => { console.error(e); try { await pool.end(); } catch {} process.exit(1); });
