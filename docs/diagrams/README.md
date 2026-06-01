# Lumen Health — Architecture Diagrams

Standalone, self-contained SVG diagrams documenting the Lumen Health system — backend operations and frontend needs — for investor decks, docs, and onboarding.

Each file is a single `.svg` with an inline `<style>` block, no external scripts, fonts, or images. They use the brand's signature **dark theme** (midnight-blue surfaces `#0A1428`/`#131F37`, gold-honey accent `#F4B942`, petrol structural lines `#6BA3C7`), Raleway / IBM Plex Sans / IBM Plex Mono with system fallbacks, a faint 64px grid, and a consistent title block + legend. They scale crisply at any zoom (`viewBox="0 0 1600 H"`).

| File | Shows |
|------|-------|
| [`01-system-architecture.svg`](01-system-architecture.svg) | High-level map: browser client → Cloudflare Pages advanced-mode Worker (the **server-side auth/role boundary**) → Neon Postgres (Frankfurt via Hyperdrive), Cloudflare R2 (EU), Anthropic API. Live domains + retired `jc-advisory-health` 301 redirect. |
| [`02-ingestion-etl-pipeline.svg`](02-ingestion-etl-pipeline.svg) | ETL flow: login → import portal → direct-to-R2 upload → LLM classification → parse & persist → section authoring → conditional render → doctor review (future) → per-patient chatbot. 13-label classification→table taxonomy. Primary path in gold. |
| [`03-data-treatment-routing.svg`](03-data-treatment-routing.svg) | Routing rule: structured rows → Neon Postgres; blobs → R2 with a Postgres pointer row (`source_blob_key`). Patient-partitioned key scheme, DICOM-canonical → JPEG-preview path, CASCADE/GDPR integrity model. |
| [`04-data-residency-locations.svg`](04-data-residency-locations.svg) | Geography: patients (US/UK/EU/BR/CA) → global Cloudflare edge (no PHI at rest) → **EU residency zone** where PHI physically lives (Neon Frankfurt + R2 EU). Anthropic sits outside the zone. GDPR-first / SCC rationale. |
| [`05-ai-llm-architecture.svg`](05-ai-llm-architecture.svg) | Two AI surfaces (dashboard authoring + chatbot) fed from one source of truth. The **proprietary IP layer** (prompts, record assembly, templates, Patient-Zero-as-maximal-template) is gold-outlined and separated from the **commodity layer** (base Claude models + cloud primitives). Model tiers + 1h prompt cache. |
| [`06-database-schema-er.svg`](06-database-schema-er.svg) | Data model in clusters (Identity/Access, Clinical Core, Narrative/Mental, Care Events, Pipeline). Doctor↔patient **many-to-many via `patient_access`**, the `patient_id → users · ON DELETE CASCADE` rule, `audit_log`, and a 12-enum side panel. 33 tables, migrations 0000→0008. |
| [`07-auth-rbac.svg`](07-auth-rbac.svg) | Roles (admin/doctor/patient) gated at the Worker boundary. Demo DB auth today (`POST /api/login`) → planned Clerk. `resolveInsightAccess` / `getAdminViewer` server-side checks, per-role effective access, and the **legacy client-side gate flagged as security debt** (red). |
| [`08-multitenancy-rendering.svg`](08-multitenancy-rendering.svg) | `patient-context.js` section dispatch → default **data-driven renderer** vs. **bespoke renderers** (Patient Zero static; Paulo/Silvana/Leo). Universal **hero-first landing rule** (hero → Reports → AI cards → rest; never above hero) and Mental-section `.ai-pill`/disclaimer/ICD-10/collapse conventions. |
| [`09-compliance-state-machine.svg`](09-compliance-state-machine.svg) | Two states: **today (dev tier) — not compliant by design** vs. **the flip (first real patient) — Enterprise + BAA** across Cloudflare/Anthropic/Neon/Clerk, audit log required, DPAs + SCCs. Architecture unchanged — only connection strings/billing move. |

## Deck

[`Lumen-Health-Architecture.pptx`](Lumen-Health-Architecture.pptx) — all nine diagrams plus a branded cover/contents slide ([`00-cover.svg`](00-cover.svg)) in one 16:9 PowerPoint, dark background, ready for investor decks. Each slide is the diagram rasterized at high resolution on a matching `#0A1428` background. To rebuild after editing any SVG: `rsvg-convert -w 2600 <file>.svg -o <file>.png` for each, then assemble with `python-pptx` (fit-to-slide, centered, cover full-bleed).

## Notes

- **Source of truth:** drawn from the repo as of generation — `web/_worker.js`, `lib/ingest.js`, `lib/dashboard.js`, `db/schema.ts` + migrations, `web/assets/patient-context.js`, `scripts/build-patient-record.mjs`, `branding.html`, and `PROJECT-MEMORY-EXPORT.md`. Where the original brief differed from the code, the code won (e.g. ingestion is currently direct multipart `POST /api/ingest`; signed-URL-direct-to-R2 is shown as the target/planned path; DICOM `dcmjs`/JPEG-preview generation is marked planned; classification uses Haiku 4.5 / Sonnet 4.6 while chat & insights use Opus 4.7).
- **Theme:** dark variants only (the brand's signature, and the priority). Light variants can be produced on request using the light-theme tokens in `branding.html`.
- **Rendering / editing:** open directly in any browser, or rasterize for decks, e.g. `rsvg-convert -w 2400 01-system-architecture.svg -o 01.png`. Each SVG is commented by region so nodes can be repositioned by hand.
- **Deploy:** these live under `docs/` — local docs only. Per the repo ops rule, changes that don't touch `web/` are **not** deployed to Cloudflare Pages; commit/push only.
