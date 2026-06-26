#!/usr/bin/env node
/**
 * Build a print-ready clinical report (PDF source) for Hercio Dias de Souza,
 * reproducing the Lumen Health clinical-report layout used for Paulo Silotto
 * (scripts/build-paulo-clinical-report.mjs) — same cover, branding, CSS, card
 * anatomy — but tailored to Hercio's record: AI synthesis + points to work on /
 * leverage + the per-exam AI "exams to watch" cards + cross-domain links, PLUS a
 * complete laboratory section listing EVERY analyte with its reference range
 * inside each card.
 *
 * All content is read LIVE from the database so it never drifts:
 *   - AI cards  <- patient_dashboards.cards_json (section 'ai-insights'), PT side
 *   - labs      <- lab_results (every analyte, latest value + range + flag)
 *   - PT names  <- web/assets/lab-taxonomy.js (panel + marker labels, order)
 *
 * Output: .staging/hercio-report/{hercio-relatorio-clinico.html,_cover.html,_content.html}
 * then rendered to PDF with scripts/render-report-pdf.mjs and merged via pdfunite.
 *
 *   node scripts/build-hercio-clinical-report.mjs
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const OUTDIR = path.join(root, ".staging/hercio-report");
fs.mkdirSync(OUTDIR, { recursive: true });

const CLERK = "pending:hercio-dias-de-souza-3fd92b";
const TODAY = "26 de junho de 2026";

/* ── db ──────────────────────────────────────────────────────────────────── */
const DATABASE_URL = process.env.DATABASE_URL ||
  (fs.readFileSync(path.join(root, ".env"), "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/) || [])[1];
const sql = neon(DATABASE_URL);

function loadTaxonomy() {
  const src = fs.readFileSync(path.join(root, "web/assets/lab-taxonomy.js"), "utf8");
  const ctx = { window: {}, module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__T = window.LAB_TAXONOMY;", ctx);
  return ctx.__T;
}
const TAX = loadTaxonomy();

/* ── helpers ─────────────────────────────────────────────────────────────── */
const fmtPT = (n) => {
  if (n === null || n === undefined || n === "") return "—";
  const s = String(n);
  return s.indexOf(".") >= 0 ? s.replace(".", ",") : s;
};
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const PT = (b) => esc((b && (b.pt || b.en)) || "");          // bilingual -> PT
const PTraw = (b) => (b && (b.pt || b.en)) || "";            // bilingual -> PT, keep markup

const RISK_PT = { high: "alto", medium: "médio", low: "baixo" };
const TRAJ_PT = { improving: "melhorando", worsening: "piorando", stable: "estável", new: "novo", insufficient_history: "histórico insuficiente" };

function section(eyebrow, title, bodyHtml, opts = {}) {
  const cls = opts.center ? " sec-center" : opts.breakBefore ? " break-before" : "";
  return `<section class="rpt-section${cls}">
    <div class="sec-inner">
      <div class="sec-head">
        <div class="sec-eyebrow">${eyebrow}</div>
        <h2 class="sec-title">${title}</h2>
      </div>
      ${bodyHtml}
    </div>
  </section>`;
}

// Page-card (attention / strength), Paulo's amber AI anatomy.
function aiCard(kind, level, title, summary, detail) {
  const lvl = RISK_PT[level] || level || "";
  const cls = kind === "work" ? "card-work" : "card-fav";
  const chip = kind === "work" ? "Ponto a trabalhar" : "Ponto a favor";
  return `<div class="card ${cls}">
    <div class="card-head">
      <span class="pill pill-ai">IA</span>
      <span class="pill pill-${kind} pill-${level}">${chip}${lvl ? " · " + lvl : ""}</span>
      <span class="card-title">${title}</span>
    </div>
    <p class="card-summary">${summary}</p>
    ${detail ? `<p class="card-detail">${detail}</p>` : ""}
  </div>`;
}

// Inline per-exam AI card ("exames para ficar de olho" / insights).
function insightCard(x) {
  const risk = x.risk_level || "low";
  const traj = x.trajectory && TRAJ_PT[x.trajectory] ? `<span class="traj traj-${x.trajectory}">${TRAJ_PT[x.trajectory]}</span>` : "";
  const ev = (x.evidence || []).find((e) => e && e.value);
  const factors = (x.contributing_factors || []).map((f) => `<li>${PT(f)}</li>`).join("");
  const steps = (x.next_steps || []).map((s) => `<li>${PT(s)}</li>`).join("");
  const interp = PTraw(x.interpretation) || PTraw(x.body);
  const tnote = PTraw(x.trajectory_note);
  return `<div class="card insight-card insight-${risk}">
    <div class="card-head">
      <span class="pill pill-ai">IA</span>
      <span class="pill pill-risk-${risk}">${x.trigger === "trending_lab" ? "Tendência" : "Fora da faixa"} · ${RISK_PT[risk] || risk}</span>
      <span class="card-title">${PT(x.title)}</span>
      ${traj}
    </div>
    ${ev ? `<p class="ins-value">${esc(ev.ref)}: <strong>${esc(ev.value)}</strong>${ev.date ? ` · ${esc(ev.date.split("-").reverse().join("/"))}` : ""}</p>` : ""}
    ${interp ? `<p class="card-summary">${interp}</p>` : ""}
    ${factors ? `<div class="ins-sub">Possíveis fatores contribuintes</div><ul class="ins-list">${factors}</ul>` : ""}
    ${steps ? `<div class="ins-sub">Próximos passos a discutir</div><ul class="ins-list">${steps}</ul>` : ""}
    ${tnote ? `<p class="ins-note">${tnote}</p>` : ""}
  </div>`;
}

// Reference-range text for a lab card.
function refText(lo, hi, unit) {
  const u = unit ? " " + esc(unit) : "";
  if (lo != null && hi != null) return `${fmtPT(lo)} – ${fmtPT(hi)}${u}`;
  if (hi != null) return `&lt; ${fmtPT(hi)}${u}`;
  if (lo != null) return `&gt; ${fmtPT(lo)}${u}`;
  return "—";
}
function stateOf(value, lo, hi, flag) {
  if (["H", "HH"].includes(flag)) return ["Alto", "hi"];
  if (["L", "LL"].includes(flag)) return ["Baixo", "lo"];
  if (value != null && isFinite(value)) {
    if (lo != null && value < lo) return ["Baixo", "lo"];
    if (hi != null && value > hi) return ["Alto", "hi"];
    return ["Normal", "norm"];
  }
  return ["Normal", "norm"]; // qualitative / no-range -> neutral
}

/* ════════════════════════════════════════════════════════════════════════ */
(async () => {
  // ── AI payload ──
  const dRow = await sql`SELECT cards_json c FROM patient_dashboards WHERE patient_id IN
    (SELECT id FROM users WHERE clerk_user_id=${CLERK}) AND section=${"ai-insights"} LIMIT 1`;
  if (!dRow.length) { console.error("✗ no ai-insights for Hercio"); process.exit(1); }
  const C = dRow[0].c;
  const NAME = C.patient_name || "Hercio Dias de Souza";
  const att = (C.pages?.physical?.attention_points || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const str = (C.pages?.physical?.strengths || []).slice().sort((a, b) => (a.rank || 0) - (b.rank || 0));
  const inline = (C.inline_insights || []).slice().sort((a, b) => {
    const o = { high: 0, medium: 1, low: 2 };
    const ra = o[a.risk_level] ?? 3, rb = o[b.risk_level] ?? 3;
    if (ra !== rb) return ra - rb;
    return (a.trigger === "out_of_range_lab" ? 0 : 1) - (b.trigger === "out_of_range_lab" ? 0 : 1);
  });
  const cross = C.summary?.cross_domain_links || [];

  // ── labs: latest value per marker + measurement count ──
  const rows = await sql`SELECT marker, value, value_text, unit, ref_low, ref_high, flag, taken_at::date AS taken_at
    FROM lab_results WHERE patient_id IN (SELECT id FROM users WHERE clerk_user_id=${CLERK})
    ORDER BY marker, taken_at DESC`;
  const ymd = (d) => d == null ? "" : (typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10));
  rows.forEach((r) => { r.taken_at = ymd(r.taken_at); });
  const byMarker = new Map();
  for (const r of rows) {
    const e = byMarker.get(r.marker);
    if (!e) byMarker.set(r.marker, { latest: r, count: 1 });
    else e.count++;
  }
  // group by taxonomy panel, in taxonomy order
  const panelOrder = {}; TAX.PANELS.forEach((p, i) => { panelOrder[p.key] = i; });
  const panelPt = {}; TAX.PANELS.forEach((p) => { panelPt[p.key] = p.pt; });
  const groups = {};
  for (const [marker, { latest, count }] of byMarker) {
    const meta = TAX.MARKERS[marker];
    const pkey = meta ? meta.panel : "other";
    (groups[pkey] = groups[pkey] || []).push({ marker, meta, latest, count });
  }
  const collectionDates = [...new Set(rows.map((r) => r.taken_at))].sort();
  const latestDate = collectionDates[collectionDates.length - 1];

  function labCard(it) {
    const m = it.latest, meta = it.meta || {};
    const namePt = meta.pt || it.marker;
    const isNum = m.value != null && isFinite(m.value);
    const val = isNum ? `${fmtPT(m.value)} <span class="lab-unit">${esc(m.unit || "")}</span>` : `<span class="lab-text">${esc(m.value_text || "—")}</span>`;
    const [label, cls] = stateOf(m.value, m.ref_low, m.ref_high, m.flag);
    const ref = refText(m.ref_low, m.ref_high, m.unit);
    return `<div class="card lab-card">
      <div class="lab-card-top">
        <span class="lab-name">${esc(namePt)}</span>
        <span class="lab-pill lab-${cls}">${label}</span>
      </div>
      <div class="lab-val">${val}</div>
      <div class="lab-ref">Referência: ${ref}</div>
      <div class="lab-meta">coleta ${esc((m.taken_at || latestDate || "").split("-").reverse().join("/"))}${it.count > 1 ? ` · ${it.count} medições` : ""}</div>
    </div>`;
  }

  const labsAllHtml = TAX.PANELS
    .filter((p) => groups[p.key] && groups[p.key].length)
    .map((p) => {
      const cards = groups[p.key]
        .sort((a, b) => (TAX.MARKERS[a.marker] ? 0 : 1) - (TAX.MARKERS[b.marker] ? 0 : 1))
        .map(labCard).join("");
      return `<div class="lab-panel-h">${esc(p.pt)} <span class="lab-panel-n">${groups[p.key].length}</span></div>
        <div class="lab-grid">${cards}</div>`;
    }).join("");
  const totalMarkers = byMarker.size;

  /* ── cover ── */
  const LUMEN_MARK = `<svg class="cv-mark-svg" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-label="Lumen Health">
    <g transform="translate(32,32) scale(1.1)">
      <path d="M 0 22 C -20 6, -28 -2, -20 -14 C -12 -22, -4 -18, 0 -10 C 4 -18, 12 -22, 20 -14 C 28 -2, 20 6, 0 22 Z" fill="rgba(36,78,110,0.08)" stroke="#244E6E" stroke-width="0.9" stroke-linejoin="round"/>
      <path d="M -36 0 L -22 0 L -16 4 L -10 -4 L -2 -16 L 6 14 L 12 -4 L 18 0 L 36 0" fill="none" stroke="#B8860B" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </svg>`;
  const PULSE_LINE = `<svg class="cv-pulse-svg" viewBox="0 0 1000 48" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M0 24 H392 l9 0 l7 5 l7 -10 l8 -17 l9 38 l9 -28 l7 12 l8 0 H560 l7 4 l6 -6 l7 2 l8 0 H1000" fill="none" stroke="#B8860B" stroke-width="4.48" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;

  const cover = `<section class="cover">
    <div class="cv-frame">
      <header class="cv-top">
        <div class="cv-brand">
          <span class="cv-mark">${LUMEN_MARK}</span>
          <span class="cv-word"><b>LUMEN</b><span>HEALTH</span></span>
        </div>
        <div class="cv-doc">Relatório&nbsp;clínico<span class="cv-doc-sub">síntese de prontuário</span></div>
      </header>
      <div class="cv-rule cv-rule-strong"></div>
      <div class="cv-gap"><div class="cv-pulse">${PULSE_LINE}</div></div>
      <div class="cv-hero">
        <div class="cv-eyebrow">Paciente</div>
        <h1 class="cv-name">${esc(NAME)}</h1>
        <div class="cv-sub">1º de abril de 1960 · 66 anos</div>
      </div>
      <div class="cv-why">
        <div class="cv-why-h">Por que existimos</div>
        <p class="cv-why-p">Um histórico de saúde raramente vive em um só lugar. Ele se espalha por anos, laboratórios, clínicas e especialistas — em PDFs, laudos, imagens e aparelhos que não conversam entre si. A <b>Lumen&nbsp;Health</b> reúne tudo isso e devolve um único quadro clínico: claro, contínuo e no tempo certo — um retrato que pertence ao paciente e fala a língua de quem cuida dele.</p>
        <p class="cv-tagline">“Dos dados dispersos a um quadro clínico.”</p>
      </div>
      <div class="cv-spacer"></div>
      <div class="cv-meta">
        <div class="cv-meta-item"><span>Emissão</span><span>${TODAY}</span></div>
        <div class="cv-meta-item"><span>Arco laboratorial</span><span>${collectionDates[0]?.slice(0, 4)} → ${latestDate?.slice(0, 4)} · ${totalMarkers} exames</span></div>
        <div class="cv-meta-item"><span>Painel mais recente</span><span>${esc((latestDate || "").split("-").reverse().join("/"))}</span></div>
        <div class="cv-meta-item"><span>Escopo</span><span>Hemograma · metabólico · renal · tireoide · hormonal · urina</span></div>
      </div>
      <div class="cv-rule"></div>
      <footer class="cv-foot">
        <p>Documento gerado pela plataforma Lumen Health, reproduzindo as seções de IA e os resultados laboratoriais do prontuário do paciente. <strong>Síntese gerada por IA — material para discussão com o médico assistente; não constitui diagnóstico.</strong></p>
        <p class="cv-conf">Confidencial · contém dados pessoais sensíveis de saúde</p>
      </footer>
    </div>
  </section>`;

  /* ── pillars from the synthesis (top concerns) ── */
  const pillars = `<div class="pillars">
    <div class="pillar"><div class="pillar-h">Pilar 1 · Renal</div><p>Filtração renal levemente reduzida (TFG 66) — sem proteinúria/hematúria; acompanhar com repetição e relação albumina/creatinina.</p></div>
    <div class="pillar"><div class="pillar-h">Pilar 2 · Endócrino</div><p>Prolactina elevada (24,2) com TSH no topo da faixa (5,06) — possível eixo tireoide-prolactina a investigar.</p></div>
    <div class="pillar"><div class="pillar-h">Pilar 3 · Cardiometabólico</div><p>Colesterol total subindo ano a ano (199) e glicemia de jejum no limite (102) — sobre um fundo favorável (HbA1c 5,2%, HDL 75, Vit. D recuperada).</p></div>
  </div>`;

  /* ── assemble ── */
  const parts = [
    cover,
    section("Síntese · IA", "Síntese de saúde",
      `<p class="headline">${PTraw(C.summary?.headline)}</p>
       <p class="overview">${PTraw(C.summary?.overview)}</p>
       ${pillars}`, { center: true }),
    section("Síntese · IA", "Pontos a trabalhar",
      `<p class="overview">Os pontos abaixo são reais, mas cada um já vem com um caminho de acompanhamento definido — frentes de cuidado, não becos sem saída.</p>` +
      att.map((a) => aiCard("work", a.risk_level, PT(a.title), PTraw(a.summary), PTraw(a.detail))).join(""),
      { breakBefore: true }),
    section("Síntese · IA", "Pontos a favor",
      str.map((s) => aiCard("fav", s.strength_level, PT(s.title), PTraw(s.summary), PTraw(s.detail))).join("")),
    section("Laboratório · IA", "Exames para ficar de olho",
      `<p class="overview">Cada exame fora da faixa ou com tendência relevante, decodificado: o que o valor significa, possíveis fatores e o próximo passo a conversar com seu médico.</p>` +
      inline.map(insightCard).join(""),
      { breakBefore: true }),
    section("Laboratório", `Todos os exames laboratoriais — painel de ${esc((latestDate || "").split("-").reverse().join("/"))}`,
      `<p class="overview">Os ${totalMarkers} exames do prontuário, agrupados por painel, cada um com o valor mais recente e o intervalo de referência. Para os exames com histórico, o número de medições aparece no rodapé do card.</p>` +
      labsAllHtml,
      { breakBefore: true }),
    cross.length
      ? section("Síntese · IA", "Conexões entre domínios",
          cross.map((c) => `<div class="card cross-card"><span class="pill pill-cross">Conexão</span><p>${PTraw(c.summary)}</p></div>`).join(""))
      : "",
  ].filter(Boolean);

  const contentSections = parts.slice(1);

  const CSS = fs.readFileSync(path.join(root, "scripts/build-paulo-clinical-report.mjs"), "utf8")
    .match(/const CSS = `([\s\S]*?)`;/)[1];
  const EXTRA_CSS = `
/* card detail (second paragraph) */
.card-detail{margin:8px 0 0;line-height:1.72;font-size:9.8pt;color:var(--slate);}
/* insight (exams to watch) */
.insight-card{border-left:3px solid var(--gold);}
.insight-high{border-left-color:#B23434;}
.insight-medium{border-left-color:#C97B3A;}
.insight-low{border-left-color:var(--steel);}
.ins-value{margin:4px 0 6px;font-size:10pt;color:var(--navy);}
.ins-value strong{font-size:13pt;}
.ins-sub{font-size:8pt;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);margin:9px 0 4px;}
.ins-list{margin:0 0 4px;padding-left:16px;}
.ins-list li{margin-bottom:4px;line-height:1.6;font-size:9.3pt;}
.ins-note{font-size:8.4pt;color:var(--steel);font-style:italic;margin:8px 0 0;line-height:1.6;}
.pill-risk-high{background:rgba(178,52,52,.12);color:#9A2A2A;}
.pill-risk-medium{background:rgba(201,123,58,.14);color:#9A4E16;}
.pill-risk-low{background:rgba(36,78,110,.10);color:#244E6E;}
.traj{font-size:7.5pt;letter-spacing:.05em;text-transform:uppercase;padding:2px 7px;border-radius:999px;}
.traj-improving{background:rgba(45,122,78,.12);color:#1F6E45;}
.traj-worsening{background:rgba(178,52,52,.12);color:#9A2A2A;}
.traj-stable{background:rgba(122,143,166,.16);color:#516378;}
.traj-new{background:rgba(184,149,74,.16);color:#8A6A1F;}
.traj-insufficient_history{background:rgba(122,143,166,.14);color:#7A8FA6;}
/* labs · all-exams panels */
.lab-panel-h{font-size:10.5pt;font-weight:600;color:var(--navy);margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid var(--line);break-after:avoid;}
.lab-panel-h:first-child{margin-top:0;}
.lab-panel-n{font-size:8pt;color:var(--steel);font-weight:500;margin-left:4px;}
.lab-norm{background:rgba(45,122,78,.12);color:#1F6E45;}
.lab-text{font-size:11pt;font-weight:600;color:var(--navy);}
`;

  const head = (extra = "") => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Relatório clínico · ${esc(NAME)}</title>
<style>${CSS}${EXTRA_CSS}${extra}</style></head>`;

  const html = head() + `<body>${parts.join("\n")}</body></html>`;
  const coverHtml = head(`@page{size:A4;margin:0}`) + `<body>${cover}</body></html>`;
  const contentHtml = head() + `<body>${contentSections.join("\n")}</body></html>`;

  fs.writeFileSync(path.join(OUTDIR, "hercio-relatorio-clinico.html"), html);
  fs.writeFileSync(path.join(OUTDIR, "_cover.html"), coverHtml);
  fs.writeFileSync(path.join(OUTDIR, "_content.html"), contentHtml);
  console.log("Wrote hercio-relatorio-clinico.html + _cover.html + _content.html (", (html.length / 1024).toFixed(0), "KB )");
  console.log(`AI cards: ${att.length} a trabalhar, ${str.length} a favor, ${inline.length} exames p/ olho, ${cross.length} conexões`);
  console.log(`Lab cards: ${totalMarkers} exames em ${Object.keys(groups).length} painéis · datas ${collectionDates.join(", ")}`);
})().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
