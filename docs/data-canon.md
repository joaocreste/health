# Lumen Health — Canonical Data Contract (backend / scalability)

> **Source of truth:** Joao Victor Creste ("Patient Zero"). This is the backend
> counterpart to [`docs/frontend-canon.md`](frontend-canon.md) (the *look*) and
> [`Management Prompts/SCHEMA-GAPS.md`](../Management%20Prompts/SCHEMA-GAPS.md)
> (provenance). It defines how a patient's data must be **stored** so the platform
> scales: one structure for every patient, the DB as the source of truth, nothing
> a patient sees left stranded outside Postgres.
>
> Enforcement tool: **`node scripts/patient-scorecard.mjs`** — run it to see every
> patient's render class, DB-completeness, and contract violations.

---

## 1. Render class — every patient is exactly one

| Class | What it means | Who | How dispatched |
|---|---|---|---|
| **STATIC** | Hand-authored HTML pages; the DB is a downstream mirror. | Joao (Patient Zero), Leo (inherits Joao's HTML via leo-mode) | `web/*.html` + `patient === PATIENT_ZERO/LEO_KELLER` |
| **BESPOKE** | A named render function for hand-curated data. | Paulo, Silvana, Cristina | `patient === X` branch in `web/assets/patient-context.js` |
| **DB-DEFAULT** | The shared `renderExams`/`renderHome` path, driven entirely by `/api/patient-{summary,exams}`. | Maria, John, Francisco, Hercio, … | fall-through (no branch) |

**Rules**
- **Default to DB-DEFAULT.** Only go BESPOKE when a patient has hand-curated data
  the generic grid can't express (a family narrative, a unique imaging story).
- **Never leave a thin-data patient on the 0/0/0 grid** — route their sub-pages to
  a bespoke render instead ([[feedback_bespoke_over_empty_grid]]).
- **A BESPOKE/STATIC patient still needs the DB populated** — the render class is a
  *display* choice; it never exempts a patient from §2. (Paulo's imaging was
  front-end-only and invisible to insights until backfilled — [[project_bespoke_insights_need_db_backfill]].)

## 2. The DB is the source of truth

**Every clinical fact a patient's front-end shows must live in a queryable Postgres
column.** The AI Insights engine (`lib/ai-insights.js` → `assembleRecord`) reads
**Postgres only**; anything stored only in a static file is invisible to it and is a
contract violation. ([[project_db_is_source_of_truth]])

| Front-end surface | Canonical DB home |
|---|---|
| Blood & urine panels | `lab_results` (one row per analyte/date) |
| Medications / supplements | `medications` / `supplements` |
| **Imaging findings narrative** | **`imaging_studies.notes`** — a clinical paragraph (technique + facility + doctors + date + findings + report pointer), like Joao's. NOT only in the manifest JSON. |
| ECG headline | `ecg_studies.interpretation` |
| AI insights / cross-links | `patient_dashboards` (section `ai-insights`) |
| Vitals / wearables | `vitals_daily`, `hr_readings`, `glucose_points` |

**Binaries are the exception, by design.** Image stacks, ECG SVG/DICOM, report PDFs
live in **R2 / `web/scans`**, referenced by DB `*_key` / `*_blob_key` / `manifest_blob_key`
columns. That is correct — the DB never stores blobs. A **manifest is a render layer,
not a store of record**: its image stacks are fine, but any *narrative text* in it
(`aiFinding`, `report.text*`) must ALSO be in a DB column (see imaging row above).

## 3. Provenance — the five facts

Every clinician-ordered row carries: exam_date, ingested_at (`created_at`),
requesting_doctor, performing_doctor, lab name/city/country. Full contract and
applicability matrix in [`SCHEMA-GAPS.md`](../Management%20Prompts/SCHEMA-GAPS.md).
Read provenance from the report; absent fields are NULL; **never infer country from
language** (deriving it from an explicit city, e.g. São Paulo → Brazil, is fine).

## 4. PHI & honesty

- **Crop burned-in identifiers** out of any displayed render; archive the untouched
  original to R2 as the record of truth; **de-identify text written to the DB** (no
  OCR admin/patient footers in `notes`).
- **Surface identity divergence and stop** (e.g. printed ID ≠ DICOM tags) before
  attaching to a record.
- **Label fidelity honestly:** AI-inferred vs clinician-validated (data-driven on
  `validating_doctor`); vector vs `Source image (not vectorized)`. Never fake a
  vector trace from pixels. ([[project_ecg_pipeline]])

## 5. AI insights

Reads Postgres only (§2). **Re-run after any new clinical data lands.** Large records
stall on the Pages endpoint (isolate dies mid-generation) — run locally via
`scripts/run-insights-local.mjs` (needs `ANTHROPIC_API_KEY`). Confirm success via
`patient_dashboards.cards_json`, not job status. ([[project_insight_rebuild_wallclock]])

## 6. The completeness gate (definition of done for a patient)

A patient is "done" only when `scripts/patient-scorecard.mjs` shows no gaps:
- render class assigned;
- every displayed surface DB-backed (§2);
- provenance present where the source has it (§3);
- insights current (re-run after the latest ingest).

### Current snapshot (2026-06-26)

11 patients · 1 gap · 3 empty. Reference patients (Joao STATIC, Paulo/Silvana/Cristina
BESPOKE, Maria DB-DEFAULT) all pass. **Open gap: `pending:john-e8fae1`** — 81 labs, no
insights → needs an insights run. (`milenne`, `andrecreste`, `leo` are empty patients.)
