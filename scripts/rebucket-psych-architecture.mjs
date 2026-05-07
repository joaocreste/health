#!/usr/bin/env node
/* Rebucket the existing 84 psych-item blocks in web/mental.html into the
   13 AMPD-aligned dimensions defined in psych-dimensions.txt, and emit
   a card-grid layout with click-to-expand detail panels.

   Reads:  web/mental.html  (existing 15-cat / 84-item section)
   Writes: web/mental.html  (replaces lines between the section header
                              and the closing </section> for #psych-architecture) */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/Users/joaocreste/Claude Agent/Health WebbApp';
const FILE = path.join(ROOT, 'web/mental.html');

const html = fs.readFileSync(FILE, 'utf8');

/* ── Locate the section we are replacing ───────────────────────────── */
const SECTION_OPEN = `<section class="report-section" id="psych-architecture">`;
const NEXT_SECTION = `<!-- 03 SUBSTANCE -->`;
const sectionStart = html.indexOf(SECTION_OPEN);
const sectionEnd   = html.indexOf(NEXT_SECTION);
if (sectionStart < 0 || sectionEnd < 0) {
  throw new Error('psych-architecture section not found in mental.html');
}
const sectionHtml = html.slice(sectionStart, sectionEnd);

/* The bit we want to keep verbatim is the section header (label, title,
   description) — everything between the opening <section> and the start
   of the <details class="psych-toc"> block. */
const TOC_OPEN = `<details class="psych-toc"`;
const headerEnd = sectionHtml.indexOf(TOC_OPEN);
if (headerEnd < 0) throw new Error('psych-toc not found');
const sectionHeaderHtml = sectionHtml.slice(0, headerEnd);

/* And the bit after all the categories — closing </div></section>. */
const SECTION_CLOSE = `</section>`;
const afterCats = sectionHtml.lastIndexOf(SECTION_CLOSE);
const sectionFooterHtml = sectionHtml.slice(afterCats);

/* ── Parse all psych-item blocks ───────────────────────────────────── */
const itemRe = /<div class="psych-item">[\s\S]*?<h4 class="psych-item-title" id="(psych-\d+-\d+)">([^<]+)<\/h4>\s*<p class="psych-synthesis">([\s\S]*?)<\/p>\s*<ul class="psych-evidence">([\s\S]*?)<\/ul>\s*<\/div>/g;
const items = {};
let m;
while ((m = itemRe.exec(sectionHtml)) !== null) {
  const id = m[1];                       // e.g. "psych-1-3"
  const title = m[2].trim();             // e.g. "1.3 Stability of the &quot;I&quot; ..."
  const synthesisHtml = m[3].trim();
  const evidenceHtml = `<ul class="psych-evidence">${m[4]}</ul>`;
  items[id] = { id, title, synthesisHtml, evidenceHtml };
}
const itemCount = Object.keys(items).length;
if (itemCount !== 84) {
  console.error(`WARNING: expected 84 items, found ${itemCount}`);
}

/* ── Mapping: old psych-X-Y id → new dimension key ─────────────────── */
const MAP = {
  /* 1. Identity architecture */
  'psych-1-1': 'identity',          'psych-1-2': 'identity',
  'psych-1-3': 'identity',          'psych-1-4': 'identity',
  'psych-1-5': 'identity',
  /* 2. Defenses */
  'psych-2-1': 'defense',           'psych-2-2': 'defense',
  'psych-2-3': 'defense',           'psych-2-4': 'defense',
  'psych-2-5': 'defense',           'psych-2-6': 'defense',
  /* 3. Attachment */
  'psych-3-1': 'attachment',        'psych-3-2': 'attachment',
  'psych-3-3': 'attachment',        'psych-3-4': 'intimacy',
  'psych-3-5': 'attachment',        'psych-3-6': 'intimacy',
  /* 4. Triggers */
  'psych-4-1': 'emoreg',            'psych-4-2': 'emoreg',
  'psych-4-3': 'emoreg',            'psych-4-4': 'emoreg',
  'psych-4-5': 'emoreg',            'psych-4-6': 'risk',
  /* 5. Fears */
  'psych-5-1': 'beliefs',           'psych-5-2': 'beliefs',
  'psych-5-3': 'beliefs',           'psych-5-4': 'beliefs',
  'psych-5-5': 'beliefs',           'psych-5-6': 'beliefs',
  /* 6. Dreams / longings */
  'psych-6-1': 'selfdir',           'psych-6-2': 'selfdir',
  'psych-6-3': 'selfdir',           'psych-6-4': 'selfdir',
  'psych-6-5': 'selfdir',
  /* 7. Spiritual operating system */
  'psych-7-1': 'beliefs',           'psych-7-2': 'beliefs',
  'psych-7-3': 'beliefs',           'psych-7-4': 'beliefs',
  'psych-7-5': 'beliefs',
  /* 8. Cognitive / linguistic patterns */
  'psych-8-1': 'traits',            'psych-8-2': 'traits',
  'psych-8-3': 'traits',            'psych-8-4': 'traits',
  'psych-8-5': 'traits',            'psych-8-6': 'traits',
  /* 9. Body */
  'psych-9-1': 'currfunc',          'psych-9-2': 'currfunc',
  'psych-9-3': 'identity',          'psych-9-4': 'currfunc',
  'psych-9-5': 'currfunc',
  /* 10. Compulsion */
  'psych-10-1': 'defense',          'psych-10-2': 'defense',
  'psych-10-3': 'defense',          'psych-10-4': 'defense',
  'psych-10-5': 'risk',
  /* 11. Shadow */
  'psych-11-1': 'emoreg',           'psych-11-2': 'intimacy',
  'psych-11-3': 'interp',           'psych-11-4': 'emoreg',
  'psych-11-5': 'defense',
  /* 12. Risk and resilience */
  'psych-12-1': 'risk',             'psych-12-2': 'risk',
  'psych-12-3': 'risk',             'psych-12-4': 'risk',
  'psych-12-5': 'risk',
  /* 13. Strengths */
  'psych-13-1': 'risk',             'psych-13-2': 'risk',
  'psych-13-3': 'risk',             'psych-13-4': 'risk',
  'psych-13-5': 'risk',             'psych-13-6': 'risk',
  'psych-13-7': 'risk',
  /* 14. Developmental / cultural */
  'psych-14-1': 'devtrauma',        'psych-14-2': 'devtrauma',
  'psych-14-3': 'devtrauma',        'psych-14-4': 'devtrauma',
  'psych-14-5': 'devtrauma',
  /* 15. The "ugly" */
  'psych-15-1': 'traits',           'psych-15-2': 'defense',
  'psych-15-3': 'risk',             'psych-15-4': 'interp',
  'psych-15-5': 'defense',          'psych-15-6': 'defense',
  'psych-15-7': 'interp',
};

/* ── 13 dimensions, in display order. Empathy gets a special note since
   the original 15-category synthesis did not isolate an empathy axis. */
const DIMS = [
  { key: 'identity',   en: 'Identity',
    pt: 'Identidade',
    blurb: 'Continuity of self, ego-ideals, reference selves, and identity ruptures across the corpus.' },
  { key: 'selfdir',    en: 'Self-direction',
    pt: 'Autodireção',
    blurb: 'Goals, longings, what he wants to build or recover, and the agency carried in language.' },
  { key: 'empathy',    en: 'Empathy',
    pt: 'Empatia',
    blurb: 'Capacity to take the perspective of others. The original synthesis did not isolate this axis; closest signals appear under Intimacy and the love-language items in Risk/protective factors.' },
  { key: 'intimacy',   en: 'Intimacy',
    pt: 'Intimidade',
    blurb: 'Capacity for vulnerable disclosure, structural loneliness, and the framing of sexuality.' },
  { key: 'emoreg',     en: 'Emotional regulation',
    pt: 'Regulação emocional',
    blurb: 'Triggers, body-state escalation pathways, anger destinations, and grandiosity-collapse cycles.' },
  { key: 'attachment', en: 'Attachment style',
    pt: 'Estilo de apego',
    blurb: 'Father, mother, and partner imagos; the marital narrative and pattern of partner choice.' },
  { key: 'beliefs',    en: 'Core beliefs',
    pt: 'Crenças centrais',
    blurb: 'Fears named and unnamed; image of God, sin/failure/illness language, and recurring biblical anchors.' },
  { key: 'defense',    en: 'Defense mechanisms',
    pt: 'Mecanismos de defesa',
    blurb: 'Anesthesia engine, intellectualization, rationalization, splitting, sublimation, avoidance, magical thinking.' },
  { key: 'traits',     en: 'Trait profile',
    pt: 'Perfil de traços',
    blurb: 'Linguistic and cognitive signatures: tense, voice, pronoun shifts, code-switching, fragmentation, metaphor.' },
  { key: 'interp',     en: 'Interpersonal patterns',
    pt: 'Padrões interpessoais',
    blurb: 'Envy and competition, manipulation patterns, recruiting helpers into protective rather than challenging roles.' },
  { key: 'devtrauma',  en: 'Developmental trauma',
    pt: 'Trauma de desenvolvimento',
    blurb: 'Botucatu/São Paulo roots, the migration arc, inherited scripts, sibling dynamics, national identity.' },
  { key: 'currfunc',   en: 'Current functioning',
    pt: 'Funcionamento atual',
    blurb: 'Somatic baseline: how the body is described, pain language, weight/hair/posture, body-decline ↔ self-worth.' },
  { key: 'risk',       en: 'Risk / protective factors',
    pt: 'Fatores de risco / proteção',
    blurb: 'Hopelessness register, self-harm patterns, what stops him, help-seeking; balanced against precision of self-awareness, articulacy, discipline, honest disclosure, spiritual depth, capacity for love, aesthetic sensitivity.' },
];

/* ── Group items by dimension, in original-order so titles stay sorted ─ */
const buckets = Object.fromEntries(DIMS.map(d => [d.key, []]));
for (const id of Object.keys(items)) {
  const dim = MAP[id];
  if (!dim) { console.error('Unmapped item:', id); continue; }
  buckets[dim].push(items[id]);
}

/* Stable sort by numeric (cat, sub) extracted from id */
const idKey = (id) => {
  const [, c, s] = id.match(/psych-(\d+)-(\d+)/);
  return Number(c) * 100 + Number(s);
};
for (const k of Object.keys(buckets)) {
  buckets[k].sort((a, b) => idKey(a.id) - idKey(b.id));
}

/* ── Build the new HTML ────────────────────────────────────────────── */
const totalItems = Object.values(buckets).reduce((s, a) => s + a.length, 0);

const cards = DIMS.map((d, i) => {
  const n = buckets[d.key].length;
  return `      <button class="psych-dim-card" data-dim="${d.key}" type="button">
        <div class="psych-dim-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="psych-dim-name"><span class="lang-en">${d.en}</span><span class="lang-pt">${d.pt}</span></div>
        <div class="psych-dim-count">${n} item${n === 1 ? '' : 's'}</div>
      </button>`;
}).join('\n');

const panels = DIMS.map((d) => {
  const its = buckets[d.key];
  const itemsHtml = its.length === 0
    ? `      <p class="psych-dim-empty"><span class="lang-en">No items mapped from the original synthesis. ${d.blurb}</span><span class="lang-pt">Nenhum item mapeado da síntese original.</span></p>`
    : its.map(it => {
        const cleanTitle = it.title.replace(/^\d+\.\d+\s+/, '');
        return `      <div class="psych-item">
        <h4 class="psych-item-title" id="${it.id}">${cleanTitle}</h4>
        <p class="psych-synthesis">${it.synthesisHtml}</p>
        ${it.evidenceHtml.replace(/^/gm, '        ').trimStart()}
      </div>`;
      }).join('\n');

  return `  <div class="psych-dim-panel" data-dim="${d.key}" hidden>
    <div class="psych-dim-panel-head">
      <h3 class="psych-dim-panel-title"><span class="lang-en">${d.en}</span><span class="lang-pt">${d.pt}</span></h3>
      <p class="psych-dim-panel-blurb">${d.blurb}</p>
    </div>
${itemsHtml}
  </div>`;
}).join('\n\n');

const newSectionInner = `<div class="psych-architecture-v2">
  <div class="psych-dim-grid">
${cards}
  </div>

${panels}
</div>

<script>
/* Card-grid expand/collapse: toggle a single panel at a time. */
(function () {
  const cards  = document.querySelectorAll('.psych-dim-card');
  const panels = document.querySelectorAll('.psych-dim-panel');
  if (!cards.length) return;

  cards.forEach(card => {
    card.addEventListener('click', () => {
      const dim = card.dataset.dim;
      const isOpen = card.classList.contains('is-open');
      cards.forEach(c => c.classList.remove('is-open'));
      panels.forEach(p => { p.hidden = true; });
      if (!isOpen) {
        card.classList.add('is-open');
        const panel = document.querySelector('.psych-dim-panel[data-dim="' + dim + '"]');
        if (panel) {
          panel.hidden = false;
          panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });
  });

  /* Deep-link: if the URL hash points to a psych-X-Y item, find which
     dimension it lives in and open that panel. */
  function openFromHash() {
    const h = window.location.hash;
    const m = h && h.match(/^#(psych-\\d+-\\d+)$/);
    if (!m) return;
    const target = document.getElementById(m[1]);
    if (!target) return;
    const panel = target.closest('.psych-dim-panel');
    if (!panel) return;
    const dim = panel.dataset.dim;
    const card = document.querySelector('.psych-dim-card[data-dim="' + dim + '"]');
    if (card && !card.classList.contains('is-open')) card.click();
    setTimeout(() => target.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }
  window.addEventListener('hashchange', openFromHash);
  if (window.location.hash) setTimeout(openFromHash, 100);
})();
</script>

  </div>`;

/* The kept opening header includes `<div class="container">`; we close it
   ourselves at the end. The closing </section> comes from sectionFooterHtml. */
const newSection = sectionHeaderHtml + newSectionInner + '\n' + sectionFooterHtml;

/* ── Splice it back ────────────────────────────────────────────────── */
const out = html.slice(0, sectionStart) + newSection + html.slice(sectionEnd);
fs.writeFileSync(FILE, out);

console.log(`Rebucketed ${totalItems} items into ${DIMS.length} dimensions:`);
for (const d of DIMS) {
  console.log(`  ${d.en.padEnd(28)}  ${buckets[d.key].length}`);
}
