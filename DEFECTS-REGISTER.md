# LUMEN HEALTH — UNIFIED DEFECTS REGISTER
_Deduplicated across Pass 1, Pass 2a/2b/2c, and FRONTEND-AUDIT.md. Severity-ordered. file:line refs are from the code audit (branch `feat/patient-account-settings`)._

## SEV-0 — Clinical safety / privacy (fix before any new patient sees the platform)

| # | Defect | Evidence | Root cause | Fix path |
|---|---|---|---|---|
| 1 | **Cross-patient PHI contamination (rendered).** Paulo's Mental page shows João's content: "What João … sees in you" + "FROM JOÃO'S ACCOUNT" card | 2a #1 (ss_6526t14hj) | Bespoke Paulo renderer / build input inherits João content | Registry + I-2/I-4; rebuild Paulo's insights with patient-scoped input |
| 2 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** **Cross-patient API call.** `GET /api/vitals-range?clerk=pending:joao` fires on Paulo/Silvana/Leo/Maria pages | 2a #2 | Hardcoded clerk id in vitals/mental view fetch | I-4; verification check #5 |
| 3 | **AI fabrication on empty data.** Paulo Spiritual: "No spiritual data ingested yet" yet AI asserts "João anchors Paulo's life in scripture"; Silvana Genetics shows Patient Zero's Dutasteride + Saw palmetto (clinically implausible for a 58yo woman) | 2a #3, #4 (ss_61553wxcm, ss_7008b92d9) | Build input contamination + renderer ignores data sufficiency | `G-DOMAIN` gate; build-side patient scoping + `data_sufficient` honesty |
| 4 | **MITIGATED 2026-07-10 (Prompt #1).** Overlay replacement rules extended (MRN/accession/visit/registration ids, PT DOB); residuals: third-party names in narrative, split-span DOB — full fix is DB-backed reports (prompt #3). **Hardcoded PHI in static shells.** Real name + MRN `3402824` in reproduced radiology reports; MRN not covered by Leo/John regex overlays → leaks into demo renders; 13 report lines EN-only | code Job 5.3 (`physical-exams.html:300,404-421,506,697,816,904`) | Reports hardcoded in HTML, not DB-backed | I-8; migrate reports to DB; retire regex overlays (D8) |
| 5 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** **Auth gap: legacy sync dashboard-build.** Any resolvable `X-Viewer-Clerk` can trigger an LLM build + DB write, no self/admin check | code Job 4.4 (`_worker.js:1771-1780`) | Legacy branch predates `resolveInsightAccess` | Remove legacy sync path (D9) |
| 6 | **Unexplained "Stop Claude" string on account.html** — behaved like a prompt injection during the audit | 2c security note | Unknown — verify against `account.html` source | CLOSED-UNCONFIRMED 2026-07-10: string absent from repo (`grep -rn web/`), absent from all git history (`git log -S`), absent from live HTML on all 16 routes incl. `/account` and `/account.html`, absent from all 22 live JS assets, absent from `users` and `patient_dashboards` (cards_json + summary_md) in Postgres. No serving path found; likely an artifact of the browser-side audit agent itself. |

## SEV-1 — Architecture (root causes of the chaos)

| # | Defect | Evidence | Root cause | Fix path |
|---|---|---|---|---|
| 7 | **No shared page assembler.** Order hand-maintained per static page + 3 self-pinning injectors; AI summary architecturally LAST (`insertBefore(footer)` → bottom dock); `/physical`,`/mental` have no AI summary at all | Pass 1 #11; code Job 2A/E (`pc:4502`, `pc:3240`) | No assembler exists | Build prompt #1: assembler + registry |
| 8 | **Card order = raw LLM emission.** No `ORDER BY`, no ordinal; order reshuffles across rebuilds | code Job 4.3; 2b §5 | `cards_json` blob stored/returned verbatim | Build prompt #2: deterministic sort + `rank` (D1) |
| 9 | **Per-patient if-ladder in shared dispatcher.** ≥12 `patient===X` branches; per-patient classes in `hidePageBody`; per-patient `<script>` tags on all shells | code Job 1.2/1.4/1.5 (`pc:3724-3887`, `pc:330-351`) | Accreted special-casing | Registry collapse (build prompt #1) |
| 10 | **PARTIAL 2026-07-10 (Prompt #1).** Per-patient data files now dispatcher-injected only for the owning patient; residual: data.js/metrics.json still shell-tagged (PZ static charts) — prompts #3/#4. **Gated PHI assets loaded globally.** `silvana-labs.js` (+`cristina-labs.js`) are GATED_ASSETS yet `<script>`-tagged on all 8 shells → 403/503 for every non-owning viewer | Pass 1 #3; code Job 3#3 (`_worker.js:182-183`) | Gate at asset layer + unconditional load | Remove GATED_ASSETS entries; load per-patient data only in-branch (transitional), then migrate to DB |
| 11 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** **Routes fail open.** No `404.html`; unrouted paths (e.g. `/assessment`) soft-404 to marketing `index.html` | Pass 1 #1; code Job 3#1 (`_worker.js:204-227`) | Pages fallback behavior | 404 page + explicit route table (D4) |
| 12 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** **Paulo physical sub-routes collapse** to a single Exams view; hidden Genetics hero in DOM | 2a #6 (ss_9314xjxo2) | One renderer mapped to all four routes (`pc:3814-3816`) | Registry per sub-page |
| 13 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** **Tail cards render above body** on database-default degraded pages | 2a #9 (ss_13454ozuh) | Injector race vs. late-rendered body; no assembler | Assembler owns tail |

## SEV-2 — Functional

| # | Defect | Evidence | Root cause | Fix path |
|---|---|---|---|---|
| 14 | ECG chart 404: `kind=svg` requested unconditionally; `svg_key` NULL | Pass 1 #2; 2a #5; code Job 3#2 (`pc:3698`, `_worker.js:722`) | No `has_svg` guard | Gate on `has_svg`; generate SVG at ingest |
| 15 | Mobile header overflow (~836px @390px); no responsive collapse; Change Patient/Sign Out off-screen | 2c D-1x (ss_1292ehfxk) | Fixed-width header controls | Responsive nav (contract §5) |
| 16 | Raw HTML leak: `t()` output passed through `escapeHtml()` (ECG subtitle shows literal spans) | Pass 1 #2b; code Job 3#4 (`pc:3578`, `:68`, `:60`) | `t()` vs `tPlain()` misuse | Use `tPlain` in escaped contexts (I-7) |
| 17 | Meds table dead columns ("—"); supplements have no `note` column; renderer never reads `m.note` | Pass 1 #8; code Job 3#6 (`physical.html:233-247`, `schema.ts:182-191`, `pc:509-531`) | 3-layer: static table + schema gap + renderer gap | Schema migration + renderer column + DB-drive Patient Zero table |
| 18 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** Psych Architecture renders 0-item dimensions ("03 Empathy — 0 items") | Pass 1 #7; code Job 3#7 (`pc:2891`, `mental.html:909-912`) | No per-dimension guard | `items.length` gate (registry) |
| 19 | 0/0/0 stat grids + empty chart boxes on thin patients read as "no data" | 2a (multiple ss) | No section gates | I-5 skip-don't-degrade |
| 20 | **RESOLVED 2026-07-10 (Prompt #1, prod-verified).** Badge inconsistency: `.ai-pill` vs "+ AI INFERENCE"; static interpretive blocks unbadged (home §03, synthesis, pyramids, genetics, spiritual) | Pass 1 #4/#5; code Job 3#5 | Badge only via `aiHeader` in DB path | One convention (D2) + I-6 |
| 21 | Identity data quality: duplicate "Patient Zero" empty shell vs `pending:joao`; Paulo DOB "—" vs "14 Jul 1961"; Leo "Paris, United Kingdom"; stale tab title | 2b note; 2a #7/#10; 2c D-1x+6 | Duplicate records; inconsistent sources | D7 cleanup + I-3 |
| 22 | Static "prepared" dates diverge (24 Jun / 25 Apr / 4 May) | Pass 1 #9; code Job 2D | Hardcoded strings | I-3 (`generated_at`) |
| 29 | **Client/server session divergence causes a login redirect loop.** `login.html` trusts sessionStorage `jc_authed` and redirects to `patients.html` without verifying the server session; when the `jc_session` cookie is absent or invalid (e.g. `SESSION_SECRET` unset in the environment, expired cookie), the static-access gate bounces every page back to login → infinite `/login` ↔ `/patients` loop, several requests/second | Observed on preview deployment 08b4416e (worker tail 2026-07-10: continuous `GET /login`/`login.html` alternation, no `/api/login` POST, no exception) | Client-side auth flag (`jc_authed`, `login.html:~208`) can diverge from the HMAC `jc_session` cookie the gate actually checks (`_worker.js:94-115`); nothing ever reconciles the two | Prompt #3/#4: client shell verifies the session via `/api/me` before redirecting; clear `jc_authed` whenever the gate bounces to login |

## SEV-3 — Polish

| # | Defect | Evidence |
|---|---|---|
| 23 | Tab titles never localize; "male" untranslated in PT patient record | 2c D-1x+1/+2 → I-7 |
| 24 | Range selector: no pressed/active state; inert with no data | 2c D-1x+3 → hide when no charts (registry) |
| 25 | Export modal "No exportable sections found" — no graceful path for empty patients | 2c D-1x+4 → hide EXPORT when nothing exportable |
| 26 | Admin: duplicate doctor "Americo/Américo Ceiki Sakamoto" in every grant dropdown | 2c D-1x+5 → dedupe users table |
| 27 | Maria Regina chip spacing "1009lab markers" / "4imaging" | 2a #8 |
| 28 | `highlights` jsonb column written but never read; two card shapes coexist in `cards_json`; `patient_dashboards` absent from Drizzle schema | code Job 4.2 → contract §3 |

## Already fixed on the feature branch (verify at deploy)
- Pass 1 #6 "Clínico geral" missing EN span — paired on disk (`home.html:258`).
- Parts of the badge work may be newer on disk than on live. The audited branch is `feat/patient-account-settings`, not clean `main` — build prompts must state which branch state they start from.
