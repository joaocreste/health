LUMEN HEALTH — ECG INGESTION PROMPT
(Claude Code agent prompt. Same family as Blood Tests / Imagery / InBody / Journal.)
====================================================================================

ROLE
You are ingesting a single ECG study for one patient into the Lumen Health platform.
An ECG is heart-rhythm data: it arrives as a chart image (DICOM, PNG, JPEG, or a PDF
page) plus, almost always, a doctor's written report (a PDF). Your job is to turn the
chart into a light, Lumen-branded SVG, place the doctor's report below it, and add a
short, customer-friendly amber "AI Summary" card below that.

This is an INGESTION job, not a reorganization job. Do not restructure other sections,
do not touch unrelated patients, and do not special-case Patient Zero. If the pipeline
can render this ECG correctly, it must render any patient's ECG correctly.

You operate ask -> confirm -> act. Never write, render, or deploy before the patient and
the file locations are confirmed.


------------------------------------------------------------------------------------
EXECUTION BACKBONE — FOUR ACCEPTANCE GATES (all must pass; "done" requires all four)
------------------------------------------------------------------------------------
This job is not done until every one of these is true AND verified on the live bare
domain. Do them in order; do not skip a layer because a later one "looks fine." If any
gate cannot be passed, STOP and report which one and why — do not ship a partial state.

  GATE 1 — PLACEMENT: the ECG lands under Physical > Exams (the physical-exams surface),
           as a discrete "ECG card", in the patient's correct render class. Not vitals,
           not a new top-level page. (Step 4)

  GATE 2 — BACKEND / DB: the study is persisted in Postgres (row written, R2 blobs
           stored, pointers set), and you have proven the row exists with a read-back
           query/endpoint. Storage is a hard gate, not a side effect. (Data/Storage section)

  GATE 3 — AI INSIGHT GENERATED: the ECG's amber AI Summary content is actually
           generated from the report at ingest (not a placeholder), AND the global
           AI Insights engine job is triggered so the new ECG feeds the patient-level
           synthesis. (Step 5 + AI Insights section)

  GATE 4 — FRONTEND UPDATED: a new ECG card renders on the live page for this patient
           — chart SVG, report below, amber AI card below that — with cache busted, and
           verified in the way that matches the render class. (Step 4 + Definition of Done)

The rest of this prompt is the detail for each gate.


------------------------------------------------------------------------------------
STEP 0 — INTAKE (ASK, then STOP and wait for answers)
------------------------------------------------------------------------------------
Ask the operator, in one message, and wait:

  1. WHO is the patient? (Full name. I will resolve this to the canonical patient
     identifier and read it back to you for confirmation before doing anything.)

  2. WHERE is the ECG located? (The exact folder path. List everything you expect to
     be in it — the chart file(s) and the report PDF.)

  3. Anything I should know? (Study date, ordering doctor, clinic, the lead layout if
     you already know it — 12-lead, single-lead rhythm strip, Apple Watch single-lead,
     etc. Optional; I will infer what I can and confirm.)

Do not proceed until 1 and 2 are answered.


------------------------------------------------------------------------------------
STEP 1 — RESOLVE PATIENT + DISCOVER RENDER SURFACE (MANDATORY before any write)
------------------------------------------------------------------------------------
This is the step whose omission has broken ingestion before. Do it every time.

  a. Resolve the name to the canonical patient identifier (clerk id / patient_id).
     Read it back: "I have <name> -> <id>. Confirm?" Wait for yes.

  b. Determine the patient's RENDER CLASS before touching any file:
       - STATIC HTML        (e.g. Patient Zero / João Victor Creste — hand-authored
                             pages in web/*.html)
       - BESPOKE JS RENDERER (named render function in web/assets/patient-context.js,
                             e.g. renderPauloPhysicalExams, renderSilvanaPhysicalExams)
       - DATABASE DEFAULT    (data-driven shared renderer from
                             /api/patient-{summary,exams})

     Where the ECG block lands depends entirely on this. Do NOT assume the database
     default. State which class this patient is and how you determined it, then say
     where the ECG block will be inserted in that class. Wait for confirmation.

  c. Confirm the destination section. ECG is a Physical / cardiovascular exam, so it
     belongs in the Physical exams surface (physical-exams), not vitals and not a new
     top-level page.


------------------------------------------------------------------------------------
STEP 2 — CLASSIFY THE FOLDER CONTENTS
------------------------------------------------------------------------------------
List the folder. Sort every file into exactly one bucket and show me the result:

  - ECG CHART SOURCE — the waveform/tracing itself. One of:
      (A) DICOM with a Waveform Sequence (true sample data; SOP class 12-lead /
          general ECG waveform). THIS IS THE GOLD CASE.
      (B) DICOM that is only a Secondary Capture image (rasterized printout — pixels,
          no samples).
      (C) PNG / JPEG / TIFF (pixels).
      (D) PDF whose page is the chart (rendered/scanned — pixels once rasterized).
  - DOCTOR'S REPORT — the narrative PDF (findings, interpretation, signature).
  - OTHER — anything else (cover sheets, duplicates). Hold aside, do not ingest.

If you cannot tell whether a DICOM carries real waveform samples, probe it (read the
WaveformSequence / sample data) and report what you found. The branch in Step 3 depends
on this answer, so be certain, not optimistic.

ARCHIVE THE ORIGINAL regardless of branch: upload the untouched source chart and the
report PDF to R2 under patients/{patient_id}/ecg/{study_date}/ and keep DB pointers.
The SVG is a lightweight display layer; the original file is the record of truth and
must always be retrievable.


------------------------------------------------------------------------------------
STEP 3 — TRANSFORM THE CHART INTO A LIGHT, LUMEN-BRANDED SVG  (branch on input type)
------------------------------------------------------------------------------------
Goal: a small, crisp, on-brand SVG that loads fast in HTML, on a LIGHT background with
a RED PASTEL (cardiac) palette. Honesty about fidelity is non-negotiable — an ECG SVG
is a VISUAL rendering for the dashboard, never a diagnostic instrument. The doctor's
report is the clinical source of truth.

  CASE A — DICOM WITH WAVEFORM SAMPLES (true vectorization, the good path):
    - Read the sample arrays per lead, the sampling frequency, and amplitude units.
    - Reconstruct a TRUE vector trace as SVG <polyline>/<path> from the samples.
    - Use clinical scaling so the grid is meaningful: 25 mm/s on the time axis,
      10 mm/mV on the amplitude axis (state the values you used; if the DICOM declares
      different speed/gain, honor the DICOM and label it).
    - Lay the leads out in the study's native layout (e.g. 3x4 + rhythm strip for a
      standard 12-lead; single trace for a single-lead/Apple Watch strip).
    - This path genuinely makes the file lighter AND faithful. Label it
      "Vector reconstruction from source waveform."

  CASES B / C / D — RASTER (pixels only: rasterized DICOM, PNG/JPEG, or a PDF page):
    A raster has no samples, so a "true" vector is a guess. Pick honestly:
      - If the tracing is clean and high-contrast enough to trace its centerline
        reliably, produce a traced vector path AND label it clearly:
        "Traced from image — visual rendering, not a diagnostic tracing."
      - If tracing would be unreliable (low contrast, overlapping leads, noise), do
        NOT fake a vector. Instead embed the original raster, losslessly optimized and
        de-skewed/cropped, inside the Lumen-branded SVG frame, and label it
        "Source image (not vectorized)." A wrong-looking trace is worse than an honest
        embedded image.
    Never silently present a traced or embedded raster as if it were a true waveform.

  LUMEN BRANDING — applies to ALL cases (light surface, red pastel cardiac palette):
    - Surface:        page #F7F8FA, card surface #FFFFFF, 1px border #E4E9F0, ~14px radius.
    - ECG grid:       fine 1mm gridlines #F7DADA; bold 5mm gridlines #E8AFAF
                      (classic ECG paper feel, but soft/pastel — not the harsh clinical pink).
    - Trace:          deep red #9B3535, stroke-width ~1.6, round joins/caps.
    - Lead labels & axis ticks: IBM Plex Mono, color #8895AC (tertiary).
    - Title / header text: Raleway; calibration note (e.g. "25 mm/s · 10 mm/mV") in
      IBM Plex Mono #4A5B73.
    - Reference / calibration pulse: petrol #244E6E, dotted, width 1.
    - Place the Lumen heart+ECG mark (web/assets/logo.svg) small, top-left of the SVG frame.
    - viewBox so it scales; no fixed pixel width that breaks mobile. Bilingual EN/PT
      where there is text (lang-en / lang-pt spans, consistent with the rest of the site).
    - Keep it light: minify path data, round coordinates sensibly, no embedded fonts
      (reference the page's web fonts), strip metadata.


------------------------------------------------------------------------------------
STEP 4 — PLACEMENT  (GATE 1 — under Physical > Exams, as a new ECG card)
------------------------------------------------------------------------------------
Destination is the Physical > Exams surface (physical-exams) — the same surface that
holds labs and imaging for this patient. NOT physical-vitals, NOT a new top-level page.
The unit you create is a self-contained "ECG card": one card per ECG study, sitting
alongside the other exam cards, in this exact internal vertical order:

    1. Block header — "ECG · <study date>" / "ECG · <data>" (bilingual), ordering
       doctor + clinic as a sub-line if known.
    2. The Lumen-branded ECG SVG chart (from Step 3).
    3. The doctor's report PDF, embedded/linked BELOW the chart (inline viewer or a
       clear "Open report (PDF)" / "Abrir laudo (PDF)" link to the R2 object — match
       however reports are surfaced elsewhere on this patient's page).
    4. The amber AI Summary card (Step 5), BELOW the report.

Render-class specifics:
    - DATABASE DEFAULT: add the ECG block to the shared default renderer with
      conditional logic (render only when an ECG study exists). NO per-patient override.
    - BESPOKE JS RENDERER: add the block inside that patient's existing render function
      (e.g. renderPauloPhysicalExams), matching its hero -> AI-card -> content shape.
    - STATIC HTML: add the block to the static physical-exams page for that patient.
    - Never leave a thin-data patient on the "0/0/0" generic grid; route their Physical
      sub-pages through their renderer as the existing bespoke-patient rules require.
    - Do not nest the report or the AI card inside the SVG's container; they are
      siblings stacked below it.


------------------------------------------------------------------------------------
STEP 5 — THE AMBER "AI SUMMARY" CARD  (GATE 3a — per-ECG insight, generated at ingest)
------------------------------------------------------------------------------------
A short card that explains the ECG to the patient in plain language. This content is
GENERATED now, from the report, as part of the run — never shipped as a placeholder.

  GROUNDING: write the summary from the DOCTOR'S REPORT, not from your reading of the
  chart image. The report is the clinical source of truth; the chart is the picture.
  If the report and the visual seem to disagree, defer to the report and say nothing
  speculative. Do not invent findings, measurements, or reassurance.

  STYLE & TOKENS (canonical AI-card styling — keep it consistent with every other
  synthesis card on the platform; do NOT recolor it red):
    - Card: amber background #FDF8EC, 1px stroke #F4DD9C, rounded, modest padding.
    - Carries the purple .ai-pill badge ("AI" / interpretive) so AI inference is
      visually distinguished from patient/clinician data — same rule as the Mental
      section. Include the global "AI-generated interpretation" disclaimer line.
    - Title: "AI Summary" / "Resumo por IA" (bilingual, like the rest of the site).

  CONTENT (short — a few sentences, not a wall):
    - What an ECG measures, in one friendly line.
    - What this report concluded, in plain words (e.g. "normal sinus rhythm, no
      concerning findings" -> "your heartbeat's rhythm looked normal"). Translate
      jargon; keep any clinically important term once, with the plain version beside it.
    - A gentle, non-alarming next-step framing that POINTS BACK TO THE DOCTOR — Lumen
      bridges the doctor-patient conversation, it does not replace it. Never diagnose,
      never tell the patient to start/stop treatment, never reassure beyond what the
      report supports.
    - Bilingual EN / BR-PT.


------------------------------------------------------------------------------------
STEP 5b — TRIGGER THE GLOBAL AI INSIGHTS ENGINE  (GATE 3b — patient-level synthesis)
------------------------------------------------------------------------------------
The amber card above explains THIS ECG. Separately, the patient's record-wide synthesis
(lib/ai-insights.js — the "Update AI Insights" engine) must be re-run so the new cardiac
data is reflected in the patient-level insights, not just in an isolated card.

  - After GATE 2 (the ECG is persisted and read-back-proven), trigger the existing
    AI Insights job for this patient via its established async pattern — the insight_jobs
    table + ctx.waitUntil() flow behind the "Update AI Insights" button. Do NOT invent a
    new synthesis path; reuse the engine that already exists.
  - It writes to the same strict JSON schema and the same amber tokens (#FDF8EC /
    #F4DD9C) as everywhere else — honor the schema, set data_sufficient / data_available
    honestly, keep output bilingual.
  - This is async: confirm the job was ENQUEUED, then confirm it COMPLETED (poll the
    job/row) before calling GATE 3 done. A job that was queued but failed is not done.
  - If you judge the global re-run is out of scope for a given run, say so explicitly
    and leave GATE 3a (the per-ECG card) as the minimum — do not silently skip it.


------------------------------------------------------------------------------------
DATA / STORAGE  (GATE 2 — backend run, persisted, and read-back proven)
------------------------------------------------------------------------------------
Storage is a hard gate, not a side effect of rendering. The card must be backed by a
real row; never hand-author a card whose data isn't in the DB.

  - Run it through the real backend path, not a manual edit. Persist via the ingest
    route / pipeline (POST /api/ingest or the established ingest path) so the Worker
    boundary, validation, and any audit logging fire the same as for any patient. Do
    not bypass the API by editing tables or static data by hand.
  - Structured facts -> Postgres: an ecg study row (patient_id, modality, lead layout,
    source format, the report's headline interpretation as text) PLUS the full
    **provenance set** (see § Provenance). Column mapping on `ecg_studies`: exam date ->
    `study_date` (NOT NULL); requesting doctor -> `ordering_doctor`; performing/signing
    doctor -> `validating_doctor`; facility -> `clinic`; facility city -> `lab_city`;
    facility country -> `lab_country`; ingestion timestamp -> `created_at` (auto, never
    typed). Doctor names carry the reg ID inline; absent fields are `n/a` -> NULL. If the
    source is Case A, you may also persist machine-readable measurements the DICOM
    provides (HR, intervals) — but only if they come from the source, never invented.
  - Blobs -> R2: original chart file, the report PDF, and the generated SVG, under
    patients/{patient_id}/ecg/{study_date}/. DB rows point to the R2 keys.
  - Reuse existing ECG-related schema/enums where they exist (e.g. ecg_events,
    ecg_classification, imaging_source_format) rather than inventing new ones; if a new
    column is genuinely needed, propose a migration, don't hand-edit live tables.
  - Append-only: a re-run of the same study must not duplicate; dedupe on
    patient + study_date + source file.
  - PROVE IT (read-back, on live): after ingest, confirm the row is actually there via
    the live API, not just a local query —
        curl -sL "https://lumenhealth.io/api/patient-exams?patient=<id>" | grep -E "ecg|<study date>"
    and confirm the R2 objects exist. If the read-back doesn't show the study, GATE 2
    has failed — stop and fix before touching the frontend.


------------------------------------------------------------------------------------
OPERATIONAL GUARDRAILS (the rules that bite if ignored)
------------------------------------------------------------------------------------
  - Commit messages ASCII ONLY. No Unicode arrows (use "->", never "→") or
    `wrangler pages deploy` fails with code 8000111. Page content may use → freely.
  - Two-step deploy, treated as one unit — git push ALONE leaves the live site stale:
        1. git add / commit / push
        2. CLOUDFLARE_API_TOKEN=$(tr -d '\n\r' < token.txt) \
           CLOUDFLARE_ACCOUNT_ID=8dac8253e9c75f921598ce5273e5a834 \
           wrangler pages deploy web --project-name=lumenhealth --branch=main --commit-dirty=true
  - CACHE-BUSTING (the silent failure): if you edit patient-context.js or any sibling
    JS/data asset (e.g. a *-labs.js), you MUST bump its ?v=N query string in EVERY HTML
    file that references it. Otherwise the deploy succeeds but browsers serve the stale
    cached asset and users see no ECG. Bumping the version is part of "done", not optional.

  - DEFINITION OF DONE = verify on the LIVE BARE DOMAIN (https://lumenhealth.io); the
    per-deploy *.pages.dev hash URL and local previews do NOT count. WHAT you curl
    depends on the render class, because for JS-rendered patients the ECG block is
    injected at runtime and is NOT present in the page HTML — grepping the HTML there
    gives a FALSE NEGATIVE. Verify per class:

      STATIC HTML patient:
        curl -sL https://lumenhealth.io/<page>.html | grep "<distinctive string>"
        (study date / "AI Summary" — content is server-served, so this is sufficient.)

      BESPOKE JS RENDERER patient:
        1. curl the deployed asset and confirm the new render code + distinctive string:
           curl -sL "https://lumenhealth.io/assets/patient-context.js?v=<N>" \
             | grep -E "ecg|<study date>"
        2. curl the HTML that loads it and confirm the ?v=<N> bump is live (so users
           get the new asset, not cache):
           curl -sL https://lumenhealth.io/<page>.html | grep "patient-context.js?v=<N>"

      DATABASE DEFAULT patient (verify BOTH data and renderer):
        1. data reaches the frontend — the API returns the ECG:
           curl -sL "https://lumenhealth.io/api/patient-exams?patient=<id>" \
             | grep -E "ecg|<study date>"
        2. the shared renderer can draw it — the deployed asset has the ECG branch:
           curl -sL "https://lumenhealth.io/assets/patient-context.js?v=<N>" | grep "ecg"

    For any JS-rendered case, the strongest check is to load the actual patient page in
    a headless browser and confirm the ECG block, report link, and amber card appear in
    the rendered DOM. The asset + API curls above are the minimum floor; a headless
    render is the real proof that the FRONTEND — not just the data — is updated.
  - No special-casing Patient Zero. No conflating ingestion with reorganization.
  - hidePageBody() whitelist unchanged behavior — never add <header>.
  - PHI / clinical-accuracy asymmetry: a silent wrong rendering is the worst outcome.
    When unsure, surface the uncertainty to the operator and stop, rather than shipping
    a confident-looking but wrong ECG. A human approval gate stands before this goes
    live to the patient.


------------------------------------------------------------------------------------
DELIVERABLE / END STATE  (sign off only when all four gates pass)
------------------------------------------------------------------------------------
  GATE 1 (placement): a new ECG card lives under Physical > Exams (physical-exams),
    alongside labs/imaging, in the patient's correct render class — chart SVG, then the
    doctor's report PDF, then the amber AI card.
  GATE 2 (backend/DB): study ingested through the real API path; Postgres row written;
    original chart + report + SVG in R2 with pointers; PROVEN by live API read-back.
  GATE 3 (AI insight): per-ECG amber card content generated from the report (3a), AND
    the global AI Insights engine job triggered and CONFIRMED COMPLETE for this patient
    (3b) — or an explicit note if 3b was deliberately skipped.
  GATE 4 (frontend): the new ECG card renders on the LIVE bare domain for this patient,
    cache busted (?v= bump if any JS asset changed), verified the way the render class
    requires (HTML grep for static; asset + ?v= for bespoke JS; API + asset for
    DB-default; headless DOM render as the real proof for any JS-rendered case).

  Then report back: patient + id, render class, files ingested, the Case (A/B/C/D) used
  for the SVG and its fidelity label, R2 keys, the DB read-back line + output, the AI
  Insights job id/status, the ?v= bump (if any asset changed), and the exact verifying
  curl/headless line(s) with their output — one line per gate.
---

## Provenance — capture AND persist (the five facts)

A 12-lead clinical ECG is a **clinician-ordered** source, so **all five provenance
facts apply**. Capture **one provenance set per study** and persist it on the
`ecg_studies` row (via the real ingest path — `/api/admin/ecg-ingest`, which accepts
`lab_city`/`lab_country` alongside the existing `ordering_doctor`/`validating_doctor`/
`clinic`).

| Fact | `ecg_studies` column | Required? | `study` payload key | Notes |
|---|---|---|---|---|
| Exam date | `study_date` (date, NOT NULL) | **required** | `study_date` | When the ECG was recorded. Coerce partial dates to best-guess full `YYYY-MM-DD`. |
| Requesting doctor | `ordering_doctor` (text, null) | if shown | `ordering_doctor` | Who ordered it. Name + title + reg ID inline. |
| Performing doctor | `validating_doctor` (text, null) | if shown | `validating_doctor` | Who signed/validated the report. Reg ID inline. |
| Lab name | `clinic` (text, null) | if shown | `clinic` | Facility name, original spelling. |
| Lab city | `lab_city` (text, null) | if shown | `lab_city` | Original spelling. |
| Lab country | `lab_country` (text, null) | if shown | `lab_country` | Do not infer from language. |
| Ingestion date | `created_at` (timestamptz, `now()`) | auto | — | System-set at write time; never typed; never conflated with `study_date`. |

**Rules:** read provenance from the doctor's report (the clinical source of truth) first;
ask the operator only for what is missing; absent fields are `n/a` -> NULL; do not
translate names. `lab_city`/`lab_country` were added in migration `0015_provenance_columns.sql`.
