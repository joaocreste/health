/**
 * Data-driven section tree for the PDF export.
 *
 * The export dialog must only offer sections the patient actually has data for —
 * no empty checkboxes, no per-patient special-casing. This module holds the
 * canonical bilingual tree (pillar -> group -> leaf) and a pure builder that
 * prunes it against a `counts` object the Worker computes from the DB. A pillar
 * or group survives only if at least one of its leaves has data.
 *
 * Counts shape (all optional, default 0) — see web/_worker.js handleExportManifest:
 *   labResults, urinalysis, imagingStudies, microbiota,
 *   vitalsDays, ecgEvents, glucosePoints, bodyComposition,
 *   pgxFindings,
 *   moodEntries, panicEvents, lifeEvents, clinicalHistory, psychItems,
 *   writings, documents, wheelOfLife, riskAssessments, spiritual
 *
 * The leaf -> data mapping mirrors the section->data table in the build spec.
 * NOTE: sleep / movement / respiratory currently share the `vitalsDays > 0`
 * predicate (vitals_daily is one table); refine with per-column counts later.
 */

/** The full tree. Leaves carry no children; groups/pillars do. */
export const EXPORT_TREE = [
  { id: "physical", en: "Physical Health", pt: "Saúde Física", children: [
    { id: "vitals", en: "Vitals", pt: "Sinais Vitais", children: [
      { id: "vitals.cardiovascular", en: "Cardiovascular Health", pt: "Saúde Cardiovascular" },
      { id: "vitals.sleep", en: "Sleep", pt: "Sono" },
      { id: "vitals.movement", en: "Movement", pt: "Movimento" },
      { id: "vitals.glucose", en: "Glucose", pt: "Glicose" },
      { id: "vitals.body", en: "Body Composition", pt: "Composição Corporal" },
      { id: "vitals.respiratory", en: "Respiratory", pt: "Respiratório" },
    ]},
    { id: "exams", en: "Exams", pt: "Exames", children: [
      { id: "exams.imaging", en: "Imaging", pt: "Imagem" },
      { id: "exams.blood", en: "Blood Tests", pt: "Exames de Sangue" },
      { id: "exams.urine", en: "Urine", pt: "Urina" },
      { id: "exams.microbiota", en: "Gut Microbiota", pt: "Microbiota Intestinal" },
    ]},
    { id: "genetics", en: "Genetics", pt: "Genética", children: [
      { id: "genetics.pgx", en: "Pharmacogenomics", pt: "Farmacogenômica" },
    ]},
  ]},
  { id: "mental", en: "Mental Health", pt: "Saúde Mental", children: [
    { id: "mental.overview", en: "Overview", pt: "Visão Geral" },
    { id: "mental.architecture", en: "Psychological Architecture", pt: "Arquitetura Psicológica" },
    { id: "mental.mood", en: "Mood & Panic", pt: "Humor e Pânico" },
    { id: "mental.assessments", en: "Assessments", pt: "Avaliações" },
    { id: "mental.writings", en: "Writings", pt: "Escritos" },
  ]},
  { id: "spiritual", en: "Spiritual Health", pt: "Saúde Espiritual", children: [
    { id: "spiritual.practice", en: "Practice", pt: "Prática" },
  ]},
];

const n = (c, k) => (c && c[k]) || 0;

/** leaf id -> predicate(counts) deciding whether the leaf has data. */
export const LEAF_PREDICATES = {
  "vitals.cardiovascular": (c) => n(c, "vitalsDays") > 0 || n(c, "ecgEvents") > 0,
  "vitals.sleep": (c) => n(c, "vitalsDays") > 0,
  "vitals.movement": (c) => n(c, "vitalsDays") > 0,
  "vitals.glucose": (c) => n(c, "glucosePoints") > 0,
  "vitals.body": (c) => n(c, "bodyComposition") > 0,
  "vitals.respiratory": (c) => n(c, "vitalsDays") > 0,
  "exams.imaging": (c) => n(c, "imagingStudies") > 0,
  "exams.blood": (c) => n(c, "labResults") > 0,
  "exams.urine": (c) => n(c, "urinalysis") > 0,
  "exams.microbiota": (c) => n(c, "microbiota") > 0,
  "genetics.pgx": (c) => n(c, "pgxFindings") > 0,
  "mental.overview": (c) => n(c, "moodEntries") > 0 || n(c, "lifeEvents") > 0 || n(c, "clinicalHistory") > 0,
  "mental.architecture": (c) => n(c, "psychItems") > 0,
  "mental.mood": (c) => n(c, "moodEntries") > 0 || n(c, "panicEvents") > 0,
  "mental.assessments": (c) => n(c, "wheelOfLife") > 0 || n(c, "riskAssessments") > 0,
  "mental.writings": (c) => n(c, "writings") > 0 || n(c, "documents") > 0,
  "spiritual.practice": (c) => n(c, "wheelOfLife") > 0 || n(c, "lifeEvents") > 0 || n(c, "spiritual") > 0,
};

const isLeaf = (node) => !node.children;

/** Set of all leaf ids in the canonical tree. */
export function allLeafIds() {
  const out = [];
  const walk = (nodes) => nodes.forEach((nd) => (isLeaf(nd) ? out.push(nd.id) : walk(nd.children)));
  walk(EXPORT_TREE);
  return out;
}

/** Set of leaf ids that have data for the given counts. */
export function availableLeafIds(counts) {
  return new Set(allLeafIds().filter((id) => (LEAF_PREDICATES[id] || (() => false))(counts)));
}

/**
 * Build the pruned manifest for the dialog.
 * @returns {{ tree: Array }} only sections with data; empty branches removed.
 */
export function buildManifest(counts) {
  const available = availableLeafIds(counts);
  const prune = (nodes) =>
    nodes
      .map((nd) => {
        if (isLeaf(nd)) return available.has(nd.id) ? { id: nd.id, en: nd.en, pt: nd.pt } : null;
        const children = prune(nd.children);
        return children.length ? { id: nd.id, en: nd.en, pt: nd.pt, children } : null;
      })
      .filter(Boolean);
  return { tree: prune(EXPORT_TREE) };
}

/**
 * Filter a client-requested list of leaf ids to those that are both real and
 * have data. Returns the accepted ids (canonical order) and any rejected ids.
 */
export function validateSections(requested, counts) {
  const available = availableLeafIds(counts);
  const wanted = new Set(Array.isArray(requested) ? requested : []);
  const sections = allLeafIds().filter((id) => wanted.has(id) && available.has(id));
  const rejected = [...wanted].filter((id) => !sections.includes(id));
  return { ok: sections.length > 0, sections, rejected };
}

/** Look up a leaf's bilingual labels by id (for the cover "Includes" chips). */
export function leafLabel(id) {
  let found = null;
  const walk = (nodes) => nodes.forEach((nd) => {
    if (nd.id === id && isLeaf(nd)) found = { en: nd.en, pt: nd.pt };
    else if (!isLeaf(nd)) walk(nd.children);
  });
  walk(EXPORT_TREE);
  return found;
}
