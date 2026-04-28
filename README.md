# JC Advisory · Personal Health Portal

Private, structured health summary for **clinical communication only**. Built
from wearables (Oura Ring, Withings, Apple Watch), point-in-time exams (CT, MRI,
EEG, blood panel), genetic profiling, and personal narrative material.

## ⚠ Confidentiality

This repository contains personal health data (PHI / GDPR special category).
**It must remain a private repository.** Public exposure of this data would
cause serious harm to the patient.

- The included `web/index.html` login (`admin / admin`) is **decoration, not
  security** — anyone with browser dev-tools can bypass `sessionStorage`.
- Real access control must be enforced at the hosting layer
  (e.g. Cloudflare Access in front of Cloudflare Pages, with an email
  allowlist).
- Search-engine indexing must be disabled at deploy (the pages already set
  `<meta name="robots" content="noindex,nofollow,noarchive">`).
- Do not enable GitHub Pages on this repository — GitHub Pages publishes
  publicly on Free / Pro / Team plans.

## Layout

```
web/                   ← deployable static site
  index.html           ← login screen
  home.html            ← post-login dashboard (the report's landing page)
  physical*.html       ← physical health pages (overview, vitals, exams, genetics)
  mental.html          ← mental health overview
  assets/              ← styles.css, app.js, logos
  scans/               ← CT / MRI / EEG image stacks + radiologist PDFs
                         (real files, served by the bundled viewers)
data/                  ← (NOT committed) raw exports — Apple Health,
                         Oura, Withings, scan archives, source PDFs
```

## Deploy target

`health.jcconsultingadv.com` via **Cloudflare Pages** (build output dir = `web`)
fronted by **Cloudflare Access** (one-time-PIN email allowlist).

See `DEPLOY.md` for the click-path (or ask the maintainer).

## Bilingual

The site is bilingual EN ↔ BR-PT. Toggle via the UK / BR flag buttons in the
top-right of every page; preference persists in `localStorage`.

## Stack

Plain static HTML + CSS + a single vanilla JS file. Chart.js for the labs
visualisations. No build step required for deployment.
