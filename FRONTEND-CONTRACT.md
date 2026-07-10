# LUMEN HEALTH — FRONT-END CONTRACT v1.0
_Consolidated from: Pass 1 (Patient Zero live audit), Pass 2a (multi-patient degradation), Pass 2b (API schemas), Pass 2c (states/mobile/admin), FRONTEND-AUDIT.md (code-side root causes). 2026-07-09._
_Status: DRAFT — items marked [D#] await decisions in DECISION-SHEET.md. Once decisions are marked, this becomes the spec every renderer is built and verified against._

---

## 1. Universal page template (all patients, all pages)

Every patient page renders exactly this sequence, produced by ONE shared assembler:

```
<nav>                                  (shared shell, responsive)
1. HERO                                always; patient-correct identity from /api/patient-summary
2. CONCISE AI SUMMARY                  iff dashboard gate passes; else fully absent
3. TOPIC SECTIONS                      registry order; each gated; failing gate = fully absent
4. EMPTY-STATE BLOCK                   iff ALL topic sections gated out: one honest line + upload pointer
5. TAIL:  Upload → Update-AI-Insights [→ Delete, per D3]
6. FOOTER                              always
```

Invariants:

- **I-1 Single assembler.** One function `assemblePage(patient, page)` owns the sequence. Renderers register sections; nothing self-pins to the footer. `reflowBottomDock()` and all per-injector tail-pinning are retired.
- **I-2 No per-patient logic in shared paths.** Zero `patient === X` branches in the dispatcher, zero per-patient class names in `hidePageBody`, zero per-patient `<script>` tags in shared shells. Patient variation is expressed only as data (registry entries + API payloads).
- **I-3 Identity from API only.** Hero name, DOB, sex, residence, "prepared" date come from `/api/patient-summary` (nullable-safe). Never static strings. "Prepared" = `generated_at` of the newest dashboard section, else omitted.
- **I-4 Patient-scoped fetches only.** Every fetch is keyed to the active patient. Hardcoded clerk ids in fetch paths are a contract violation (root cause of the João `vitals-range` contamination).
- **I-5 Skip, don't degrade.** A section whose gate fails emits nothing: no heading, no 0/0/0 stat grid, no placeholder card. The honest empty state exists once per page (template slot 4), not per section.
- **I-6 Interpretive content is badged.** Every AI-authored or interpretive block carries the badge per [D2], sourced from one shared helper. Static interpretation gets the same badge explicitly.
- **I-7 Bilingual by construction.** All patient-facing strings emit paired `lang-en`/`lang-pt` spans. Inside `escapeHtml()`d strings use `tPlain()`, never `t()`. `document.title` localizes. Enum data values (`sex`, statuses) translate via a value map. Language persists via the existing localStorage key.
- **I-8 PHI never hardcoded.** No real names, MRNs, or report text in HTML/JS. Reproduced reports are DB-backed (`documents`/report tables) and rendered through the assembler. (Live violation: MRN `3402824` in `physical-exams.html`, leaking into Leo/John overlays.)
- **I-9 Routes fail closed.** Explicit route table + real `404.html`. No soft-404 fallback to the marketing `index.html`.

## 2. Section registry

Layout is data. Each entry: `{ id, page, order, title:{en,pt}, gate, source, badge }`.

### Gate predicates (grounded in the Pass 2b payload facts)
Collections are always present-but-empty (`[]`); demographics are nullable scalars; the dashboard is `{sections:{}}` with the `ai-insights` key **absent** (not empty) when unbuilt. Therefore:

- `G-DASH` — `dashboard.sections['ai-insights']` key exists
- `G-DOMAIN(d)` — `G-DASH` && `cards_json.pages[d].data_sufficient === true` (blocks fabricated synthesis on empty domains — the Paulo-Spiritual failure)
- `G-ARR(path)` — `payload.path.length > 0`
- `G-NUM(path)` — value non-null and > 0

### Registry v1 (canonical; per page, in order)

**home**: hero · ai-summary `G-DASH` · reports-nav (always) · at-a-glance `G-NUM(pillars.*.total)` per card, section gated on any · active-priorities `G-DOMAIN` badge✓ · injuries-surgeries `G-ARR(procedures)` · connected-sources `G-ARR` (DB-backed per D6) · medications `G-ARR(medications)` · health-synthesis `G-DASH` badge✓ · tail(+Delete per D3) · footer

**physical**: hero · ai-summary `G-DOMAIN(physical)` badge✓ · browse-cards (Vitals/Exams/Genetics; each card gated on its sub-page having ≥1 live section) · clinical-history `G-ARR` · medications `G-ARR` · attention/strengths cards `G-DOMAIN(physical)` badge✓ · tail · footer

**physical-vitals**: hero(+range selector, shown iff any chart section live) · ai-summary `G-DOMAIN(physical)` badge✓ · body-composition `G-ARR` · glucose `G-ARR` · sleep `G-ARR` · exercise `G-ARR` · movement `G-ARR` · cardiovascular `G-ARR(vitals/ecg)` · stress-resilience `G-ARR` · blood-pressure `G-ARR` · physician-assessment `G-ARR(encounters)` · specific-findings (cards where `subpage==='physical-vitals'`) badge✓ · tail · footer

**physical-exams**: hero · ai-summary `G-DOMAIN(physical)` badge✓ · imaging `G-ARR(imaging)` (per-study; ECG chart iff `has_svg`) · laboratory `G-ARR(panels)` · gut-microbiota `G-ARR` · alcohol-audit `G-ARR(risk data)` · specific-findings (`subpage==='physical-exams'`) badge✓ · tail · footer

**physical-genetics**: hero · ai-summary `G-DOMAIN(physical)` badge✓ · pgx-summary `G-ARR(pgx_findings)` badge✓ · meds-vs-pgx table `G-ARR(pgx) && G-ARR(medications)` badge✓ · pgx-modules `G-ARR` (DB-driven per D6) · specific-findings (`subpage==='physical-genetics'`) badge✓ · tail · footer

**mental**: hero · badge-legend (always, per D2) · ai-summary/therapy-trends `G-DOMAIN(mental)` badge✓ · archetype/coping/self-awareness/strengths/risk/substance/formulation `G-ARR(psych_items etc.)` badge✓ each · psych-architecture `G-ARR(dimensions)`, per-dimension gate `items.length>0` · life-history `G-ARR(life_events/writings)` · tail · footer

**spiritual**: hero · ai-summary `G-DOMAIN(spiritual)` badge✓ · confession/witness/scriptures/timeline/practices/struggles `G-ARR` each · wheel-of-life `G-ARR(wheel_of_life)` · specific-findings (`subpage==='spiritual'`) badge✓ · tail · footer

**loops**: [D5] — folded into `mental` as a gated topic section, or brought under the full template.

Patient-Zero-bespoke narrative blocks (Class B in the audit: Três Pirâmides, spiritual devotional sections, red-flag narratives, clinical-history bullets) enter the registry as **patient-scoped entries**: same mechanism, `gate: patient === <id>` expressed as a registry data field — reachable ONLY when that entry's patient matches, never via shared paths or overlays.

## 3. Dashboard card contract

Canonical card (from `cards_json.inline_insights[]`, per Pass 2b + code audit):

```
{ id, anchor, subpage, analyte,
  title:{en,pt}, interpretation:{en,pt}, trajectory_note:{en,pt},
  next_steps:[{en,pt}], contributing_factors:[{en,pt}],
  risk_level: low|medium|high, confidence: low|moderate|high,
  trajectory: stable|worsening|improving|new|insufficient_history,
  trigger: <enum>, evidence:[{ref,source,value,date}],
  diagnostic_code_caveat: bool, rank: int  ← NEW, stored ordinal }
```

- Namespace lives in `anchor` prefix: `lab: | imaging: | ecg: | vitals: | pgx: | interaction: | journal:`.
- Vestigial fields `body`, `what_the_report_says`, `plain_language_reading` are deprecated: stop emitting, renderer must not read them. Legacy `{kind,title,subtitle}` cards are migrated or dropped.
- **Deterministic order [D1].** Today order = raw LLM emission (grouped by prefix, stable per build, but reshuffles across rebuilds — the "random order" experience). Fix: server-side sort at write time in the sanitize step, `rank` persisted; renderer sorts by `rank` defensively on read. Recommended key: subpage ordinal → prefix-group ordinal (lab→imaging→ecg→vitals→pgx→interaction→journal) → risk (high→medium→low) → anchor slug.
- `patient_dashboards` (and `cards_json` shape) gets a Drizzle schema definition — no more schema-invisible raw-SQL tables.

## 4. Degradation ladder (observed → contractual)

| Tier | Today (Pass 2a) | Under contract |
|---|---|---|
| Full build (Leo) | bespoke JS, complete, clean | registry fully lit; identical mechanism as every other tier |
| Partial (Silvana, Maria Regina) | mixed renderers; honest empty states in default path; 0/0/0 grids; genetics leak | lit sections render; unlit sections absent; single empty-state block; zero leaks by construction (I-2/I-4) |
| Thin (Paulo) | sub-routes collapse to Exams; Mental/Spiritual leak João | each sub-page gates independently; browse cards reflect live sections; no collapse |
| Empty (Andre, "Patient Zero" shell) | plain record + 0-grids; inert controls | hero + empty-state + tail + footer only; range selector and export hidden when nothing to show |

Build-side corollary (backend, tracked here because the front end displays it): the insights build must scope its input strictly to the target patient and set `data_sufficient=false` per empty domain — rendering already gates on it (`G-DOMAIN`), so fabricated cross-patient synthesis can no longer surface even if generated.

## 5. Shell & chrome

- **Nav**: responsive; collapses below ~768px (hamburger or priority+overflow). Fixes the 836px overflow at 390px. Controls: language toggle, Simplified|Complete [D10], CHANGE PATIENT, account, sign-out, EXPORT (hidden when no exportable sections).
- **Tail**: Upload → Update-AI-Insights (→ Delete [D3]). Rendered by the assembler — never above body content (fixes Pass 2a #9).
- **Footer**: one shared bilingual footer on every patient page (spiritual's pastoral variant becomes a registry-driven footnote line, not a different footer).
- **AI badge [D2]**: one convention app-wide + one legend entry.
- **Charts**: the validated variability recipe is unchanged and normative (SD tonexty bands, palette 400→600→800, dotted clinical reference lines, bilingual titles, legend chips).
- **Brand tokens**: from `lumenhealth-branding.html` only.

## 6. Verification (the contract as a test)

`scripts/verify-frontend.mjs`, run after every deploy against bare `lumenhealth.io`, for a patient matrix (rich / partial / thin / empty), every page:

1. HTTP 200; explicit route table honored; `/assessment`-style unrouted paths → 404, never marketing HTML.
2. DOM order: hero first; AI summary (when present) immediately after; tail cards last before footer; footer present.
3. No literal `lang-en`/`lang-pt` markup rendered as text; EN/PT span parity per page.
4. No 0-count stat grid rendered (gate discipline); no empty chart boxes.
5. Grep rendered HTML + asset requests: no foreign `clerk=` (any patient id ≠ active patient); no MRN pattern; no other patient's name.
6. All asset/API requests 2xx (no gated-asset 403/503 on the critical path).
7. Every interpretive block carries the badge marker.
8. Viewport 390px: `document.documentElement.scrollWidth <= viewport + 1`.

Failures block the deploy from being declared done. This is the mechanical guard that replaces documentation discipline for this error class.

---

_Companion documents: DEFECTS-REGISTER.md (all known defects, root-caused, severity-ordered) and DECISION-SHEET.md (open decisions D1–D10). Contract becomes v1.0-final when decisions are marked and merged in._
