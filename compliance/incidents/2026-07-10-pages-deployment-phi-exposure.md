# Incident note — PHI exposure via immutable Cloudflare Pages deployment URLs

**Incident ID:** 2026-07-10-pages-deployment-phi-exposure
**Status:** Contained (Access lockdown verified). DPIA / notification assessment OPEN.
**Written:** 2026-07-10 · facts-only record, compiled during remediation.

## What was exposed

Cloudflare Pages keeps every historical deployment serving at an immutable hash
URL (`<hash>.lumenhealth.pages.dev`). Deploys made while PHI files sat
untracked inside `web/` on disk included those files in the deployment
manifest, publicly and without authentication (the scoped-access gate either
did not exist yet or did not cover the path at the time those deployments were
built).

Evidenced exposed artifacts (direct probes, HTTP 200 `application/pdf`):

| File | Data subject | Exposing deployments | Deployment creation window |
|---|---|---|---|
| `/Relatorio-Psiquiatrico-Joao-Creste-2026-06-24.pdf` (psychiatric report) | João Victor Creste | 7 | 2026-06-24T18:01Z → 2026-06-26T15:04Z |
| `/scans/silvana-source-pdfs/silvana_creste.pdf` (lab source PDF) | Silvana Aparecida Creste Dias de Souza | 111 | 2026-05-27T13:10Z → 2026-06-11T15:07Z |

Exposure duration is longer than the creation windows: each exposing
deployment kept serving from its creation until remediation on 2026-07-10
(deletion ~04:00Z; hard lockdown 16:01Z). Worst case: **João's psychiatric
report was publicly reachable ~16 days (24 Jun → 10 Jul)**; **Silvana's lab
PDF ~44 days (27 May → 10 Jul)**.

Probe methodology: 4 representative PHI paths tested against all 202
deployment hash URLs (808 requests). The two files above were the only
confirmed hits; the same-directory Silvana source PDFs (11 further untracked
files) were on disk during the same window and were plausibly included in the
same 111 pre-gate deployments — **inference, not individually probed** (the
deployments were deleted before per-file enumeration). The current production
deployment was verified clean before and after (the apparent 200 on the bare
domain was the soft-404 marketing page, `text/html`).

Likelihood of third-party access: unknown — Pages provides no access logs on
this plan. The URLs require guessing an 8-hex-digit deployment hash; the files
were never linked from any indexed page. No evidence of access; no evidence of
absence either.

## How it was discovered

2026-07-10 ~03:35Z, during the Build Prompt #1 intake deploy-integrity check
(frontend audit program): a bare-domain probe of the psychiatric-report path
returned HTTP 200, which triggered the full deployment-history sweep.

## Remediation timeline (all 2026-07-10 UTC)

| Time | Action |
|---|---|
| ~03:35 | Exposure suspected (bare-domain probe); deployment sweep started |
| 03:49 | Stash-shielded production deploy `f0e7e04f` — current deployment confirmed clean |
| ~03:55–04:01 | All 201 non-current deployments deleted via API (201/201 success; GET on deleted IDs returns not-found) |
| ~04:05–05:30 | Deleted hash URLs observed **still serving** (Cloudflare edge propagation lag on deleted Pages deployments) — re-probed twice, still 200 `application/pdf` |
| 16:00 | Zero Trust Access application `96d16641-a50e-4b8c-8792-1b805097a1b3` created on `*.lumenhealth.pages.dev`; owner-only allow policy `70ed5f13-633a-45c3-8824-a535384b7d5b` |
| 16:02 | Verification PASS: preview root + both artifact URLs on their old hash subdomains return 302 to the Access login (`jc-advisory.cloudflareaccess.com`); no `application/pdf` reachable |

## Residual risk

- Edge caches may retain copies until natural expiry; the Access policy now
  blocks the only public route to them.
- Files may have been fetched during the exposure window (no logs either way).
- The same-directory Silvana PDFs (11 files) share the exposure window by
  inference (see methodology note).
- Root cause (PHI transiting `web/` on disk) is mitigated procedurally by the
  stash-shield deploy ritual; the durable fix — relocating PHI out of `web/`
  entirely plus a deploy-guard that fails on PHI-pattern files in the deploy
  directory — is scheduled for build prompt #4's verification script.

## OPEN

- **DPIA follow-up / notification assessment: OPEN — decision owner João
  Victor Creste.** (Both data subjects are family members of the platform
  owner; assessment of ANPD/GDPR notification duty is deliberately not made in
  this note.)
