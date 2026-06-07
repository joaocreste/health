/* ════════════════════════════════════════════════════════════════════════
 * Lab taxonomy — single source of truth for DB-driven lab presentation.
 *
 * Maps each canonical lab marker (the normalized `marker` string stored in
 * lab_results) to a bilingual EN/PT label and a standard panel, and defines
 * the panel order. Mirrors the curated organization of Patient Zero's static
 * exams page so that ANY DB-driven patient (Maria Regina and onward) renders
 * the same way Joao does — Portuguese-first panels, bilingual marker names.
 *
 * Two consumers share this file:
 *   - web/assets/patient-context.js renderExams() reads window.LAB_TAXONOMY to
 *     regroup + relabel the markers returned by /api/patient-exams.
 *   - scripts/ingest-*.mjs load it via `vm` to normalize raw marker names into
 *     the canonical keys below (so the time series merges instead of splitting)
 *     and to stamp lab_results.panel with the standard panel.
 *
 * Keys here ARE the canonical marker strings written to the DB. Keep them and
 * the ingest normalizer (canonicalMarker) in agreement.
 * ════════════════════════════════════════════════════════════════════════ */
(function () {
  // Ordered list of standard panels (key + bilingual title). Order = render order.
  var PANELS = [
    { key: 'cbc_erythro', en: 'Complete Blood Count — Erythrogram', pt: 'Hemograma — Eritrograma' },
    { key: 'cbc_leuko',   en: 'Complete Blood Count — Leukogram',   pt: 'Hemograma — Leucograma' },
    { key: 'platelets',   en: 'Platelets & Coagulation',                 pt: 'Plaquetas e coagulação' },
    { key: 'glycemia',    en: 'Glycemia & Diabetes',                     pt: 'Glicemia e diabetes' },
    { key: 'lipids',      en: 'Lipid Profile',                           pt: 'Lipidograma' },
    { key: 'kidney',      en: 'Kidney Function',                         pt: 'Função renal' },
    { key: 'liver',       en: 'Liver Function',                          pt: 'Função hepática' },
    { key: 'minerals',    en: 'Minerals & Electrolytes',                 pt: 'Minerais e eletrólitos' },
    { key: 'iron',        en: 'Iron Studies',                            pt: 'Metabolismo do ferro' },
    { key: 'thyroid',     en: 'Thyroid',                                 pt: 'Tireoide' },
    { key: 'vitamins',    en: 'Vitamins & Metabolic Markers',            pt: 'Vitaminas e marcadores metabólicos' },
    { key: 'serology',    en: 'Serology',                                pt: 'Sorologia' },
    { key: 'urine',       en: 'Urinalysis (EAS) & Uroculture',           pt: 'Sumário de urina (EAS) e urocultura' },
    { key: 'other',       en: 'Other markers',                           pt: 'Outros marcadores' },
  ];

  // canonical marker key -> { en, pt, panel }
  var M = {
    // ── Erythrogram ──
    'RBC':                       { en: 'Red Blood Cells (RBC)', pt: 'Eritrócitos', panel: 'cbc_erythro' },
    'Hemoglobin':                { en: 'Hemoglobin', pt: 'Hemoglobina', panel: 'cbc_erythro' },
    'Hematocrit':                { en: 'Hematocrit', pt: 'Hematócrito', panel: 'cbc_erythro' },
    'MCV':                       { en: 'MCV (mean corpuscular volume)', pt: 'VCM (volume corpuscular médio)', panel: 'cbc_erythro' },
    'MCH':                       { en: 'MCH (mean corpuscular hemoglobin)', pt: 'HCM (hemoglobina corpuscular média)', panel: 'cbc_erythro' },
    'MCHC':                      { en: 'MCHC', pt: 'CHCM', panel: 'cbc_erythro' },
    'RDW':                       { en: 'RDW (red cell distribution width)', pt: 'RDW (índice de anisocitose)', panel: 'cbc_erythro' },
    // ── Leukogram ──
    'WBC':                       { en: 'White Blood Cells (WBC)', pt: 'Leucócitos totais', panel: 'cbc_leuko' },
    'Neutrophils':               { en: 'Neutrophils', pt: 'Neutrófilos', panel: 'cbc_leuko' },
    'Neutrophils (abs)':         { en: 'Neutrophils (absolute)', pt: 'Neutrófilos (absoluto)', panel: 'cbc_leuko' },
    'Lymphocytes':               { en: 'Lymphocytes', pt: 'Linfócitos', panel: 'cbc_leuko' },
    'Lymphocytes (abs)':         { en: 'Lymphocytes (absolute)', pt: 'Linfócitos (absoluto)', panel: 'cbc_leuko' },
    'Monocytes':                 { en: 'Monocytes', pt: 'Monócitos', panel: 'cbc_leuko' },
    'Monocytes (abs)':           { en: 'Monocytes (absolute)', pt: 'Monócitos (absoluto)', panel: 'cbc_leuko' },
    'Eosinophils':               { en: 'Eosinophils', pt: 'Eosinófilos', panel: 'cbc_leuko' },
    'Eosinophils (abs)':         { en: 'Eosinophils (absolute)', pt: 'Eosinófilos (absoluto)', panel: 'cbc_leuko' },
    'Basophils':                 { en: 'Basophils', pt: 'Basófilos', panel: 'cbc_leuko' },
    'Basophils (abs)':           { en: 'Basophils (absolute)', pt: 'Basófilos (absoluto)', panel: 'cbc_leuko' },
    // ── Platelets & coagulation ──
    'Platelets':                 { en: 'Platelets', pt: 'Plaquetas', panel: 'platelets' },
    'MPV':                       { en: 'MPV (mean platelet volume)', pt: 'VPM (volume plaquetário médio)', panel: 'platelets' },
    'Prothrombin time':          { en: 'Prothrombin Time (PT)', pt: 'Tempo de protrombina (TP)', panel: 'platelets' },
    'Prothrombin activity':      { en: 'Prothrombin Activity', pt: 'Atividade de protrombina', panel: 'platelets' },
    'INR':                       { en: 'INR', pt: 'RNI (razão normatizada internacional)', panel: 'platelets' },
    'aPTT':                      { en: 'aPTT', pt: 'TTPA (tempo de tromboplastina parcial)', panel: 'platelets' },
    'aPTT ratio':                { en: 'aPTT Ratio', pt: 'TTPA — relação', panel: 'platelets' },
    // ── Glycemia ──
    'Fasting glucose':           { en: 'Fasting Glucose', pt: 'Glicemia de jejum', panel: 'glycemia' },
    'HbA1c':                     { en: 'HbA1c (glycated hemoglobin)', pt: 'Hemoglobina glicada (HbA1c)', panel: 'glycemia' },
    'Estimated average glucose': { en: 'Estimated Average Glucose (eAG)', pt: 'Glicose média estimada (GME)', panel: 'glycemia' },
    // ── Lipids ──
    'Total cholesterol':         { en: 'Total Cholesterol', pt: 'Colesterol total', panel: 'lipids' },
    'LDL-C':                     { en: 'LDL Cholesterol', pt: 'LDL-colesterol', panel: 'lipids' },
    'HDL-C':                     { en: 'HDL Cholesterol', pt: 'HDL-colesterol', panel: 'lipids' },
    'VLDL':                      { en: 'VLDL Cholesterol', pt: 'VLDL-colesterol', panel: 'lipids' },
    'Triglycerides':             { en: 'Triglycerides', pt: 'Triglicérides', panel: 'lipids' },
    'Non-HDL-C':                 { en: 'Non-HDL Cholesterol', pt: 'Colesterol não-HDL', panel: 'lipids' },
    // ── Kidney ──
    'Creatinine':                { en: 'Creatinine', pt: 'Creatinina', panel: 'kidney' },
    'eGFR':                      { en: 'eGFR (estimated GFR)', pt: 'TFG estimada', panel: 'kidney' },
    'Urea/BUN':                  { en: 'Urea (BUN)', pt: 'Ureia', panel: 'kidney' },
    'Uric acid':                 { en: 'Uric Acid', pt: 'Ácido úrico', panel: 'kidney' },
    // ── Liver ──
    'AST':                       { en: 'AST (TGO)', pt: 'TGO (AST)', panel: 'liver' },
    'ALT':                       { en: 'ALT (TGP)', pt: 'TGP (ALT)', panel: 'liver' },
    'GGT':                       { en: 'GGT (gamma-GT)', pt: 'Gama-GT (GGT)', panel: 'liver' },
    'Alkaline phosphatase':      { en: 'Alkaline Phosphatase', pt: 'Fosfatase alcalina', panel: 'liver' },
    'Total protein':             { en: 'Total Protein', pt: 'Proteínas totais', panel: 'liver' },
    'Albumin':                   { en: 'Albumin', pt: 'Albumina', panel: 'liver' },
    'Globulin':                  { en: 'Globulin', pt: 'Globulina', panel: 'liver' },
    'Albumin/Globulin ratio':    { en: 'Albumin/Globulin Ratio', pt: 'Relação albumina/globulina', panel: 'liver' },
    // ── Minerals & electrolytes ──
    'Sodium':                    { en: 'Sodium', pt: 'Sódio', panel: 'minerals' },
    'Potassium':                 { en: 'Potassium', pt: 'Potássio', panel: 'minerals' },
    'Calcium':                   { en: 'Calcium', pt: 'Cálcio', panel: 'minerals' },
    'Ionized calcium':           { en: 'Ionized Calcium', pt: 'Cálcio iônico', panel: 'minerals' },
    'Magnesium':                 { en: 'Magnesium', pt: 'Magnésio', panel: 'minerals' },
    'Phosphate':                 { en: 'Phosphate', pt: 'Fósforo', panel: 'minerals' },
    // ── Iron studies ──
    'Ferritin':                  { en: 'Ferritin', pt: 'Ferritina', panel: 'iron' },
    'Serum iron':                { en: 'Serum Iron', pt: 'Ferro sérico', panel: 'iron' },
    'Transferrin saturation':    { en: 'Transferrin Saturation', pt: 'Saturação de transferrina', panel: 'iron' },
    'Total iron-binding capacity (TIBC)':       { en: 'TIBC (total iron-binding capacity)', pt: 'Capacidade total de fixação do ferro', panel: 'iron' },
    'Unsaturated iron-binding capacity (UIBC)': { en: 'UIBC (unsaturated iron-binding capacity)', pt: 'Capacidade latente de fixação do ferro', panel: 'iron' },
    // ── Thyroid ──
    'TSH':                       { en: 'TSH', pt: 'TSH (hormônio tireoestimulante)', panel: 'thyroid' },
    'Free T4':                   { en: 'Free T4', pt: 'T4 livre', panel: 'thyroid' },
    'Anti-TPO':                  { en: 'Anti-TPO antibodies', pt: 'Anti-TPO (antiperoxidase)', panel: 'thyroid' },
    'Anti-thyroglobulin antibodies': { en: 'Anti-Thyroglobulin antibodies', pt: 'Anti-tireoglobulina', panel: 'thyroid' },
    // ── Vitamins ──
    'Vitamin D (25-OH)':         { en: 'Vitamin D (25-OH)', pt: 'Vitamina D (25-OH)', panel: 'vitamins' },
    'Vitamin B12':               { en: 'Vitamin B12', pt: 'Vitamina B12', panel: 'vitamins' },
    'Folate':                    { en: 'Folate', pt: 'Ácido fólico', panel: 'vitamins' },
    // ── Serology ──
    'Hepatitis B surface antigen (HBsAg)': { en: 'Hepatitis B surface antigen (HBsAg)', pt: 'HBsAg (antígeno de superfície da hepatite B)', panel: 'serology' },
    'Anti-HBc Total (IgM+IgG)':  { en: 'Anti-HBc Total (IgM+IgG)', pt: 'Anti-HBc total (IgM+IgG)', panel: 'serology' },
    'Hepatitis C antibody (Anti-HCV)': { en: 'Hepatitis C antibody (Anti-HCV)', pt: 'Anti-HCV (hepatite C)', panel: 'serology' },
    // ── Urinalysis (canonical keys carry "(urine)") ──
    'Specific gravity (urine)':  { en: 'Specific Gravity', pt: 'Densidade', panel: 'urine' },
    'pH (urine)':                { en: 'pH', pt: 'pH', panel: 'urine' },
    'Color (urine)':             { en: 'Color', pt: 'Cor', panel: 'urine' },
    'Protein (urine)':           { en: 'Protein', pt: 'Proteínas', panel: 'urine' },
    'Glucose (urine)':           { en: 'Glucose', pt: 'Glicose', panel: 'urine' },
    'Ketones (urine)':           { en: 'Ketones', pt: 'Corpos cetônicos', panel: 'urine' },
    'Bilirubin (urine)':         { en: 'Bilirubin / Bile pigments', pt: 'Pigmentos biliares', panel: 'urine' },
    'Urobilinogen (urine)':      { en: 'Urobilinogen', pt: 'Urobilinogênio', panel: 'urine' },
    'Nitrite (urine)':           { en: 'Nitrite', pt: 'Nitrito', panel: 'urine' },
    'Blood (urine)':             { en: 'Blood / Hemoglobin', pt: 'Hemoglobina (sangue)', panel: 'urine' },
    'Leukocytes (urine)':        { en: 'Leukocytes', pt: 'Leucócitos', panel: 'urine' },
    'Erythrocytes (urine)':      { en: 'Erythrocytes (RBC)', pt: 'Hemácias', panel: 'urine' },
    'Epithelial cells (urine)':  { en: 'Epithelial Cells', pt: 'Células epiteliais', panel: 'urine' },
    'Urine culture':             { en: 'Urine Culture', pt: 'Urocultura', panel: 'urine' },
  };

  /* canonicalMarker(rawMarker, unit, category) -> canonical key in M.
     Collapses the inconsistent extraction names (e.g. "Neutrophils %",
     "Neutrophils absolute", "Neutrophils (absolute)") and the 27 urinalysis
     spellings into the single keys above. Shared by render + ingest so a marker
     never splits across spellings. Returns the raw name unchanged if unknown
     (it then falls into the "other" panel rather than being dropped). */
  function isPct(u) { return String(u || '').indexOf('%') !== -1; }

  var DIFF = ['Neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils'];

  function canonicalMarker(raw, unit, category) {
    var s = String(raw == null ? '' : raw).trim();
    var low = s.toLowerCase();

    // Urinalysis: one canonical "(urine)" key per analyte, by keyword.
    if (String(category || '').toLowerCase().indexOf('urinalysis') !== -1 ||
        /\(urine\)|^urine\s|urina/i.test(s)) {
      if (/cultur/.test(low)) return 'Urine culture';
      if (/gravity|densidade/.test(low)) return 'Specific gravity (urine)';
      if (/^urine ph$|^ph(\s|$|\s*\(urine)/.test(low) || low === 'ph') return 'pH (urine)';
      if (/colou?r|cor\b/.test(low)) return 'Color (urine)';
      if (/protein|proteína/.test(low)) return 'Protein (urine)';
      if (/glucose|glicose/.test(low)) return 'Glucose (urine)';
      if (/keton|cetônic|cetona/.test(low)) return 'Ketones (urine)';
      if (/bilirubin|bile pigment|pigmentos biliares/.test(low)) return 'Bilirubin (urine)';
      if (/urobilin/.test(low)) return 'Urobilinogen (urine)';
      if (/nitrit/.test(low)) return 'Nitrite (urine)';
      if (/hemoglobin|blood|sangue/.test(low)) return 'Blood (urine)';
      if (/leu[kc]ocyte|leucócito/.test(low)) return 'Leukocytes (urine)';
      if (/erythrocyte|rbc|hemácia/.test(low)) return 'Erythrocytes (urine)';
      if (/epithelial|epitelial/.test(low)) return 'Epithelial cells (urine)';
      // unknown urine line — keep a stable urine-scoped key
      return s;
    }

    // WBC differential: derive (cell, %|abs) from the base name + unit.
    var base = s.replace(/\s*\((abs|absolute)\)\s*$/i, '')
                .replace(/\s+(absolute|abs)\s*$/i, '')
                .replace(/\s*%\s*$/, '')
                .trim();
    for (var i = 0; i < DIFF.length; i++) {
      if (base === DIFF[i]) {
        var wasAbs = /abs|absolute/i.test(s) || (!isPct(unit) && !/%/.test(s) && unit);
        return wasAbs ? (DIFF[i] + ' (abs)') : DIFF[i];
      }
    }

    // Estimated average glucose variants -> single key.
    if (/estimated average glucose/i.test(s)) return 'Estimated average glucose';

    return s;
  }

  var T = { PANELS: PANELS, MARKERS: M, canonicalMarker: canonicalMarker };
  if (typeof window !== 'undefined') window.LAB_TAXONOMY = T;
  if (typeof module !== 'undefined' && module.exports) module.exports = T;
})();
