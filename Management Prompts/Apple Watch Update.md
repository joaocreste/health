# Lumen Health — Apple Health Ingestion Prompt (Claude Code)

> Paste everything below the line into Claude Code, running from the repo root.
> This ingests an **Apple Health export from a local folder** for one patient and
> **fully replaces** that patient's existing Apple Health data. It does NOT append.

---

You are working in the **Lumen Health** repository. I want you to ingest a fresh **Apple Health**
export and load it into the platform's data model — daily metrics into **Neon Postgres**, raw
files into **R2** — **completely replacing** the patient's previous Apple Health data, then
commit and deploy.

## 0. First — ask me two questions, then stop and wait

Before reading any files, deleting anything, or writing any code, **ask me both of these and
wait for my answers**:

1. **What is the patient's name?** (a name or internal identifier). Once I answer, resolve the
   exact internal identifier from the schema/seed data and **confirm it back to me** before
   proceeding — do not hardcode a guess. **No special-casing for Patient Zero**: whoever I name,
   the data takes the same path any other patient's Apple Health data would.
2. **Where is the Apple Health data folder?** (the absolute path on my machine, e.g.
   `/Users/joao/lumen-data/apple-health-export-2026-06`). This is normally an unzipped
   `apple_health_export/` containing `export.xml` (and/or `export_cda.xml`), an
   `electrocardiograms/` folder of ECG CSVs, and a `workout-routes/` folder of GPX files.
   You'll read everything under it recursively. Verify the path exists and report what you see at
   the top level (and the `export.xml` size) before going further.

Do not assume defaults for either. If I haven't answered both, ask again rather than guessing.
Only once you have a confirmed patient identifier **and** a verified folder path do you continue
to the steps below.

## 1. Ground truth — read these first (repo wins)

Before writing or deleting anything, read these for the *real* shapes — do not invent columns,
tables, enums, sources, or routes:

- `CLAUDE.md` / project memory at repo root — ops rules, conventions.
- `db/schema.ts` and `db/migrations/` — the real tables, columns, enums (`import_source`,
  `import_status`, `import_file_status`, `ecg_classification`, etc.), and the `0000`–`0007` +
  `meta/_journal` pattern. Pay attention to **how `vitals_daily` is shaped** (and whether
  rows/metrics carry a source tag), and to **`ecg_events`** and **`glucose_points`** if present.
- `lib/ingest.js` and `POST /api/ingest` in `web/_worker.js` — the existing ingestion path,
  classification, and the R2 partition scheme `patients/{patient_id}/{category}/{file}`.
- The existing ingestion prompts in `Ingestion Prompts/` (`Blood Tests.txt`, `Imagery.txt`,
  `InBody.txt`, `Journal Ingestion.txt`) — **match their structure, tone, and conventions.**
- `scripts/build-patient-record.mjs`, `scripts/aggregate-hr-by-tod.mjs`,
  `scripts/aggregate-bp-by-week.mjs` — how the chatbot record and the variability charts are
  assembled (relevant in §5). Patient Zero's Apple Health already feeds these; match that path.
- `DATA-PROVENANCE.md` — you will update this.

If anything in this prompt conflicts with the repo, **the repo wins** — except the
full-replacement rule in §3, which is the whole point of the task.

## 2. What's in an Apple Health export and where each part goes

Apple Health is large and heterogeneous — one big XML plus side folders. **Stream-parse
`export.xml`** (it can be hundreds of MB to multiple GB — do NOT load it whole into memory; use a
SAX/streaming XML reader). Detect and log what you found before loading.

Structure to expect:
- **`export.xml`** — the bulk. `<Record type="HK...">` elements (one per sample) covering heart
  rate, resting HR, HRV (SDNN), steps, active/basal energy, walking distance, flights, VO₂max,
  respiratory rate, blood oxygen (SpO₂), body mass / BMI / body fat, blood pressure
  (systolic/diastolic), sleep analysis, audio exposure, etc.; plus `<Workout>`, `<ActivitySummary>`,
  and `<ClinicalRecord>` elements.
- **`electrocardiograms/*.csv`** — the ~per-reading ECG CSVs (voltage trace + classification +
  date). These map to **`ecg_events`** (and the raw CSV goes to R2). Use the `ecg_classification`
  enum for the Apple-reported result (e.g. sinus rhythm / AFib / inconclusive).
- **`workout-routes/*.gpx`** — GPS routes for workouts; raw to R2, link to the workout.
- **`export_cda.xml`** / `clinical-records/` — any clinical documents; raw to R2 with a pointer row.

Route the data the platform's usual way:

| Apple Health data | Destination |
|---|---|
| **Raw export files** (`export.xml`, ECG CSVs, GPX, CDA) | **R2** under `patients/{patient_id}/apple-health/…`, with pointer row(s) in `imports` / `import_files` |
| **Daily structured metrics** (HR, resting HR, HRV, steps, energy, SpO₂, respiratory rate, body mass, BP, sleep) | **Neon** — aggregate samples to the daily grain and map onto existing `vitals_daily` columns |
| **ECG readings** | **Neon** `ecg_events` (date, classification, avg HR, etc.); raw CSV in R2 |
| **High-frequency samples** (per-minute HR, etc.) | source material for the variability charts (§5) if the schema/scripts already consume them; otherwise keep raw in R2 and skip |

**Aggregation note:** Apple stores many samples per day. Reduce to the **daily grain** the
`vitals_daily` schema expects (e.g. resting HR = the resting-HR sample for the day; steps = daily
sum; HRV = daily mean/median per the existing convention). Mirror exactly how Patient Zero's
existing Apple Health rows were derived so the two are consistent. Make sure the metrics that
surface in **"At a glance"** (resting heart rate, sleep efficiency, blood pressure) land.

## 3. FULL REPLACEMENT — the key requirement

Apple Health data **accumulates over time**: each export is a *superset* of every prior export.
So the correct, dedup-free strategy is **wipe the patient's existing Apple Health data, then load
the new folder fresh** — never merge or append.

Do this carefully and **scoped to (this patient) AND (Apple Health provenance) only**:

1. **Identify Apple Health provenance.** Determine exactly how an Apple-Health-sourced row/blob is
   distinguished from Oura / Withings / lab data — a `source` column, the `import_source` enum
   value, or linkage through `imports` / `import_files`. **Use that as your delete filter.** If
   you cannot prove a row is Apple-Health-sourced, do NOT delete it.
2. **Delete the old Apple Health data:**
   - The patient's Apple-Health-derived rows in `vitals_daily` (and any HR/sleep detail tables
     fed from Apple Health).
   - The patient's `ecg_events` rows sourced from Apple Health.
   - The patient's Apple Health `import_files` + `imports` rows.
   - The R2 blobs under `patients/{patient_id}/apple-health/`.
3. **Guardrail — shared daily rows.** If `vitals_daily` stores **one row per day merged across
   devices** (rather than one row per source), do NOT nuke whole days — that could wipe Oura- or
   Withings-owned columns for the same date. Instead null out only the Apple-Health-owned columns
   for those days, then repopulate. Inspect the schema and pick the safe path; tell me which one
   you took and why.
4. **Never touch non-Apple-Health sources.** Oura, Withings, labs, imaging, genetics, writings,
   etc. must be left completely untouched.
5. **Then reingest** everything from the folder I confirmed in §0, fresh, for the patient I
   confirmed in §0.

Wrap the delete+reload in a transaction where feasible so a mid-run failure can't leave the
patient with half their Apple Health history. Given the volume, **batch the inserts** (chunked
`INSERT`s, not one giant statement) and log progress as you stream `export.xml`.

## 4. Schema changes — only if needed

Map onto existing columns first. **Only if** an Apple Health metric has no home, add migration
`0008` (or next free number) following the exact `0000`–`0007` + `meta/_journal` convention, plus
the matching Drizzle change in `db/schema.ts`. Don't add speculative columns for metrics not in
this export. Run `db:generate` / `db:migrate` per the package scripts.

> **Local `.env` gotcha:** the `neondb_owner` password was rotated; the live `lumenhealth`
> secret is current but the **local `.env` may be STALE** (`password authentication failed`).
> If local DB writes fail, refresh `.env` from the Neon dashboard before assuming data loss —
> the live `/api/login` still works. Do not change the live secret.

## 5. Charts & chatbot record (refresh — Apple Health feeds these)

Patient Zero's HR-by-time-of-day and BP-by-week variability charts are derived from Apple Health,
so for that patient (and any other whose charts use it):

- **Re-run the relevant `scripts/aggregate-*.mjs`** (`aggregate-hr-by-tod.mjs`,
  `aggregate-bp-by-week.mjs`, and any others reading the Apple Health source), paste each
  regenerated single-line const back into `web/assets/data.js`, and **bump the `?v=N`** on its
  `<script>` include. Follow the validated variability-chart recipe (stacked ±1/±2 SD bands,
  median spline, palette-800 stroke, clinical reference lines, bilingual title/meta).
- Re-run `npm run build:patient-record` so the chatbot's `patient-record.txt` reflects the new
  Apple Health data.

## 6. Provenance & verification

- Update `DATA-PROVENANCE.md`: note the new Apple Health export (folder name, export date, date
  range covered, file/record counts, number of ECG CSVs) and that it **replaced** the prior Apple
  Health import.
- Report, before vs after: row counts in each affected table (`vitals_daily`, `ecg_events`, etc.),
  and the **min/max date** of the ingested daily metrics, so I can see the new coverage window.
- Spot-check live (after deploy): `curl -sL` the relevant API (`/api/patient-summary` and the
  vitals endpoint) and confirm **resting heart rate**, **blood pressure**, and **sleep
  efficiency** reflect the new data.

## 7. Commit & deploy — the full ritual

Run the project's standard shipping unit (a git push alone leaves the live site stale):

1. `git add` + `git commit` + `git push`. Use ASCII `->` (never `→`) in **git commit messages** —
   the Pages API rejects the Unicode arrow.
2. **Deploy** (required here, since §5 touches `web/assets/data.js`):
   ```
   CLOUDFLARE_API_TOKEN=$(tr -d '\n\r' < token.txt) \
   CLOUDFLARE_ACCOUNT_ID=8dac8253e9c75f921598ce5273e5a834 \
   wrangler pages deploy web --project-name=lumenhealth --branch=main --commit-dirty=true
   ```
3. **Verify** on the user-facing bare domain — `curl -sL https://lumenhealth.io/...` and grep for
   a distinctive string from this change (e.g. the bumped `?v=` or a new data point). The
   per-deploy hash URL is just an immutable preview; the bare domain is what matters.

Ensure `node_modules` exists at repo root (`npm install`) before any bundle/build step. DB (Neon)
and R2 writes are external and need no deploy on their own — but because this task also edits
`web/`, the deploy above is mandatory.

## 8. Do NOT

- Do **not** special-case Patient Zero.
- Do **not** delete or modify any non-Apple-Health source data.
- Do **not** load `export.xml` whole into memory — stream it.
- Do **not** move auth client-side or change the live secrets.
- Do **not** invent columns, endpoints, or enum values — read the repo.
- Do **not** append/merge Apple Health data — this is a clean full replacement.

When done, give me a short summary: format/contents detected, what was deleted, what was loaded
(with row counts), the new date range, any migration added, the commit hash, and the live
verification result.
---

## Provenance classification — device self-captured

This is a **device self-captured** source, so the clinician provenance facts do
**NOT** apply. Only the **measurement date** applies — it is the per-row date/timestamp
already written (`vitals_daily.day`, `ecg_events.recorded_at`) and the device is recorded
in `source` (e.g. `oura`, `apple_health`, `withings_*`). The system ingestion timestamp is
the existing `created_at`. Requesting/performing doctor and lab name/city/country are
`n/a` here — do **not** force the clinical fields onto wearable rows. (Contrast with the
clinician-ordered Blood/Imagery/ECG prompts, where all five facts apply.)
