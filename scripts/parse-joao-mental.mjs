#!/usr/bin/env node
/**
 * Wave 2 — mental: psychological architecture for Patient Zero.
 * Parses web/mental.html (13 dimensions, 84 items, quoted evidence) into
 * psych_items + psych_evidence, and creates the writings the evidence cites so
 * the psych_evidence -> writings FK links resolve.
 *
 *   node scripts/parse-joao-mental.mjs            # dry run
 *   node scripts/parse-joao-mental.mjs --apply
 *
 * Apply order: writings -> psych_items -> psych_evidence (FK + title lookups).
 */
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const BASE = process.env.LUMEN_BASE || "https://lumenhealth.io";
const ADMIN = process.env.LUMEN_ADMIN_CLERK || "pending:admin";
const CLERK = "pending:joao";

// page data-dim short form -> canonical psych_dimensions.id
const DIM = {
  identity: "identity", selfdir: "self_direction", empathy: "empathy", intimacy: "intimacy",
  emoreg: "emotional_regulation", attachment: "attachment_style", beliefs: "core_beliefs",
  defense: "defense_mechanisms", traits: "trait_profile", interp: "interpersonal_patterns",
  devtrauma: "developmental_trauma", currfunc: "current_functioning", risk: "risk_protective",
};

const decode = (s) => (s == null ? s : String(s)
  .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " "));
const clean = (s) => decode(String(s).replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

const html = fs.readFileSync(new URL("../web/mental.html", import.meta.url), "utf8");

const items = [];
const evidence = [];
const writingTitles = new Set();

const panels = html.split('<div class="psych-dim-panel"').slice(1);
for (const panel of panels) {
  const dimM = panel.match(/data-dim="([a-z_]+)"/);
  const dimension_id = DIM[dimM && dimM[1]];
  if (!dimension_id) continue;
  const blocks = panel.split('<div class="psych-item">').slice(1);
  let rank = 0;
  for (const b of blocks) {
    const anchorM = b.match(/id="(psych-\d+-\d+)"/);
    const titleM = b.match(/<h4 class="psych-item-title"[^>]*>([\s\S]*?)<\/h4>/);
    const synthM = b.match(/<p class="psych-synthesis">([\s\S]*?)<\/p>/);
    if (!anchorM || !titleM) continue;
    rank++;
    const legacy_anchor = anchorM[1];
    items.push({
      dimension_id, legacy_anchor,
      title: clean(titleM[1]),
      synthesis: synthM ? clean(synthM[1]) : "",
      rank, generated_by: "llm:opus-4-7",
    });
    // evidence
    const ul = b.match(/<ul class="psych-evidence">([\s\S]*?)<\/ul>/);
    if (!ul) continue;
    const liRe = /<li>([\s\S]*?)<\/li>/g;
    let li, erank = 0;
    while ((li = liRe.exec(ul[1]))) {
      const html_li = li[1];
      const qM = html_li.match(/<span class="quote">([\s\S]*?)<\/span>\s*<span class="citation">/) ||
                 html_li.match(/<span class="quote">([\s\S]*?)<\/span>/);
      const cM = html_li.match(/<span class="citation">([\s\S]*?)<\/span>/);
      if (!qM) continue;
      erank++;
      const is_translated = /translated-marker/.test(html_li) || /\(translated\)/.test(html_li);
      let quote = clean(qM[1]).replace(/^[“"]\s*/, "").replace(/\s*[”"]$/, "");
      const citation = cM ? clean(cM[1]) : "";
      // "Filename.txt, p0001" or "...txt, p0011-0015"
      const ci = citation.match(/^(.*?),\s*(p[0-9-]+)?$/);
      const source_filename = ci ? ci[1].trim() : (citation || null);
      const source_paragraph = ci && ci[2] ? ci[2] : null;
      if (source_filename) writingTitles.add(source_filename);
      evidence.push({
        legacy_anchor, quote, source_filename, source_paragraph,
        writing_title: source_filename, is_translated, rank: erank,
      });
    }
  }
}

// Writings rows from the distinct cited filenames (title = filename so the FK links resolve).
const yearOf = (name) => { const m = name.match(/(20[12]\d)/); return m ? `${m[1]}-01-01` : null; };
const langOf = (name) => (/_PT\b|_pt\b/.test(name) ? "pt" : "en");
const writings = [...writingTitles].map((t) => ({
  title: t, written_at: yearOf(t), language: langOf(t), blob_key: `writings/${t}`,
}));

console.log(`psych_items: ${items.length} across ${new Set(items.map((i) => i.dimension_id)).size} dimensions`);
console.log(`psych_evidence: ${evidence.length} quotes`);
console.log(`writings (cited sources): ${writings.length}`);
console.log("dims:", [...new Set(items.map((i) => i.dimension_id))].join(", "));
console.log("sample item:", JSON.stringify(items[0]));
console.log("sample evidence:", JSON.stringify(evidence[0]));
console.log("writing titles:", writings.map((w) => w.title).join(" | "));

if (!APPLY) { console.log("\n(dry run — pass --apply)"); process.exit(0); }

async function seed(table, rows) {
  const r = await fetch(`${BASE}/api/admin/seed-clinical`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Viewer-Clerk": ADMIN },
    body: JSON.stringify({ patient_clerk: CLERK, table, rows }),
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`${table}: ${r.status} ${t}`);
  console.log(`  ✓ ${table}: ${t}`);
}

await seed("writings", writings);          // first — psych_evidence links to these by title
await seed("psych_items", items);          // wipes (cascades evidence) then inserts
await seed("psych_evidence", evidence);    // resolves psych_item (anchor) + writing (title)
console.log("✓ mental applied.");
