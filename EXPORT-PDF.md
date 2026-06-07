# Export to PDF

Patient-facing "Export" button -> a branded, A4, print-ready PDF of the selected
sections in the selected language. The PDF is built **entirely on the backend**
with real (vector) text — no client-side screenshotting. Rebuilt 2026-06-07.

## How it works

1. **Manifest** — `GET /api/export-manifest?patient=<clerk>` returns a section
   tree pruned to what the patient actually has (no empty checkboxes).
   `lib/export-manifest.js`; counts in `_worker.js`.
2. **Server build** — `POST /api/export-pdf {patientId, language, sections}`:
   - authorises the viewer (`gateExportViewer`),
   - validates the section list,
   - launches **headless Chrome** (Cloudflare Browser Rendering, `env.BROWSER`)
     via `lib/export-render.js`:
     - renders the **dark cover** from HTML (`lib/export-print.js`),
     - opens each selected section's **real page** in Chrome (so every existing
       chart/figure/card renders natively and crisply),
     - injects a print stylesheet that **strips all app chrome** — nav, language
       switch, sign-out, "Add data", "Update AI insights", chatbot, export
       button, danger zone — and forbids splitting a card across a page,
     - removes non-selected sections (exams filtered by `.report-section` id;
       vitals/mental captured whole for now),
     - emits a true **A4 vector PDF with normal margins** per page,
     - **merges** cover + sections into one document (`pdf-lib`),
   - streams it back as `application/pdf` with
     `Content-Disposition: attachment; filename="Lumen Health <Patient> <DD-MM-YYYY>.pdf"`.
3. **Front-end** (`web/assets/export-pdf.js`) is thin: load the manifest, show the
   dialog, POST the selection, download the returned blob. No html2canvas/jsPDF.

### Files
| File | Role |
|---|---|
| `lib/export-manifest.js` (+test) | data-driven section tree |
| `lib/export-report-util.js` (+test) | pure helpers: filename, section filter, print CSS, page grouping |
| `lib/export-render.js` | Browser Rendering orchestrator (Chrome -> per-page PDF -> merge) |
| `lib/export-print.js` (+test) | dark cover HTML |
| `web/_worker.js` | `GET /api/export-manifest`, `POST /api/export-pdf` |
| `web/assets/export-pdf.js` | dialog + blob download |

## Security / privacy
- **Auth gate at the Worker boundary** (`gateExportViewer`) — best-effort, and
  deliberately matches the rest of this app. Every data endpoint here (e.g.
  `handlePatientSummary`) is currently OPEN and trusts the patient param; Clerk is
  only half-wired (sessions don't validate via `authenticateRequest`). So the gate
  enforces viewer<->patient ONLY when Clerk genuinely authenticates a patient, and
  otherwise falls open like the rest of the app. It tightens automatically when
  real per-user auth lands app-wide. (Gating export with Clerk while nothing else
  used it 401'd logged-in users — that was the first production bug.)
- **No PHI in URLs.** The build is a single authenticated POST; nothing sensitive
  rides in a query string.
- **No new model calls** — re-renders already-stored data + already-authored AI
  insights; no new US transfer beyond what the platform already does.

## Ops (deploy — operator, not the agent)
- **Enable Browser Rendering** on the Cloudflare account (included on Workers
  Paid). The binding is declared in `wrangler.toml` (`[browser] binding =
  "BROWSER"`) so a deploy won't wipe it.
- **Install deps:** `npm i` (adds `@cloudflare/puppeteer`, `pdf-lib`).
- **Ship = BOTH:** `git push` **and**
  `wrangler pages deploy web --project-name=lumenhealth --branch=main --commit-dirty=true`.
- **ASCII-only commit messages** (no unicode `->`).
- Asset versions bumped: `export-pdf.js?v=2`, `styles.css?v=54`.
- **Verify** after deploy:
  ```
  curl -s "https://lumenhealth.io/api/export-manifest?patient=pending:joao" | head
  ```
  Then in the browser: Export -> pick "Blood Tests", PT -> Generate -> a PDF
  downloads named `Lumen Health <name> <DD-MM-YYYY>.pdf` with a dark PT cover +
  crisp light-theme range-bar lab cards, no app buttons.

## Known constraints / follow-ups
- **Browser Rendering on Pages Functions** — declared via `wrangler.toml`. If the
  Pages project can't bind Browser Rendering, move the export to a standalone
  Worker (same `lib/export-render.js`) and call it from the Pages function.
- **Generation is synchronous** (one POST, ~10-40s). If it bumps request limits,
  move to an async job (enqueue -> poll -> R2 download).
- **Leaf filtering** is exact for Exams; vitals/mental capture their page whole
  (blood vs urine also share `#labs`). Per-leaf anchors are the next pass.
- **AI insight cards** appear as they already render on the pages; no separate
  `patient_dashboard_cards` pull yet.
- Charts settle via `networkidle0` + a fixed delay; if a heavy Plotly chart isn't
  finished, increase the settle in `lib/export-render.js` or add a readiness flag
  on the page.
- Out of scope: clinician/admin export, scheduled exports, e-signing,
  per-recipient watermarking, in-PDF DICOM volume rendering.

## Tests
`node --test lib/export-report-util.test.mjs lib/export-manifest.test.mjs lib/export-print.test.mjs`
(24 tests, pure logic). `buildReportPdf` needs the `BROWSER` binding and is
verified on deploy.
