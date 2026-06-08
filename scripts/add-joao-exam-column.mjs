#!/usr/bin/env node
/**
 * Insert the 2026-06-08 Hospital Sírio-Libanês panel as the new leftmost
 * (latest, bold) column of Joao's historical comparison table in
 * web/physical-exams.html, and demote the prior latest column (20 May Thriva)
 * to a normal column.
 *
 * Values are mapped to each row's existing unit (so the time series stays
 * comparable): estradiol ng/dL→pg/mL (×10), progesterone ng/dL→ng/mL (×0.01),
 * CRP mg/dL→mg/L (×10), B12 ng/L = pg/mL (×1), ferritin µg/L = ng/mL (×1),
 * LH/FSH UI/L = mIU/mL (×1). Markers the panel didn't measure stay empty (—).
 *
 *   node scripts/add-joao-exam-column.mjs            # dry run (prints diff stats)
 *   node scripts/add-joao-exam-column.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.resolve(__dirname, "../web/physical-exams.html");
const APPLY = process.argv.includes("--apply");

// label (exact lab-cmp-marker text, sans unit <small>) -> 08-Jun cell value (string) or null (empty)
const V = {
  // Erythrogram
  "Red Blood Cells (RBC)": "4.85", "Hemoglobin": "14.3", "Hematocrit": "42.9",
  "MCV": "88.5", "MCH": "29.5", "MCHC": "33.3", "RDW": "13.1",
  // Leukogram
  "Total Leukocytes (WBC)": "6260", "Neutrophils (/mm³)#": "3725", "Neutrophils (%)#": "59.5",
  "Eosinophils": "63", "Basophils": "38", "Lymphocytes (/mm³)#": "1753",
  "Lymphocytes (%)#": "28.0", "Monocytes": "682",
  // Platelets & coag
  "Platelets": "270000", "MPV": "11.8", "Prothrombin Time activity": null, "INR (Prothrombin ratio)": null,
  // Glycemia
  "Fasting Glucose": "80", "HbA1c (Glycated Hb)": "5.2", "Estimated Average Glucose (eAG)": "103",
  "Insulin (fasting)": null, "HOMA-IR": null,
  // Lipid
  "Total Cholesterol": "214", "HDL Cholesterol": "70", "LDL Cholesterol": "119",
  "Triglycerides": "134", "Non-HDL Cholesterol": null, "VLDL Cholesterol": null,
  "Lipoprotein(a)": null, "Apolipoprotein A-1": null, "Apolipoprotein B": null,
  // Kidney
  "Creatinine": "1.10", "eGFR": "91", "Uric Acid": "6.1", "Sodium (Na)": "140",
  "Potassium (K)": "4.3", "Urea (BUN)": "25",
  // Liver, bile & pancreatic
  "AST / TGO": "40", "ALT / TGP": "38", "GGT": "21", "Alkaline Phosphatase": "47",
  "Bilirubin Total": null, "Bilirubin Direct": null, "Bilirubin Indirect": null,
  "Amylase": null, "Lipase": null, "Total Protein": "7.3", "Albumin": "4.6",
  "Globulin": "2.7", "A/G Ratio": "1.7",
  // Minerals & electrolytes
  "Calcium (total)": "9.6", "Magnesium": "2.1", "Phosphorus": "4.6", "Iron (serum)": "68",
  "Ferritin": "99", "Transferrin (total)": null, "Transferrin Saturation": "23",
  "TIBC (Total Iron Binding Capacity)": "300", "Zinc": null, "CPK (Creatine Kinase)": null,
  // Thyroid
  "TSH": "2.8", "Free T4": "1.11", "T4 Total": "6.3", "T3": "123",
  "Anti-thyroglobulin": null, "Anti-thyroid peroxidase (TPO)": null,
  // Sex & adrenal hormones
  "Total Testosterone": "615", "Free Testosterone": null, "Bioavailable Testosterone": null,
  "SHBG": null, "Estradiol (E2)": "64", "Estriol (E3)": null, "LH": "5.4", "FSH": "5.3",
  "Prolactin": "6", "PSA Total": "0.30", "PTH (intact)": "33", "Cortisol (morning)": "5.0",
  "ACTH": null, "Progesterone": "0.11", "DHEA-S (sulfate)": "222", "DHEA (free)": null,
  // Vitamins & metabolic
  "hs-CRP": "4.7", "Vitamin D (25-OH)": "47", "Vitamin B12": "1315", "Folate (Folic Acid)": "6.5",
  "Homocysteine": "12.8", "Serotonin (serum)": null, "Alpha-Fetoprotein (AFP)": null,
  // Drug levels
  "Lithium (serum)": null,
  // Serology (none in this panel)
  "Anti-HBs (Hep B immunity)": null, "HBsAg (Hep B antigen)": null, "Anti-HBc IgG": null,
  "Anti-HBc IgM": null, "Anti-HBe": null, "HBeAg": null, "Anti-HCV (Hepatitis C)": null,
  "HIV I & II": null, "VDRL (Syphilis)": null, "FTA-ABS IgG": null, "FTA-ABS IgM": null,
  "Trypanosoma cruzi IgG (Chagas)": null,
  // Urinalysis
  "Color": "Lt. yellow", "Aspect": "Clear", "Density": "1.006", "pH": "7.0",
  "Chemistry (Glu/Pro/Nit/Ket/Bil/Heme)": "Normal", "Microscopy": "Normal", "Uroculture": null,
};

// A few labels are ambiguous between %/abs rows that share base text; disambiguate by the unit small-tag.
const UNIT_DISAMBIG = {
  "Neutrophils|(/mm³)": "Neutrophils (/mm³)#", "Neutrophils|(%)": "Neutrophils (%)#",
  "Lymphocytes|(/mm³)": "Lymphocytes (/mm³)#", "Lymphocytes|(%)": "Lymphocytes (%)#",
};

let html = fs.readFileSync(FILE, "utf8");

// ── 1. thead: demote old latest, prepend new latest col ──
const newTh =
`          <th class="lab-cmp-col-head lab-cmp-col-latest">
            <div class="lab-cmp-date">8 Jun 2026</div>
            <div class="lab-cmp-lab">Hospital Sírio-Libanês · São Paulo</div>
            <div class="lab-cmp-md">Dr. Marco Antonio de Carvalho</div>
          </th>
          <th class="lab-cmp-col-head">
            <div class="lab-cmp-date">20 May 2026</div>`;
const beforeTh = html;
html = html.replace(
  /<th class="lab-cmp-col-head lab-cmp-col-latest">\s*<div class="lab-cmp-date">20 May 2026<\/div>/,
  newTh
);
if (html === beforeTh) throw new Error("thead anchor (20 May latest col) not found");

// ── 2. colspans 17 -> 18 on section header rows ──
let colspanFixed = 0;
html = html.replace(/(<tr class="lab-cmp-section"><th colspan=)"17"/g, (_m, p) => { colspanFixed++; return p + '"18"'; });

// ── 3. caption + count ──
html = html.replace("111 markers · 16 samples", "111 markers · 17 samples")
           .replace("111 marcadores · 16 amostras", "111 marcadores · 17 amostras");
html = html.replace(
  /the most recent panel — the 20 May 2026 Thriva self-administered fingerstick \(35 markers, partial scope\)\. The detailed view above still reflects the full 25 April 2026 panel\./,
  "the most recent panel — the 8 June 2026 Hospital Sírio-Libanês full panel (Dr. Marco Antonio de Carvalho). The 20 May 2026 Thriva fingerstick (35 markers, partial scope) is now the second column; the detailed view above reflects the 8 June 2026 panel."
);
html = html.replace(
  /a coluna mais à esquerda \(em negrito\) é o painel mais recente — o teste capilar Thriva autoaplicado de 20 de maio de 2026 \(35 marcadores, escopo parcial\)\. A visualização detalhada acima continua refletindo o painel completo de 25 de abril de 2026\./,
  "a coluna mais à esquerda (em negrito) é o painel mais recente — o painel completo do Hospital Sírio-Libanês de 8 de junho de 2026 (Dr. Marco Antonio de Carvalho). O teste capilar Thriva de 20 de maio de 2026 (35 marcadores, escopo parcial) passa a ser a segunda coluna; a visualização detalhada acima reflete o painel de 8 de junho de 2026."
);

// ── 4. each marker row: prepend new latest cell, demote old first cell ──
let rowsTouched = 0, filled = 0, empties = 0, unmapped = [];
html = html.replace(/<tr>\s*(<th class="lab-cmp-marker">([\s\S]*?)<\/th>)([\s\S]*?)<\/tr>/g,
  (full, thFull, thInner, tds) => {
    rowsTouched++;
    // label = th text minus the <small> unit tag
    const unitM = thInner.match(/<small class="lab-cmp-unit">\(([^)]*)\)<\/small>/);
    const unit = unitM ? "(" + unitM[1] + ")" : "";
    let label = thInner.replace(/<small[\s\S]*?<\/small>/g, "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    let key = label;
    const dis = UNIT_DISAMBIG[label + "|" + unit];
    if (dis) key = dis;
    if (!(key in V)) { unmapped.push(label + " " + unit); }
    const val = key in V ? V[key] : null;

    // demote the OLD first value cell (was the 20-May latest)
    let newTds = tds.replace(
      /<td class="lab-cmp-val lab-cmp-latest"><strong>([\s\S]*?)<\/strong><\/td>/,
      '<td class="lab-cmp-val">$1</td>'
    );

    // build new latest cell for 08-Jun
    const cell = (val == null)
      ? '<td class="lab-cmp-val lab-cmp-empty">—</td>'
      : `<td class="lab-cmp-val lab-cmp-latest"><strong>${val}</strong></td>`;
    if (val == null) empties++; else filled++;

    return `<tr>\n            ${thFull}\n            ${cell}${newTds}</tr>`;
  });

console.log("── add-joao-exam-column (historical table) ──");
console.log("thead latest col inserted :", html.includes('<div class="lab-cmp-date">8 Jun 2026</div>'));
console.log("colspan 17->18 rows fixed :", colspanFixed);
console.log("marker rows touched       :", rowsTouched);
console.log("cells filled / empty      :", filled, "/", empties);
console.log("unmapped labels (should be 0):", unmapped.length);
unmapped.forEach((u) => console.log("   ! " + u));

if (rowsTouched !== 111) console.log("WARNING: expected 111 marker rows, got " + rowsTouched);

if (APPLY) { fs.writeFileSync(FILE, html); console.log("\n✓ written to", FILE); }
else console.log("\n(dry run — no write. Re-run with --apply.)");
