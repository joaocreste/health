#!/usr/bin/env node
/**
 * Regenerate Joao's detailed "All panels" section in web/physical-exams.html
 * from the 2026-06-08 panel (Patients/.../Blood/extracted-labs.json), replacing
 * the 13 April-25 <details> blocks (id=lab-hemograma … id=lab-urina) that sit
 * between the "All N panels" grid and the Historical comparison block.
 *
 * Bars use the page's confirmed formula: left% = 10 + 80·(v−refLow)/(refHigh−refLow),
 * clamped to [2,98] (refLow→10%, refHigh→90%). A bar renders only when both
 * reference bounds are numeric; otherwise just value + reference text.
 *
 *   node scripts/build-joao-detailed-panels.mjs            # dry run (prints stats)
 *   node scripts/build-joao-detailed-panels.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const FILE = path.join(root, "web/physical-exams.html");
const PAYLOAD = path.join(root, "Patients/Joao Victor Creste/Blood/extracted-labs.json");
const APPLY = process.argv.includes("--apply");

function loadTaxonomy() {
  const src = fs.readFileSync(path.join(root, "web/assets/lab-taxonomy.js"), "utf8");
  const ctx = { window: {}, module: { exports: {} } };
  vm.createContext(ctx);
  vm.runInContext(src + "\n;globalThis.__T = window.LAB_TAXONOMY;", ctx);
  return ctx.__T;
}
const TAX = loadTaxonomy();
const data = JSON.parse(fs.readFileSync(PAYLOAD, "utf8"));
const byKey = {};
for (const r of data.results) byKey[r.canonical_analyte] = r;

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ptNum = (n) => String(n).replace(".", ",");

// flag -> presentation
function present(r, overrideWatch) {
  const f = r.flag;
  const watch = overrideWatch || f === "high" || f === "low";
  if (watch) return { cls: "watch", pill: "watch", en: "Watch", pt: "Atenção", marker: "watch" };
  return { cls: "normal", pill: "ok", en: "Normal", pt: "Normal", marker: "normal" };
}

// concise bilingual notes for the markers worth flagging
const NOTES = {
  "Total cholesterol": ["214 mg/dL, slightly above the &lt;190 target — offset by excellent HDL (70). Discuss the full lipid picture with the physician.", "214 mg/dL, levemente acima da meta &lt;190 — compensado por HDL excelente (70). Discutir o quadro lipídico completo com o médico."],
  "Estradiol": ["64 pg/mL (6.4 ng/dL), above the male range. May relate to body composition or medication — discuss with the physician.", "64 pg/mL (6,4 ng/dL), acima da faixa masculina. Pode relacionar-se à composição corporal ou medicação — discutir com o médico."],
  "Phosphate": ["Marginally above range (4.6 vs 4.5 mg/dL). Usually benign; correlate with diet and kidney function.", "Marginalmente acima da faixa (4,6 vs 4,5 mg/dL). Geralmente benigno; correlacionar com dieta e função renal."],
  "Vitamin B12": ["Above the upper reference — typically reflects supplementation, not pathology.", "Acima do limite superior — geralmente reflete suplementação, não patologia."],
  "Cortisol": ["Below the 7–9 a.m. range (5.0 vs 6.0 µg/dL). Drawn 09:53 — correlate with collection timing and any glucocorticoid use before repeating.", "Abaixo da faixa das 7–9h (5,0 vs 6,0 µg/dL). Coletado às 09:53 — correlacionar com horário da coleta e uso de glicocorticoide antes de repetir."],
  "Specific gravity (urine)": ["Dilute sample (1.006 vs ≥1.010). Suggests high fluid intake at collection; no pathology if isolated.", "Amostra diluída (1,006 vs ≥1,010). Sugere alta ingestão hídrica na coleta; sem patologia se isolado."],
  "Homocysteine": ["12.8 µmol/L — between the folate-supplemented (≤12) and non-supplemented (≤15) cut-offs. Independent cardiovascular marker; discuss B-vitamin status.", "12,8 µmol/L — entre os limiares com suplementação de folato (≤12) e sem (≤15). Marcador cardiovascular independente; discutir status de vitaminas B."],
  "CRP": ["0.47 mg/dL (≈4.7 mg/L) — within range and markedly lower than the 12.1 mg/L seen on 25 Apr. Systemic inflammation has improved.", "0,47 mg/dL (≈4,7 mg/L) — dentro da faixa e bem menor que os 12,1 mg/L de 25 abr. A inflamação sistêmica melhorou."],
};
const WATCH_OVERRIDE = new Set(["Homocysteine"]);

function block(canonical) {
  const r = byKey[canonical];
  if (!r) { missing.push(canonical); return ""; }
  const meta = TAX.MARKERS[canonical] || { en: canonical, pt: canonical };
  const p = present(r, WATCH_OVERRIDE.has(canonical));
  const val = r.value_numeric != null ? esc(r.value_numeric) : esc(r.value_text);
  const unit = esc(r.unit_reported || "");

  let bar = "";
  if (r.value_numeric != null && typeof r.ref_low === "number" && typeof r.ref_high === "number" && r.ref_high > r.ref_low) {
    let pct = 10 + 80 * (r.value_numeric - r.ref_low) / (r.ref_high - r.ref_low);
    pct = Math.max(2, Math.min(98, pct));
    bar =
`        <div class="lab-bar-wrap">
          <div class="lab-bar">
            <div class="lab-bar-bg"></div>
            <div class="lab-bar-range"></div>
            <div class="lab-bar-tick lab-bar-tick-min"></div>
            <div class="lab-bar-tick lab-bar-tick-max"></div>
            <div class="lab-bar-marker lab-bar-marker-${p.marker}" style="left: ${Math.round(pct * 100) / 100}%;">
              <div class="lab-bar-dot"></div>
            </div>
          </div>
          <div class="lab-bar-labels">
            <span>min ${ptNum(r.ref_low)}</span>
            <span>max ${ptNum(r.ref_high)}</span>
          </div>
        </div>
`;
  }
  const ref = esc(r.ref_text || "");
  const note = NOTES[canonical]
    ? `        <div class="lab-note"><span class="lang-en">${NOTES[canonical][0]}</span><span class="lang-pt">${NOTES[canonical][1]}</span></div>\n`
    : "";
  return (
`      <div class="lab-test lab-test-${p.cls}">
        <div class="lab-test-head">
          <div class="lab-test-name">${esc(meta.en)} <span class="lab-name-pt">(${esc(meta.pt)})</span></div>
          <div class="lab-test-meta">
            <span class="lab-test-val"><span class="lab-val-num">${val}</span> <span class="lab-val-unit">${unit}</span></span>
            <span class="pill pill-${p.pill}"><span class="lang-en">${p.en}</span><span class="lang-pt">${p.pt}</span></span>
          </div>
        </div>
${bar}        <div class="lab-test-foot"><div class="lab-test-ref"><span class="lang-en">Reference:</span><span class="lang-pt">Referência:</span> ${ref}</div></div>
${note}      </div>
`);
}

const PANELS = [
  { id: "lab-hemograma", en: "Complete Blood Count — Erythrogram", pt: "Hemograma — Eritrograma", sen: "Red blood cells and oxygenation capacity", spt: "Hemácias e capacidade de oxigenação",
    m: ["RBC", "Hemoglobin", "Hematocrit", "MCV", "MCH", "MCHC", "RDW"] },
  { id: "lab-leucograma", en: "Complete Blood Count — Leukogram", pt: "Hemograma — Leucograma", sen: "White blood cells and immune defense", spt: "Leucócitos e defesa imune",
    m: ["WBC", "Neutrophils", "Neutrophils (abs)", "Lymphocytes", "Lymphocytes (abs)", "Monocytes", "Monocytes (abs)", "Eosinophils", "Eosinophils (abs)", "Basophils", "Basophils (abs)"] },
  { id: "lab-plaquetas", en: "Platelets & Coagulation", pt: "Plaquetas e coagulação", sen: "Clotting capacity", spt: "Capacidade de coagulação",
    m: ["Platelets", "MPV"] },
  { id: "lab-glicose", en: "Glycemia & Diabetes", pt: "Glicemia e diabetes", sen: "Blood sugar control", spt: "Controle de açúcar no sangue",
    m: ["Fasting glucose", "HbA1c", "Estimated average glucose"] },
  { id: "lab-lipidograma", en: "Lipid Profile", pt: "Lipidograma", sen: "Cholesterol and blood lipids — cardiovascular risk", spt: "Colesterol e gorduras no sangue — risco cardiovascular",
    m: ["Total cholesterol", "HDL-C", "LDL-C", "Triglycerides"] },
  { id: "lab-renal", en: "Kidney Function", pt: "Função renal", sen: "Filtration and electrolyte handling", spt: "Filtração e manejo de eletrólitos",
    m: ["Creatinine", "eGFR", "Urea/BUN", "Uric acid", "Sodium", "Potassium"] },
  { id: "lab-hepatica", en: "Liver Function", pt: "Função hepática", sen: "Hepatic enzymes and proteins", spt: "Enzimas e proteínas hepáticas",
    m: ["AST", "ALT", "GGT", "Alkaline phosphatase", "Total protein", "Albumin", "Globulin", "Albumin/Globulin ratio"] },
  { id: "lab-minerais", en: "Minerals & Electrolytes", pt: "Minerais e eletrólitos", sen: "Bone and cellular minerals", spt: "Minerais ósseos e celulares",
    m: ["Calcium", "Magnesium", "Phosphate"] },
  { id: "lab-ferro", en: "Iron Studies", pt: "Metabolismo do ferro", sen: "Iron stores and transport", spt: "Estoques e transporte de ferro",
    m: ["Ferritin", "Serum iron", "Total iron-binding capacity (TIBC)", "Transferrin saturation"] },
  { id: "lab-tireoide", en: "Thyroid", pt: "Tireoide", sen: "Thyroid axis", spt: "Eixo tireoidiano",
    m: ["TSH", "Free T4", "Total T4", "Total T3"] },
  { id: "lab-hormonios", en: "Sex & Adrenal Hormones", pt: "Hormônios sexuais e adrenais", sen: "Gonadal, adrenal and parathyroid hormones", spt: "Hormônios gonadais, adrenais e paratireoidianos",
    m: ["Testosterone (total)", "Estradiol", "FSH", "LH", "Prolactin", "Progesterone", "DHEA-S", "Cortisol", "PTH"] },
  { id: "lab-inflamacao", en: "Inflammation & Immune Markers", pt: "Inflamação e marcadores imunes", sen: "Systemic inflammation", spt: "Inflamação sistêmica",
    m: ["CRP"] },
  { id: "lab-tumor", en: "Tumor Markers", pt: "Marcadores tumorais", sen: "Prostate screening", spt: "Rastreio prostático",
    m: ["PSA total", "PSA free"] },
  { id: "lab-vitaminas", en: "Vitamins & Metabolic Markers", pt: "Vitaminas e marcadores metabólicos", sen: "Vitamin status and metabolic markers", spt: "Status vitamínico e marcadores metabólicos",
    m: ["Vitamin D (25-OH)", "Vitamin B12", "Folate", "Homocysteine"] },
  { id: "lab-urina", en: "Urinalysis (EAS) & Uroculture", pt: "Sumário de urina (EAS) e urocultura", sen: "Urine physical, chemical and microscopic exam", spt: "Exame físico, químico e microscópico da urina",
    m: ["Color (urine)", "Appearance (urine)", "pH (urine)", "Specific gravity (urine)", "Protein (urine)", "Glucose (urine)", "Ketones (urine)", "Bilirubin (urine)", "Urobilinogen (urine)", "Nitrite (urine)", "Epithelial cells (urine)", "Leukocytes (urine)", "Erythrocytes (urine)"] },
];

const missing = [];
let total = 0;
let out = "";
for (const pn of PANELS) {
  const blocks = pn.m.map(block).join("\n");
  total += pn.m.length;
  out +=
`<details class="lab-panel" id="${pn.id}" open>
  <summary class="lab-panel-head">
    <span class="lab-panel-title"><span class="lang-en">${esc(pn.en)}</span><span class="lang-pt">${esc(pn.pt)}</span></span>
    <span class="lab-panel-sub"><span class="lang-en">${esc(pn.sen)}</span><span class="lang-pt">${esc(pn.spt)}</span></span>
    <span class="lab-panel-count"><span class="lang-en">${pn.m.length} markers</span><span class="lang-pt">${pn.m.length} marcadores</span></span>
  </summary>
  <div class="lab-panel-body">
${blocks}
  </div>
</details>
`;
}

let html = fs.readFileSync(FILE, "utf8");
const startA = '<details class="lab-panel" id="lab-hemograma" open>';
const endA = '<details class="lab-panel" id="lab-comparison" open>';
const si = html.indexOf(startA);
const ei = html.indexOf(endA);
if (si < 0 || ei < 0 || ei <= si) throw new Error("detail-section anchors not found");
const before = html.slice(0, si);
const after = html.slice(ei);
// The replaced span ran from the first detail panel up to (not including) the
// historical-comparison block, which in the source includes the </div> that
// CLOSES .lab-panel-grid. Re-emit it so the historical table stays OUTSIDE the
// grid (full-width, below all sample cards) rather than trapped in a grid cell.
const newHtml = before + out + "</div>\n\n" + after;

console.log("── build-joao-detailed-panels ──");
console.log("panels generated :", PANELS.length);
console.log("markers rendered :", total);
console.log("missing from data:", missing.length, missing.join(", "));
console.log("replaced span    :", si, "→", ei, "(", ei - si, "chars )");

if (missing.length) throw new Error("some markers missing from payload — aborting");

if (APPLY) { fs.writeFileSync(FILE, newHtml); console.log("\n✓ written"); }
else console.log("\n(dry run — no write. Re-run with --apply.)");
