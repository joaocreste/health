/**
 * Server-side PDF report builder (Cloudflare Browser Rendering).
 *
 * Headless Chrome opens the patient's REAL pages (so every existing chart, figure
 * and card renders natively and crisply), an injected print stylesheet strips all
 * app chrome (nav, language switch, sign-out, "Add data", "Update AI insights",
 * chatbot, export button, danger zone), non-selected sections are removed, and
 * each page is emitted as a true vector A4 PDF with normal margins. The dark cover
 * is rendered from HTML and the parts are merged into one document with pdf-lib.
 *
 * This replaces the old client-side html2canvas capture (which produced blurry,
 * chrome-polluted screenshots). Output here is real selectable text, small files.
 *
 * Requires env.BROWSER. Pure helpers live in ./export-report-util.js (unit-tested
 * without the puppeteer/pdf-lib deps); buildReportPdf is exercised on deploy.
 */

import { buildCoverDocument } from "./export-print.js";
import { groupByPage, pageKeepIds, printCss } from "./export-report-util.js";

// puppeteer + pdf-lib are imported LAZILY inside buildReportPdf (below). They must
// stay out of module scope: this file is imported at the top of web/_worker.js, so
// a top-level import of a missing/broken native dep would fail the whole worker to
// load and take down login + every route. Lazy import isolates any failure to the
// export endpoint, which then just 500s.

export { reportFilename } from "./export-report-util.js";

const A4 = { width: "210mm", height: "297mm" };
const CONTENT_MARGIN = { top: "1in", right: "1in", bottom: "1in", left: "1in" };

/**
 * Build the merged report PDF.
 * @param {object} env  Worker env (needs env.BROWSER)
 * @param {object} args { patientClerk, patientName, sections, language, origin, generatedAt }
 * @returns {Promise<Uint8Array>} the merged PDF bytes
 */
export async function buildReportPdf(env, args) {
  const { patientClerk, patientName, sections, language = "en", origin } = args;
  const generatedAt = args.generatedAt || new Date();
  const parts = [];

  const [{ default: puppeteer }, { PDFDocument }] = await Promise.all([
    import("@cloudflare/puppeteer"),
    import("pdf-lib"),
  ]);

  const browser = await puppeteer.launch(env.BROWSER);
  try {
    // 1. Dark cover (full-bleed, rendered from HTML).
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1240, height: 1754 });
      const coverHtml = buildCoverDocument({
        patient: { name: patientName, patientId: patientClerk },
        sections, language, generatedAt,
      });
      await page.setContent(coverHtml, { waitUntil: "networkidle0" });
      try { await page.evaluate(() => document.fonts && document.fonts.ready); } catch (e) { /* noop */ }
      parts.push(await page.pdf({
        width: A4.width, height: A4.height, printBackground: true,
        margin: { top: "0", right: "0", bottom: "0", left: "0" },
      }));
      await page.close();
    }

    // 2. One vector PDF per backing page, chrome stripped + sections filtered.
    for (const group of groupByPage(sections)) {
      const page = await browser.newPage();
      // Render at the A4 print CONTENT width (8.27in - 2x1in margins = 6.27in =
      // ~602px @96dpi) so the page's layout matches the paper: charts size to the
      // column instead of overflowing, text stays full-size, and content fills the
      // page edge-to-edge within the 1in margins (single-column, report-style).
      await page.setViewport({ width: 600, height: 960 });

      // The app's login gate (app.js) is purely client-side: it redirects to the
      // login screen unless sessionStorage.jc_authed === 'true'. Headless Chrome
      // has no session, so seed the flag (and the selected patient) BEFORE the
      // page's own scripts run — otherwise the section page captures as login.
      // (Don't use window.JC_PUBLIC: that also makes patient-context.js skip
      // rendering the data.)
      await page.evaluateOnNewDocument((clerk) => {
        try {
          sessionStorage.setItem("jc_authed", "true");
          if (clerk) sessionStorage.setItem("jc_current_patient", clerk);
        } catch (e) { /* opaque origin — ignore */ }
      }, patientClerk);

      const url = `${origin}/${group.page}?patient=${encodeURIComponent(patientClerk)}&lang=${language}`;
      await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });

      // Force language (CSS hides the other .lang-*), wait for fonts/charts.
      await page.evaluate(async (lang) => {
        document.documentElement.lang = lang;
        try { await document.fonts.ready; } catch (e) { /* noop */ }
      }, language);
      await page.addStyleTag({ content: printCss() });

      const keep = pageKeepIds(group.page, group.leaves);
      if (keep) {
        await page.evaluate((ids) => {
          document.querySelectorAll(".report-section").forEach((s) => {
            if (s.id && ids.indexOf(s.id) === -1) s.remove();
          });
        }, keep);
      }

      // Settle: let Plotly/Chart.js finish drawing after layout changes.
      await new Promise((r) => setTimeout(r, 1800));

      parts.push(await page.pdf({ format: "A4", printBackground: true, margin: CONTENT_MARGIN }));
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // 3. Merge cover + sections into one document.
  if (parts.length === 1) return parts[0];
  const out = await PDFDocument.create();
  for (const bytes of parts) {
    const doc = await PDFDocument.load(bytes);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
