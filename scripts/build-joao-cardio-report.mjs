#!/usr/bin/env node
/**
 * CARDIOLOGY report for Joao Victor Creste — PT, Raleway, dark Lumen cover +
 * light body. Reuses the chart PNGs already captured in /tmp/endo_charts.json
 * (same vitals charts) and slices the real cards/tables/reports from the app.
 *
 * Section order (as requested):
 *   1  Saúde cardiovascular — cards (RHR/HRV) + charts (HRV/RHR mensal, FC por
 *      hora do dia, RHR semanal) + AI
 *   2  Pressão arterial (Withings) — cards + charts (semanal, diária, mensal) +
 *      tabela de médias mensais + AI
 *   3  Composição corporal (balança Withings) — cards + gráfico + AI
 *   4  Composição corporal (InBody) — cards + análise segmentar (magra/gordura
 *      por membro) + AI
 *   5  Angio-TC de coronárias 19 jul 2023 — imagens-chave (516) + (PR, 517) em
 *      matriz 2-col, laudo + escore de cálcio (tabela) + AI
 *   6  ECG 8 jun 2026 — SVG em página inteira + laudo + AI
 *   7  Sangue e urina — todos os cards concatenados (fluxo denso)
 *
 * Run: node scripts/build-joao-cardio-report.mjs   (charts come from /tmp)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const webDir = path.join(root, "web");
const vitals = fs.readFileSync(path.join(webDir, "physical-vitals.html"), "utf8");
const exams = fs.readFileSync(path.join(webDir, "physical-exams.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(webDir, "assets/styles.css"), "utf8");
const CHARTPNG = JSON.parse(fs.readFileSync("/tmp/endo_charts.json", "utf8"));
// The ECG Lumen SVG draws its header text as <use> glyph refs (not <text>), so
// the burned-in patient name/DoB/ID can't be redacted by string. It was
// rasterized and the PHI header band masked -> embed the de-identified PNG.
const ECG_IMG = "data:image/png;base64," + fs.readFileSync("/tmp/joao-ecg-deid.png").toString("base64");

// ── slicers ───────────────────────────────────────────────────────────────────
function sliceBalanced(html, startIdx, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = startIdx;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    if (m[0][1] === "/") { if (--depth === 0) return html.slice(startIdx, re.lastIndex); }
    else depth++;
  }
  throw new Error(`unbalanced <${tag}> from ${startIdx}`);
}
const sliceDivById = (h, id) => { const i = h.search(new RegExp(`<div[^>]*id="${id}"`)); if (i < 0) throw new Error(`#${id}`); return sliceBalanced(h, i, "div"); };
const sliceDivByClass = (h, c) => { const i = h.indexOf(`<div class="${c}"`); if (i < 0) throw new Error(`.${c}`); return sliceBalanced(h, i, "div"); };
const openDetails = (h) => h.replace(/<details(?![^>]*\bopen\b)/g, "<details open");

// Find the <div class="metric-grid"> whose content contains `needle`.
function gridContaining(needle) {
  const re = /<div class="metric-grid">/g; let m;
  while ((m = re.exec(vitals))) {
    const block = sliceBalanced(vitals, m.index, "div");
    if (block.includes(needle)) return block;
  }
  return "";
}
// Slice the <table class="data-table"> containing `needle`.
function tableContaining(needle) {
  const re = /<table class="data-table">/g; let m;
  while ((m = re.exec(vitals))) {
    const block = sliceBalanced(vitals, m.index, "table");
    if (block.includes(needle)) return block;
  }
  return "";
}
function removeDivBlocks(html, needle) {
  let out = html, guard = 0;
  while (guard++ < 60) {
    const i = out.search(new RegExp(`<div class="[^"]*${needle}[^"]*"`));
    if (i < 0) break;
    out = out.slice(0, i) + out.slice(i + sliceBalanced(out, i, "div").length);
  }
  return out;
}

// ── chart PNG embeds (reused from the endo capture) ───────────────────────────
const CHART_META = {
  cardioChart: ["VFC e FC em repouso — média mensal", "Oura · VFC (ms) e FC em repouso (bpm)"],
  hrPatternsChart: ["Frequência cardíaca — por hora do dia", "Oura · curva mediana · ±1 DP · ±2 DP"],
  "rhr-weekly-timeline": ["FC em repouso — média semanal", "Oura · média semanal · faixa saudável 50–65 bpm"],
  bpPatternsChart: ["Pressão arterial — variabilidade semanal", "Mediana + banda de ±1 DP · sistólica (vermelho) / diastólica (azul)"],
  bpDailyChart: ["Pressão arterial — leituras diárias", "Braçadeira Withings · linha do tempo, categoria AHA"],
  bpChart: ["Pressão arterial — média mensal", "Braçadeira Withings · sistólica e diastólica"],
  bodyChart: ["Composição corporal — tendência", "Balança Withings · peso, gordura, massa muscular"],
};
const chartImg = (id) => {
  const meta = CHART_META[id]; const src = CHARTPNG[id];
  if (!src || !meta) return "";
  return `<div class="chart-card"><div class="chart-card-head"><div class="chart-card-title">${meta[0]}</div><div class="chart-card-meta">${meta[1]}</div></div><img class="chart-png" src="${src}" alt="${meta[0]}"></div>`;
};
const pair = (a, b) => `<div class="grid2">${chartImg(a)}${chartImg(b)}</div>`;

// ── sliced cards / tables ─────────────────────────────────────────────────────
const cardioCards = gridContaining("Resting HR (median)");
const bpCards = gridContaining("Systolic mean");
const bodyCards = gridContaining("Body weight");
const bpMonthlyTable = tableContaining("Classification");
let inbody = sliceDivById(vitals, "inbody")
  .replace(/<h2 class="section-title">[\s\S]*?<\/h2>/, "")
  .replace(/<p class="section-desc">[\s\S]*?<\/p>/, "");
// translate InBody English-only labels
for (const [a, b] of [
  [">Body Water<", ">Água corporal<"], [">Protein<", ">Proteína<"], [">Body Fat Mass<", ">Massa de gordura<"],
  [">Body weight<", ">Peso<"], [">Weight<", ">Peso<"], [">Body fat<", ">Gordura corporal<"],
  [">Skeletal muscle<", ">Massa muscular esq.<"], [">Skeletal Muscle Mass<", ">Massa muscular esquelética<"],
  [">Total Body Water<", ">Água corporal total<"], [">Above<", ">Acima<"], [">Below<", ">Abaixo<"],
  [">In range<", ">Na faixa<"], [">Overweight<", ">Sobrepeso<"], [">Lean mass<", ">Massa magra<"],
  ["Lean mass and fat per limb", "Massa magra e de gordura por membro"],
  [">Lean Mass by Segment<", ">Massa magra por membro<"], [">Fat Mass by Segment<", ">Massa de gordura por membro<"],
]) inbody = inbody.split(a).join(b);

// ── Angio-TC: de-identified key images (516 + 517 PR) + report + calcium ──────
const tcKey = ["image_s0018_i0001.jpg", "image_s0018_i0002.jpg", "image_s0018_i0003.jpg", "image_s0018_i0004.jpg"];
const tcKeyPR = ["image_s0019_i0001.jpg", "image_s0019_i0002.jpg"];
const tcCell = (f, cap) => `<figure class="kimg"><img src="scans/_cardio_keyimg/tc-heart/${f}" alt="${cap}"><figcaption>${cap}</figcaption></figure>`;
const tcGrid = `<div class="kgrid">${tcKey.map((f, i) => tcCell(f, `Imagem-chave ${i + 1}`)).join("")}${tcKeyPR.map((f, i) => tcCell(f, `Imagem-chave PR ${i + 1}`)).join("")}</div>`;
let tcReport = sliceDivById(exams, "tc-heart");
tcReport = removeDivBlocks(tcReport, "ct-grid");
tcReport = removeDivBlocks(tcReport, "ct-viewer");
tcReport = tcReport.replace(/<div class="report-export-row"[\s\S]*?<\/div>/g, "")
  .replace(/<figure[\s\S]*?<\/figure>/gi, "").replace(/<img\b[^>]*>/gi, "")
  .replace(/<div class="section-label">[\s\S]*?<\/div>/, "")
  .replace(/<h2 class="section-title">[\s\S]*?<\/h2>/, "")
  .replace(/<p class="section-desc">[\s\S]*?<\/p>/, "");

// ── blood + urine: dense newspaper flow, whole cards ──────────────────────────
let labRaw = openDetails(sliceDivByClass(exams, "lab-panel-grid"));
const labPanels = [];
{ const re = /<details class="lab-panel"/g; let m; while ((m = re.exec(labRaw))) labPanels.push(sliceBalanced(labRaw, m.index, "details")); }
const labGrid = `<div class="lab-flow">${labPanels.map((p) => `<div class="lab-card-wrap">${p}</div>`).join("\n")}</div>`;

// ── AI cards (authored, cardiology-framed) ────────────────────────────────────
const aiCard = (edge, chip, title, body) =>
  `<div class="ai-card ai-edge-${edge}"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-${edge}">${chip}</span><span class="ai-ct">${title}</span></div><p>${body}</p></div>`;
const disc = `<p class="ai-disc">Interpretação por modelo de linguagem sobre o registro do paciente — para discussão clínica, não constitui diagnóstico nem prescrição.</p>`;

const sec = (label, title, body) => `<section class="rep"><div class="wrap"><div class="sec-label">${label}</div><h2 class="sec-title">${title}</h2>${body}</div></section>`;

const s1 = sec("01 · Saúde cardiovascular", `Saúde cardiovascular <span class="ai-pill">IA</span>`, `
  <p class="prose">Frequência cardíaca e variabilidade (Oura): FC em repouso, VFC e o padrão de FC ao longo do dia.</p>
  ${cardioCards}
  ${chartImg("cardioChart")}
  ${pair("hrPatternsChart", "rhr-weekly-timeline")}
  ${aiCard("high", "Eixo autonômico", "VFC em queda e FC em repouso em alta — dominância simpática",
    "A VFC mensal caiu (mar 23,7 → abr 15,8 → mai 13,9 ms, a mais baixa do período, com leve alta em jun para 15,9) enquanto a FC em repouso subiu em paralelo (64,9 → 73,5 → 76,5 bpm, recuando para 72,3 em jun). O padrão indica <strong>dominância simpática / recuperação autonômica reduzida</strong>, coerente com a inflamação sistêmica (hs-CRP 12,1) e a dor cervical. Para o cardiologista: VFC persistentemente baixa é marcador prognóstico — vale acompanhar junto com PA e a resposta ao controle da dor/inflamação.")}
  ${disc}`);

const s2 = sec("02 · Pressão arterial", `Pressão arterial — monitor Withings <span class="ai-pill">IA</span>`, `
  <p class="prose">278 leituras (13 nov 2025 – 7 jun 2026), braçadeira Withings. Variabilidade semanal (mediana ± 1 DP), leituras diárias por categoria AHA, média mensal e a tabela de médias por mês.</p>
  ${bpCards}
  ${pair("bpPatternsChart", "bpDailyChart")}
  ${chartImg("bpChart")}
  <h3 class="rep-h3">Médias por mês</h3>
  ${bpMonthlyTable}
  ${aiCard("high", "Hipertensão", "Estágio 1–2 com melhora pós-alta; tendência de queda",
    "Médias mensais em faixa de <strong>Estágio 1–2</strong> (pico em abril, em torno da crise cervical e da internação de 29 abr), com <strong>melhora em maio–junho</strong> (jun ~123/81, Estágio 1) — embora a última leitura isolada (7 jun, 145/93) tenha voltado ao Estágio 2; pico diastólico do conjunto = 116 mmHg. Causas a considerar antes de ajuste: dor, retomada de corticosteroide (Diprospan), <strong>retenção hídrica</strong> por valproato (Depakote ER) e pregabalina (Lyrica), flutuação de benzodiazepínico e efeito do jaleco branco (FC média de 92 bpm durante a medição sugere componente ansioso). Sugere-se confirmar com MAPA/medidas domiciliares padronizadas antes de iniciar/escalonar anti-hipertensivo.")}
  ${disc}`);

const s3 = sec("03 · Composição corporal — balança", `Composição corporal — balança Withings <span class="ai-pill">IA</span>`, `
  <p class="prose">Tendência da balança Withings (peso, gordura corporal, massa muscular).</p>
  ${bodyCards}
  ${chartImg("bodyChart")}
  ${aiCard("elevated", "Risco cardiometabólico", "Sobrepeso com adiposidade — alvo de redução de risco",
    "Peso ~81,9 kg, gordura ~24,6%, IMC ~27,1 (sobrepeso) com massa muscular estável. No contexto cardiovascular, a adiposidade soma-se à hipertensão e à dislipidemia (colesterol total 214) no perfil de risco. A perda de peso é alavanca direta de pressão e lipídios — relevante para a estratégia (inclusive a discussão de GLP-1 em curso com o endocrinologista).")}
  ${disc}`);

const s4 = sec("04 · Composição corporal — InBody", `Composição corporal — InBody <span class="ai-pill">IA</span>`, `
  <p class="prose">Bioimpedância multifrequência (InBody, 1 jul 2025) — composição e análise segmentar (massa magra e de gordura por membro).</p>
  ${inbody}
  ${aiCard("info", "Segmentar", "Adiposidade central; pernas com massa magra no limite inferior",
    "Gordura acima do ideal em todas as regiões e ambas as pernas com massa magra ~89% do ideal InBody. RCQ 1,02 (adiposidade central) reforça o risco cardiovascular. Útil como linha de base antes de uma estratégia de perda de peso.")}
  ${disc}`);

const s5 = sec("05 · Angio-TC de coronárias", `Angiotomografia das coronárias · 19 jul 2023 <span class="ai-pill">IA</span>`, `
  <p class="prose">Imagens-chave (reconstruções 3D / MPR; pré-visualizações desidentificadas a partir do DICOM) em matriz de duas colunas, seguidas do laudo do radiologista e do escore de cálcio.</p>
  ${tcGrid}
  <h3 class="rep-h3">Laudo do radiologista e escore de cálcio</h3>
  ${tcReport}
  ${aiCard("elevated", "Achado", "Escore de cálcio 7 (p75–90) + placa parcialmente calcificada no DAd proximal",
    "Sem redução luminal significativa, mas há <strong>placa parcialmente calcificada com remodelamento positivo no segmento proximal da DA</strong>, produzindo leve redução luminal — descrita como achado incomum para a faixa etária. Escore de cálcio total 7 (percentil 75–90 para idade/sexo). Para o cardiologista: justifica controle agressivo de fatores de risco (PA, LDL, peso, inflamação) e seguimento; considerar reavaliação de imagem conforme evolução do risco.")}
  ${disc}`);

const s6 = sec("06 · Eletrocardiograma", `Eletrocardiograma (ECG) · 8 de junho de 2026 <span class="ai-pill">IA</span>`, `
  <p class="prose">ECG de 12 derivações (Hospital Sírio-Libanês). Traçado em página inteira (cabeçalho com identificadores do paciente desidentificado); laudo abaixo.</p>
  <div class="ecg-wrap"><img src="${ECG_IMG}" alt="ECG 12 derivações"></div>
  <div class="list-card">
    <h4>Laudo</h4>
    <ul>
      <li><strong>Ritmo:</strong> sinusal. Traçado morfologicamente dentro dos limites normais.</li>
      <li><strong>FC:</strong> 81 bpm · <strong>PR:</strong> 172 ms · <strong>QRS:</strong> 115 ms · <strong>QTc:</strong> 403 ms.</li>
    </ul>
  </div>
  ${aiCard("info", "ECG", "Ritmo sinusal normal; QRS 115 ms no limite superior",
    "Traçado dentro dos limites normais, intervalos PR e QTc normais. O <strong>QRS de 115 ms</strong> fica no limite superior — sem critério de bloqueio completo, mas vale notar em série, sobretudo com a placa proximal de DA e o uso de fármacos que afetam a condução. Correlacionar clinicamente.")}
  ${disc}`);

const s7 = `<section class="rep"><div class="wrap">
  <div class="sec-label">07 · Laboratório</div>
  <h2 class="sec-title">Sangue e urina — painel completo (8 jun 2026)</h2>
  <p class="prose">Painel completo do Hospital Sírio-Libanês, solicitado pelo Dr. Marco Antonio de Carvalho. Todos os cartões concatenados em fluxo de duas colunas.</p>
  ${labGrid}
</div></section>`;

// ── Medications & supplements (final section) ─────────────────────────────────
// Mirrors the backend `medications` table (same record physical.html reflects).
// Supplements: none on record. Cardiovascular notes are standard pharmacology,
// kept conservative and consistent with the BP / ECG sections above.
const medRows = [
  ["Depakote ER", "divalproato de sódio (valproato)", "1.000 mg/dia", "Anticonvulsivante / estabilizador de humor",
   "Ganho de peso e retenção hídrica associados — pode contribuir para a pressão arterial."],
  ["Lyrica", "pregabalina", "300 mg/dia (em 2 tomadas)", "Gabapentinoide (análogo de GABA)",
   "Edema periférico e retenção hídrica dose-dependentes — somam-se ao quadro pressórico."],
  ["Quetiapina", "quetiapina", "50 mg/dia", "Antipsicótico atípico",
   "Prolongamento de QT dose-dependente; efeito cardiometabólico (peso e lipídios)."],
  ["Valium", "diazepam", "32,5 mg/dia (desmame 40 → 35 → 32,5)", "Benzodiazepínico",
   "Sem efeito direto de condução; a ansiólise pode atenuar o componente do jaleco branco."],
  ["Revia", "naltrexona", "50 mg/dia", "Antagonista opioide",
   "Sem efeito cardiovascular direto significativo; indicado no transtorno por uso de álcool/opioides."],
];
const medTableRows = medRows.map(([brand, inn, dose, klass, note]) =>
  `<tr><td class="strong">${brand}<div style="font-size:8.5pt;color:#6E7B8A;font-weight:400">${inn}</div></td><td class="num">${dose}</td><td>${klass}</td><td><span class="pill pill-info">Ativa</span></td><td style="font-size:9pt">${note}</td></tr>`).join("");
const medTable = `<table class="data-table">
  <thead><tr><th>Medicação</th><th>Dose</th><th>Classe</th><th>Status</th><th>Observação cardiovascular</th></tr></thead>
  <tbody>${medTableRows}</tbody></table>`;
const s8 = sec("08 · Medicações e suplementos", `Medicações e suplementos <span class="ai-pill">IA</span>`, `
  <p class="prose">Regime atual conforme o registro do backend (tabela <code>medications</code>), com ajustes de dose coordenados com o Dr. Eduardo Tisher. As observações cardiovasculares são farmacologia padrão, relevantes para a leitura da pressão arterial e do ECG nas seções acima.</p>
  ${medTable}
  <div class="alert alert-warn"><strong>Uso pontual (não de manutenção):</strong> infiltração de corticosteroide <strong>Diprospan</strong> (betametasona) na crise de protrusão cervical (mar 2026) — efeito transitório conhecido sobre PA e FC; não faz parte do regime diário.</div>
  <h3 class="rep-h3">Suplementação</h3>
  <table class="data-table">
    <thead><tr><th>Suplemento</th><th>Dose</th><th>Observação</th></tr></thead>
    <tbody><tr><td colspan="3" style="color:#6E7B8A;font-style:italic">Nenhum suplemento registrado no backend.</td></tr></tbody>
  </table>
  ${aiCard("elevated", "Polifarmácia", "Cinco fármacos no regime; três com pegada cardiovascular — pesar no contexto da PA e do QT/QRS",
    "Três dos cinco fármacos têm relevância cardiovascular direta: <strong>valproato (Depakote ER) e pregabalina (Lyrica)</strong> favorecem <strong>retenção hídrica e ganho de peso</strong>, coerentes com as médias pressóricas de Estágio 1–2 da Seção 02; a <strong>quetiapina</strong> prolonga o QT de forma dose-dependente — a vigiar junto ao QRS de 115 ms da Seção 06; o <strong>diazepam</strong>, embora sem efeito de condução, pode atenuar o componente ansioso/jaleco branco visto na medição da PA; e a <strong>naltrexona (Revia)</strong> não tem efeito cardiovascular direto relevante. Para o cardiologista: antes de iniciar ou escalonar anti-hipertensivo, vale considerar a contribuição farmacológica para a PA e a retenção hídrica, e manter o QTc em série diante da quetiapina.")}
  ${disc}`);

// ── CSS ───────────────────────────────────────────────────────────────────────
const EXTRA_CSS = `
@page { size:A4; margin:11mm 12mm; }
*{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
html,body{ background:#fff !important; margin:0; padding:0; color:#1A2129; font-family:'Raleway',system-ui,sans-serif; font-size:11pt; line-height:1.5; }
html[lang="pt"] .lang-en{ display:none !important; }
.topnav,.section-nav,.sp-nav,.lang-switch,.signout-btn,.changepatient-btn,[data-export-btn],.back-link,.add-data-btn,.iu-wrap,.danger-zone,.vr-bar,.vr-overlay,.ct-viewer,.ct-grid,.report-export-row{display:none!important;}
.rep{ margin:0 0 6mm 0; }
.sec-label{ font-family:'IBM Plex Mono',monospace; font-size:18pt; letter-spacing:.08em; text-transform:uppercase; color:#0D1B2A; margin:0 0 8px; border-top:2.5px solid #0D1B2A; padding-top:10px; break-after:avoid; }
.sec-title{ font-family:'Raleway',sans-serif; font-weight:700; font-size:19pt; color:#0D1B2A; margin:0 0 10px; line-height:1.15; break-after:avoid; }
.rep-h3{ font-family:'Raleway',sans-serif; font-weight:700; font-size:14pt; color:#244E6E; margin:16px 0 8px; break-after:avoid; }
.prose{ font-size:11pt; line-height:1.55; margin:0 0 9px; }
.grid2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:start; }
.chart-card{ background:#fff!important;border:1px solid #E5E2DC!important;border-radius:9px;padding:9px 11px;margin:0 0 10px; break-inside:avoid; }
.chart-card-head{ margin-bottom:5px; }
.chart-card-title{ font-family:'Raleway',sans-serif; font-weight:700; font-size:11pt; color:#0D1B2A; }
.chart-card-meta{ font-family:'IBM Plex Mono',monospace; font-size:8pt; color:#6E7B8A; margin-top:2px; }
.chart-png{ width:100%; height:auto; display:block; }
/* metric cards */
.metric-grid{ display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin:0 0 10px; }
.metric-card{ background:#F7F5F0; border:1px solid #E5E2DC; border-radius:8px; padding:8px 10px; break-inside:avoid; }
.metric-label{ font-family:'IBM Plex Mono',monospace; font-size:8pt; letter-spacing:.04em; text-transform:uppercase; color:#6E7B8A; }
.metric-value{ font-family:'Raleway',sans-serif; font-weight:700; font-size:17pt; color:#0D1B2A; margin:2px 0; }
.metric-value small{ font-size:9pt; font-weight:400; color:#6E7B8A; }
.metric-note{ font-size:8.5pt; color:#52606b; line-height:1.35; }
.pill{ font-size:8pt; padding:1px 6px; border-radius:999px; background:#EEF1F5; color:#52606b; }
.pill-flag{ background:#fbe9e7; color:#c0392b; } .pill-watch{ background:#fef3e2; color:#b45309; }
.pill-ok{ background:#e6f4ec; color:#2e7d52; } .pill-info{ background:#e7eff5; color:#2f6489; }
/* data table */
.data-table{ width:100%; border-collapse:collapse; font-size:9.5pt; margin:4px 0 10px; break-inside:avoid; }
.data-table th{ text-align:left; background:#0D1B2A; color:#fff; padding:6px 8px; font-family:'Raleway',sans-serif; font-weight:700; font-size:8.5pt; }
.data-table td{ padding:5px 8px; border-bottom:1px solid #ECE8DF; }
.data-table .num{ text-align:right; font-family:'IBM Plex Mono',monospace; }
/* AI cards */
.ai-pill{ background:#FFF6E5;color:#B8954A;border:1px solid #E0C681;padding:1px 8px;border-radius:999px;font-family:'IBM Plex Mono',monospace;font-size:8.5pt;font-weight:500;letter-spacing:.06em;vertical-align:middle; }
.ai-card{ background:#FDFAF3;border:1px solid #EFE4C6;border-left:4px solid #7A8FA6;border-radius:10px;padding:11px 14px;margin:0 0 9px; break-inside:avoid; }
.ai-edge-high{border-left-color:#c0392b}.ai-edge-elevated{border-left-color:#d97706}.ai-edge-info{border-left-color:#3E7CA3}
.ai-head{ display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-bottom:5px; }
.ai-ct{ font-family:'Raleway',sans-serif;font-weight:700;font-size:11pt;color:#1A2129;flex:1 1 auto; }
.ai-card p{ font-size:10.5pt;line-height:1.5;margin:3px 0 0; }
.ai-chip{ font-size:8pt;padding:1px 7px;border-radius:999px;font-family:'IBM Plex Mono',monospace;font-weight:500; }
.chip-high{background:#fbe9e7;color:#c0392b}.chip-elevated{background:#fef3e2;color:#b45309}.chip-info{background:#e7eff5;color:#2f6489}
.ai-disc{ font-size:8.5pt;color:#7A8FA6;border-top:1px solid #eee;margin-top:10px;padding-top:7px; }
/* imaging key-image grid */
.kgrid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:6px 0 10px; }
.kimg{ margin:0; } .kimg img{ width:100%; border:1px solid #cfd6de; border-radius:5px; display:block; background:#000; }
.kimg figcaption{ font-family:'IBM Plex Mono',monospace; font-size:8pt; color:#6E7B8A; margin-top:3px; text-align:center; }
.list-card{ background:#fff; border:1px solid #E5E2DC; border-radius:9px; padding:11px 13px; margin:0 0 9px; break-inside:avoid; }
.list-card h4{ font-family:'Raleway',sans-serif; font-weight:700; font-size:11pt; color:#0D1B2A; margin:0 0 6px; }
.list-card ul{ margin:0 0 0 16px; } .list-card li{ font-size:9.5pt; line-height:1.45; margin:3px 0; }
.list-card table{ width:100%; border-collapse:collapse; font-size:9.5pt; }
.two-col{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.alert{ border-radius:8px; padding:9px 12px; font-size:9.5pt; line-height:1.5; margin:8px 0; break-inside:avoid; }
.alert-warn{ background:#FBF1E3; border:1px solid #E8C99A; } .alert-info{ background:#EAF1F6; border:1px solid #Bcd3e3; }
/* ECG full page */
.ecg-wrap{ width:100%; border:1px solid #E5E2DC; border-radius:8px; padding:6px; margin:6px 0 10px; break-inside:avoid; }
.ecg-wrap img{ width:100%; height:auto; display:block; }
/* InBody */
#inbodySegmental{ max-height:360px; overflow:hidden; } #inbody .inbody-fig-wrap{ max-width:200px; }
img,svg{ max-width:100%; height:auto; }
/* lab flow */
.lab-flow{ column-count:2 !important; column-gap:10px !important; column-fill:auto !important; }
.lab-card-wrap{ break-inside:avoid !important; -webkit-column-break-inside:avoid !important; page-break-inside:avoid !important; display:block; margin:0 0 7px; }
.lab-flow .lab-panel{ break-inside:avoid !important; width:100% !important; margin:0 !important; padding:6px 9px !important; }
.lab-flow .lab-test{ padding:2px 0 !important; margin:0 !important; }
.lab-flow .lab-test *{ line-height:1.25 !important; }
.lab-flow .lab-panel-head,.lab-flow .lab-panel-title{ margin-bottom:3px !important; }
.lab-flow .lab-bar{ margin:2px 0 !important; }
.lab-flow .lab-test-ref,.lab-flow .lab-note,.lab-flow .lab-bar-labels{ margin:1px 0 0 !important; }
details > summary{ list-style:none !important; } details > summary::-webkit-details-marker{ display:none !important; }
`;
const FONT_F = 0.54;
const bloodShrink = [];
{ const re = /([.#][^{}]+?)\{([^{}]*)\}/g; let m;
  const SEL = /lab-panel-title|lab-panel-sub|lab-panel-count|lab-test-name|lab-name-pt|lab-val-num|lab-val-unit|lab-test-ref|lab-bar-labels|lab-note|lab-causes/;
  while ((m = re.exec(stylesCss))) { const sel = m[1].trim(), b = m[2]; const fm = b.match(/font-size:\s*([0-9.]+)px/);
    if (fm && SEL.test(sel)) bloodShrink.push(`.lab-flow ${sel}{font-size:${(+fm[1] * FONT_F).toFixed(2)}px !important}`); } }

const content = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<title>Relatório cardiológico — Joao Victor Creste</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style id="site-styles">${stylesCss}</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script><script src="https://cdn.jsdelivr.net/npm/@sgratzl/chartjs-chart-boxplot@4.4.4/build/index.umd.min.js"></script>
<style>${EXTRA_CSS}</style><style id="blood-shrink">${bloodShrink.join("\n")}</style></head>
<body class="theme-light"><main style="padding:0;max-width:none">
${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}
</main>
<script src="assets/data.js?v=35"></script>
<script>${vitals.slice(vitals.indexOf("<script>", vitals.indexOf('assets/data.js?v=35"></script>')) + 8, vitals.indexOf("</script>", vitals.indexOf("<script>", vitals.indexOf('assets/data.js?v=35"></script>'))))}
// renderInBody (IIFE) populated #inbodyBars/#inbodySegmental at parse; no live charts.
</script>
</body></html>`;
fs.writeFileSync(path.join(webDir, "_cardio-content.html"), content);

const cover = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@200;300;400;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#0A1428;--fg:#F0F4F8;--muted:#8FA3BC;--gold:#B8954A;--petrol:#7A8FA6;--bd:#283655}
*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@page{size:A4;margin:0} html,body{background:var(--bg);color:var(--fg);font-family:'Raleway',sans-serif}
.cover{position:relative;width:210mm;min-height:297mm;padding:24mm 22mm;display:flex;flex-direction:column;overflow:hidden}
.cover::before{content:'';position:absolute;inset:0;background-image:linear-gradient(to right,rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.025) 1px,transparent 1px);background-size:64px 64px}
.cover::after{content:'';position:absolute;left:0;right:0;bottom:0;height:6mm;background:var(--gold)}
.cover>*{position:relative;z-index:1}
.top{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:9pt;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.brandline{font-family:'IBM Plex Mono',monospace;font-size:9pt;letter-spacing:.34em;text-transform:uppercase;color:var(--petrol);margin-top:2mm}
.center{margin:auto 0;padding:14mm 0}
.tag{font-family:'IBM Plex Mono',monospace;font-size:10pt;letter-spacing:.34em;text-transform:uppercase;color:var(--gold);margin-bottom:14px}
.title{font-family:'Raleway',sans-serif;font-weight:200;font-size:40pt;color:var(--fg);line-height:1.08}.title strong{font-weight:700}
.sub{font-size:13pt;color:var(--muted);margin-top:14px;max-width:150mm;line-height:1.5}
.meta{display:grid;grid-template-columns:max-content 1fr;gap:7px 22px;border-top:1px solid var(--bd);border-bottom:1px solid var(--bd);padding:16px 0;margin-bottom:18px}
.k{font-family:'IBM Plex Mono',monospace;font-size:9pt;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);align-self:center}.v{font-size:12pt}
.inc-l{font-family:'IBM Plex Mono',monospace;font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:20px}
.chip{font-family:'IBM Plex Mono',monospace;font-size:9pt;padding:4px 10px;border-radius:999px;background:rgba(122,143,166,.12);color:var(--petrol);border:1px solid rgba(122,143,166,.4)}
.disc{font-size:8.5pt;line-height:1.55;color:var(--muted);border-left:2px solid var(--gold);padding-left:12px;margin-top:auto}
.foot{display:flex;justify-content:space-between;font-family:'IBM Plex Mono',monospace;font-size:8pt;letter-spacing:.1em;color:var(--muted);margin-top:14px}
</style></head><body><section class="cover">
  <div class="top"><span>Confidencial · Comunicação clínica</span><span>Cardiologia</span></div>
  <div class="brandline">Lumen Health</div>
  <div class="center">
    <div class="tag">Relatório clínico</div>
    <div class="title">Avaliação<br><strong>cardiológica</strong></div>
    <div class="sub">Saúde cardiovascular, pressão arterial, composição corporal, angio-TC de coronárias, ECG e laboratório — consolidados para a consulta.</div>
  </div>
  <div class="meta">
    <div class="k">Paciente</div><div class="v">Joao Victor Creste Dias de Souza</div>
    <div class="k">Nascimento</div><div class="v">17 de outubro de 1992</div>
    <div class="k">Sexo</div><div class="v">Masculino</div>
    <div class="k">Gerado em</div><div class="v">12 de junho de 2026</div>
    <div class="k">Idioma</div><div class="v">Português</div>
  </div>
  <div class="inc-l">Inclui</div>
  <div class="chips">
    <span class="chip">Saúde cardiovascular</span><span class="chip">Pressão arterial</span><span class="chip">Composição corporal</span>
    <span class="chip">InBody</span><span class="chip">Angio-TC de coronárias</span><span class="chip">ECG</span><span class="chip">Sangue e urina</span><span class="chip">Medicações e suplementos</span>
  </div>
  <p class="disc">Estritamente confidencial. Documento gerado a partir do registro clínico do paciente. As seções marcadas como IA são interpretações por modelo de linguagem, destinadas à discussão clínica — não constituem diagnóstico nem prescrição.</p>
  <div class="foot"><span>Lumen Health · Documento confidencial</span><span>12-06-2026</span></div>
</section></body></html>`;
fs.writeFileSync(path.join(webDir, "_cardio-cover.html"), cover);

console.log("wrote web/_cardio-cover.html + web/_cardio-content.html");
console.log(`  cardioCards:${!!cardioCards} bpCards:${!!bpCards} bodyCards:${!!bodyCards} bpTable:${!!bpMonthlyTable} inbody:${inbody.length}b`);
console.log(`  tc report:${tcReport.length}b · lab panels:${labPanels.length} · ECG img embedded · meds:${medRows.length}`);

// ── render with headless Chrome + pdfunite ────────────────────────────────────
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outPath = path.join(root, "Patients", "Joao Victor Creste", "Relatorio Cardiologico - Joao Victor Creste - 12-06-2026.pdf");
const tmpCover = path.join(root, ".staging", "_cardio-cover.pdf");
const tmpContent = path.join(root, ".staging", "_cardio-content.pdf");
fs.mkdirSync(path.join(root, ".staging"), { recursive: true });
function renderPDF(htmlPath, pdfPath) {
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
    "--virtual-time-budget=15000",
    `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ], { stdio: "pipe" });
}
console.log("• rendering cover …");
renderPDF(path.join(webDir, "_cardio-cover.html"), tmpCover);
console.log("• rendering content …");
renderPDF(path.join(webDir, "_cardio-content.html"), tmpContent);
console.log("• merging …");
execFileSync("pdfunite", [tmpCover, tmpContent, outPath], { stdio: "pipe" });
console.log("✓ PDF:", path.relative(root, outPath));
