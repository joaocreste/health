/**
 * Pure, dependency-free helpers for the server-side PDF report.
 *
 * The report is TOPIC-CURATED, not a page print: each selected leaf maps to the
 * specific sections that belong to that topic WHEREVER they live across the app
 * (e.g. cardiovascular = the Vitals cardio + blood-pressure sections AND the
 * Coronary-CT section from Exams). lib/export-render.js extracts those sections
 * from the real (rendered) pages and composes them into one clean white document.
 */

const V = "physical-vitals.html";
const E = "physical-exams.html";
const G = "physical-genetics.html";
const M = "mental.html";
const S = "spiritual.html";

/** Page render order for the composed report. */
export const PAGE_ORDER = [V, E, G, M, S];

/**
 * leaf id -> the sections that belong to that topic, as [page, sectionId] pairs
 * (sections are .report-section / .sp-section ids on the real pages). Cross-page
 * on purpose; duplicates across leaves are de-duped at extraction time.
 */
export const TOPIC_SECTIONS = {
  // Physical · vitals
  "vitals.cardiovascular": [[V, "cardio"], [V, "bp"], [E, "tc-heart"]],
  "vitals.sleep": [[V, "sleep"]],
  "vitals.movement": [[V, "exercise"], [V, "movement"]],
  "vitals.glucose": [[V, "glucose"]],
  "vitals.body": [[V, "body"]],
  "vitals.respiratory": [[V, "cardio"]], // SpO2/respiratory live in the recovery section
  // Physical · exams (tc-heart is intentionally under cardiovascular, not here)
  "exams.imaging": [[E, "imaging"], [E, "mri-cervical"], [E, "mri-head"], [E, "eeg"]],
  "exams.blood": [[E, "labs"]],
  "exams.urine": [[E, "labs"]],
  "exams.microbiota": [[E, "gut"]],
  // Genetics
  "genetics.pgx": [[G, "pgx"]],
  // Mental
  "mental.overview": [[M, "self-awareness"], [M, "strengths"], [M, "timeline"]],
  "mental.architecture": [[M, "psych-architecture"], [M, "three-pyramids"]],
  "mental.mood": [[M, "coping-mechanisms"], [M, "crisis-29apr"]],
  "mental.assessments": [[M, "risk"], [M, "formulation"], [M, "substance"]],
  "mental.writings": [[M, "self-awareness"]], // no dedicated writings section yet
  // Spiritual
  "spiritual.practice": [
    [S, "practices"], [S, "faith-coping"], [S, "confession"], [S, "witness"],
    [S, "scriptures"], [S, "struggles"], [S, "wheel-of-life"],
  ],
};

/**
 * Resolve selected leaves to the sections to pull, grouped by page.
 * @returns {Map<string, Set<string>>} page -> set of section ids
 */
export function neededSections(leaves) {
  const m = new Map();
  (leaves || []).forEach((leaf) => {
    (TOPIC_SECTIONS[leaf] || []).forEach(([page, id]) => {
      if (!m.has(page)) m.set(page, new Set());
      m.get(page).add(id);
    });
  });
  return m;
}

/** App chrome to hide if any slips into an extracted section. */
export function chromeHideSelectors() {
  return [
    ".topnav", ".section-nav", ".sp-nav", ".lang-switch", ".signout-btn", ".changepatient-btn",
    "[data-export-btn]", ".export-modal", ".back-link", ".pt-pending-notice",
    ".danger-zone", ".report-export-row",
    ".add-data-btn", '[class^="add-data"]', '[class*=" add-data"]', '[id^="add-data"]',
    ".iu-wrap", ".iu-ov", "#iu-styles",
    '[class^="jc-chat"]', '[class*=" jc-chat"]',
  ];
}

/**
 * Build the CLEAN composed report document from extracted section HTML fragments.
 * White background (no app page tint), full-width, cards never split, only the
 * selected language shown. <base> makes the pages' relative image URLs resolve.
 */
export function composeReportDocument({ fragments = [], language = "en", origin = "" }) {
  const L = language === "pt" ? "pt" : "en";
  return `<!doctype html>
<html lang="${L}">
<head>
<meta charset="utf-8">
<base href="${origin}/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Raleway:wght@300;700&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${origin}/assets/styles.css?v=54">
<style>
  html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; color: #1A2129; }
  * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  ${chromeHideSelectors().join(", ")} { display: none !important; }

  /* Clean, white, full-width sections (strip the app's page tint + chrome offset). */
  .report-section, .sp-section {
    margin: 0 0 22px 0 !important; padding: 0 !important;
    background: #fff !important; border: 0 !important; box-shadow: none !important;
    max-width: none !important; width: auto !important;
  }
  .container, .container-narrow {
    max-width: none !important; width: auto !important; margin: 0 !important; padding: 0 !important;
  }
  [style*="blue-50"], [style*="--blue"], [style*="background:var(--surface"], [style*="background: var(--surface"] {
    background: #fff !important;
  }

  /* Never split a card / chart / table across a page. */
  .metric-card, .lab-test, .lab-card, .ai-card, .ai-insight, .chart-wrap, .chart-card,
  .alert, table, figure, .panel { break-inside: avoid !important; page-break-inside: avoid !important; }
  .section-label, .sp-section-label, h2, h3 { break-after: avoid !important; page-break-after: avoid !important; }

  html[lang="en"] .lang-pt { display: none !important; }
  html[lang="pt"] .lang-en { display: none !important; }
  img, svg { max-width: 100% !important; height: auto; }
</style>
</head>
<body class="report-export">
${fragments.join("\n")}
</body>
</html>`;
}

/** "Lumen Health <Patient> <DD-MM-YYYY>.pdf" (filesystem-safe). */
export function reportFilename(patientName, date = new Date()) {
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = date.getUTCFullYear();
  const name = String(patientName || "Patient")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Lumen Health ${name} ${dd}-${mm}-${yyyy}.pdf`;
}
