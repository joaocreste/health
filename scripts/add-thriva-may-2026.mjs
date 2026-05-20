// One-shot: insert the 20 May 2026 Thriva fingerstick panel as the new
// leftmost (latest) column in the historical-comparison table on
// physical-exams.html. Idempotent: re-running detects the column and exits.

import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(
  "/Users/joaocreste/Claude Agent/Health WebbApp/web/physical-exams.html",
);

// Marker label (as it appears in <th class="lab-cmp-marker">) → Thriva value
// already converted to the table's unit. Values not in this map → empty cell.
//
// Conversions applied (Thriva → table unit):
//   mmol/L  → mg/dL  (cholesterols ×38.67, glucose ×18.02)
//   mmol/L  → mg/dL  (TG ×88.57)
//   µmol/L  → mg/dL  (creatinine ÷88.4, uric acid ÷59.48, bilirubin ÷17.1)
//   µmol/L  → µg/dL  (iron ×5.585, TIBC ×5.585)
//   g/L     → g/dL   (÷10) — albumin, globulin, total protein
//   pmol/L  → pg/mL  (B12 ×1.3554)
//   pmol/L  → ng/dL  (Free T4 ÷12.87)
//   nmol/L  → µg/dL  (T4 Total ÷12.87)
//   nmol/L  → ng/mL  (folate ÷2.265, vitamin D ÷2.5)
//   nmol/L  → ng/dL  (testosterone ×28.84)
//   mmol/mol HbA1c → % HbA1c  (×0.0915 + 2.15)
//   kIU/L   = IU/mL = U/mL  (TgAB, TPO)
//   1 mIU/L = 1 µIU/mL       (TSH)
//   1 µg/L  = 1 ng/mL        (ferritin)
const THRIVA = {
  // Glycemia
  "HbA1c (Glycated Hb)": "5.1",            // 32 mmol/mol → 5.08% (IFCC→NGSP)

  // Lipid profile
  "Total Cholesterol":   "197",            // 5.1 mmol/L ×38.67 (H)
  "HDL Cholesterol":     "66",             // 1.7 mmol/L ×38.67
  "LDL Cholesterol":     "108",            // 2.8 mmol/L ×38.67
  "Triglycerides":       "124",            // 1.4 mmol/L ×88.57
  "Non-HDL Cholesterol": "131",            // 3.4 mmol/L ×38.67

  // Kidney
  "Creatinine":          "1.17",           // 103 µmol/L ÷88.4
  "eGFR":                "85",             // L (ref >90)
  "Uric Acid":           "6.17",           // 367 µmol/L ÷59.48

  // Liver
  "ALT / TGP":           "27",
  "GGT":                 "24",
  "Alkaline Phosphatase":"46",
  "Bilirubin Total":     "0.23",           // 4 µmol/L ÷17.1
  "Total Protein":       "6.7",            // 67 g/L ÷10
  "Albumin":             "4.2",            // 42 g/L ÷10
  "Globulin":            "2.5",            // 25 g/L ÷10
  "A/G Ratio":           "1.68",           // 4.2 / 2.5 (computed)

  // Minerals / iron studies
  "Iron (serum)":        "120",            // 21.5 µmol/L ×5.585
  "Ferritin":            "118",
  "Transferrin Saturation":"39",
  "TIBC (Total Iron Binding Capacity)": "313", // 56 µmol/L ×5.585

  // Thyroid
  "TSH":                 "2.27",
  "Free T4":             "0.87",           // 11.2 pmol/L ÷12.87 (L)
  "T4 Total":            "4.74",           // 61 nmol/L ÷12.87
  "Anti-thyroglobulin":  "18.5",
  "Anti-thyroid peroxidase (TPO)": "16",

  // Sex / adrenal
  "Total Testosterone":  "585",            // 20.3 nmol/L ×28.84

  // Vitamins / metabolic
  "hs-CRP":              "2.28",
  "Vitamin D (25-OH)":   "38.8",           // 97 nmol/L ÷2.5
  "Vitamin B12":         "1099",           // 811 pmol/L ×1.3554 (Total B12, HH)
  "Folate (Folic Acid)": "5.83",           // 13.2 nmol/L ÷2.265
};

let src = fs.readFileSync(FILE, "utf8");

if (src.includes("20 May 2026")) {
  console.log("Already contains 20 May 2026 column. No-op.");
  process.exit(0);
}

// 1. Insert the new column-header <th> immediately before the current latest
//    (25 Apr 2026) header, and strip the lab-cmp-col-latest class from it.
const oldHeaderBlock =
  `          <th class="lab-cmp-col-head lab-cmp-col-latest">\n` +
  `            <div class="lab-cmp-date">25 Apr 2026</div>\n` +
  `            <div class="lab-cmp-lab">Lab. Behring · Ribeirão Preto</div>\n` +
  `            <div class="lab-cmp-md">Dr. Eduardo Tisher</div>\n` +
  `          </th>`;

const newHeaderBlock =
  `          <th class="lab-cmp-col-head lab-cmp-col-latest">\n` +
  `            <div class="lab-cmp-date">20 May 2026</div>\n` +
  `            <div class="lab-cmp-lab">Thriva · Pura UK (capillary)</div>\n` +
  `            <div class="lab-cmp-md"><span class="lang-en">Self-administered</span><span class="lang-pt">Autoaplicado</span></div>\n` +
  `          </th>\n` +
  `          <th class="lab-cmp-col-head">\n` +
  `            <div class="lab-cmp-date">25 Apr 2026</div>\n` +
  `            <div class="lab-cmp-lab">Lab. Behring · Ribeirão Preto</div>\n` +
  `            <div class="lab-cmp-md">Dr. Eduardo Tisher</div>\n` +
  `          </th>`;

if (!src.includes(oldHeaderBlock)) {
  throw new Error("Could not locate the 25 Apr 2026 header block.");
}
src = src.replace(oldHeaderBlock, newHeaderBlock);

// 2. Bump every section-divider colspan from 16 to 17.
src = src.replaceAll(
  '<tr class="lab-cmp-section"><th colspan="16">',
  '<tr class="lab-cmp-section"><th colspan="17">',
);

// 3. For every marker row, insert a new first <td> (Thriva value or empty)
//    BEFORE the existing leftmost <td class="lab-cmp-val lab-cmp-latest"><strong>…</strong></td>,
//    and strip the lab-cmp-latest + <strong> from that previously-leftmost cell.
//
//    Walk line-by-line: when we hit a `<th class="lab-cmp-marker">` line,
//    capture the marker name, then on the very next line (always a
//    lab-cmp-latest <td>) prepend the Thriva cell and demote that cell.
const lines = src.split("\n");
const out = [];
let pendingMarker = null;
let demoted = 0;
let injected = 0;
let paddedEmpty = 0;

const markerRe = /<th class="lab-cmp-marker">([^<]+?)(?:\s*<small class="lab-cmp-unit">[^<]*<\/small>)?\s*<\/th>/;
const latestCellRe = /^(\s*)<td class="lab-cmp-val lab-cmp-latest"><strong>([\s\S]+?)<\/strong><\/td>\s*$/;
const emptyCellRe  = /^(\s*)<td class="lab-cmp-val lab-cmp-empty">—<\/td>\s*$/;

for (const line of lines) {
  const m = line.match(markerRe);
  if (m) {
    pendingMarker = m[1].trim();
    out.push(line);
    continue;
  }

  if (pendingMarker) {
    const lm = line.match(latestCellRe);
    if (lm) {
      // Row where Apr 25 had a value — replace its `latest` styling with
      // either the Thriva value (new latest) or an empty placeholder.
      const indent = lm[1];
      const oldValue = lm[2];
      const thriva = THRIVA[pendingMarker];
      if (thriva !== undefined) {
        out.push(`${indent}<td class="lab-cmp-val lab-cmp-latest"><strong>${thriva}</strong></td>`);
        injected++;
      } else {
        out.push(`${indent}<td class="lab-cmp-val lab-cmp-empty">—</td>`);
      }
      out.push(`${indent}<td class="lab-cmp-val">${oldValue}</td>`);
      demoted++;
      pendingMarker = null;
      continue;
    }
    const em = line.match(emptyCellRe);
    if (em) {
      // Row where Apr 25 already had no data. Thriva markers all map to
      // markers Apr 25 also tested, so this row needs an extra empty cell.
      const indent = em[1];
      out.push(`${indent}<td class="lab-cmp-val lab-cmp-empty">—</td>`);
      out.push(line);
      paddedEmpty++;
      pendingMarker = null;
      continue;
    }
    // Anything else: stop expecting the value cell on this marker.
    if (line.trim().length > 0) pendingMarker = null;
  }

  out.push(line);
}

src = out.join("\n");

// 4. Update the panel-count footer "111 markers · 15 samples" → "111 markers · 16 samples".
src = src.replace("111 markers · 15 samples", "111 markers · 16 samples");
src = src.replace("111 marcadores · 15 amostras", "111 marcadores · 16 amostras");

// 5. Update the intro note to flag that the new leftmost is a partial fingerstick.
const oldIntroEn =
  "Source PDFs are stored in <code>data/Blood/</code>. The leftmost (bold) column is the most recent panel; the detailed view above always reflects this column. Drag horizontally to scroll older samples into view.";
const newIntroEn =
  "Source PDFs are stored in <code>data/Blood/</code>. The leftmost (bold) column is the most recent panel — the 20 May 2026 Thriva self-administered fingerstick (35 markers, partial scope). The detailed view above still reflects the full 25 April 2026 panel. Drag horizontally to scroll older samples into view.";
const oldIntroPt =
  "Os PDFs originais estão armazenados em <code>data/Blood/</code>. A coluna mais à esquerda (em negrito) é o painel mais recente; a visualização detalhada acima sempre reflete esta coluna. Arraste horizontalmente para visualizar amostras mais antigas.";
const newIntroPt =
  "Os PDFs originais estão armazenados em <code>data/Blood/</code>. A coluna mais à esquerda (em negrito) é o painel mais recente — o teste capilar Thriva autoaplicado de 20 de maio de 2026 (35 marcadores, escopo parcial). A visualização detalhada acima continua refletindo o painel completo de 25 de abril de 2026. Arraste horizontalmente para visualizar amostras mais antigas.";

if (!src.includes(oldIntroEn)) throw new Error("Could not locate EN intro line.");
if (!src.includes(oldIntroPt)) throw new Error("Could not locate PT intro line.");
src = src.replace(oldIntroEn, newIntroEn);
src = src.replace(oldIntroPt, newIntroPt);

fs.writeFileSync(FILE, src);

console.log(`Inserted ${injected} Thriva values, demoted ${demoted} prior-latest rows, padded ${paddedEmpty} previously-empty rows.`);
