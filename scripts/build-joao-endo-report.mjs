#!/usr/bin/env node
/**
 * Comprehensive ENDOCRINOLOGY report for Joao Victor Creste — PT, Raleway,
 * dark Lumen cover + light body. Framed for a GLP-1 (tirzepatide / Mounjaro)
 * initiation discussion.
 *
 * Two-step build (live charts stall headless print-to-pdf, so every chart is
 * pre-rendered to PNG by a harness page first):
 *   1) node scripts/build-joao-endo-report.mjs harness   -> web/_endo-harness.html
 *      (render it headless, dump #out JSON, extract PNGs to /tmp/endo_*.png)
 *   2) node scripts/build-joao-endo-report.mjs            -> cover + content HTML
 *
 * Sections:
 *   0  Cover (dark)
 *   1  AI key insights for the endocrinologist (GLP-1 focus)
 *   2  Vitals — every chart + insight/text from Oura, Apple Watch, BP cuff,
 *      Withings scale + InBody body composition
 *   3  Blood & urine — all panels + out-of-reference insight cards
 *   4  Imaging — all studies: radiologist reports + key images + AI notes
 *   5  Genetics — markers relevant to an endocrinologist + GLP-1 initiation
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
const MODE = process.argv[2];

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
const sliceSectionById = (h, id) => { const i = h.search(new RegExp(`<section[^>]*id="${id}"`)); if (i < 0) throw new Error(`section#${id}`); return sliceBalanced(h, i, "section"); };
const openDetails = (h) => h.replace(/<details(?![^>]*\bopen\b)/g, "<details open");

// ── chart machinery from vitals inline <script> ───────────────────────────────
const dm = vitals.indexOf('assets/data.js?v=35"></script>');
const scrOpen = vitals.indexOf("<script>", dm);
const scrClose = vitals.indexOf("</script>", scrOpen);
const CHART_JS = vitals.slice(scrOpen + "<script>".length, scrClose);

// Every chart we surface: id -> {kind, titlePt, metaPt}. Plotly ids render via
// Plotly.toImage; canvas ids via toDataURL.
const CHARTS = [
  ["bodyChart", "canvas", "Composição corporal — tendência", "Balança Withings · peso, gordura corporal e massa muscular"],
  ["glucoseChart", "plotly", "Glicose — monitorização contínua (CGM)", "Sensor contínuo · série temporal completa"],
  ["glucosePatternsChart", "plotly", "Glicose — padrão diário (24h)", "Todas as leituras dobradas em 24h · mediana + ±1/±2 DP"],
  ["cardioChart", "canvas", "VFC e FC em repouso — média mensal", "Oura · variabilidade da FC (ms) e FC em repouso (bpm)"],
  ["hrPatternsChart", "plotly", "Frequência cardíaca — por hora do dia", "Oura · curva mediana · ±1 DP · ±2 DP"],
  ["rhr-weekly-timeline", "plotly", "FC em repouso — média semanal (Oura)", "Oura · média semanal · faixa saudável 50–65 bpm"],
  ["bpChart", "canvas", "Pressão arterial — média mensal", "Braçadeira Withings · sistólica e diastólica"],
  ["bpDailyChart", "canvas", "Pressão arterial — leituras diárias", "Braçadeira Withings · linha do tempo completa, por categoria AHA"],
  ["bpPatternsChart", "plotly", "Pressão arterial — variabilidade semanal", "Mediana + banda de ±1 DP · sistólica (vermelho) / diastólica (azul)"],
  ["stepsChart", "canvas", "Passos — por dia", "Oura/Apple · passos diários + mediana semanal"],
  ["exerciseMixChart", "canvas", "Mix de exercícios", "Oura · minutos por modalidade"],
  ["stressChart", "canvas", "Estresse e resiliência — diário", "Oura · minutos de alto estresse + pontuação de resiliência"],
  ["sleepStageChart", "canvas", "Estágios do sono — boxplot (±1,5 × IIQ)", "Oura · mediana, quartis e hastes a 1,5 × IIQ · horas/noite"],
  ["sleep-total-weekly-timeline", "plotly", "Sono total — média semanal", "Oura · horas por noite · faixa adulta 7–9h"],
  ["sleep-stage-weekly-composition", "plotly", "Composição do sono — média semanal", "Oura · % do sono total por estágio ao longo do tempo"],
];

if (MODE === "harness") {
  const canvases = CHARTS.filter((c) => c[1] === "canvas").map((c) => c[0]);
  const plotly = CHARTS.filter((c) => c[1] === "plotly").map((c) => c[0]);
  // Real containers for everything (sized); renderAllVitalsCharts fills them.
  const containers = CHARTS.map(([id, kind]) => kind === "canvas"
    ? `<div class="cw"><canvas id="${id}"></canvas></div>`
    : `<div class="cw"><div id="${id}" style="width:760px;height:380px"></div></div>`).join("\n");
  // InBody mounts (renderInBody auto-runs) — not exported, just prevents errors.
  const harness = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<style>.cw{width:760px;height:400px}#sleepStageChart{width:560px;height:380px}canvas{max-width:760px}</style>
<script src="_vendor/plotly.min.js"></script>
<script src="_vendor/chart.umd.min.js"></script>
<script src="_vendor/boxplot.umd.min.js"></script>
</head><body>
${containers}
<div style="display:none"><div id="inbodyBars"></div><div id="inbodySegmental"></div></div>
<pre id="out"></pre>
<script src="assets/data.js?v=35"></script>
<script>${CHART_JS}</script>
<script>
(function(){
  try { if (typeof renderAllVitalsCharts==='function') renderAllVitalsCharts(); } catch(e){ console.error('renderAll',e); }
  var CANV=${JSON.stringify(canvases)}, PLOT=${JSON.stringify(plotly)};
  setTimeout(function(){
    var out={};
    CANV.forEach(function(id){ try{ var c=document.getElementById(id); out[id]=c?c.toDataURL('image/png'):''; }catch(e){ out[id]=''; } });
    Promise.all(PLOT.map(function(id){
      var el=document.getElementById(id);
      return (el && window.Plotly) ? Plotly.toImage(el,{format:'png',width:760,height:380,scale:2}).then(function(u){return [id,u];}).catch(function(){return [id,''];}) : Promise.resolve([id,'']);
    })).then(function(rs){ rs.forEach(function(r){ out[r[0]]=r[1]; }); document.getElementById('out').textContent=JSON.stringify(out); document.title='READY'; });
  }, 1200);
})();
</script>
</body></html>`;
  fs.writeFileSync(path.join(webDir, "_endo-harness.html"), harness);
  console.log("wrote web/_endo-harness.html · charts:", CHARTS.length);
  process.exit(0);
}

// ════════════════ CONTENT BUILD ════════════════
const CHARTPNG = JSON.parse(fs.readFileSync("/tmp/endo_charts.json", "utf8"));
const chartImg = (id) => {
  const meta = CHARTS.find((c) => c[0] === id);
  const src = CHARTPNG[id];
  if (!src) return "";
  return `<div class="chart-card"><div class="chart-card-head"><div class="chart-card-title">${meta[2]}</div><div class="chart-card-meta">${meta[3]}</div></div><img class="chart-png" src="${src}" alt="${meta[2]}"></div>`;
};
const chartPair = (a, b) => `<div class="grid2">${chartImg(a)}${chartImg(b)}</div>`;

// ── InBody (with segmental — relevant for endocrinology) ───────────────────────
let inbody = sliceDivById(vitals, "inbody")
  .replace(/<h2 class="section-title">[\s\S]*?<\/h2>/, "")
  .replace(/<p class="section-desc">[\s\S]*?<\/p>/, "");
const INBODY_TX = [
  [">Body Water<", ">Água corporal<"], [">Protein<", ">Proteína<"], [">Body Fat Mass<", ">Massa de gordura<"],
  [">Body weight<", ">Peso<"], [">Body Weight<", ">Peso<"], [">Weight<", ">Peso<"], [">Body fat<", ">Gordura corporal<"],
  [">Skeletal muscle<", ">Massa muscular esq.<"], [">Skeletal Muscle Mass<", ">Massa muscular esquelética<"],
  [">Total Body Water<", ">Água corporal total<"], [">Above<", ">Acima<"], [">Below<", ">Abaixo<"],
  [">In range<", ">Na faixa<"], [">Overweight<", ">Sobrepeso<"], [">Lean mass<", ">Massa magra<"],
];
for (const [a, b] of INBODY_TX) inbody = inbody.split(a).join(b);

// ── vitals findings list-cards (the "textos/insights já extraídos") ───────────
// Pull the three-column findings blocks (HRV / sleep / BP etc.) that sit under
// the vitals charts, plus the page's AI-synthesis card.
const aiSynthCard = (() => {
  try { return sliceDivByClass(vitals, "ai-synthesis-card"); } catch { return ""; }
})();

// ── blood + urine: dense 2-column NEWSPAPER flow (column-fill:auto packs cards
// top-to-bottom, left column then right, with no half-empty pages). Each panel
// is a break-inside:avoid wrapper so no card is ever cut; every panel is
// shorter than a page-column at this compact sizing, so the flow never stalls. */
let labRaw = openDetails(sliceDivByClass(exams, "lab-panel-grid"));
const labPanels = [];
{ const re = /<details class="lab-panel"/g; let m; while ((m = re.exec(labRaw))) labPanels.push(sliceBalanced(labRaw, m.index, "details")); }
const labGrid = `<div class="lab-flow">${labPanels.map((p) => `<div class="lab-card-wrap">${p}</div>`).join("\n")}</div>`;

// ── out-of-reference markers (authored insight cards) ─────────────────────────
const OUT_OF_RANGE = [
  { sev: "high", t: "hs-CRP (PCR ultrassensível) — 12,1 mg/L", ref: "alvo < 3 mg/L",
    body: "Inflamação sistêmica acentuada (≈4× o limiar de risco cardiovascular). Relevante antes de iniciar GLP-1: ajuda a contextualizar resistência à insulina e risco cardiometabólico, e serve de marcador para acompanhar a resposta à perda de peso. Provável contribuição da crise cervical inflamatória de março e do uso de corticosteroide." },
  { sev: "high", t: "Colesterol total — 214 mg/dL", ref: "alvo < 190 mg/dL",
    body: "Dislipidemia leve. O HDL elevado (70 mg/dL) compensa parcialmente; LDL 119. GLP-1 tende a melhorar o perfil lipídico junto com a perda de peso — útil como linha de base." },
  { sev: "high", t: "Homocisteína — 14,4 µmol/L", ref: "alvo 5–12 µmol/L",
    body: "Elevada, coerente com a variante MTHFR C677T (atividade enzimática ~50%, ver Genética). Fator de risco cardiovascular independente; sugere suplementação com L-metilfolato + B6/B12 (B12 já alta, ver abaixo)." },
  { sev: "high", t: "Vitamina B12 — 1315 ng/L / B12 ativa > 150 pmol/L", ref: "ref. 272–1071 ng/L",
    body: "Acima da faixa — por suplementação. Sem significado patológico isolado, mas a dose de B12 pode ser reduzida; priorizar metilfolato para a homocisteína." },
  { sev: "low", t: "Cortisol matinal — 5 µg/dL", ref: "ref. 6–18,4 µg/dL (07–09h)",
    body: "No limite inferior / discretamente baixo. Em conjunto com DHEA limítrofe, sugere eixo adrenal depletado num quadro de estresse crônico. Vale confirmar com cortisol seriado / ACTH antes de atribuir a fadiga apenas ao contexto, sobretudo se houver perda de peso adicional com GLP-1." },
  { sev: "low", t: "T4 livre (FT4) — 11,2 pmol/L", ref: "ref. 12–22 pmol/L",
    body: "Discretamente baixo. Avaliar TSH em conjunto (no painel) para descartar hipotireoidismo subclínico/central — importante porque sintomas tireoidianos se sobrepõem aos efeitos do GLP-1 e à fadiga relatada." },
  { sev: "high", t: "Estradiol — 6,4 ng/dL (47,6 pg/mL no painel anterior)", ref: "ref. 1,1–4,3 ng/dL",
    body: "Estradiol elevado para o sexo masculino. Investigar relação testosterona/estradiol e aromatização (tecido adiposo aromatiza androgênios — relevante no contexto de adiposidade central e candidatura a GLP-1)." },
  { sev: "high", t: "Fosfato — 4,6 mg/dL", ref: "ref. 2,5–4,5 mg/dL",
    body: "Discretamente elevado; provavelmente sem significado isolado. Correlacionar com função renal (eGFR 85) e cálcio/PTH." },
  { sev: "low", t: "eGFR — 85 mL/min/1,73m²", ref: "alvo ≥ 90",
    body: "Função renal levemente reduzida (estágio G2). GLP-1 (tirzepatida) não exige ajuste renal nessa faixa, mas convém ter a basal documentada e monitorar hidratação — náusea/vômito iniciais do GLP-1 podem causar depleção de volume." },
  { sev: "low", t: "Densidade urinária — 1,005–1,006", ref: "ref. 1,015–1,025",
    body: "Urina diluída (alta ingestão hídrica ou diluição na coleta). Sem patologia se isolado; reavaliar com a função renal." },
];

// ── imaging studies (report text + key images + AI note) ──────────────────────
// Each: {label, sectionId, scanDir, keyImgs:[file,cap], reportSlicer, aiNote}
function imgGrid(dir, items) {
  return `<div class="kgrid">${items.map(([f, c]) => `<figure class="kimg"><img src="scans/${dir}/${f}" alt="${c}"><figcaption>${c}</figcaption></figure>`).join("")}</div>`;
}
// MRI face+brain report block (list-cards + conclusion + AI card after viewers)
const mriFBStart = exams.indexOf('<span class="lang-en">Radiologist\'s reports</span>');
const mriFBh3 = exams.lastIndexOf("<h3", mriFBStart);
const mriFBai = exams.indexOf('<div class="list-card ai-insight-card mb-3">', mriFBh3);
const mriFBreport = exams.slice(mriFBh3, mriFBai + sliceBalanced(exams, mriFBai, "div").length);

// Generic: for the other studies, slice the section and keep only the textual
// report parts (list-cards + alerts + ai-insight-card), dropping the viewers.
// Remove every <div class="...needle..."> block by BALANCED slicing (regex
// can't handle the nested divs inside ct-grid/ct-viewer, which left a black
// .ct-stage remnant behind).
function removeDivBlocks(html, needle) {
  let out = html, guard = 0;
  while (guard++ < 50) {
    const i = out.search(new RegExp(`<div class="[^"]*${needle}[^"]*"`));
    if (i < 0) break;
    const block = sliceBalanced(out, i, "div");
    out = out.slice(0, i) + out.slice(i + block.length);
  }
  return out;
}
function reportTextOf(sectionId) {
  let s;
  try { s = sliceDivById(exams, sectionId); } catch { return ""; }
  // remove the viewer grids/stages + export rows + the section title/desc
  s = removeDivBlocks(s, "ct-grid");
  s = removeDivBlocks(s, "ct-viewer");
  s = s.replace(/<div class="report-export-row"[\s\S]*?<\/div>/g, "");
  // keep list-cards, alerts, ai cards, two-col, h3/h4 — strip the leading section-label+h2+desc
  s = s.replace(/<div class="section-label">[\s\S]*?<\/div>/, "")
       .replace(/<h2 class="section-title">[\s\S]*?<\/h2>/, "")
       .replace(/<p class="section-desc">[\s\S]*?<\/p>/, "");
  return s;
}

const IMAGING = [
  { label: "RM de face + crânio · 8 jun 2026", dir: "mri-face-2026-06-08",
    imgs: [["image_s0001_i0019.jpg", "Face · T2 STIR coronal"], ["image_s0004_i0037.jpg", "Face · T1 axial"], ["image_s0001_i0027.jpg", "Crânio · difusão axial"], ["image_s0003_i0081.jpg", "Crânio · T2 FLAIR sagital"]],
    dir2: "mri-brain-2026-06-08", report: mriFBreport },
  { label: "Ultrassom dermatológico da fronte · 8 jun 2026", dir: "us-face-2026-06-08",
    imgs: [["image_s0001_i0001.jpg", "Modo B · região frontal"], ["image_s0001_i0345.jpg", "Doppler colorido"]],
    report: reportTextOf("us-face-2026") },
  { label: "RM de joelho (esq.) · 8 jun 2026", dir: "mri-knee-2026-06-08",
    imgs: [["image_s0001_i0010.jpg", "Sequência 1"], ["image_s0002_i0010.jpg", "Sequência 2"]],
    report: reportTextOf("mri-knee-2026") },
  { label: "RM da coluna cervical · 26 mar 2026", dir: "mri-cervical-spine",
    imgs: null, report: reportTextOf("mri-cervical") },
  { label: "TC dos seios da face · 12 jan 2026", dir: "mri-head",
    imgs: null, report: reportTextOf("imaging") },
  { label: "TC de crânio · 3 jan 2026", dir: "ct-brain",
    imgs: null, report: reportTextOf("ct-brain-paris") },
  { label: "RM + TC lombossacra · 29 out 2024", dir: "mri-lumbar-spine", deid: true, report: reportTextOf("lumbar-2024") },
  { label: "Angio-TC de coronárias · 19 jul 2023", dir: "tc-heart", deid: true, report: reportTextOf("tc-heart") },
  { label: "TC de crânio / RM de cabeça (angio-veno) · arquivo", dir: "mri-head", deid: true, report: "" },
  { label: "EEG · 29 mar 2023", dir: "eeg", noImgs: true, report: reportTextOf("eeg") },
];
// De-identified key images live ONLY in web/scans/_endo_keyimg/<dir>/NN.jpg
// (a Python pre-pass masked the burned-in PHI band + picked mid-stack slices).
// We never embed raw scan folders for the non-pre-de-identified studies.
function deidGrid(dir) {
  let files;
  try { files = fs.readdirSync(path.join(webDir, "scans", "_endo_keyimg", dir)).filter((f) => /\.jpg$/i.test(f)).sort(); }
  catch { return ""; }
  if (!files.length) return "";
  return imgGrid(`_endo_keyimg/${dir}`, files.map((f, i) => [f, `Imagem ${i + 1}`]));
}
// Per request: NO images in the imaging section — only the radiologist reports
// and the AI insight cards. Beyond the viewer grids, several report blocks embed
// clinical photos (face/forehead — biometric PHI) via <figure>/<img>; strip them
// all so the section is text-only.
const stripMedia = (html) => (html || "")
  .replace(/<figure[\s\S]*?<\/figure>/gi, "")
  .replace(/<img\b[^>]*>/gi, "")
  .replace(/<div class="[^"]*(?:photo|gallery|image|img-grid|kgrid|ct-grid)[^"]*"[\s\S]*?<\/div>/gi, "")
  .replace(/<picture[\s\S]*?<\/picture>/gi, "");
const imagingHtml = IMAGING.map((s) =>
  `<div class="study"><h3 class="rep-h3">${s.label}</h3>${stripMedia(s.report) || '<p class="prose">Laudo em texto não disponível neste registro.</p>'}</div>`
).join("\n");

// ── section wrapper + bespoke PT prose ────────────────────────────────────────
const sec = (label, title, body) => `<section class="rep"><div class="wrap"><div class="sec-label">${label}</div><h2 class="sec-title">${title}</h2>${body}</div></section>`;

const aiTop = sec("00 · Síntese para o endocrinologista",
  `Principais achados para o endocrinologista <span class="ai-pill">IA</span>`, `
  <p class="lead">Síntese por IA do registro do paciente, voltada à consulta endócrina e a uma possível introdução de agonista GLP-1/GIP (tirzepatida, "Mounjaro"). Para discussão clínica — não constitui diagnóstico nem prescrição.</p>
  <div class="ai-card ai-edge-high"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-high">Candidatura a GLP-1</span><span class="ai-ct">1 · Adiposidade central + inflamação, sem diabetes estabelecido</span></div>
    <p>Perfil de <strong>sobrepeso com adiposidade central</strong> (InBody: 78 kg, gordura 29,9%, IMC 25,8, RCQ 1,02) e <strong>inflamação sistêmica marcante (hs-CRP 12,1 mg/L)</strong>, mas com <strong>glicemia e HbA1c normais</strong> (jejum 80 mg/dL, HbA1c 5,2%) e CGM em alvo. A indicação de tirzepatida seria primariamente para <strong>controle de peso / risco cardiometabólico</strong>, não para diabetes. Convém documentar a basal metabólica e revisar metas com o paciente.</p></div>
  <div class="ai-card ai-edge-high"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-high">Segurança pré-GLP-1</span><span class="ai-ct">2 · Triagem tireoidiana, renal e adrenal antes de iniciar</span></div>
    <p><strong>FT4 discretamente baixo (11,2 pmol/L)</strong> e <strong>cortisol matinal no limite inferior (5 µg/dL)</strong> pedem avaliação de eixo tireoidiano (TSH em conjunto) e adrenal antes do início, pois sintomas se sobrepõem aos do GLP-1. <strong>eGFR 85</strong> (G2) não contraindica tirzepatida, mas a náusea/vômito iniciais podem depletar volume — monitorar hidratação e função renal. <strong>Rastreio de carcinoma medular de tireoide / NEM-2 não consta no painel genético</strong> — confirmar história familiar e calcitonina antes de iniciar (alerta de bula do GLP-1).</p></div>
  <div class="ai-card ai-edge-elevated"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-elevated">Interações</span><span class="ai-ct">3 · Polifarmácia de ação central + esvaziamento gástrico</span></div>
    <p>O paciente usa <strong>valproato (Depakote ER), pregabalina, quetiapina e diazepam em desmame</strong>. A tirzepatida <strong>não é metabolizada por CYP</strong> (peptídeo) — sem interação farmacocinética direta — mas <strong>retarda o esvaziamento gástrico</strong>, o que pode alterar a absorção de medicações orais; com <strong>CYP2C9 intermediário</strong> (valproato/AINEs) vale reforçar a monitorização. Atentar à sobreposição de efeitos GI e à retenção hídrica do valproato/pregabalina ao interpretar peso e pressão.</p></div>
  <p class="ai-disc">Síntese por modelo de linguagem — para discussão clínica, não constitui diagnóstico nem prescrição.</p>`);

const vitalsSec = `<section class="rep"><div class="wrap">
  <div class="sec-label">01 · Sinais vitais e biometria contínua</div>
  <h2 class="sec-title">Vitais — Oura, Apple Watch, balança e braçadeira</h2>
  <p class="prose">Biometria diária e contínua das fontes do paciente: anel Oura (sono, atividade, VFC/FC), Apple Watch (histórico de FC), braçadeira Withings (pressão) e balança/InBody (composição corporal). Todos os gráficos e leituras consolidados abaixo.</p>
  ${aiSynthCard ? `<div class="ai-synthesis-wrap">${aiSynthCard}</div>` : ""}

  <h3 class="rep-h3">Composição corporal</h3>
  ${chartImg("bodyChart")}
  <h4 class="rep-h4">InBody — composição e análise segmentar</h4>
  ${inbody}

  <h3 class="rep-h3">Glicose (CGM)</h3>
  ${chartPair("glucoseChart", "glucosePatternsChart")}

  <h3 class="rep-h3">Cardiovascular — pressão arterial e frequência cardíaca</h3>
  ${chartPair("bpPatternsChart", "bpDailyChart")}
  ${chartPair("bpChart", "cardioChart")}
  ${chartPair("hrPatternsChart", "rhr-weekly-timeline")}

  <h3 class="rep-h3">Sono</h3>
  ${chartPair("sleepStageChart", "sleep-stage-weekly-composition")}
  ${chartImg("sleep-total-weekly-timeline")}

  <h3 class="rep-h3">Atividade e estresse</h3>
  ${chartPair("stepsChart", "exerciseMixChart")}
  ${chartImg("stressChart")}
</div></section>`;

const labsSec = `<section class="rep"><div class="wrap">
  <div class="sec-label">02 · Laboratório</div>
  <h2 class="sec-title">Sangue e urina — painel completo (8 jun 2026)</h2>
  <p class="prose">Painel completo do Hospital Sírio-Libanês (8 jun 2026), solicitado pelo Dr. Marco Antonio de Carvalho. Cada cartão posiciona o valor dentro da faixa de referência. Abaixo dos painéis, os insights dos marcadores <strong>fora de referência</strong> com leitura voltada ao contexto endócrino/GLP-1.</p>
  <div class="ai-card ai-edge-elevated"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-elevated">Fora de referência</span><span class="ai-ct">Marcadores a destacar para o endocrinologista</span></div>
    <div class="ooref">${OUT_OF_RANGE.map((o) => `<div class="oo oo-${o.sev}"><div class="oo-t">${o.t} <span class="oo-ref">${o.ref}</span></div><div class="oo-b">${o.body}</div></div>`).join("")}</div>
    <p class="ai-disc" style="margin-top:8px">Interpretação por IA dos marcadores sinalizados — para discussão clínica.</p></div>
  <h3 class="rep-h3">Todos os painéis</h3>
  ${labGrid}
</div></section>`;

const imagingSec = `<section class="rep"><div class="wrap">
  <div class="sec-label">03 · Imagem</div>
  <h2 class="sec-title">Exames de imagem — laudos e insights</h2>
  <p class="prose">Todos os exames de imagem do registro, com os laudos dos radiologistas (quando em texto) e as notas de IA. Ordenados do mais recente ao mais antigo. As imagens DICOM permanecem no registro do paciente e podem ser disponibilizadas separadamente.</p>
  ${imagingHtml}
</div></section>`;

const geneticsSec = sec("04 · Genética",
  `Genética relevante para o endocrinologista e GLP-1 <span class="ai-pill">IA</span>`, `
  <p class="lead">Marcadores do painel GnTech TotalGene (NGS, jun 2023) que fogem do padrão e importam ao contexto endócrino e à introdução de tirzepatida (Mounjaro). Inferência por IA — não substitui avaliação genética.</p>
  <div class="ai-card ai-edge-info"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-info">Apetite e peso</span><span class="ai-ct">MC4R · HTR2C</span></div>
    <p><strong>MC4R rs489693 (C/A)</strong> e <strong>HTR2C rs1414334 (G/-)</strong> — eixo melanocortina/serotoninérgico do apetite e do ganho de peso. No painel, ambos indicam <strong>menor risco de ganho de peso induzido por fármacos</strong>; biologicamente coerente com boa resposta a terapias que atuam na saciedade central (como GLP-1/GIP). <strong>HTR2C rs3813929 (C/-)</strong> aparece com risco aumentado de efeitos adversos metabólicos — relevante pela quetiapina em uso concomitante.</p></div>
  <div class="ai-card ai-edge-elevated"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-elevated">Metabolismo da homocisteína</span><span class="ai-ct">MTHFR C677T + A1298C</span></div>
    <p><strong>MTHFR C677T (C/T, ~50% da atividade enzimática)</strong> + <strong>A1298C (A/C)</strong> — explica a <strong>homocisteína elevada (14,4 µmol/L)</strong> observada nos exames. Risco cardiovascular independente; indica <strong>L-metilfolato</strong> em vez de ácido fólico comum (a B12 já está alta). Importante na otimização cardiometabólica pré-GLP-1.</p></div>
  <div class="ai-card ai-edge-info"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-info">Farmacocinética de co-medicações</span><span class="ai-ct">CYP2C9 · CYP3A5 · UGT2B15</span></div>
    <p>A tirzepatida é um <strong>peptídeo, não metabolizado por CYP</strong> — sem interação PK direta. Porém, com <strong>CYP2C9 *1/*2 (intermediário)</strong> e <strong>UGT2B15 reduzido</strong>, a depuração de <strong>valproato</strong> (Depakote ER) e de AINEs já é menor; somado ao <strong>retardo do esvaziamento gástrico do GLP-1</strong>, reforça a monitorização sérica do valproato e atenção à absorção de orais. <strong>CYP3A5 não-expressor</strong> é relevante para sedativos (ver relatórios anteriores), não para a tirzepatida.</p></div>
  <div class="ai-card ai-edge-elevated"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-elevated">Lacuna de teste</span><span class="ai-ct">NEM-2 / carcinoma medular de tireoide (RET)</span></div>
    <p>O painel <strong>não inclui RET / NEM-2</strong>, associado ao carcinoma medular de tireoide. Como os agonistas GLP-1/GIP carregam alerta de bula para CMT, recomenda-se <strong>história familiar dirigida + calcitonina basal</strong> antes de iniciar, já que a genética disponível não exclui o risco.</p></div>
  <p class="ai-disc">Inferência por modelo de linguagem sobre o painel PGx — para discussão com o endocrinologista, não constitui prescrição.</p>`);

// ── Medications & supplements (final section, lab-marker framing) ─────────────
// Mirrors the backend `medications` table; supplements: none on record. The note
// column and AI summary focus on how each drug can move the blood markers seen
// in Section 02. Standard pharmacology, kept conservative.
const medRows = [
  ["Depakote ER", "divalproato de sódio (valproato)", "1.000 mg/dia", "Anticonvulsivante / estabilizador de humor",
   "↑ transaminases e GGT, hiperamonemia e plaquetopenia possíveis; ganho de peso e resistência à insulina, com ↑ triglicerídeos."],
  ["Lyrica", "pregabalina", "300 mg/dia (em 2 tomadas)", "Gabapentinoide (análogo de GABA)",
   "Praticamente neutra nos exames de rotina; pode elevar CK e favorecer ganho de peso/edema."],
  ["Quetiapina", "quetiapina", "50 mg/dia", "Antipsicótico atípico",
   "Disglicemia e dislipidemia (↑ glicose/HbA1c, ↑ triglicerídeos e colesterol); pode ↑ prolactina e transaminases."],
  ["Valium", "diazepam", "32,5 mg/dia (desmame 40 → 35 → 32,5)", "Benzodiazepínico",
   "Sem efeito relevante nos exames laboratoriais de rotina."],
  ["Revia", "naltrexona", "50 mg/dia", "Antagonista opioide",
   "Elevação dose-dependente de transaminases — convém monitorar a função hepática."],
];
const medTableRows = medRows.map(([brand, inn, dose, klass, note]) =>
  `<tr><td class="strong">${brand}<div style="font-size:8.5pt;color:#6E7B8A;font-weight:400">${inn}</div></td><td class="num">${dose}</td><td>${klass}</td><td><span class="pill pill-info">Ativa</span></td><td style="font-size:9pt">${note}</td></tr>`).join("");
// AI summary — how the regimen can move the Section 02 markers (marker → drug).
const MED_MARKER_LINKS = [
  { sev: "low", t: "Cortisol matinal baixo (5 µg/dL)", ref: "Diprospan (corticosteroide)",
    body: "A infiltração recente de betametasona (mar 2026) pode ter suprimido o eixo HPA — antes de atribuir a depleção adrenal apenas ao estresse crônico, reavaliar cortisol/ACTH afastado do corticoide." },
  { sev: "high", t: "Colesterol 214 mg/dL + risco glicêmico", ref: "quetiapina + valproato",
    body: "Ambos têm pegada cardiometabólica (↑ colesterol/triglicerídeos, tendência a disglicemia e ganho de peso). Glicemia e HbA1c hoje normais, mas é o pano de fundo da candidatura a GLP-1 — vale monitorar." },
  { sev: "high", t: "Transaminases / função hepática", ref: "valproato + naltrexona",
    body: "Ambos elevam AST/ALT/GGT de forma dose-dependente; o valproato ainda eleva amônia. Recomenda-se LFTs basais e seriadas, sobretudo se iniciar tirzepatida." },
  { sev: "low", t: "Plaquetas e amônia", ref: "valproato",
    body: "Plaquetopenia e hiperamonemia são efeitos conhecidos do valproato — manter hemograma e, havendo sintomas (confusão, letargia), dosar amônia." },
  { sev: "high", t: "hs-CRP 12,1 mg/L", ref: "corticosteroide (efeito oposto)",
    body: "Corticoides reduzem a PCR; uma PCR ainda elevada apesar do corticoide recente reforça que a inflamação é genuína, não artefato medicamentoso." },
];
const medsSec = sec("05 · Medicações e suplementos",
  `Medicações e suplementos <span class="ai-pill">IA</span>`, `
  <p class="prose">Regime atual conforme o registro do backend (tabela <code>medications</code>), com ajustes de dose coordenados com o Dr. Eduardo Tisher. A coluna de observações e o sumário de IA destacam como cada fármaco pode mover os marcadores laboratoriais da Seção 02.</p>
  <table class="data-table">
    <thead><tr><th>Medicação</th><th>Dose</th><th>Classe</th><th>Status</th><th>Interferência em marcadores de sangue</th></tr></thead>
    <tbody>${medTableRows}</tbody></table>
  <div class="alert alert-warn"><strong>Uso pontual (não de manutenção):</strong> infiltração de corticosteroide <strong>Diprospan</strong> (betametasona) na crise de protrusão cervical (mar 2026). Efeito laboratorial transitório relevante: <strong>supressão do eixo HPA</strong> (pode reduzir cortisol matinal e ACTH), <strong>hiperglicemia</strong>, <strong>leucocitose com linfopenia</strong> e queda da PCR.</div>
  <h3 class="rep-h3">Suplementação</h3>
  <table class="data-table">
    <thead><tr><th>Suplemento</th><th>Dose</th><th>Observação</th></tr></thead>
    <tbody><tr><td colspan="3" style="color:#6E7B8A;font-style:italic">Nenhum suplemento registrado no backend.</td></tr></tbody>
  </table>
  <div class="ai-card ai-edge-elevated"><div class="ai-head"><span class="ai-pill">IA</span><span class="ai-chip chip-elevated">Sumário · fármacos × exames</span><span class="ai-ct">Como o regime atual pode interferir nos marcadores de sangue</span></div>
    <p>Ao ler os marcadores fora de referência da Seção 02, vale descontar a contribuição farmacológica. Mapa marcador → fármaco:</p>
    <div class="ooref">${MED_MARKER_LINKS.map((o) => `<div class="oo oo-${o.sev}"><div class="oo-t">${o.t} <span class="oo-ref">${o.ref}</span></div><div class="oo-b">${o.body}</div></div>`).join("")}</div>
    <p style="font-size:10.5pt;line-height:1.5;margin-top:9px"><strong>Para o endocrinologista:</strong> antes/depois de iniciar tirzepatida, priorizar <strong>LFTs</strong> (valproato + naltrexona), <strong>perfil lipídico e glicêmico</strong> (quetiapina + valproato) e <strong>reavaliação do eixo adrenal</strong> afastada do corticoide. A naltrexona e o diazepam têm, no mais, baixa interferência laboratorial.</p>
    <p class="ai-disc">Síntese por modelo de linguagem sobre o registro do paciente — para discussão clínica, não constitui diagnóstico nem prescrição.</p></div>`);

// ── CSS ───────────────────────────────────────────────────────────────────────
const EXTRA_CSS = `
@page { size:A4; margin:11mm 12mm; }
*{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important; }
html,body{ background:#fff !important; margin:0; padding:0; color:#1A2129; font-family:'Raleway',system-ui,sans-serif; font-size:11pt; line-height:1.5; }
html[lang="pt"] .lang-en{ display:none !important; }
.topnav,.section-nav,.sp-nav,.lang-switch,.signout-btn,.changepatient-btn,[data-export-btn],.back-link,.add-data-btn,.iu-wrap,.danger-zone,.vr-bar,.vr-overlay,.ct-viewer,.ct-grid,.report-export-row,.ai-synthesis-link{display:none!important;}
.rep{ margin:0 0 6mm 0; }
/* Major section dividers (00-04) — 2x font + a rule on top, so each big
   section opens clearly. */
.sec-label{ font-family:'IBM Plex Mono',monospace; font-size:18pt; letter-spacing:.08em; text-transform:uppercase; color:#0D1B2A; margin:0 0 8px; border-top:2.5px solid #0D1B2A; padding-top:10px; break-after:avoid; }
.sec-title{ font-family:'Raleway',sans-serif; font-weight:700; font-size:19pt; color:#0D1B2A; margin:0 0 10px; line-height:1.15; break-after:avoid; }
.rep-h3{ font-family:'Raleway',sans-serif; font-weight:700; font-size:14pt; color:#244E6E; margin:16px 0 8px; break-after:avoid; border-top:2px solid #E8EEF3; padding-top:10px; }
.rep-h4{ font-family:'Raleway',sans-serif; font-weight:700; font-size:12pt; color:#0D1B2A; margin:12px 0 6px; break-after:avoid; }
.prose,.lead{ font-size:11pt; line-height:1.55; margin:0 0 9px; }
.lead{ color:#0D1B2A; border-left:3px solid #B8954A; padding-left:11px; }
.prose ul{ margin:6px 0 9px 18px; } .prose li{ margin:3px 0; }
.grid2{ display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:start; }
.chart-card{ background:#fff!important;border:1px solid #E5E2DC!important;border-radius:9px;padding:9px 11px;margin:0 0 10px; break-inside:avoid; }
.chart-card-head{ margin-bottom:5px; }
.chart-card-title{ font-family:'Raleway',sans-serif; font-weight:700; font-size:11pt; color:#0D1B2A; }
.chart-card-meta{ font-family:'IBM Plex Mono',monospace; font-size:8pt; color:#6E7B8A; margin-top:2px; }
.chart-png{ width:100%; height:auto; display:block; }
.ai-synthesis-wrap{ margin:6px 0 4px; }
.ai-synthesis-card{ background:#FDFAF3; border:1px solid #EFE4C6; border-radius:10px; padding:12px 14px; }
.ai-synthesis-lead{ font-size:10.5pt; line-height:1.55; margin:0 0 8px; }
.ai-synthesis-grid{ display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
.ai-synthesis-eyebrow{ font-family:'IBM Plex Mono',monospace; font-size:7.5pt; letter-spacing:.1em; text-transform:uppercase; color:#B8954A; margin-bottom:3px; }
.ai-synthesis-block-title{ font-family:'Raleway',sans-serif; font-weight:700; font-size:10pt; color:#0D1B2A; margin:0 0 4px; }
.ai-synthesis-block-body{ font-size:9pt; line-height:1.45; margin:0; }
.ai-synthesis-bottom{ font-size:9.5pt; margin-top:8px; border-top:1px solid #EADFBF; padding-top:7px; }
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
/* out-of-range list */
.ooref{ display:flex; flex-direction:column; gap:6px; margin-top:4px; }
.oo{ border-left:3px solid #B8954A; padding:4px 0 4px 10px; }
.oo-high{ border-left-color:#c0392b } .oo-low{ border-left-color:#2f6489 }
.oo-t{ font-family:'Raleway',sans-serif; font-weight:700; font-size:10pt; color:#0D1B2A; }
.oo-ref{ font-family:'IBM Plex Mono',monospace; font-size:8pt; color:#6E7B8A; font-weight:400; margin-left:6px; }
.oo-b{ font-size:9.5pt; line-height:1.45; margin-top:2px; }
/* imaging */
.study{ break-inside:auto; margin-bottom:6px; }
.kgrid{ display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:6px 0 10px; }
.kimg{ margin:0; } .kimg img{ width:100%; border:1px solid #cfd6de; border-radius:5px; display:block; background:#000; }
.kimg figcaption{ font-family:'IBM Plex Mono',monospace; font-size:8pt; color:#6E7B8A; margin-top:3px; text-align:center; }
.list-card{ background:#fff; border:1px solid #E5E2DC; border-radius:9px; padding:11px 13px; margin:0 0 9px; break-inside:avoid; }
.list-card h4{ font-family:'Raleway',sans-serif; font-weight:700; font-size:11pt; color:#0D1B2A; margin:0 0 6px; }
.list-card ul{ margin:0 0 0 16px; } .list-card li{ font-size:9.5pt; line-height:1.45; margin:3px 0; }
.two-col{ display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.alert{ border-radius:8px; padding:9px 12px; font-size:9.5pt; line-height:1.5; margin:8px 0; break-inside:avoid; }
.alert-warn{ background:#FBF1E3; border:1px solid #E8C99A; } .alert-info{ background:#EAF1F6; border:1px solid #Bcd3e3; }
.ai-insight-card{ background:#FDFAF3 !important; border:1px solid #EFE4C6 !important; }
/* meds table (section 05) */
.data-table{ width:100%; border-collapse:collapse; font-size:9.5pt; margin:4px 0 10px; break-inside:avoid; }
.data-table th{ text-align:left; background:#0D1B2A; color:#fff; padding:6px 8px; font-family:'Raleway',sans-serif; font-weight:700; font-size:8.5pt; }
.data-table td{ padding:5px 8px; border-bottom:1px solid #ECE8DF; vertical-align:top; }
.data-table td.strong{ font-weight:700; color:#0D1B2A; }
.data-table .num{ text-align:right; font-family:'IBM Plex Mono',monospace; white-space:nowrap; }
.pill{ font-size:8pt; padding:1px 7px; border-radius:999px; background:#EEF1F5; color:#52606b; }
.pill-info{ background:#e7eff5; color:#2f6489; }
img,svg{ max-width:100%; height:auto; }
/* InBody */
#inbodyBars{ margin-top:4px; } #inbodySegmental{ max-height:360px; overflow:hidden; }
#inbody .inbody-fig-wrap{ max-width:190px; }
/* lab grid — dense newspaper flow */
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
<title>Relatório endocrinológico — Joao Victor Creste</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style id="site-styles">${stylesCss}</style>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@sgratzl/chartjs-chart-boxplot@4.4.4/build/index.umd.min.js"></script>
<style>${EXTRA_CSS}</style><style id="blood-shrink">${bloodShrink.join("\n")}</style></head>
<body class="theme-light"><main style="padding:0;max-width:none">
${aiTop}
${vitalsSec}
${labsSec}
${imagingSec}
${geneticsSec}
${medsSec}
</main>
<div style="position:absolute;left:-9999px"><div id="inbodyBars2"></div></div>
<script src="assets/data.js?v=35"></script>
<script>${CHART_JS}
// renderInBody is an IIFE that already populated #inbodyBars/#inbodySegmental at
// parse time. No live chart rendering runs (all charts are PNGs) -> print stable.
</script>
</body></html>`;
fs.writeFileSync(path.join(webDir, "_endo-content.html"), content);

const cover = `<!DOCTYPE html><html lang="pt"><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
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
  <div class="top"><span>Confidencial · Comunicação clínica</span><span>Endocrinologia</span></div>
  <div class="brandline">Lumen Health</div>
  <div class="center">
    <div class="tag">Relatório clínico</div>
    <div class="title">Avaliação<br><strong>endocrinológica</strong></div>
    <div class="sub">Síntese completa de vitais, laboratório, imagem e genética — preparada para a discussão de uma possível terapia com agonista GLP-1/GIP (tirzepatida).</div>
  </div>
  <div class="meta">
    <div class="k">Paciente</div><div class="v">Joao Victor Creste Dias de Souza</div>
    <div class="k">Nascimento</div><div class="v">17 de outubro de 1992</div>
    <div class="k">Sexo</div><div class="v">Masculino</div>
    <div class="k">Foco</div><div class="v">Metabólico / candidatura a GLP-1 (Mounjaro)</div>
    <div class="k">Gerado em</div><div class="v">12 de junho de 2026</div>
    <div class="k">Idioma</div><div class="v">Português</div>
  </div>
  <div class="inc-l">Inclui</div>
  <div class="chips">
    <span class="chip">Síntese da IA</span><span class="chip">Vitais completos</span><span class="chip">Composição corporal</span>
    <span class="chip">Glicose (CGM)</span><span class="chip">Pressão arterial</span><span class="chip">Sono</span>
    <span class="chip">Sangue e urina</span><span class="chip">Marcadores fora de referência</span>
    <span class="chip">Imagem + laudos</span><span class="chip">Genética e GLP-1</span><span class="chip">Medicações e suplementos</span>
  </div>
  <p class="disc">Estritamente confidencial. Documento gerado a partir do registro clínico do paciente. As seções marcadas como IA são interpretações por modelo de linguagem, destinadas à discussão clínica — não constituem diagnóstico nem prescrição.</p>
  <div class="foot"><span>Lumen Health · Documento confidencial</span><span>12-06-2026</span></div>
</section></body></html>`;
fs.writeFileSync(path.join(webDir, "_endo-cover.html"), cover);

console.log("wrote web/_endo-cover.html + web/_endo-content.html");
console.log(`  charts embedded: ${Object.values(CHARTPNG).filter(Boolean).length}/${CHARTS.length}`);
console.log(`  lab panels: ${labPanels.length} · out-of-range: ${OUT_OF_RANGE.length} · imaging studies: ${IMAGING.length} · meds: ${medRows.length}`);

// ── render with headless Chrome + pdfunite ────────────────────────────────────
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outPath = path.join(root, "Patients", "Joao Victor Creste", "Relatorio Endocrinologico - Joao Victor Creste - 12-06-2026.pdf");
const tmpCover = path.join(root, ".staging", "_endo-cover.pdf");
const tmpContent = path.join(root, ".staging", "_endo-content.pdf");
fs.mkdirSync(path.join(root, ".staging"), { recursive: true });
function renderPDF(htmlPath, pdfPath) {
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--no-pdf-header-footer",
    "--virtual-time-budget=15000",
    `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
  ], { stdio: "pipe" });
}
console.log("• rendering cover …");
renderPDF(path.join(webDir, "_endo-cover.html"), tmpCover);
console.log("• rendering content …");
renderPDF(path.join(webDir, "_endo-content.html"), tmpContent);
console.log("• merging …");
execFileSync("pdfunite", [tmpCover, tmpContent, outPath], { stdio: "pipe" });
console.log("✓ PDF:", path.relative(root, outPath));
