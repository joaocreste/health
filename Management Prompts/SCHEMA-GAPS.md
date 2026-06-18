# SCHEMA-GAPS.md — Provenance capture & persistence

> **Status: IMPLEMENTED & VERIFIED LIVE (2026-06-17).** Migration `0015` applied
> to Neon; `/api/ingest` labs write-path + `ecg-ingest` handler updated and
> deployed to `lumenhealth.io`; the three clinician-ordered prompts carry the
> provenance contract. Read-back proof in the "Implemented" section at the end.
> Numbers reflect the live repo (migrations through `0014`, not `0007` as the
> brief assumed; next migration is `0015`).

## The five provenance facts (scope)

1. **exam_date** — when the exam/sample/measurement was taken
2. **ingested_at** — when the row was written to the DB (system-set)
3. **requesting_doctor** — who ordered it
4. **performing_doctor** — who performed / signed / is responsible
5. **lab + city + country** — where it was performed

---

## Two findings that change the scope

### Finding A — `/api/ingest` only typed-writes TWO tables

`web/_worker.js` → `lib/ingest.js` (`handleIngest`) is the multipart upload
endpoint. Per file it: streams to R2, inserts a `documents` row (always), and
runs a typed extractor for exactly **two** classes:

- `lab_pdf` → `lab_results` (real provenance extraction today)
- `writing` → `writings`

Every other class (`dicom_series`, `imaging_image`, `ecg_pdf`, `genetics_report`,
`medication_csv`, `doctor_report`, …) lands as a **blob in `documents` only** —
no typed row, no provenance. So **`lab_results` is the only clinician-ordered
table `/api/ingest` actually persists provenance into.**

Imaging and ECG rows are written by **other paths**:

- **`imaging_studies`** ← bespoke `scripts/*.mjs` (MRI CD ingestion, etc.)
- **`ecg_studies`** ← `POST /api/admin/ecg-ingest` (separate handler in `_worker.js`)

**Implication:** the literal "`/api/ingest` write-path" change is labs only.
Imaging/ECG need the schema columns too, but their *writers* are scripts and a
different endpoint. Recommended approach: add columns to all three tables; wire
the `/api/ingest` write path (labs) now; wire `ecg-ingest` + the imaging scripts
in the same migration pass since the columns are cheap and the writers are small.

### Finding B — every table already has an ingestion timestamp

Every clinical table already carries `created_at timestamptz DEFAULT now()`,
which **is** the system-set ingestion timestamp and is already strictly separate
from the exam-date column. Recommendation: **treat `created_at` as `ingested_at`**
(document the alias) rather than adding a duplicate `ingested_at` column.
Open question Q-time below.

---

## Source-type classification

| Prompt | Ingests | Target table(s) | Class | Facts that apply |
|---|---|---|---|---|
| Blood Test Ingestion | Blood/urine lab panels | `lab_results` | Clinician-ordered | all 5 |
| Imagery | MRI/CT/US/XR studies + report | `imaging_studies` | Clinician-ordered | all 5 |
| ECG Ingestion | 12-lead clinical ECG + report | `ecg_studies` | Clinician-ordered | all 5 |
| InBody | Body-composition scan | **none today** (front-end only) | Clinician-ordered | all 5 (blocked — no table) |
| Medication Ingestion | Current med list | `medications` | Informational (not an exam) | see Q-meds |
| Specialist Report | Generated PDF (read-only) | — (no ingest) | N/A — output, not ingest | none |
| Oura Update | Daily wearable metrics | `vitals_daily` (`source='oura'`) | Device self-captured | exam_date only |
| Apple Watch Update | Apple Health metrics + ECGs | `vitals_daily`, `ecg_events` | Device self-captured | exam_date only |
| Withings Update | Weight/BP/ECG | `vitals_daily`, `ecg_events` | Device self-captured | exam_date only |
| Journal Ingestion | Personal writings | `writings` (→ psych_* derived) | Narrative | authored date only |

---

## Applicability matrix (rows = table, cols = the five facts)

Legend: `OK` already persisted · `ADD` column missing, applies · `n/a` not applicable

| Table | exam_date | requesting_doctor | performing_doctor | lab_name | lab_city | lab_country | ingested_at |
|---|---|---|---|---|---|---|---|
| `lab_results` | OK `taken_at` (NOT NULL) | OK `requesting_doctor` (0007) | **ADD** | OK `laboratory` | **ADD** | **ADD** | OK `created_at` |
| `imaging_studies` | OK `study_date` (NOT NULL) | **ADD** | **ADD** | **ADD** | **ADD** | **ADD** | OK `created_at` |
| `ecg_studies` | OK `study_date` (NOT NULL) | OK `ordering_doctor` | OK `validating_doctor` | OK `clinic` | **ADD** | **ADD** | OK `created_at` |
| InBody (no table) | — | — | — | — | — | — | — |
| `vitals_daily` | OK `day` (NOT NULL) | n/a | n/a | n/a | n/a | n/a | OK `created_at` |
| `ecg_events` | OK `recorded_at` | n/a | n/a | n/a | n/a | n/a | OK `created_at` |
| `writings` | OK `written_at` | n/a | n/a | n/a | n/a | n/a | OK `created_at` |
| `medications` | n/a (started/ended) | see Q-meds | see Q-meds | n/a | n/a | n/a | OK `created_at` |

**Net new columns required (pending answers):**

- `lab_results`: `performing_doctor`, `lab_city`, `lab_country` (3)
- `imaging_studies`: `requesting_doctor`, `performing_doctor`, `lab_name`, `lab_city`, `lab_country` (5)
- `ecg_studies`: `lab_city`, `lab_country` (2)

No new columns for device/narrative tables — their exam-date + `created_at`
already cover the applicable facts, and the clinical facts are correctly `n/a`.

---

## Write-path (extractor) gaps

- **`lab_results` (lib/ingest.js):** `CLASSIFY_AND_EXTRACT_SYSTEM` + `LAB_EXTRACTOR_SYSTEM`
  already extract `laboratory`, `taken_at`, `requesting_doctor`. They do **not**
  extract performing doctor or city/country, and `insertLabRows` does not write
  the new columns. Both need updating.
- **`ecg_studies` (/api/admin/ecg-ingest):** writer needs `lab_city`/`lab_country`.
- **`imaging_studies` (scripts):** writers need all five new columns.

---

## Decisions pending (see questions in chat)

- **Q-doctor-id** — registration IDs (CRM etc.) inside doctor text fields, or names only?
- **Q-granularity** — one provenance set per exam/study (default), or per result row?
- **Q-partial-dates** — store partial dates with a precision flag, or best-guess full date?
- **Q-location** — separate `lab_city`/`lab_country` (default) vs one free-text string?
- **Q-sequencing** — one consolidated migration vs one per table.
- **Q-time** — reuse `created_at` as `ingested_at` (recommended) vs add explicit column.
- **Q-inbody** — InBody has no DB table; add one, route to `documents`, or leave front-end-only?
- **Q-meds** — keep medications out of the exam contract (provenance via source note + `source_blob_key`), or add prescriber/source columns?

## Decisions confirmed (2026-06-17)

- **Doctor IDs:** name + registration ID **inline** in the doctor text field.
- **Granularity:** **one provenance set per exam/study** (shared across rows).
- **Partial dates:** coerce to **best-guess full `YYYY-MM-DD`** (no precision flag).
- **Location:** **separate `lab_city` + `lab_country`** columns.
- **Migration:** **one consolidated migration `0015`**, `created_at` reused as `ingested_at`.
- **InBody:** deferred (no DB table). **Medications:** source-note only (out of the exam contract).

---

## Implemented

### Schema — `db/migrations/0015_provenance_columns.sql` (applied to Neon)

10 nullable `text` columns added via `ADD COLUMN IF NOT EXISTS` (repo's hand-authored
pattern; drizzle journal lags at 0004 so `db:generate` is not usable here — applied
with `scripts/apply-0015-provenance-columns.mjs`). `db/schema.ts` updated to match.

| Table | Columns added | Already present (reused) |
|---|---|---|
| `lab_results` | `performing_doctor`, `lab_city`, `lab_country` | `taken_at`, `laboratory`, `requesting_doctor`, `created_at` |
| `imaging_studies` | `requesting_doctor`, `performing_doctor`, `lab_name`, `lab_city`, `lab_country` | `study_date`, `created_at` |
| `ecg_studies` | `lab_city`, `lab_country` | `study_date`, `ordering_doctor`, `validating_doctor`, `clinic`, `created_at` |

### Write path — `lib/ingest.js` + `web/_worker.js` (deployed to `lumenhealth.io`)

- `lib/ingest.js`: `CLASSIFY_AND_EXTRACT_SYSTEM` + `LAB_EXTRACTOR_SYSTEM` now extract
  `performing_doctor`, `lab_city`, `lab_country` (with PT/EN label guidance, reg-ID-inline
  rule, partial-date coercion); `insertLabRows` writes them once per panel.
- `web/_worker.js`: `/api/admin/ecg-ingest` INSERT + ON CONFLICT now persist
  `lab_city`/`lab_country`; `ensureEcgStudiesTable` adds them idempotently.
- `ingested_at` is `created_at` (server-set `now()`), never trusted from the client.

### Prompts — `Management Prompts/` (no deploy; not under `web/`)

| Prompt | Class | Change |
|---|---|---|
| Blood Test Ingestion | clinician-ordered | Full provenance §; intake/extract/write steps reference it; `lab_results` column map. |
| Imagery | clinician-ordered | Full provenance §; manifest gains `facilityCity`/`facilityCountry`; `imaging_studies` map. |
| ECG Ingestion | clinician-ordered | Full provenance §; `ecg_studies` map (ordering/validating/clinic + new city/country). |
| Oura / Apple Watch / Withings | device | "device self-captured" note: measurement date only; clinical facts **n/a**. |
| Journal Ingestion | narrative | "narrative" note: authored date only; clinical facts **n/a**. |
| InBody | clinician-ordered | Deferred note: no DB table; provenance via DATA-PROVENANCE.md until a table exists. |
| Medication Ingestion | informational | Note: out of the exam contract; provenance via `source_blob_key` + DATA-PROVENANCE.md. |

### Verification — live ingestion + DB read-back (2026-06-17)

**Clinician-ordered** — POST `Exam 02 05 2026.pdf` → `https://lumenhealth.io/api/ingest`
(patient `pending:john-e8fae1`). Classified `lab_pdf`, 33 `lab_results` rows. Read-back:

| Column | Value |
|---|---|
| `taken_at` (exam date) | `2024-10-31` |
| `created_at` (ingested_at, auto) | `2026-06-18` → **differs from exam date ✓** |
| `requesting_doctor` | `Dra. Vivian Helene Hermanson Lima — CRM-SP 244306` (reg ID inline) |
| `performing_doctor` | `Manoel Iomar de Medeiros — CRBM-SP-21714` |
| `laboratory` | `Laboratório de Análises Clínicas — Rede D'Or / Vila Nova Star` |
| `lab_city` / `lab_country` | `São Paulo` / `Brasil` (original spelling) |
| Granularity | 33 rows / **1** date / **1** lab / **1** city → one set per panel ✓ |

**Device** (`vitals_daily`) and **Narrative** (`writings`): **0** clinical-provenance
columns exist on either table → the clinical facts are structurally `n/a` (NULL, not
fabricated, not empty-string); each row carries only its measurement/authored date plus
the auto `created_at` ingestion timestamp. Confirms the source-type classification held —
clinical fields were not forced onto self-captured or narrative data.
