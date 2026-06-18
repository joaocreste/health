CONTEXT FOR THIS RUN — read before the prompt below:

- The file is already staged locally. Do NOT ask where the data lives.
- Import ID: 83147b9a-bff3-4689-9058-3e72c1665c35
- Staged folder: .staging/83147b9a-bff3-4689-9058-3e72c1665c35/
- The file to ingest: the single PDF under that folder (a blood test).
- Patient: user id b677a974-53cb-4219-b9ca-611581f0e591 (this is "John Smith", a
  brand-new patient).

MANDATORY render-surface discovery before any write:
- This patient is NOT João, Paulo, Silvana, or Leo. He has no bespoke static HTML
  and no bespoke renderer in patient-context.js.
- Therefore he is a DATABASE-DEFAULT patient: his page is driven by
  /api/patient-{summary,exams} reading from the database.
- Write the extracted lab data to the DATABASE for patient
  b677a974-53cb-4219-b9ca-611581f0e591. Do NOT create static HTML and do NOT add a
  bespoke renderer.
- After writing, his data must render through the default data-driven renderer.

Then follow the blood/urine labs ingestion prompt below, reading the PDF from the
staged folder above.

# Blood & Urine Panel Ingestion — Lumen Health (v2, corrected)

> Claude Code prompt. Ingest one patient's blood and/or urine panel into Lumen Health,
> surface it **where that patient actually looks**, and treat the job as done **only when it
> is verified live on the URL the patient sees**.
>
> This version exists to fix a specific failure: the previous prompt assumed every patient is
> database-driven. That is false. For a bespoke-static-HTML patient (João / Patient Zero, and
> Leo who derives from him), writing correct rows to Postgres produces a perfectly accurate,
> **completely invisible** result, because that patient's page never reads the database. The
> single most important change below is **Step 0 — identify the render path before writing any
> data.**

---

## 0. The one rule this prompt enforces

**Do not write a single value anywhere until you know HOW this patient's lab UI renders and WHERE the result must appear.**

A 30-second read of `web/assets/patient-context.js` tells you whether this patient is database-driven or bespoke. Skipping that check was the root cause of every error last time. Identify the render path first; choose the write target second; write third.

---

## 1. Operating mode: ask → confirm → act

This is the non-negotiable intake shape used across all Lumen ingestion prompts.

1. **Ask** the intake questions in §3. Do not assume answers you can verify — verify them.
2. **Confirm** the write plan in §4 back to the user and get an explicit "go" before any write.
3. **Act** only after confirmation, and only on the targets confirmed.

Never declare success on the basis of a database load or a preview deploy. Success is defined in §9, and nothing short of it counts.

---

## 2. Step 0 — Identify the render mechanism (BEFORE anything else)

Open `web/assets/patient-context.js` and determine which of three classes this patient belongs to. **Do not proceed past this step until you can state, in one sentence, where the ingested labs will become visible.**

### Class A — Bespoke static-HTML patient
- **Who:** João Victor Creste (Patient Zero), whose pages are hand-built static HTML in `web/*.html` (labs live in `web/physical-exams.html`). Leo Keller derives from João's pages at runtime via `web/assets/leo-mode.js`.
- **How to detect:** the patient is explicitly skipped by the generic DB renderer; their content is static markup, not fetched from `/api/patient-exams`.
- **Deliverable:** **a careful HTML edit of the static page** (see §5A). The database is only a downstream mirror for the AI-insight engine — it does **not** drive the page.

### Class B — Bespoke JS-renderer patient
- **Who:** Paulo Silotto Souza (`renderPauloPhysicalExams()`), Silvana Creste (`renderSilvanaPhysicalExams()`, data in `web/assets/silvana-labs.js` as `window.SILVANA_LABS`). Other hand-curated, off-pipeline patients follow this shape.
- **How to detect:** there is a named `render<Name>PhysicalExams()` function and a branch for this patient in the `section === 'physical-exams'` dispatch (and in the catch-all Physical dispatch).
- **Deliverable:** **edit the patient's render const and/or data file** (e.g. add the panel to `window.SILVANA_LABS` and bump its `?v=N`), then mirror to the database. The page is JS-rendered, not API-driven.

### Class C — Generic database-driven patient (the default)
- **Who:** every patient with no bespoke branch — the default data-driven renderer fed by `/api/patient-summary` and `/api/patient-exams`.
- **How to detect:** no static page, no `render<Name>PhysicalExams()`, no branch in the dispatch — they fall through to the default renderer.
- **Deliverable:** **load `lab_results` correctly** (see §5C). The renderer surfaces it automatically; the database load *is* the visible change for this class only.

> **Reconciling this with "front-end display is a separate job."** That principle is about building
> genuinely *new* UI components (e.g. a brand-new chart type that doesn't exist yet) — those stay
> separate. It does **not** license leaving an ingested panel invisible. For Class A and Class B
> patients, surfacing the labs on their **existing** exams page is the load step itself, just expressed
> as HTML / a render const instead of SQL. It is in scope for this job.

---

## 3. Step 1 — Intake questions (ask)

Ask all of these. The last two are the ones the old prompt was missing and are mandatory.

1. **Who is the patient?** Resolve the name to the canonical patient identifier. Patient names are the unique identifier in this system — there is no separate patient-ID field.
2. **Where is the source data?** Exact file path(s) / upload (PDF, image, CSV).
3. **Is this blood, urine, or both?** Capture the full **provenance set** (§ Provenance). Read it from the report first (header/footer/signature block); only ask the user for what the document does not show. Mark any genuinely-absent field `n/a` — never invent.
4. **How does this patient render — Class A, B, or C?** Answer from `patient-context.js` (§2), not from assumption.
5. **Where must this be visible when done, and on which live URL?** Name the exact page (e.g. `https://lumenhealth.io/physical-exams`). This is the surface you will verify against in §9.

---

## 4. Step 2 — Confirm the write plan (confirm)

Before writing anything, restate to the user:
- The patient and their render class.
- The exact write target(s): which HTML file / which render const + data file / which table.
- That the database write is the *visible* change (Class C) or only a *downstream mirror* (Class A/B).
- The single live URL you will verify against.

Get an explicit "go." Do not over-build ahead of this confirmation.

---

## 5. Step 3 — Extract (keep this — it was accurate)

The extraction logic from the previous run was correct and should be preserved. For each analyte in the panel:

- Capture **name, value, unit, reference range, and flag** (High / Low / abnormal / normal).
- Map each analyte to its **canonical analyte** and **canonical category**.
- **Read the live category enum — do not guess it.** The canonical `lab_results.category` enum has a known **19-vs-20-category divergence** between the ingestion and reorganization prompts that is *not yet resolved*. Read the actual enum from `db/schema.ts` (and confirm against existing rows). If your panel needs a category that isn't in the live enum, **stop and flag it** — do not silently invent or pick a near-miss.
- **Panel name is an order-set tag, not a storage destination.** A "Metabolic Panel" (or any panel/order set) is metadata: store the panel name as `panel_ordered` and route each constituent analyte to its real subcategory home. Never create a "Metabolic Panel" bucket and dump analytes into it.
- **Deduplicate point-on-change:** one row per analyte per collection date. Don't duplicate an unchanged historical value.
- Record the full **provenance set** once per panel (see § Provenance for the exact `lab_results` column mapping): collection date, requesting + performing doctor, lab name/city/country. `ingested_at` is set automatically by the DB (`created_at`) — never type it.
- Confirm exact column names against `db/schema.ts` before any insert.

---

## 6. Step 4 — Two different things are called "history" — don't conflate them

This collision caused a self-inflicted layout break last time. Keep them distinct:

- **The data concept** — *per-date analyte rows* (one row per analyte per date, for longitudinal storage and the AI engine). This is a **data-routing** idea. It has nothing to do with layout.
- **The UI "Historical comparison table"** — a **front-end element** on the exams page with hard structural rules:
  - It is **full-width**.
  - It sits **below all the detail cards**, as a **sibling of the panel grid — never a child of it**.
  - Columns are ordered **newest-leftmost**.
  - The latest value is **bold** (`lab-cmp-latest`).

When the prompt or your notes say "history table," be explicit about which of these you mean.

---

## 7. Step 5 — Write, branched by render class (act)

### 5A — Class A: bespoke static-HTML patient (João; Leo derives)

The deliverable is an HTML edit of **three distinct regions** of `web/physical-exams.html`. Treat them as three separate, careful edits — not one bulk find/replace.

1. **Summary cards** (top).
2. **Detail cards** — the `.lab-panel-grid` of `<details>` elements (one per analyte).
3. **Historical comparison table** — full-width, **below** the grid, a **sibling** of `.lab-panel-grid`.

**The trap that broke the layout last time:** a span replacement swallowed the `</div>` that closes `.lab-panel-grid`, trapping the historical table *inside* the grid as if it were a sample card. To avoid it:
- The grid's closing `</div>` must come **before** the historical table's opening tag.
- After editing, confirm the table is a sibling, not a descendant, of `.lab-panel-grid` (§8).
- Do **not** rewrite a caption to claim the detail view "reflects the [date] panel" *before* the detail view actually does — that forced an unnecessary full panel regeneration last time. Make the change true first, then describe it.

**Also** load the same panel into Neon `lab_results` as a **downstream mirror** — the AI-insight engine reads it. Present this as "mirrored for the AI engine," not as "the labs are now visible" (they aren't, until the HTML edit is live).

### 5B — Class B: bespoke JS-renderer patient (Paulo, Silvana)

- Add the panel to the patient's data structure (e.g. `window.SILVANA_LABS` in `web/assets/silvana-labs.js`) and/or the named render const.
- If you edit a data file loaded via `<script>` (like `silvana-labs.js`), **bump its `?v=N`** cache-buster wherever it's referenced.
- Preserve the renderer's existing card / table / summary structure and the §8 invariants.
- Mirror to Neon `lab_results` as the downstream AI-engine source.

### 5C — Class C: generic database-driven patient (default)

- Insert into `lab_results` with the correct columns (confirm names in `db/schema.ts`), correct canonical category, `panel_ordered` metadata, dedup, timestamps, and the full **provenance set** (§ Provenance).
- The default renderer surfaces it from `/api/patient-summary` + `/api/patient-exams` — for this class only, the database load is the visible change.

---

## 8. Step 6 — Front-end invariants you must not break

Any ingestion that touches the UI must preserve all of these:

- **Landing-hero-first.** Every patient's `/home` opens with the hero block (`Health Summary · [DATE]` / *From scattered data to a clinical picture.*). Nothing above it. Injected AI / synthesis cards go **below** the Reports/Browse section. Order: hero → Reports → AI/synthesis → everything else.
- **Amber/gold AI-summary card + `.ai-pill`.** The gold-bordered AI summary card carries the purple `.ai-pill` badge. Any block that mixes patient data with AI synthesis must carry the badge. Reuse the existing card classes / amber tokens (`#FDF8EC` background, `#F4DD9C` stroke) — don't hardcode new colours.
- **Historical comparison table** is a full-width **sibling below** the detail-card grid; newest column leftmost; latest value bold (`lab-cmp-latest`). (See §6.)
- **Bar-position formula.** Lab cards show a position bar locating the value within its reference range. **Reuse the existing formula already in the page / renderer — do not invent one.** After rendering, eyeball a known card to confirm your new cards position identically.
- **Bilingual everywhere.** EN ↔ BR-PT via `<span class="lang-en">` / `<span class="lang-pt">`, including any chart titles / meta you add.
- **`hidePageBody()` whitelist** (bespoke patients) must whitelist **only `<nav>`, never `<header>`** — otherwise João's static `page-header` hero leaks onto other patients' pages. New bespoke patients also need: a constant at the top of `patient-context.js`, a branch in the `section === 'physical-exams'` dispatch, a branch in the catch-all Physical dispatch, and their class added to the `hidePageBody()` whitelist.

---

## 9. Step 7 — Structural verification that matches the edit

Last time the verification checked the thing that was fine (`<details>` open/close = 16/16 ✓) and skipped the thing that was broken (`<div>` balance was off by one). Verify what your edit can actually break:

- **`<div>` balance.** Count `<div>` opens vs `</div>` closes in the edited file — they must match exactly. This is the check that would have caught the swallowed grid `</div>`. Do **not** rely on `<details>` counts alone.
- **Sibling check.** Confirm the historical comparison table's opening tag comes **after** the `.lab-panel-grid` closing `</div>` — i.e. the table is a sibling, not nested inside the grid.
- **Render check.** Load the **live** page after deploy and confirm: the historical table renders full-width below the cards (not as a card inside the grid), the bar positions match existing cards, the AI card keeps its `.ai-pill`, and both language spans are present.

---

## 10. Step 8 — Definition of done (the omission that caused premature "success")

The job is **not** done at "structured payload + summary." The job is done only when **all** of these are true:

1. Data extracted and written to the **correct target(s) for this patient's render class** (§5).
2. Changes **committed** (ASCII-only commit message — see §11).
3. Deployed to **production** via the two-step ritual — **not** a preview branch alias (§11).
4. **Verified on the live bare domain** (`lumenhealth.io`, not a per-deploy `*.pages.dev` hash URL) with `curl -sL … | grep` for a distinctive string from this change.
5. The patient can **see** the result on the exact URL named in §3.

If any of these is false, the job is unfinished — say so plainly. Never offer a tidy "leave on preview / promote / stash" menu in place of shipping to production; "you can't see it" is a failure, not a configuration choice.

---

## 11. Step 9 — Deploy discipline

- **Two steps, one unit.** `git push` **and** `wrangler pages deploy`. A push alone leaves the live site stale (Pages does not auto-deploy this project). Never push alone.
  ```
  git add … && git commit -m "ASCII-only summary" && git push
  CLOUDFLARE_API_TOKEN=$(tr -d '\n\r' < token.txt) \
  CLOUDFLARE_ACCOUNT_ID=8dac8253e9c75f921598ce5273e5a834 \
  wrangler pages deploy web --project-name=lumenhealth --branch=main --commit-dirty=true
  ```
- **ASCII-only commit messages.** A `→` (U+2192) in the latest commit message makes `wrangler pages deploy` fail (`Invalid commit message [code: 8000111]`). Use `->` in commit messages (page content can keep `→`), or override with `--commit-message`.
- **Verify on the bare domain.** `curl -sL https://lumenhealth.io/<page> | grep "<distinctive string>"`. The hash URL is an immutable preview, not the user-facing site.
- **Scoped, clean deploy.** Deploy only the files this job changed. Do not ship a dirty tree with unrelated changes (stray `leo-mode.js` edits, deleted scans). If the tree is dirty, scope the commit or clean it first.
- **Skip deploy only** for purely-local changes that don't touch `web/` (CLAUDE.md, memory files, `scripts/`). When uncertain, deploy.

---

## 12. Scope discipline / anti-patterns (all observed last time)

- **Don't act before Step 0.** Most of the wasted work last time was building down the wrong path before confirming the target.
- **Don't write a caption true-in-advance.** Don't claim the page reflects something before it does, then expand scope to make your own claim true.
- **Don't over-build.** Taxonomy edits, generator scripts, and migration-style loads are not free — only do what this patient's render class requires.
- **Don't conflate the two "history" concepts** (§6).
- **Don't declare victory on a DB load or a preview deploy** (§10).

---

## 13. PHI / safety

- **No PHI in URLs** (no patient identifiers, no values in query strings).
- **Safe-Harbor de-identification at the Worker boundary** before any PHI could reach the model. If the de-identification boundary is absent at the point you're touching, leave an explicit `TODO` marking it — do not silently send PHI on the current non-HIPAA tier.

---

## 14. Final report format

Hand back, concisely:
- **Patient + render class** (A/B/C) and *why*.
- **Extracted:** analyte count, panel(s), collection date(s), any flagged/abnormal values, any category that didn't fit the live enum (flagged, not invented).
- **Written to:** exact file(s) / render const / table — and which was the *visible* change vs the *downstream mirror*.
- **Verification:** the commit hash, the production deploy, and the `curl`-on-bare-domain result proving it's live.
- **Open items:** anything deferred (e.g. the unresolved 19-vs-20 category enum), stated explicitly.
---

## 15. Provenance — capture AND persist (the five facts)

Every clinician-ordered exam must capture its provenance and persist it to the DB
on ingestion. A blood/urine panel is a **clinician-ordered** source, so **all five
facts apply**. Capture **one provenance set per panel** (shared by every analyte
row), not one per analyte.

| Fact | `lab_results` column | Required? | Notes |
|---|---|---|---|
| Exam date (collection) | `taken_at` (date, NOT NULL) | **required** | When the sample was drawn. Coerce partial dates to a best-guess full `YYYY-MM-DD`. |
| Requesting doctor | `requesting_doctor` (text, null) | if shown | Who ordered the panel. Name + title + **registration ID inline** (e.g. `Dra. Maria Souza — CRM-SP 12345`). Original language. |
| Performing doctor | `performing_doctor` (text, null) | if shown | Who performed/signed/is responsible (*Responsável técnico, Assinado por, Liberado por, Patologista*). Reg ID inline. |
| Lab name | `laboratory` (text, null) | if shown | Facility name, original spelling (this column **is** the lab-name slot). |
| Lab city | `lab_city` (text, null) | if shown | City, original spelling. |
| Lab country | `lab_country` (text, null) | if shown | Country. Do **not** infer from the report's language. |
| Ingestion date | `created_at` (timestamptz, `now()`) | auto | System-set at write time. **Never** type it; never conflate with `taken_at`. |

**Rules:**
- Read provenance from the report first (header, footer, signature block). Ask the
  user only for what the document lacks.
- Mark genuinely-absent fields **`n/a` → NULL** (not empty string, not a guess).
- Do not translate doctor / lab / city names — store the original spelling.
- The live `/api/ingest` path already extracts and writes all of these for lab PDFs
  (`lib/ingest.js`). For Class A/B (HTML/JS render) the DB mirror must carry the same
  provenance columns so the AI engine and any future provenance UI see one truth.
