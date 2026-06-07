/**
 * Pure, dependency-free helpers for the server-side PDF report.
 * Kept separate from lib/export-render.js so they can be unit-tested without the
 * @cloudflare/puppeteer / pdf-lib runtime deps.
 */

/** Which real page backs each leaf's content. */
export const SOURCE_PAGE = {
  vitals: "physical-vitals.html",
  exams: "physical-exams.html",
  genetics: "physical-genetics.html",
  mental: "mental.html",
  spiritual: "spiritual.html",
};

/** Exams page: leaf -> .report-section ids to keep (hybrid leaf filtering).
 *  Pages absent here are captured whole (vitals/mental for now). */
export const EXACT_SECTIONS = {
  "exams.blood": ["labs"],
  "exams.urine": ["labs"],
  "exams.imaging": ["imagery", "imaging", "mri-cervical", "mri-head", "tc-heart", "eeg"],
  "exams.microbiota": ["gut", "microbiota"],
};
const PAGES_WITH_ID_FILTER = { "physical-exams.html": true };

/** App chrome to hide before printing — content only, no navigation/actions. */
export function chromeHideSelectors() {
  return [
    ".topnav", ".section-nav", ".lang-switch", ".signout-btn", ".changepatient-btn",
    "[data-export-btn]", ".export-modal", ".back-link", ".pt-pending-notice",
    ".danger-zone", ".report-export-row",
    ".add-data-btn", '[class^="add-data"]', '[class*=" add-data"]', '[id^="add-data"]',
    ".iu-wrap", ".iu-ov", "#iu-styles",
    '[class^="jc-chat"]', '[class*=" jc-chat"]',
  ];
}

/** Injected print stylesheet: hide chrome, force full-width content (the app's
 *  centered max-width container + side-nav offset must not survive into print, or
 *  the report renders as a narrow off-centre column), keep colours, never split a
 *  card. Page margins (1in) are applied by page.pdf(), not here. */
export function printCss() {
  return `
    ${chromeHideSelectors().join(", ")} { display: none !important; }
    html, body { background: #fff !important; }
    body { margin: 0 !important; padding: 0 !important; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }

    /* Full-bleed content: drop the fixed side-nav offset and the centered
       max-width container so the report fills the page content box. */
    body.has-side-nav { display: block !important; }
    body.has-side-nav > .page-header,
    body.has-side-nav > .sp-hero,
    body.has-side-nav > section.report-section,
    body.has-side-nav > section.sp-section,
    body.has-side-nav > .doc-footer,
    body.has-side-nav > .sp-footer,
    body.has-side-nav > .container { margin-left: 0 !important; }
    .container, .container-narrow {
      max-width: none !important; width: auto !important;
      margin-left: 0 !important; margin-right: 0 !important;
    }

    .metric-card, .lab-test, .lab-card, .ai-card, .ai-insight,
    .chart-wrap, .chart-card, .alert, table, figure {
      break-inside: avoid !important; page-break-inside: avoid !important;
    }
    .section-header, h2, h3 { break-after: avoid !important; page-break-after: avoid !important; }
  `;
}

/** Sections to keep for a page, or null = keep the whole page. */
export function pageKeepIds(page, leaves) {
  if (!PAGES_WITH_ID_FILTER[page]) return null;
  const keep = [];
  leaves.forEach((id) => (EXACT_SECTIONS[id] || []).forEach((sid) => keep.push(sid)));
  return keep.length ? Array.from(new Set(keep)) : null;
}

/** Group selected leaves by their backing page, preserving leaf order. */
export function groupByPage(leaves) {
  const order = [];
  const map = {};
  (leaves || []).forEach((id) => {
    const page = SOURCE_PAGE[String(id).split(".")[0]];
    if (!page) return;
    if (!map[page]) { map[page] = { page, leaves: [] }; order.push(map[page]); }
    map[page].leaves.push(id);
  });
  return order;
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
