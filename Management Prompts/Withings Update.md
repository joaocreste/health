# Lumen Health — Withings Ingestion Prompt (Claude Code)

> Paste everything below the line into Claude Code, running from the repo root.
> This ingests a **Withings Health Mate export from a local folder** for one patient and
> **fully replaces** that patient's existing Withings data. It does NOT append.

---

You are working in the **Lumen Health** repository. I want you to ingest a fresh **Withings**
(Health Mate) data export and load it into the platform's data model — daily metrics into
**Neon Postgres**, ECG traces into **`ecg_events`**, raw files into **R2** — **completely
replacing** the patient's previous Withings data, then commit and deploy.

## 0. First — ask me two questions, then stop and wait

Before reading any files, deleting anything, or writing any code, **ask me both of these and
wait for my answers**:

1. **What is the patient's name?** (a name or internal identifier). Once I answer, resolve the
   exact internal identifier from the schema/seed data and **confirm it back to me** before
   proceeding — do not hardcode a guess. **No special-casing for Patient Zero**: whoever I name,
   the data takes the same path any other patient's Withings data would.
2. **Where is the Withings data folder?** (the absolute path on my machine, e.g.
   `/Users/joao/lumen-data/withings-export-2026-06`). This is normally an unzipped Health Mate
   export (`data_<NAME>_<ID>/`): a flat folder of ~40–70 CSVs plus a `README.txt` describing
   each file. Verify the path exists and report what you see — file count, which device
   families are represented (scale / BP cuff / watch-tracker), and the contents of
   `README.txt` — before going further.

Do not assume defaults for either. If I haven't answered both, ask again rather than guessing.
Only once you have a confirmed patient identifier **and** a verified folder path do you continue
to the steps below.

## 1. Ground truth — read these first (repo wins)

Before writing or deleting anything, read these for the *real* shapes — do not invent columns,
tables, enums, sources, or routes:

- `CLAUDE.md` / project memory at repo root — ops rules, conventions.
- `db/schema.ts` and `db/migrations/` — the real tables, columns, enums, and the migration +
  `meta/_journal` pattern. Pay attention to **how `vitals_daily` is shaped**: one row per
  (patient, day, **source**), where the `source` comment already reserves
  **`withings_cuff`** and **`withings_scale`**; and to **`ecg_events`** (its `source` comment
  already anticipates `'withings'`).
- `lib/vitals-resolve.js` + `scripts/resolve-vitals.mjs` — the device hierarchy
  (Oura > Apple Watch > Withings cuff > Withings scale; **BP is cuff-owned, weight/body-comp is
  scale-owned**) and the derived `source='resolved'` rows. The resolver must know every source
  tag you write — if the export contains watch/tracker metrics that fit neither `withings_cuff`
  nor `withings_scale`, check what the resolver supports and **flag it to me** before inventing
  a new tag.
- `bin/extract.py` — the static-dashboard generator. It reads
  `Patients/<Patient>/Withings/weight.csv` + `bp.csv` and emits the `WEIGHT` and `BP` consts in
  `web/assets/data.js` plus `metrics.json`. `scripts/aggregate-bp-by-week.mjs` builds the
  `BP_BY_WEEK` variability const from the same `bp.csv`. **Withings feeds live charts** — this
  is the big difference from the Apple Health ingestion, where charts were untouched.
- The sibling prompts in `Management Prompts/` (`Oura Update.txt`, `Apple Watch Update.md`,
  `Blood Tests.txt`) and the prior ingestion scripts
  (`scripts/ingest-joao-oura.mjs`, `scripts/ingest-joao-apple-vitals.mjs`,
  `scripts/ingest-joao-apple-ecg.mjs`, `scripts/record-joao-apple-import.mjs`) — **match their
  structure, conventions, and delete-filter discipline.**
- `DATA-PROVENANCE.md` — you will update this. Its 2026-06-11 entry already flags that on-disk
  Withings data is AHEAD of the published charts — this ingestion is what closes that gap.

If anything in this prompt conflicts with the repo, **the repo wins** — except the
full-replacement rule in §3, which is the whole point of the task.

## 2. What's in a Health Mate export and where each part goes

The export is one flat folder of CSVs. Inventory and log what you found before loading.
Files to expect (names are stable across exports):

- **`weight.csv`** — scale measurements, several columns per reading: Weight, Fat mass, Bone
  mass, Muscle mass, Hydration (all **kg**), timestamped (possibly several/day).
- **`bp.csv`** — BP cuff readings: Date, Heart rate, Systolic, Diastolic, Comments — often
  **multiple readings per day**.
- **`height.csv`**, **`pwv.csv`** (pulse-wave velocity, m/s), **`manual_spo2.csv`**,
  **`other.csv`** (Body Scan extras: electrodermal activity, nerve-response score…),
  **`note.csv`**.
- **`sleep.csv`** — per-night sessions: from/to, light/deep/REM/awake **seconds**, wake-ups,
  snoring, avg/min/max HR.
- **`activities.csv`** — workout sessions (Activity type + a JSON `Data` blob with calories,
  steps, distance).
- **`aggregates_*.csv`** — daily-grain steps, calories earned/passive, distance, elevation
  (watch/tracker-derived).
- **`signal.csv`** — full **ECG voltage traces**: date, sampling frequency, duration, wear
  position, the signal as a comma-list, plus any doctor assessment. There may also be a
  `raw_hr_Atrial fibrillation result.csv` with the device classification.
- **`raw_*.csv`** — high-frequency series (continuous HR, sleep state, tracker streams, walking
  metrics, elevation). Large; not for Postgres.
- **`raw_location_*.csv`** + **`devices.csv`** — GPS tracks and device home coordinates.
- **`account.csv`**, **`user.csv`**, **`user_survey.csv`** — account metadata.

Route the data the platform's usual way:

| Withings data | Destination |
|---|---|
| **Raw export files** (all CSVs, README) | **R2** under `patients/{patient_id}/withings/…`, with pointer row(s) in `imports` / `import_files` — **EXCEPT location data, see below** |
| **`weight.csv`** | **Neon** `vitals_daily` rows with **`source='withings_scale'`** — `weight_kg` = last reading of the day; fat/bone/muscle/hydration kg in `extras` (no dedicated columns — follow the `respiratory_rate`-in-extras precedent) |
| **`bp.csv`** | **Neon** `vitals_daily` rows with **`source='withings_cuff'`** — `blood_pressure_sys`/`_dia` = daily mean, rounded to int. The cuff's pulse is a seated spot-check, **not** a resting HR — keep it in `extras`, never in `resting_hr` |
| **`sleep.csv`** / `manual_spo2.csv` / `aggregates_*.csv` | **Neon** daily grain, but ONLY under a source tag the resolver knows (§1) — these are watch/tracker metrics; if there's no sanctioned tag, keep them raw-in-R2 and **tell me** rather than polluting `withings_cuff`/`withings_scale` |
| **`signal.csv`** ECG traces | **Neon** `ecg_events` (recorded_at, classification mapped to the `ecg_classification` enum, duration, `source='withings'`); raw CSV in R2 |
| **`raw_*.csv`** high-frequency streams | **R2 only** — no Postgres rows |
| **`raw_location_*.csv`**, GPS columns in `devices.csv` | **EXCLUDE from upload entirely** — same privacy rule as the Oura `rawlocation.csv` precedent in `DATA-PROVENANCE.md` |
| `height.csv` | report it; do NOT silently overwrite `patient_profiles.height_cm` — flag if it differs |

**Aggregation note:** reduce to the **daily grain** `vitals_daily` expects, mirroring the
conventions in `scripts/ingest-joao-apple-vitals.mjs` (sums for counts, means for rates, last-of-
day for weight, sleep attributed to the wake day, sleep stages in minutes). Same-day duplicate
readings are normal for a cuff — that's what the daily mean is for.

## 3. FULL REPLACEMENT — the key requirement

A Health Mate export **accumulates over time**: each export is a *superset* of every prior
export. So the correct, dedup-free strategy is **wipe the patient's existing Withings data, then
load the new folder fresh** — never merge or append.

Do this carefully and **scoped to (this patient) AND (Withings provenance) only**:

1. **Identify Withings provenance.** The delete filters are: `vitals_daily` rows with
   `source IN ('withings_cuff','withings_scale', …any other withings_* tag actually present)`;
   `ecg_events` rows with `source='withings'`; `imports`/`import_files` rows whose
   `classified_as` marks them as Withings; R2 blobs under `patients/{patient_id}/withings/`.
   If you cannot prove a row is Withings-sourced, do NOT delete it.
2. **Derived rows are not delete targets.** The legacy merged `source='aggregate'` rows and the
   resolver's `source='resolved'` rows are *derived*, not Withings-owned — leave them alone in
   the wipe. But if `source='resolved'` rows are materialised for this patient, **re-run
   `scripts/resolve-vitals.mjs --apply` after reingesting** so the resolved series reflects the
   new per-device rows. (If they are not materialised, refresh the dry-run numbers only —
   keep the pending state.)
3. **Never touch non-Withings sources.** Oura, Apple Health (`apple_health` vitals rows,
   `apple_watch` ECGs), labs, imaging, genetics, writings, etc. must be left completely
   untouched. Verify their row counts before vs after and report them.
4. **Then reingest** everything from the folder I confirmed in §0, fresh, for the patient I
   confirmed in §0.
5. **Refresh the on-disk chart source.** For a patient whose static dashboard reads
   `Patients/<Patient>/Withings/` (this is how `bin/extract.py` finds `weight.csv`/`bp.csv`),
   replace that folder's contents with the new export so DB and charts come from the same
   files. If the patient has no static dashboard folder, skip and say so.

Wrap the delete+reload in a transaction where feasible, batch the inserts (chunked `INSERT`s),
and log progress.

## 4. Schema changes — only if needed

Map onto existing columns first; overflow metrics ride in the `extras` JSONB per the existing
convention. **Only if** a Withings metric genuinely has no home, add the next free migration
number following the exact migrations + `meta/_journal` convention, plus the matching Drizzle
change in `db/schema.ts`. Don't add speculative columns. Run `db:generate` / `db:migrate` per
the package scripts.

> **Local `.env` gotcha:** the `neondb_owner` password was rotated; if local DB writes fail with
> `password authentication failed`, refresh `.env` from the Neon dashboard before assuming data
> loss. Do not change the live secret.

> **R2 credentials gotcha:** `token.txt` is Pages-deploy-scoped and CANNOT touch R2. For R2
> object writes use the machine's **wrangler OAuth login** — run `npx wrangler r2 object put …`
> WITHOUT setting `CLOUDFLARE_API_TOKEN` (the env var would override OAuth) and ALWAYS with
> **`--jurisdiction eu`** (the bucket is EU-jurisdiction; without the flag it's invisible).
> Single PUTs cap around ~300 MB — gzip anything bigger (unlikely here; Withings CSVs are small).

## 5. Charts & chatbot record — Withings feeds these (unlike Apple Health)

For a patient whose dashboard renders Withings data (Patient Zero does):

- Re-run **`python3 bin/extract.py`** → regenerates the `WEIGHT` and `BP` consts in
  `web/assets/data.js` + `metrics.json`. Diff and confirm the **non-Withings consts**
  (`HRV_RHR`, `STEPS`, `STRESS_RES`, `SLEEP_BOX`, `HR_BY_TOD`, `GLUCOSE`, `ECG`) are
  **byte-identical** — only Withings-fed output may move.
- Re-run **`node scripts/aggregate-bp-by-week.mjs`** and paste the regenerated single-line
  `BP_BY_WEEK` const back into `data.js`. Follow the validated variability-chart recipe
  (stacked ±1/±2 SD bands, median spline, palette-800 stroke, clinical reference lines,
  bilingual title/meta).
- **Re-paste the hardcoded HTML metric cards** that mirror `metrics.json` (BP mean/peak/latest-
  month, weight/fat/muscle/BMI cards, hero data-source counts) in `home.html` +
  `physical-vitals.html` and any other page that carries them — `DATA-PROVENANCE.md` lists
  exactly which cards are inlined-by-hand.
- **Bump the `?v=N`** on every `<script src="assets/data.js?v=…">` include you touched.
- Re-run `npm run build:patient-record` so the chatbot's `patient-record.txt` reflects the new
  Withings numbers.

## 6. Provenance & verification

- Update `DATA-PROVENANCE.md`: new export (folder name, export date, date range, file/reading
  counts, ECG trace count), that it **replaced** the prior Withings data, and clear the
  "Withings on-disk ahead of published charts" flag from the 2026-06-11 entry if this run
  resolves it.
- Report, before vs after: row counts per `vitals_daily` source, `ecg_events` by source,
  `imports`/`import_files`, and the **min/max date** per ingested metric family (weight, BP),
  so I can see the new coverage window.
- Spot-check live (after deploy): `curl -sL https://lumenhealth.io/api/patient-summary?...` and
  the deployed `data.js` — confirm **blood pressure** and **weight/body-composition** reflect
  the new data (grep for a new latest reading or the bumped `?v=`).

## 7. Commit & deploy — the full ritual

This task touches `web/` (§5), so the deploy is mandatory:

1. `git add` + `git commit` + `git push`. Stage ONLY this task's files — the working tree may
   carry unrelated WIP. Use ASCII `->` (never `→`) in commit messages — the Pages API rejects
   the Unicode arrow. Note `DATA-PROVENANCE.md` and `Patients/` are gitignored — update them on
   disk, but don't try to commit them.
2. **Deploy**:
   ```
   CLOUDFLARE_API_TOKEN=$(tr -d '\n\r' < token.txt) \
   CLOUDFLARE_ACCOUNT_ID=8dac8253e9c75f921598ce5273e5a834 \
   wrangler pages deploy web --project-name=lumenhealth --branch=main --commit-dirty=true
   ```
3. **Verify** on the user-facing bare domain — `curl -sL https://lumenhealth.io/...` and grep
   for a distinctive string from this change (the bumped `?v=` or a new BP/weight data point).
   The per-deploy hash URL is just an immutable preview; the bare domain is what matters.

Ensure `node_modules` exists at repo root (`npm install`) before any bundle/build step.

## 8. Do NOT

- Do **not** special-case Patient Zero.
- Do **not** delete or modify any non-Withings source data (incl. the derived
  `aggregate`/`resolved` rows — re-derive, don't wipe).
- Do **not** upload GPS/location data (`raw_location_*.csv`, device coordinates) to R2.
- Do **not** map the BP cuff's pulse into `resting_hr`.
- Do **not** invent `vitals_daily` source tags the resolver doesn't know — ask first.
- Do **not** move auth client-side or change the live secrets.
- Do **not** append/merge Withings data — this is a clean full replacement.

When done, give me a short summary: devices/files detected, what was deleted, what was loaded
(with row counts per source), the new date ranges, which charts/consts/cards changed, any
migration added, the commit hash, and the live verification result.

---

## Provenance classification — device self-captured

This is a **device self-captured** source, so the clinician provenance facts do
**NOT** apply. Only the **measurement date** applies — it is the per-row date/timestamp
already written (`vitals_daily.day`, `ecg_events.recorded_at`) and the device is recorded
in `source` (e.g. `oura`, `apple_health`, `withings_*`). The system ingestion timestamp is
the existing `created_at`. Requesting/performing doctor and lab name/city/country are
`n/a` here — do **not** force the clinical fields onto wearable rows. (Contrast with the
clinician-ordered Blood/Imagery/ECG prompts, where all five facts apply.)
