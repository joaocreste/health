# Lumen Health — Front-End Code & Backend Contract Audit (Pass 2, code-side)

**Scope:** read-only. Nothing modified except this file. No commits, deploys, or DB writes.
**Repo:** `/Users/joaocreste/Claude Agent/Health WebbApp`
**Audited state:** branch `feat/patient-account-settings` (working tree, on disk — **not** clean `main`), last commit `2c2dfb28 imaging: rebuild Paulo chest CT report to house pattern`.
**Method:** five parallel read-only agents over `web/_worker.js` (4,301 lines), `web/assets/patient-context.js` (8,979 lines), the static HTML shells, `db/schema.ts`, and migrations 0005/0006. Key root causes independently re-verified against source.

> **Branch caveat that matters for the rebuild.** This audit reflects the code *as it sits on the feature branch*, which is what would deploy from here. Two Pass-1 (live-site) defects appear **already fixed on disk** — flagged inline (defect #8; parts of #5). Where the branch and the live site diverge, the branch is what the rebuild inherits.

---

## STEP 0 — Render-surface inventory

Every surface that can put pixels on a patient page.

### Static HTML shells (`web/`)
| File | Size | Role |
|---|---|---|
| `home.html` | 10.5 KB | Patient-Zero `/home` — hero + reports + at-a-glance + alerts + injury/surgery + sources |
| `physical.html` | 30 KB | Patient-Zero `/physical` landing — browse + deterioration callout + clinical history + meds + pyramids |
| `physical-exams.html` | 371 KB | Labs history, imaging viewers, ECG, reproduced radiology reports |
| `physical-vitals.html` | 165 KB | Vitals charts (Chart.js/Plotly/boxplot) |
| `physical-genetics.html` | 95 KB | PGx module (~93 gene cards + drug-class bands) |
| `mental.html` | 350 KB | Therapy trends, archetype, psych architecture, timeline, pyramids |
| `spiritual.html` | 99 KB | Confession, wheel-of-life, witness, scriptures, timeline, practices |
| `loops.html` | 20 KB | Two coping-loop SVG diagrams (bespoke; no tail cards, no footer) |
| `index.html` | 360 KB | **Public marketing landing** (also the soft-404 fallback — see defect #1) |
| `account.html` | 16 KB | Self-service profile page (loads only `app.js`) |
| `login.html`, `patients.html`, `upload.html`, `admin.html`, `uploads-review.html` | — | Auth / portal / admin surfaces |
| `_*.html` (`_endo-content` 2.2 MB, `_cardio-content` 1.9 MB, `_report-*`, `_card-catalog`, `_viewer-fixture`, `_*-cover`, `_*-harness`) | — | **Build/report/harness fixtures** — not in live nav (Class C) |

### JS render surfaces (`web/assets/`)
| File | Size | Role |
|---|---|---|
| `patient-context.js` | 629 KB | **The renderer.** Dispatch + all bespoke JS renderers + injected styles + AI-insights decorator + danger zone + bottom-dock reflow |
| `leo-mode.js` | 39 KB | Demo overlay — regex-rewrites Patient-Zero's name → "Leo Keller", guarded `if (patient !== LEO) return` (`:41`) |
| `john-mode.js` | 4 KB | Demo overlay — 1:1 clone as "John Smith Jr", guarded (`:33`) |
| `data.js` | 83 KB | Patient-Zero vitals/metrics data global |
| `metrics.json` | 110 KB | Vitals metrics (fetched at runtime, not script-tagged) |
| `silvana-labs.js` | 59 KB | **Pure data** — top-level `window.SILVANA_LABS = {…}`, **no guard** (`:13`) |
| `paulo-labs.js` (113 KB), `cristina-labs.js` (14 KB), `paulo-mental.js`, `paulo-sleep.js`, `paulo-ergometric.js` | — | Pure data globals; consumed only by their bespoke renderer branches |
| `app.js` (26 KB) | — | Shared shell: nav, language toggle, view-mode tiers |
| `upload-card.js` (6 KB) | — | Mounts "Upload" card on every patient page (`:4-5`) |
| `insights-update.js` (20 KB) | — | Mounts "Update AI Insights" card + drives status polling |
| `chat-widget.js` (11 KB) | — | Patient chat root |
| `export-pdf.js` (14 KB) | — | Client-side PDF export (html2canvas + jsPDF) |
| `add-data.js`, `chatbot.js`, `export.js`, `exam-tags.js`, `lab-taxonomy.js`, `upload-page.js`, `uploads-review.js` | — | Not loaded by the 8 patient shells (admin/portal/unused) |

### Worker-injected
- `web/_worker.js` — routing gate (`gateStaticRequest`), all `/api/*` handlers, ECG/scan object serving. Injects nothing into HTML directly; it gates, redirects, or passes through to `env.ASSETS`.

**Only two files match `*-mode.js`:** `leo-mode.js`, `john-mode.js`. All other per-patient assets are *pure data*, not renderers.

---

## JOB 1 — Renderer dispatch map

### 1.1 Patient constants & template class
All six identifiers are `pending:*` pseudo-slugs defined at the top of `patient-context.js`:

| Constant | Slug | Def | Template class |
|---|---|---|---|
| `PATIENT_ZERO` | `pending:joao` | `:22` | **bespoke-static-HTML** (hardcoded shells; JS only decorates) |
| `LEO_KELLER` | `pending:leo-keller-a3f1c2` | `:30` | bespoke-JS overlay of Joao's static HTML (`leo-mode.js`) |
| `JOHN_SMITH_JR` | `pending:john-smith-jr-9d4e21` | `:35` | bespoke-JS clone of Joao's static HTML (`john-mode.js`) |
| `PAULO_SILOTTO` | `pending:paulo-silotto-df3441` | `:23` | bespoke-JS renderer (`window.PAULO_LABS`) |
| `SILVANA_CRESTE` | `pending:silvana-creste-18ba19` | `:24` | bespoke-JS renderer (`window.SILVANA_LABS`) |
| `CRISTINA_CRESTI` | `pending:cristina-cresti-d7479c` | `:25` | bespoke-JS renderer (`window.CRISTINA_LABS`) |
| *(any other slug)* | — | — | **default DB renderer** via `/api/patient-summary` |

Patient resolved at `:37-48` from `?patient=` or `sessionStorage['jc_current_patient']`.

### 1.2 Dispatch logic — single dispatcher at `patient-context.js:3724-3887`

- **Bespoke-static short-circuit (`:3733-3755`):** Joao/Leo/John → `injectStyles()`; on `home` also `injectDangerZone()` + `decorateProceduresFromDb()`; on `physical-exams` also `retrofitStaticLabHistory()` + `decorateExamsWithAiOutliers()` + `decorateEcgStudies()`; then `decorateWithAiInsights(section0)` and **early `return` at `:3754`** — static HTML left in place, `hidePageBody()` never called.
- **All others (`:3757-3760`):** `injectStyles(); hidePageBody(); gatePillarNav()`.
- **Per-section/per-patient branches (`:3763-3860`):** hardcoded `if (patient === …)` chains (see 1.4).
- **Default fall-through (`:3862-3887`):** `dataRenderers = { physical, physical-vitals, physical-genetics, mental, spiritual }` (`:3872`); unmapped section (e.g. `loops`) → `renderEmptyShell()`.

**Patient × page → renderer @ file:line**

| Page \ Patient | Joao / Leo / John | Paulo | Silvana | Cristina | default |
|---|---|---|---|---|---|
| home | static + `injectDangerZone` @3737 | `renderHome`+`injectPauloPainMap` @3767/3779 | `renderHome` @3767 | `renderHome` @3767 | `renderHome` @3767 |
| physical | static | `renderPauloPhysicalExams` @3816 | `renderSilvanaPhysicalLanding` @3845 | `renderCristinaPhysicalExams` @3834 | `renderPhysical` @3883 |
| physical-vitals | static | `renderPauloPhysicalExams` @3816 | `renderSilvanaVitals` @3849 | `renderVitals` @3874 | `renderVitals` @3874 |
| physical-exams | static + retrofit/ECG @3745-3748 | `renderPauloPhysicalExams` @3790 | `renderSilvanaPhysicalExams` @3795 | `renderCristinaPhysicalExams` @3800 | `renderExams` @3806 |
| physical-genetics | static | `renderPauloPhysicalExams` @3816 | `renderEmptyShell` @3858 | `renderGenetics` @3875 | `renderGenetics` @3875 |
| mental | static | `renderPauloMental` @3825 | `renderMental` @3876 | `renderMental` @3876 | `renderMental` @3876 |
| spiritual | static | `renderSpiritual` @3877 | `renderSpiritual` @3877 | `renderSpiritual` @3877 | `renderSpiritual` @3877 |
| loops | static | `renderEmptyShell` @3884 | `renderEmptyShell` @3884 | `renderEmptyShell` @3884 | `renderEmptyShell` @3884 |

Renderer defs: `renderEmptyShell` `:2972`, `renderPauloMental` `:6376`, `renderPauloPhysicalExams` `:7154`, `renderSilvanaPhysicalLanding` `:7973`, `renderSilvanaPhysicalExams` `:8077`, `renderCristinaPhysicalExams` `:8381`, `renderSilvanaVitals` `:8942`.

### 1.3 `hidePageBody()` — `patient-context.js:330-351`
Hides every direct child of `<body>` **except** a whitelist. It does **NOT** whitelist only `<nav>` — it whitelists **two tags + nine classes**:

`NAV`, `SCRIPT`, `.jc-empty-shell`, `.jc-overview`, `.jc-exams`, `.jc-home`, `.jc-paulo-exams`, `.jc-paulo-mental`, `.jc-silvana-exams`, `.jc-danger-zone`, `.jc-danger-backdrop`, `.lumen-chat-root`.

Note: `<header class="page-header">` is deliberately **not** whitelisted (`:334-337`) because it hardcodes Joao's hero copy. The whitelist also bakes in **per-patient class names** (`jc-paulo-exams`, `jc-paulo-mental`, `jc-silvana-exams`) — a shared-path special case in itself. Cristina has no dedicated class (reuses a generic container).

### 1.4 Per-patient special cases in the SHARED dispatcher (no-special-casing violations)
All inside `ready()` (`:3724-3887`), which runs for every patient:

| # | file:line | Branch |
|---|---|---|
| 1 | `:3733` | `PATIENT_ZERO \|\| LEO_KELLER \|\| JOHN_SMITH_JR` static short-circuit |
| 2 | `:3779` | `PAULO_SILOTTO` → `injectPauloPainMap()` inside shared home callback |
| 3–5 | `:3789 / :3794 / :3799` | Paulo / Silvana / Cristina branches in `physical-exams` |
| 6 | `:3814` | Paulo && (physical\|vitals\|genetics) |
| 7 | `:3824` | Paulo && mental |
| 8 | `:3833` | Cristina && physical |
| 9–12 | `:3844 / :3848 / :3852 / :3857` | Silvana && physical / vitals / exams / genetics |
| + | `:343-345` | `hidePageBody` hardcodes per-patient classes |

### 1.5 Why `silvana-labs.js` loads on every page for every patient
It is an **unconditional `<script src>` tag on all 8 shells** (`home:283`, `physical:303`, `physical-exams:5394`, `physical-vitals:904`, `physical-genetics:1046`, `mental:2278`, `spiritual:1181`, `loops:337`), and the file itself is **pure data with no patient guard** — its entire body is `window.SILVANA_LABS = {…}` (`silvana-labs.js:13`, spanning to EOF at 1345). Unlike `leo-mode.js:41` / `john-mode.js:33`, there is no IIFE and no `if (patient !== …) return`. So the ~59 KB object is built on every page load regardless of active patient, even though only Silvana's dispatch branches read it (`:7455, :7644, :8086`). This is also the mechanism behind defect #3.

---

## JOB 2 — Page assembly order

**Contract order:** hero → concise AI summary → topic sections → upload → update-insights → delete → footer.

**Central finding:** For Joao/Leo/John the DB renderers (`renderHome/renderExams/…`) **never run** — the bespoke path early-returns at `:3754`. So page order = whatever the **static HTML** emits, plus **three independent JS injectors** that each re-pin themselves to the footer/body tail. The *only* shared layout primitive is `reflowBottomDock()` (`:3240-3271`), and it orders **only the tail cluster** (AI block + Upload/Update/Delete), not the whole page.

### Per-page order vs contract
- **/home** (`home.html`): nav `:17` → **hero** `:40` → Reports `:58` → at-a-glance `:109` → alerts `:163` → injury/surgery `:202` → sources `:234` → **footer** `:274`. JS then appends, before footer / into dock: danger zone (`injectDangerZone` @`pc:3737`), **AI "Health synthesis"** (`decorateWithAiInsights('home')` @`pc:3753`, inserted `insertBefore(sec, footer)` @`pc:4503`), Upload (`home:288`), Update-Insights (`home:287`). `reflowBottomDock` (`pc:3240`) then stacks AI block on top of a 3-col **Upload | Update | Delete** row before the footer. **Diff:** the AI summary is **last**, not second. Delete present (home only). ✔ order within dock matches.
- **/physical** (`physical.html`): nav → **page-header** `:38` → browse `:48` → April callout `:128` → clinical history `:189` → meds `:223` → Três Pirâmides `:254` → **footer** `:294` → Upload `:312` + Update `:311`. **No AI summary at all** (`decorateWithAiInsights` not called off the home/physical-exams path). **No delete card** (by design).
- **/mental** (`mental.html`): nav → page-header `:39` → 12 topic sections (`#therapy-trends:65` … `#three-pyramids:2231`) → **footer** `:2269` → Upload `:2284` + Update `:2283`. No AI summary, no delete.
- **/spiritual** (`spiritual.html`): nav `:429` → **hero** `:452` → 9 topics (`#confession:491` … `#three-pyramids:971`) → **footer** `:1033` → Upload `:1186` + Update `:1185`. No AI summary, no delete.
- **/loops** (`loops.html`): nav `:100` → page-header `:120` → single Comparison section `:132` → `</section>` `:334` → `<script>` `:336`. **No tail cards, no footer.**

### The five specific answers
- **A. Why /home's Health synthesis renders last, not second.** It is the **AI-insights block** built by `buildAiInsightsHtml` (`aiHeader('Health synthesis',…)` @`pc:4390`) and injected by `decorateWithAiInsights('home')` (`pc:3753`) with hardcoded tail placement: `footer = querySelector('footer'); footer.parentNode.insertBefore(sec, footer)` (`pc:4502-4503`), then pulled into the bottom dock as its top item (`pc:3264`). The "insert after hero" path (`findInsertionTarget()` `pc:4633-4644`) exists but is only used by `decorateWithDashboard/injectDashboardCard`, which the bespoke Joao path **never calls**. So nothing ever positions the summary after the hero.
- **B. Where sub-pages get Upload+Update but no Delete.** `injectDangerZone()` (`pc:3276`, delete card) is called **only inside the `section0 === 'home'` branch** (`pc:3735-3737`). Sub-pages hit neither `home` nor `physical-exams` branch → no danger zone. Upload+Update come from separate scripts (`upload-card.js:4-5`, `insights-update.js:4`) included in every sub-page's HTML, independent of the home gate. That asymmetry **is** the `pc:3735` conditional.
- **C. Why /loops has no tail cards and no footer.** Two independent causes: (1) the renderer skips it — bespoke path matches neither `home` nor `physical-exams`, and `buildAiInsightsHtml` has no `loops` branch so `decorateWithAiInsights` bails (`pc:4494`); (2) the HTML simply omits `insights-update.js` and `upload-card.js` (compare `home:287-288`) and has **no `<footer>` element** (content ends at `</section>` `loops:334`). Nothing to pin, nothing pins.
- **D. Where the "prepared" dates come from.** **Static string literals in HTML**, not API/build: /home "24 June 2026" `home.html:42` + `:51`; /physical "25 April 2026" `physical.html:43`; /spiritual "4 May 2026" `spiritual.html:471`. (`pc:632` emits a generic `Prepared` label but only for the DB renderer, never on these static pages.)
- **E. Is there a shared page-assembly function?** **No — definitively.** Whole-page order is hand-maintained in each static HTML file; the JS layer adds sections through several injectors that each re-pin to the tail (`decorateWithAiInsights` `pc:4502`, `injectDangerZone` `pc:3292`, `upload-card.js:76`, `insights-update.js`). The *only* shared layout mechanism is `reflowBottomDock()` (`pc:3240-3271`), scoped to the tail cluster only (comment at `pc:3182-3186`: "rather than fight placement we REFLOW"). **Rebuild implication: there is no assembler — order must be reconstructed per-page and per-injector.**

---

## JOB 3 — Known-defect root causes

| # | Defect | Root cause | file:line | Fix sketch (not implemented) |
|---|---|---|---|---|
| 1 | `/assessment` serves the marketing landing | No `assessment.html`, no PAGE_RULE, no 404 page → `gateStaticRequest` returns `null` (public shell) and Pages soft-404-resolves the extensionless path to root `index.html` (the marketing page), served `no-cache` as HTML | gate fall-through `_worker.js:227`; `PAGE_RULES` `:204-213` (no `/assessment`); pass-through `:4285`; no `web/assessment.html`; landing is `index.html:1`. **Not linked from patient nav** (nav = Summary/Physical/Mental/Spiritual, `home.html:23-26`) | Add an explicit `/assessment` route in `_worker.js` (404 or redirect), **or** ship a real `assessment.html` + PAGE_RULE + nav link. Add a `404.html` so future gaps stop resolving to marketing. |
| 2 | `/api/patient-ecg-object?kind=svg` → 404 | `ecg_studies.svg_key` is NULL (study ingested with no SVG blob); renderer requests `kind=svg` unconditionally with no `has_svg` guard | 404 at `_worker.js:722` (`if (!key) return 404 object_not_found`); svg_key only set when `files.svg` supplied at ingest `_worker.js:3524-3532`; unconditional fetch `patient-context.js:3698` | In the ECG hydrate path, gate on `s.has_svg` (already returned at `_worker.js:1237`) before requesting svg; fall back to report/original or hide the chart. Long-term: generate+upload SVG at ingest. |
| 3 | `/assets/silvana-labs.js?v=3` → 503/403 site-wide | File is a **PHI-gated asset** (`GATED_ASSETS`, patient=Silvana, scope=`labs`) yet hard-loaded by `<script>` on **all 8 shells**. Any viewer lacking Silvana's `labs` scope (i.e. everyone on their own page) → plain **403**; a Neon error on the `pending:` placeholder clerk surfaces as **503**. File **is** git-tracked (not a `.gitignore`/deploy issue) | gate entry `_worker.js:182`; script tags `home:283,physical:303,mental:2278,physical-exams:5394,physical-genetics:1046,physical-vitals:904,spiritual:1181,loops:337`; blocking cross-patient DB round-trip with no try/catch on the static-asset critical path | **Remove the `GATED_ASSETS` entry** (the file is just a `window.` assignment; gate the real PHI at the API/scan layer), **or** stop loading it globally — load `silvana-labs.js` only inside the Silvana render branch. Same applies to `cristina-labs.js` (`_worker.js:183`). |
| 4 | Raw HTML leaks in ECG card subtitle (`<span class="lang-en">ordered by</span>` shown as literal text) | `t('ordered by','solicitado por')` **returns `<span>…</span>` HTML**, then the whole concatenated subtitle is passed through `escapeHtml()`, escaping the span tags into visible text | emit `patient-context.js:3578`; `t` def `:68`; `escapeHtml` `:60`; plain-text variant `tPlain` `:76` | Use `tPlain(...)` inside escaped strings, or build the subtitle from pre-escaped fragments and drop the outer `escapeHtml` on `t()` output. |
| 5 | Interpretive content with no `+ AI INFERENCE` / `.ai-pill` badge | Static shells emit human/AI-authored interpretation with **zero** badges; the badge helper (`aiPill()`) only fires in the DB-driven path, which never runs for Joao | `.ai-pill` CSS `styles.css:657` (+ inline copies `pc:739, :3098`); badge helper `aiPill()` `pc:4354` (called by `aiHeader` `:4390`). **Unbadged interpretive surfaces:** /home §03 "Active clinical priorities" `home.html:165-166` (whole file has 0 pills); "Health synthesis" IS badged in the DB path but Joao renders the static §03 instead; also `physical.html` (0 pills — e.g. "Três Pirâmides"), `physical-genetics.html` (0 pills), `spiritual.html` (0 pills) | Add an `.ai-pill` badge to static interpretive section headers, matching the `mental.html:857` pattern. Longer-term: only interpretive blocks that come through `aiHeader` get badged for free — static interpretation needs an explicit badge convention. |
| 6 | `/physical` meds table: CLASS / STATUS-note / CLINICAL NOTE = "—", supplements empty | Three-layer. (a) The `/physical` Patient-Zero table is **static and hardcodes "—"**. (b) `supplements` schema **has no note column**; `drug_class` rows unpopulated. (c) Dynamic renderer never emits the note column | (a) `physical.html:233-236, 247` (hardcoded "—" / "No supplements"); (b) schema: `medications` has `drug_class/status/note` `db/schema.ts:173-175`, `supplements` only name/dose/dates `:182-191`; worker selects `drug_class,status,note` `_worker.js:596-597` but supplements only `name,dose` `:604`; (c) renderer `medsTablesInner` reads `m.drug_class` but **never `m.note`**, supplements row emits name+dose only `patient-context.js:509, 528-531` | Dynamic table: add a Clinical-note column reading `m.note`; populate `drug_class` at ingest; add a `note` column to `supplements` (schema+migration+worker+renderer). Patient-Zero: replace the static table with DB-driven `medsTablesInner`, or fill real values. |
| 7 | `/mental` Psych Architecture "03 Empathy — 0 items" | Empathy dimension authored empty; **no skip-when-empty guard** on either surface. Static grid hardcodes "0 items"; dynamic `forEach` renders every dimension with no `d.items.length` check | static card `mental.html:909-912` + empty panel `:1101`; dynamic `psych.dimensions.forEach(...)` `patient-context.js:2891` (section-level guard at `:2886` only) | Add `if (!d.items || !d.items.length) return;` inside the `forEach` (`pc:2891`); remove the empty Empathy card+panel from `mental.html` or drive the grid from data so 0-item dimensions are skipped. |
| 8 | Missing EN span for "Clínico geral" source item, /home §05 | **Does not reproduce on this branch.** `home.html:258` currently contains **both** `lang-en` ("GP") and `lang-pt` ("Clínico geral") spans; a full scan of `home.html` `<li>`s found no orphan `lang-pt`. `home.html` mtime is today — likely already patched vs. the Pass-1 live site | `home.html:258` | None needed on this branch; if it regresses, keep the paired `lang-en` span. |

---

## JOB 4 — Backend response contracts

Route dispatch (top-level fetch handler): `/api/patient-summary` `_worker.js:4176` → `handlePatientSummary` (`:515`); `/api/patient-exams` `:4185` → `handlePatientExams` (`:1154`); `/api/patient-dashboard` `:4215` → `handlePatientDashboard` (`:1620`); `/api/patient-dashboard-build/status` `:4218` → `handleInsightJobStatus` (`:1847`, matched **before** build — correct); `/api/patient-dashboard-build` `:4221` → `handlePatientDashboardBuild` (`:1748`).

### 4.1 Response schemas

**`/api/patient-summary`** (200, `no-store`, body built `:643-660`). Auth `:536-541`: `loadScopeGrant`; deny 403/401 if 0 scopes; every slice scope-**filtered**.
```
{ patient:{id,clerk_user_id,full_name,email,locale,created_at,date_of_birth,sex,
           country_of_residence,native_language},
  pillars:{ physical:{total:int,breakdown:{<key>:int}}, mental:{…}, spiritual:{…} },  // keys filtered by SCOPE_OF_KEY :618-629
  counts:{documents:int, imports:int},
  recent_documents:[{id,kind,title,original_filename,document_date,created_at}]|[],   // scope journal
  recent_labs:[{panel,marker,value,value_text,unit,ref_low,ref_high,flag,taken_at,laboratory}]|[], // scope labs
  pending_files:[{original_path,status,classified_as,error_message,created_at}]|[],   // privileged only
  medications:[{name,dose,frequency,daily_dose_amount,daily_dose_unit,drug_class,status,note,started_at,ended_at}]|[], // scope medications
  supplements:[{name,dose,started_at,ended_at}]|[],                                    // scope medications
  procedures:[{event_date,date_raw,type,location,description,notes}]|[] }              // scope clinical_history
```
`breakdown` keys: physical `lab_results,imaging_studies,medications,supplements,encounters,prescriptions,vitals_days,ecg_events,pgx_findings,surgeries,injuries,clinical_history`; mental `psych_items,mood_entries,panic_events,risk_assessments,writings`; spiritual `wheel_of_life,life_events` (`:632-638`).

**`/api/patient-exams`** (200, `no-store`, `:1328-1337`). Auth `:1173-1178`: privileged OR `imaging`/`labs`; EDX uses **admin-only** review bypass (`:1304`, excludes `self`).
```
{ patient:{id,clerk_user_id,full_name},
  panels:[{panel, markers:[{marker,latest_value,latest_value_text,unit,ref_low,ref_high,flag,
           latest_taken_at,laboratory,requesting_doctor,source_blob_key,points:[…]}]}],  // scope labs
  lab_documents:[{id,kind,title,original_filename,document_date,blob_key,created_at}]|[],
  imaging:[{id,modality,body_part,study_date,source_format,file_count,notes,blob_prefix,
            report_blob_key,manifest_blob_key,jpeg_preview_prefix}]|[],                   // scope imaging
  medications:[…]|[], supplements:[…]|[],
  ecg_studies:[{id,study_date,recorded_at,modality,lead_layout,source_format,fidelity,
                ordering_doctor,validating_doctor,clinic,heart_rate,pr_ms,qrs_ms,qt_ms,qtc_ms,
                axis_p,axis_qrs,axis_t,interpretation,report_text,
                has_svg:bool,has_report:bool,has_original:bool}]|[],                       // maps to scope imaging
  electrodiagnostic_studies:[{id,study_type,study_subtype,body_region,laterality,exam_date,
                ingested_at,requesting_doctor,performing_doctor,lab,city,country,source_language,
                display_mode,requires_review,severity_flags,confidence,
                conclusion:str|null,report_text:str|null,structured_data:jsonb|null}] }      // review-gated :1310-1321
```

**`/api/patient-dashboard`** (200, `no-store`, `:1648`). Auth `:1636-1646`: deny if 0 scopes; `ai-insights` section stripped unless viewer has the **full** scope set.
```
{ sections:{ "<section>":{ section, summary_md:str|null, cards_json:jsonb, generated_at,
             model, input_tokens:int|null, output_tokens:int|null, cards:[…] } } }  // cards = cards_json.cards if array else [] (dashboard.js:366)
```

**`/api/patient-dashboard-build`** (POST only `:1749`). Auth: viewer from **`X-Viewer-Clerk` header only** (`:1761`); async path → `resolveInsightAccess` **self-or-admin** (`:1786`,`:1735`). Responses: legacy sync `200 {ok,section,cards,summary_md,input_tokens,output_tokens,generated_at}` (`:1780`); already-running `200 {ok,job_id,status,progress,stage,insights_version,already_running}` (`:1795`); cooldown `429 {ok:false,error:"cooldown",generated_at,minutes_ago,retry_after_seconds}` (`:1810`); new job `202 {ok,job_id,status:"queued",progress:0}` (`:1832`); errors `404/400/429/500`.

**`/api/patient-dashboard-build/status`** (200, `:1847`). Auth: header or `?viewer=`; both branches `resolveInsightAccess` self-or-admin (`:1864`,`:1887`). By `?patient=`: `{status:"idle"}` or `{job_id,status,progress,stage,insights_version}`. By `?job_id=`: `{job_id,status,progress,stage,error:str|null,insights_version,started_at,updated_at,finished_at}`; `status ∈ queued|running|succeeded|failed`.

### 4.2 Dashboard card schema & table mapping
**There is no `patient_dashboard_cards` table.** Migration `0006` is a 2-line `ALTER TABLE patient_dashboards ADD COLUMN cards_json jsonb`. Cards are a JSON array inside that one column (explicitly noted `lib/ai-insights.js:16-19`). `patient_dashboards` (0005+0006): `patient_id` uuid FK, `section` text, `summary_md`, `highlights` jsonb (**not read** by `fetchAllDashboards`), `model`, `input_tokens`, `output_tokens`, `generated_at`, `generated_by`, `cards_json`. PK `(patient_id, section)` → one row per section, upserted. **These tables are not in `db/schema.ts`** — raw-SQL migrations only, outside Drizzle.

Two card shapes coexist in `cards_json`: (a) **legacy** `{kind, title, subtitle, …kind-specific}` capped at 10 (`dashboard.js:240-280`); (b) **AI-insights** payload = the whole object `{request_type, patient_id, generated_at, insights_version, source_coverage, pages{…}, summary{headline,overview,points_to_work_on[],points_to_leverage[],cross_domain_links[]}, inline_insights[]}` (`ai-insights.js:349-457`, sanitized `:919-982`).

### 4.3 Machine-key namespace & CARD ORDER (root cause of "random order")
- The prefixes `lab:`/`ecg:`/`pgx:`/`vitals:`/`imaging:`/`interaction:` **do not exist** as card keys anywhere. Legacy cards have no id at all (`dashboard.js:247-278`). AI-insights cards carry an **LLM-minted `id` slug** (`ai-insights.js:398,851`) and a `trigger` category (enum `out_of_range_lab|trending_lab|concerning_imaging|imaging_followup|abnormal_ecg|vitals_anomaly|body_composition_trend|repetitive_journal_pattern|pgx_flag|interaction_or_polypharmacy` `:436`) — a *tag*, not a positional key.
- **Card order is NOT sorted by the backend.** No `position`/`sort_order`/`rank` column, no `ORDER BY` on cards anywhere. Order = the **array order the LLM emitted**, preserved verbatim through sanitize (`sanitizeInline` `.map/.filter`, no sort, `:835-873`; `sanitizeList` assigns `rank` from array position but never sorts by it, `:784-793`) and stored/returned as-is (`fetchAllDashboards` has **no `ORDER BY`**, returns `cards_json.cards` unchanged, `dashboard.js:356-366`). `risk_level`/`rank` are *instructions to the model* (`:383-384`), never enforced server-side. **"Random section/card order" is inherent to this design** — it is whatever a non-deterministic LLM run emitted. Fix requires a deterministic sort (e.g. `inline_insights` by `risk_level` then a stored ordinal; a section ordinal) that does not exist today.

### 4.4 Patient filtering & auth per route
All five routes filter every query by `patient_id = ${pid}` — none over-broad on the patient axis. Two resolvers: scoped **reads** use `loadScopeGrant` (`:127`; self/admin get all `SCOPE_KEYS`, third parties get `patient_access` scopes with expiry); write/rebuild use `resolveInsightAccess` (`:1725`; strictly self-or-admin). Viewer precedence: `X-Viewer-Clerk` → `?viewer=` → signed cookie (`:115-121`), except build reads the header **only** (`:1761`).

> **Auth gap to flag:** the **legacy synchronous** section-build branch (`_worker.js:1771-1780`) resolves the viewer's DB id but performs **no self/admin check** before running the LLM build and upserting `patient_dashboards` — any resolvable `X-Viewer-Clerk` reaches it. The async branch is properly gated.

---

## JOB 5 — Static content inventory

### 5.1 Front-end-only content blocks (migrate / bespoke / dead)
| Block | file:line-range | Class | Reason |
|---|---|---|---|
| Injury & surgery tbodies | `home.html:201-232` | **A** | Already DB-driven (filler `pc:3419-3435`); generic |
| Red-flag events narrative (overdose/bike/plastic surgery) | `home.html:227-229` | **B** | Patient-Zero narrative inside the DB-driven `#injury` section |
| "Connected sources" device/clinician roster | `home.html:234-292` | **B** | Real Oura/Withings/Probiome + named clinicians; should be DB-backed |
| Clinical history bullets | `physical.html:188-232` | **B** | Bicycle accident, divorce 2024-25 — bespoke |
| "Três Pirâmides" card (physical) | `physical.html:253-289` | **B** | Prof. Rui napkin anecdote, single-patient |
| "Três Pirâmides" card (mental) | `mental.html:2230-2266` | **B** | Duplicate bespoke pyramid narrative |
| Reproduced radiology reports (Patient/Indication/Technique/Findings/Impression) | `physical-exams.html:404-411,416-421,504-520,530-544,695+,814+,902+` | **B** | Verbatim single-patient reports; hardcode real name + MRN |
| PGx summary bullets | `physical-genetics.html:71-75` | **B** | Patient-specific genotype interpretation |
| PGx medication tables | `physical-genetics.html:80-100` | **A** | Generic drug×gene×band grid → DB rows |
| PGx module (Psico/Onco/Cardio/InfectoGene) | `physical-genetics.html:106-~1000` | **A** | ~93 hardcoded gene cards; generic schema → DB |
| Loops page (Loop A/B SVG diagrams) | `loops.html:122-320` | **B** | Bespoke coping-loop narrative |
| Spiritual sections 01-09 | `spiritual.html:490-1037` | **B** | Deeply single-patient devotional narrative |
| PGx demo card-catalog | `_card-catalog.html:220-240` | **C** | Orphaned component catalog, not in nav |
| Endo/Cardio harness + report fixtures | `_endo-content.html`, `_cardio-content.html`, `_report-*`, `_*-harness.html` | **C** | Build/report artifacts, not live nav |

> **Reachability violation:** every Class-B block is currently **reachable** from other patients. `leo-mode.js:52-57` / `john-mode.js:44-49` are regex name-replacement overlays that render this exact bespoke content as "Leo Keller" / "John Smith Jr". The Class-B requirement ("unreachable from other patients' render paths") is violated by design today.

### 5.2 Page × asset matrix
| Page | patient-context | data.js | silvana-labs | paulo-labs | leo-mode | john-mode | chat | upload-card | insights-update | export-pdf | app.js |
|---|---|---|---|---|---|---|---|---|---|---|---|
| home | ✓ | – | **✓** | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| physical | ✓ | – | **✓** | ✓ v1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| physical-exams | ✓ | ✓ | **✓** | ✓ v3 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| physical-vitals | ✓ | ✓ | **✓** | ✓ v1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| physical-genetics | ✓ | ✓ | **✓** | ✓ v1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| mental | ✓ | – | **✓** | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| spiritual | ✓ | – | **✓** | – | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| loops | ✓ | – | **✓** | – | ✓ | ✓ | ✓ | – | – | ✓ | ✓ |

`silvana-labs.js` on **all 8**; `paulo-labs.js` only the 4 `physical-*` (version skew: exams `v3`, others `v1`); `account.html` loads only `app.js`. `add-data.js`/`metrics.json` not script-tagged by any of the 8 (metrics fetched at runtime). Also per-page: `paulo-mental.js` (mental only), `paulo-sleep.js` (exams only), `cristina-labs.js`+`lab-taxonomy.js` (physical + exams only), `paulo-ergometric.js` (4 physical-*).

### 5.3 lang-en / lang-pt coverage
Global span counts are **balanced** on every static page and effectively balanced in `patient-context.js` (170 en / 169 pt; the extra `lang-en` is a CSS selector at `pc:4568`, not an emit — **emit sites clean**). Concrete violations (visible text with no paired span → renders untranslated in PT):
- `physical-exams.html:406-411` — reproduced report list (Patient/Requesting physician/Indication/Technique/Findings/Impression) English-only; also hardcodes `Joao Victor Creste Dias de Souza · MRN 3402824`.
- `physical-exams.html:418, 421` — biopsy report `Patient` + `Technique`, English-only + MRN.
- `physical-exams.html:506` — brain-CT `Patient` line English-only (`:519` Indication IS wrapped).
- `physical-exams.html:300, 697, 816, 904` — additional `Patient.` lines, English-only, all leaking the real name.
- **13** `<li><strong>{Patient|Indication|Technique|Findings|Impression}.</strong>` report lines with no `lang-*` span (grep-confirmed). No violations in home/mental/spiritual/loops/physical-genetics.

> **PHI leak (not a lang bug):** those unwrapped report blocks hardcode the real name and **MRN `3402824`**. Name is regex-rewritten for Leo/John, but **`3402824` is in no replacement rule** — it leaks verbatim into the demo render paths.

---

## Rebuild implications — the architectural facts the rebuild prompts MUST respect

1. **There is no shared page-assembly function.** Section order is hand-maintained in each static HTML file plus several tail-pinning injectors. The only reusable layout primitive is `reflowBottomDock()` (tail cluster only). A rebuild that assumes an assembler will fail — order must be reconstructed per-page/per-injector, or a real assembler introduced. (Job 2E)
2. **Patient Zero (Joao) does not use the renderer.** Joao/Leo/John short-circuit to static HTML and `return` before the DB renderers run (`pc:3733-3754`). Every "topic section" for these patients is hardcoded HTML, not data. Leo/John are name-regex overlays of Joao's exact DOM. (Job 1, Job 5)
3. **Dispatch is a hardcoded per-patient `if`-ladder in one function** (`pc:3724-3887`), with ≥12 `patient === X` special cases and per-patient class names baked into `hidePageBody`. A generic template contract cannot coexist with this without collapsing the ladder to a registry. (Job 1.2/1.4)
4. **The concise AI summary is architecturally last, not second.** It is injected before the footer and reflowed into the bottom dock; the "after-hero" insertion path exists but is never wired for Joao. To honor the contract order, summary placement must move out of the tail-dock path. (Job 2A)
5. **`cards_json` is a single JSON blob whose order is whatever the LLM emitted.** No `patient_dashboard_cards` table, no `ORDER BY`, no `position` column. "Random card/section order" is inherent. The rebuild must add a deterministic ordinal (stored) and sort on read. (Job 4.2/4.3)
6. **PHI data files are gated but loaded globally.** `silvana-labs.js` (and `cristina-labs.js`) are `GATED_ASSETS` yet `<script>`-loaded on all 8 shells → guaranteed 403/503 for non-owning viewers on the critical path. Per-patient data must load only inside that patient's render branch, and gating belongs at the API/scan layer, not on a `window.` assignment. (Job 1.5, Job 3#3)
7. **Interpretive content is only badged when it flows through `aiHeader`.** All static interpretation (home §03, pyramids, spiritual, genetics) is unbadged. The rebuild needs an explicit "this block is AI/interpretive" badge convention that does not depend on the DB path. (Job 3#5)
8. **Static shells carry raw PHI that name-replacement misses.** MRN `3402824` and 13 unwrapped English-only report lines leak into Leo/John demo paths and PT-mode rendering. Reproduced reports must be DB-backed and PHI-scrubbed, not hardcoded HTML. (Job 5.1/5.3)
9. **`/assessment` resolves to the marketing landing via soft-404.** No 404 page exists, so any unrouted extensionless path falls to `index.html`. The rebuild needs a real 404 and an explicit route table that fails closed. (Job 3#1)
10. **Two auth resolvers with one gap.** Reads use scope grants; writes use self-or-admin — except the **legacy synchronous dashboard-build** branch, which runs the LLM and writes with no access check. Close it or remove the legacy path. (Job 4.4)

---
*End of Pass 2. Read-only — no files under `web/` were modified; this report is local and uncommitted.*
