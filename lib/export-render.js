/**
 * Server-side PDF report builder (Cloudflare Browser Rendering) — TOPIC-CURATED.
 *
 * The report is NOT a print of a page. For the selected topics we:
 *   1. open the real pages in headless Chrome (so charts/figures render),
 *   2. extract only the sections that belong to those topics (across pages),
 *   3. compose them into ONE clean white document (no app tint/chrome),
 *   4. renumber the sections sequentially and emit a true vector A4 PDF (1in
 *      margins, cards never split), merged behind the dark cover.
 *
 * Requires env.BROWSER. Pure helpers (topic map, compose, filename) live in
 * ./export-report-util.js and are unit-tested without the puppeteer/pdf-lib deps.
 */

import { buildCoverDocument } from "./export-print.js";
import {
  PAGE_ORDER,
  neededSections,
  composeReportDocument,
} from "./export-report-util.js";

export { reportFilename } from "./export-report-util.js";

// puppeteer + pdf-lib are imported LAZILY inside buildReportPdf so a missing/
// broken native dep can never fail the whole worker to load (it's imported at the
// top of web/_worker.js) — only the export endpoint would 500.

const A4 = { width: "210mm", height: "297mm" };
const CONTENT_MARGIN = { top: "1in", right: "1in", bottom: "1in", left: "1in" };
// Render source pages at the A4 print content width (8.27in - 2x1in = 6.27in =
// ~602px) so charts size to the column; tall so lazy/below-fold charts still draw.
const SRC_VIEWPORT = { width: 600, height: 3200 };

/* Runs IN the page: snapshot <canvas> charts to <img> (so Chart.js survives the
   HTML copy), strip Plotly's interactive mode-bar, then return the outerHTML of
   the requested elements (by id — they may be .report-section, .sp-section, or
   nested .imagery-exam blocks) in DOM order. */
function extractSections(idList) {
  document.querySelectorAll("canvas").forEach((cv) => {
    try {
      const url = cv.toDataURL("image/png");
      const img = document.createElement("img");
      img.src = url;
      img.style.width = (cv.clientWidth || cv.width) + "px";
      img.style.maxWidth = "100%";
      if (cv.parentNode) cv.parentNode.replaceChild(img, cv);
    } catch (e) { /* tainted canvas — skip */ }
  });
  document.querySelectorAll(".modebar, .modebar-container").forEach((n) => n.remove());

  const nodes = idList.map((id) => document.getElementById(id)).filter(Boolean);
  // DOM order (4 = Node.DOCUMENT_POSITION_FOLLOWING)
  nodes.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
  return nodes.map((n) => n.outerHTML);
}

/* Runs IN the composed doc: renumber every section label sequentially (01, 02,
   …) so the curated report reads as a standalone document, not site leftovers. */
function renumberSections() {
  let i = 1;
  document.querySelectorAll(".section-label, .sp-section-label").forEach((el) => {
    const num = String(i).padStart(2, "0");
    const rewrite = (node) => {
      const txt = node.textContent || "";
      node.textContent = /^\s*[0-9]+[a-zA-Z.]*\s*·/.test(txt)
        ? txt.replace(/^\s*[0-9]+[a-zA-Z.]*\s*·\s*/, num + " · ")
        : num + " · " + txt.replace(/^\s*/, "");
    };
    const spans = el.querySelectorAll(".lang-en, .lang-pt");
    if (spans.length) spans.forEach(rewrite);
    else rewrite(el);
    i++;
  });
}

const seedAuth = (clerk) => {
  try {
    sessionStorage.setItem("jc_authed", "true");
    if (clerk) sessionStorage.setItem("jc_current_patient", clerk);
  } catch (e) { /* opaque origin */ }
};

/**
 * @param {object} env  Worker env (needs env.BROWSER)
 * @param {object} args { patientClerk, patientName, sections, language, origin, generatedAt }
 * @returns {Promise<Uint8Array>}
 */
export async function buildReportPdf(env, args) {
  const { patientClerk, patientName, sections, language = "en", origin } = args;
  const generatedAt = args.generatedAt || new Date();

  const [{ default: puppeteer }, { PDFDocument }] = await Promise.all([
    import("@cloudflare/puppeteer"),
    import("pdf-lib"),
  ]);

  const need = neededSections(sections); // Map<page, Set<id>>
  const browser = await puppeteer.launch(env.BROWSER);
  const parts = [];

  try {
    // 1. Cover (dark, full-bleed).
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1240, height: 1754 });
      await page.setContent(
        buildCoverDocument({ patient: { name: patientName, patientId: patientClerk }, sections, language, generatedAt }),
        { waitUntil: "networkidle0" }
      );
      try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (e) { /* noop */ }
      parts.push(await page.pdf({ width: A4.width, height: A4.height, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } }));
      await page.close();
    }

    // 2. Extract the requested sections from each real page (in page order).
    const fragments = [];
    for (const pg of PAGE_ORDER) {
      const ids = need.get(pg);
      if (!ids || !ids.size) continue;
      const page = await browser.newPage();
      await page.setViewport(SRC_VIEWPORT);
      await page.evaluateOnNewDocument(seedAuth, patientClerk);
      const url = `${origin}/${pg}?patient=${encodeURIComponent(patientClerk)}&lang=${language}`;
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
      await page.evaluate((lang) => { document.documentElement.lang = lang; }, language);
      await new Promise((r) => setTimeout(r, 1800)); // let Plotly/Chart.js finish
      const frags = await page.evaluate(extractSections, [...ids]);
      fragments.push(...frags);
      await page.close();
    }

    if (!fragments.length) throw new Error("no_sections_extracted");

    // 3. Compose one clean white document, renumber, emit A4 content PDF.
    {
      const page = await browser.newPage();
      await page.setViewport(SRC_VIEWPORT);
      await page.setContent(
        composeReportDocument({ fragments, language, origin }),
        { waitUntil: "networkidle0" }
      );
      try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (e) { /* noop */ }
      await page.evaluate(renumberSections);
      parts.push(await page.pdf({ format: "A4", printBackground: true, margin: CONTENT_MARGIN }));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // 4. Merge cover + content.
  if (parts.length === 1) return parts[0];
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const doc = await PDFDocument.load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
