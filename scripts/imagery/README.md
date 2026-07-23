# Reusable imagery ingester

Generalizes the per-patient DICOM ingest (Paulo chest-CT, Silvana thyroid-US) into
two reusable, patient-agnostic tools. Implements the local half of
`Management Prompts/Imagery.md`. **No model calls, no PHI to any model** — so each
run costs ~$0 of AI. (The expensive part of a one-off session is the agent
reasoning through it; running these scripts directly avoids that.)

## Two steps

```bash
# 1) LOCAL: segment + de-identify + previews + manifest + report + provenance
python3 scripts/imagery/ingest.py \
    --slug silvana \
    --name "Silvana Aparecida Creste Dias de Souza" \
    --src  "/path/to/folder-or-zip" \
    [--kind thyroid-us]    # override auto study-kind for a single-study drop
    [--deid us|auto|none]  # default auto: US -> banner-mask, CT/MR/XR -> none
    --apply

# 2) DB + wiring instructions (prints SCAN_OWNERS + bespoke snippet; upserts rows)
node scripts/imagery/wire.mjs \
    --studies .staging/imagery/silvana-studies.json \
    --clerk   pending:silvana-creste-18ba19 \
    --apply
```

Then apply the printed wiring and deploy `web/` (clean-worktree, `--branch main`).

## What each does

**`ingest.py`** (Python — pydicom + Pillow + pypdf):
- Opens a folder or `.zip` container of one or more studies.
- Segments by DICOM `StudyInstanceUID` (authoritative); skips `DICOMDIR` / non-image objects.
- 1 series → single scrubber stack (`ways:[]`); >1 series → a `series` control way.
- **De-identifies**: US frames get the identity banner above the calibrated sector
  (`SequenceOfUltrasoundRegions`) blacked out; monochrome CT/MR/XR are windowed and
  carry no burned-in identity. Verify previews before shipping.
- Writes `web/scans/{slug}-{kind}-{date}/…jpg`, `…-manifest.json`, copies `report.pdf`,
  extracts `textPt`, reads provenance from DICOM tags, and emits
  `.staging/imagery/{slug}-studies.json`.

**`wire.mjs`** (Node — neon):
- Upserts one `imaging_studies` row per study (additive: delete-by-`blob_prefix`).
- Detects **generic vs bespoke** patients:
  - *Generic* → turnkey; the DB-driven `renderImagingStudy` mounts the viewer, no code edits.
  - *Bespoke* (Silvana, Paulo) → prints the `studies[]` `viewer{}` snippet to paste + which
    file to edit and `?v=` to bump.
- Prints the `SCAN_OWNERS` gate line (only if missing) and the live verify curls.

## What still needs a human (flagged, never guessed)
- **Findings / conclusions** — auto-`notes` = the raw extracted report text (`textPt`),
  which is enough to feed the AI engine; polish bilingual EN/PT + the bespoke card
  `conclusion_en/pt` by hand.
- **Doctor / facility names** come through in the report's original casing; tidy if desired.
- **`lab_city` / `lab_country`** are usually not in DICOM tags — fill from the report.
- **`aiSummary` stays null** until the HIPAA tier (de-identified summary pass).
- Anything the segmenter can't resolve cleanly (multi-PDF studies, missing report,
  DICOM `PatientName` mismatch) is printed as a `⚠` — resolve before shipping.

## Reference implementations
The first hand-built ingests remain as worked examples:
`scripts/ingest-paulo-chest-ct-2026-07-10.py` / `-db.mjs`,
`scripts/ingest-silvana-thyroid-us-2026-07-03.py` / `-db.mjs`.
