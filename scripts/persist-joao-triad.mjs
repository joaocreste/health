#!/usr/bin/env node
/**
 * Reflective v3 Gate 1 persist: stores the clinical-behavioral triad -
 * archetype object (primary/secondary with shadow + evidence), coping loops
 * (functional-analysis units with valence), and per-epoch loop trajectories -
 * in patient_dashboards (section='portrait_triad') for Joao, and upserts
 * joao-v3-* respond-anchor rows in reflective_items (status pending_review;
 * flipped to approved only after the operator approves the archetype and
 * every valence label by name - Gate 4).
 *
 * Source of truth: .staging/joao-reflective/gate1-triad.json (gitignored, PHI).
 * Idempotent. Distress carve-outs are documented in the staging file's
 * `excluded` block and never become loops or anchors.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const sql = neon(process.env.DATABASE_URL || fromEnv("DATABASE_URL"));
const PID = "d984faba-4a3a-45ff-9ef2-fd52606a02d3";
const staged = JSON.parse(fs.readFileSync(path.join(root, ".staging", "joao-reflective", "gate1-triad.json"), "utf8"));

const del = await sql`delete from patient_dashboards where patient_id = ${PID} and section = 'portrait_triad' returning generated_at`;
await sql`insert into patient_dashboards (patient_id, section, summary_md, cards_json, model, generated_at)
  values (${PID}, 'portrait_triad',
          'Reflective v3 triad - archetype (Hero primary / Creator secondary), 7 coping loops with valences, per-epoch loop trajectories. Valence labels render only after named operator approval.',
          ${JSON.stringify(staged)}, 'claude-fable-5', now())`;
console.log(`✓ portrait_triad persisted (replaced ${del.length})`);

// Respond anchors: one per loop + one for the archetype card.
const anchors = [{ key: "joao-v3-archetype", en: "[v3 anchor] Archetype card: The Hero (primary) / The Creator (secondary).", pt: "[Âncora v3] Cartão de arquétipo: O Herói (primário) / O Criador (secundário)." }]
  .concat(staged.loops.map(l => ({
    key: "joao-v3-loop-" + l.id,
    en: `[v3 loop anchor] ${l.label_en} (${l.valence}).`,
    pt: `[Âncora de ciclo v3] ${l.label_pt} (${l.valence}).`
  })));
const delA = await sql`delete from reflective_items where patient_id = ${PID} and item_key like 'joao-v3-%' returning id`;
for (const a of anchors) {
  await sql`insert into reflective_items (patient_id, item_key, source, source_meta, quadrant, category,
                                          content_en, content_pt, evidence, distress_flag, sort_rank, status)
    values (${PID}, ${a.key}, 'ai_synthesis', ${JSON.stringify({ entry_date: staged.generated, date_source: "explicit", confidence: "high", author_name: null, relationship: null, known_duration: null })},
            'emerging', 'texture', ${a.en}, ${a.pt}, null, false, 60, 'pending_review')`;
}
console.log(`✓ ${anchors.length} joao-v3 anchors upserted (replaced ${delA.length}), status=pending_review`);
const chk = await sql`select count(*)::int n from reflective_items where patient_id = ${PID} and item_key like 'joao-v3-%'`;
console.log(`✓ read-back: ${chk[0].n} anchor rows in DB`);
