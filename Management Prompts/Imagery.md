# Imagery Ingestion Prompt

*Lives at `Management Prompts/Imagery.md` (markdown-formatted is fine). Supersedes the
prior `Imagery.txt` — including its one-exam-per-folder assumption: a patient's folder may
hold **several distinct exams** (e.g. an MRI, then a CT/TC, then another MRI). Feeds the LLM
authoring pipeline; produces, per exam, a study manifest + web previews + a viewer — 2D slice
stacks and rotatable 3D models — with the radiology report beneath it, plus a small patient
index that lets the viewer switch between exams.*

---

## Role

You are ingesting **one or more imaging exams (studies)** for a Lumen Health patient. They
arrive **together in a single folder tree or `.zip`** — a *container*, not a single study.
A folder routinely holds multiple exams: different modalities (MRI + CT + X-ray), different
dates (the same MRI repeated months apart), or both. Treat the folder as a drop of studies
and split it into the studies it contains before doing anything per-exam.

Each individual study may arrive as DICOM, JPEG/PNG, **3D surface meshes** (STL / OBJ / PLY /
glTF), or **volumetric data** (NIfTI / NRRD, or a DICOM series meant for 3D reconstruction) —
or a mix. Within a study, the data may be organized along one or more categorical axes —
**"ways"** — such as Region (cervical / lumbar), Plane (axial / coronal / sagittal), or Type
(slices / mesh / volume). Each way becomes a control on the viewer; the asset a selection
resolves to declares how it renders — a 2D slice stack, or a 3D model you rotate, zoom, and pan.

Your job:
1. Collect three inputs from the operator.
2. **Segment the folder into distinct studies.**
3. Then, **for each study**: discover and classify its files, reconcile what you find against
   what the operator told you, normalize each asset (order slice stacks, web-optimize 3D
   models), attach the report, and emit a **study manifest** + the per-study previews, and
   upsert its `imaging_studies` row.
4. Emit a small **patient imaging index** listing the studies, and the **generic viewer** that
   reads it — a top-level study switcher above the per-study controls.

Honor the project conventions in the final section. Do **not** special-case the patient — this
is the pipeline path that replaces hand-written renderers.

**Vocabulary (DICOM, and how it maps here).** A *study* = one exam (one `StudyInstanceUID`).
A *series* = one acquisition within a study (one `SeriesInstanceUID`) — series usually become
plane/sequence **ways**, never separate studies. An *instance* = one slice/image. The folder
you are handed contains one or more **studies**; each study contains one or more **series**.

**The report is mandatory, and it is the PDF.** Every exam carries a doctor's report, and in
this data it is reliably **the one file whose format is not an imaging asset — i.e. the lone
`.pdf`** sitting alongside the DICOM/JPEG/mesh/volume files. Identify it that way (not by
filename guessing), attach it to its study, extract its text, and **always render it below the
viewer** for that study. A study that ends up with no report breaks this invariant — flag it,
don't ship it silently. (Extracting the PDF's text for display is library-side and fine on the
current tier; sending that text to the model for an AI summary is the gated part — see
Compliance.)

---

## Step 0 — Intake (ask exactly these three, then stop and wait)

Ask all three in one turn, then wait for the operator's reply. Do not begin discovery before
you have answers.

> **1. Whose exams are these?**
> Give the patient's full name as it should appear in Lumen. I'll match it to an existing
> patient, or flag it if the name is new. Everything in this folder should belong to one
> patient — I'll flag it if I find more than one.
>
> **2. Where is the folder?**
> Paste the path to the root folder, or point me at the `.zip`. This may contain a single exam
> or several — I'll figure out how many.
>
> **3. What's inside, and how is each exam organized?**
> Two parts:
> - **How many exams, and how are they separated?** e.g. "three exams, one sub-folder each:
>   `RM Cervical`, `TC Cranio`, `RM Lombar`", or "two MRIs of the spine from different dates",
>   or "one exam." If they're DICOM, I'll split them by `StudyInstanceUID` regardless.
> - **For each exam, list its ways** — the axes I should turn into controls, each with its
>   values, in the order you'd like them to read. e.g. `Region = cervical, lumbar` ·
>   `Plane = axial, coronal, sagittal` · `Type = score, volume, charts`. These become buttons
>   (or a dropdown when an axis has > 5 values). Different exams can have different ways — a CT
>   may be a single axial stack while an MRI has region x plane. If any value should open as a
>   **3D model** (a mesh or a volume you rotate) rather than a slice stack, say so — otherwise
>   I'll detect 3D from the file type.
>
> Not sure of the counts, boundaries, or exact values? Give me what you know and I'll infer the
> rest from the folders, DICOM tags, and reports, then report back before emitting anything.

If the operator is unsure of the **number of exams** or the **ways**, proceed and **infer**
both — study boundaries from DICOM `StudyInstanceUID` / dates / folder-and-file naming
(Step 3), and ways within each study from its structure and tags (Step 5) — then present what
you inferred for confirmation before emitting anything.

---

## Step 1 — Resolve the patient (from answer 1)

- Match the name against existing patients. Resolve to `patient_id` and a URL-safe
  `patientSlug` (e.g. `paulo-silotto`). The patient is shared across every study in the folder.
- If DICOM is present, read the `PatientName` tag on each study and compare. If any disagrees
  with the operator's answer, **flag the mismatch and ask** — never silently trust either source.
- If the folder appears to mix **two different patients**, stop and ask whether to split it by
  patient and ingest each separately. A drop is normally one patient, many exams.
- If the patient is new, stop and ask whether to create the patient record first.
- All originals are stored under the patient partition in R2, namespaced per study:
  `patients/{patient_id}/imaging/{studySlug}/...`. Web-served previews go under
  `web/scans/{patientSlug}-{studySlug}/...`.

## Step 2 — Open the source (from answer 2)

- If a folder: take it as the container root.
- If a `.zip`: unzip to a temp working dir; treat the extracted root as the container root. If
  the zip contains a single top-level wrapper folder, descend into it.
- Recursively list every file under the root. Do not assume the top level separates exams —
  some drops nest exams in sub-folders, some dump everything flat. Segmentation (Step 3)
  decides.

## Step 3 — Segment the folder into studies (the partition step)

Split every discovered file into distinct **studies**, in this priority order. A folder of N
exams becomes N studies; a folder of one exam becomes one study (and the rest of the prompt
behaves exactly as the old single-exam version).

1. **DICOM present → group by `StudyInstanceUID` (authoritative).** Read tags with `dcmjs`
   and bucket every DICOM instance by its `StudyInstanceUID`; each distinct UID is one study.
   `SeriesInstanceUID` separates **series within** a study — these become plane/sequence ways
   in Step 5, **not** new studies. This is the gold-standard separator; trust it over folders.
2. **No DICOM → infer boundaries**, in priority order:
   - **(a) Top-level grouping.** One sub-folder per exam is the common layout — treat each
     top-level child folder as a candidate study.
   - **(b) Modality + date tokens** in folder/file names. Recognize EN and PT tokens and map to
     the `imaging_modality` enum: `RM`/`RNM`/`MRI`/`MR` -> MRI · `TC`/`CT` -> CT ·
     `RX`/`RaioX`/`Radiografia`/`X-ray` -> X-ray · `US`/`USG`/`Ultrassom` -> ultrasound ·
     `PET`/`PET-CT` -> PET · `Mamografia`/`Mammo` -> mammography ·
     `Densitometria`/`DEXA` -> bone densitometry · `Cintilografia` -> scintigraphy. A change of
     modality token, or a different embedded date, marks a new study.
   - **(c) Reports.** One report PDF per exam is common; the number and scope of reports hints
     at the number of studies. Associate each report with its study in Step 7.
   - **(d) `(StudyDate, Modality)` tuples** from any available metadata as a final separator.
3. **Reconcile** the inferred study set with the operator's answer to question 3 (how many
   exams they said, and how they're separated):
   - Found more studies than the operator described -> surface them and ask whether two are
     actually one exam.
   - Found fewer -> ask where the missing exam lives.
   - Counts agree but names differ by synonym/modality token -> resolve silently, note it.
4. **Assign a unique `studySlug` per study.** Base form is `{study-kind}-{YYYY-MM-DD}` (e.g.
   `spine-mri-2026-05-15`, `cranio-ct-2026-03-02`). **Guarantee uniqueness within the patient:**
   when two studies share kind + date, append a discriminator — a region/body-part token first
   (`spine-mri-2026-05-15`, `knee-mri-2026-05-15`), then a numeric suffix or 6 chars of the
   `StudyInstanceUID` if still colliding (`spine-mri-2026-05-15-2`). **Never merge two distinct
   studies into one** — not even same modality + same date (the "MRI ... then another MRI" case
   below).
5. **Present the detected studies for confirmation** before any per-study work — a short list,
   newest first:
   `1. Spine MRI · cervical+lumbar · 2026-05-15 · 3 series · report yes`
   `2. Cranio CT · axial · 2026-03-02 · 1 series · report yes`
   `3. Spine MRI · lumbar · 2024-11-10 · 2 series · report yes`
   Default the study order newest-first (the most recent exam is usually the one of interest)
   but keep it stable.

**Guard against over-segmentation.** Sibling folders like `axi/ cor/ sag/`, or `T1/ T2/ STIR/`,
are **planes/sequences of one study**, not three studies — they share a `StudyInstanceUID`
(or the same date + modality + region). Do not promote series or planes to studies. The
existing Paulo layout (`region-cervical/plane-{axi,cor,sag}/`) is **one** study with two ways,
and must stay one study.

---

## Per-study loop — run Steps 4–8 once for each study from Step 3

Everything below operates on a **single study's** file subset and writes into that study's own
`web/scans/{patientSlug}-{studySlug}/` folder and `imaging_studies` row. Files belonging to one
study never cross-contaminate another's classification or ways.

## Step 4 — Discover & classify (within the study)

Bucket the study's files:

- **DICOM** — `.dcm`, or extension-less files whose bytes carry the `DICM` magic at offset 128.
  Read tags with `dcmjs`: `PatientName`, `StudyInstanceUID`, `SeriesInstanceUID`, `StudyDate`,
  `Modality`, `SeriesDescription`, `InstanceNumber`, `SliceLocation`, `ImageOrientationPatient`.
- **Raster slices** — `.jpg` / `.jpeg` / `.png`.
- **3D meshes** — `.stl`, `.obj`, `.ply`, `.gltf`, `.glb`, `.3mf` (segmented anatomy,
  surgical-planning or print models).
- **Volumes** — `.nii` / `.nii.gz`, `.nrrd`, `.mha` / `.mhd`, or a DICOM series the operator
  (or `SeriesDescription`) flags for 3D reconstruction.
- **Report (mandatory)** — **the PDF.** In this data the doctor's report is the lone file whose
  format is not an imaging asset: identify it as the `.pdf` sitting among the DICOM/JPEG/mesh/
  volume files, rather than by filename. `.docx` / `.txt` are accepted only as a fallback when no
  PDF is present. Expect exactly one per study (or one per region for multi-region studies).
- **Other** — manifests, thumbnails, OS cruft (`.DS_Store`, `Thumbs.db`) -> ignore.

Confirm this study's `StudyDate` and `Modality` (set in Step 3) against the tags; they anchor
the manifest and the index entry.

## Step 5 — Infer the ways, then reconcile (against answer 3, within the study)

1. Read this study's directory hierarchy. Each nesting level is a **candidate way**; each
   distinct child name at that level is a candidate value. (For DICOM, the study's
   `SeriesInstanceUID` set is the natural source of plane/sequence ways.)
2. Normalize value names with a synonym table — at minimum:
   `lumbar ↔ lombar`, `sagittal ↔ sag ↔ sagital`, `axial ↔ axi`, `coronal ↔ cor`,
   `left ↔ esq`, `right ↔ dir`. Extend as needed; record the raw->canonical mapping.
3. When folders don't separate planes but DICOM does, derive the plane way from this study's
   `SeriesDescription` / `ImageOrientationPatient` instead.
4. **Reconcile** the inferred structure with the operator's per-exam answer 3:
   - Inferred axis the operator didn't mention (e.g. a stray `score/` folder) -> surface it and
     ask whether it's a way, a single derived image, or noise.
   - Operator named an axis you can't find -> ask where it lives.
   - Names differ only by synonym -> resolve silently, but note it.
5. **Each study has its own ways.** Do not force a shared axis set across studies — an MRI may
   be region x plane while a CT in the same folder is a single axial stack and a mesh-only study
   has just a Type way. Settle the final ordered `ways[]` (axis name + ordered values) for *this*
   study before continuing.

## Step 6 — Normalize the slices / 3D (within the study)

For each leaf (each full combination of this study's way-values that contains images):

- **Order matters and is not lexical.** Sort DICOM by `InstanceNumber`, falling back to
  `SliceLocation`. Sort raster slices by the numeric index parsed from the filename — **sort
  numerically, never as strings** (`IMG-2` precedes `IMG-10`). Unpadded filenames are the common
  failure here; do not let `10.jpg` sort before `2.jpg`.
- **DICOM -> JPEG previews.** Keep the original DICOM as the canonical blob in R2. Generate a
  windowed JPEG preview per slice for the browser (and for any vision pass). Pixel data stays out
  of git; previews are what `web/scans/` serves.
- **Single-image "ways."** A value like `score` or a chart is usually one derived image, not a
  stack. Represent it as a stack of `count: 1`. The viewer hides the scrubber when `count === 1`.
- **3D meshes -> web-optimized GLB.** Keep the original mesh in R2. Convert to glTF-binary
  (`.glb`) and Draco-compress for the browser; decimate very dense meshes. Preserve named
  parts/sub-meshes if present (the viewer can toggle them). Record up-axis and units (mm).
- **Volumes -> keep reconstructable + a fallback.** Store the volume (NIfTI/NRRD) or the ordered
  slice stack plus voxel spacing so it can be reconstructed in-browser. Full volume rendering is
  the heavy path tied to the open DICOM-viewer decision; until that lands, also generate a
  **turntable** — a ring of pre-rendered frames around the object — so 3D is at least rotatable
  without a WebGL volume engine.
- Write normalized previews to (paths already namespaced by `studySlug`, so studies never
  collide):
  `web/scans/{patientSlug}-{studySlug}/{way1key}-{value}/{way2key}-{value}/0001.jpg …`
  Prefix each folder with its way key (`region-cervical/plane-sag/`) so a generic walker can read
  structure from the path alone.

## Step 7 — Attach the report (mandatory, within the study)

Every study **must** end with a report attached. The report is **the PDF** — the lone
non-imaging-format file in the study's file set (see Step 4). Do not ship a study without one.

- **Locate it deterministically.** Take the `.pdf` among the imaging assets as the report. If the
  study spans regions with **separate PDFs** (a cervical report and a lumbar report), keep them
  separate and associate each with its way-value so the viewer shows the relevant one as the
  selection changes. If a study has more than one PDF and they don't map cleanly to regions, stop
  and ask which is the report. If a study has **no PDF at all**, flag it loudly — this violates the
  always-a-report invariant — and ask before continuing rather than emitting a report-less study.
- **Store the original + serve a copy.** Keep the original PDF as a blob in R2 at
  `patients/{patient_id}/imaging/{studySlug}/report.pdf` (per region:
  `report-{region}.pdf`). Serve a copy under the study's web folder,
  `web/scans/{patientSlug}-{studySlug}/report.pdf`, which is what the manifest references.
- **Extract the text — library-side, not via the model.** Pull the PDF's text with a PDF text
  library (e.g. `pdfminer` / `pypdf` / `pdfium`) for in-page rendering and search. Store it on the
  manifest as `textPt` (PT-primary — most reports here are Brazilian Portuguese) and `textEn`
  (`null` unless an English original or a translation exists). Sending identifiable report text to
  the model for summarization is the gated path — keep extraction on the library and leave
  `aiSummary` null until the de-identified pass is run (see Compliance). Image-only or scanned PDFs
  with no text layer: still embed the PDF, leave the text fields null (or OCR de-identified first).
- **A report that covers multiple exams** (one combined PDF for the MRI and the CT) -> split it by
  section and attach each section to its study, or, if it can't be split, attach it to each study
  it references and note the overlap. A report clearly belonging to one exam stays with that exam
  only.
- **Record the full provenance set** (see § Provenance at the end). For imaging the
  `imaging_studies` column mapping is: study date -> `study_date` (NOT NULL); requesting
  doctor -> `requesting_doctor`; reporting/performing radiologist -> `performing_doctor`;
  facility -> `lab_name`; facility city -> `lab_city`; facility country -> `lab_country`;
  ingestion timestamp -> `created_at` (auto, never typed). Doctor names carry the
  registration ID inline; absent fields are `n/a` -> NULL. Read from report text / DICOM
  first; original spelling.

## Step 8 — Emit the study manifest (within the study)

One manifest per study — this schema is **unchanged** from the single-exam version. It is the
contract the viewer reads — the `ways[]` drive the controls, and `stacks[]` resolve a selection
to an **asset** (a slice stack, a 3D mesh, or a volume). Each entry's `render` field tells the
viewer how to display it. Write it to `web/scans/{patientSlug}-{studySlug}/manifest.json` and
reference it with a `?v=N` cache-bust that you bump whenever the data changes.

```json
{
  "patient": "Paulo Silotto Souza",
  "patientSlug": "paulo-silotto",
  "study": "Spine MRI",
  "studySlug": "spine-mri-2026-05-15",
  "studyInstanceUID": "1.2.840.113619.2.55.3.…",
  "date": "2026-05-15",
  "modality": "MRI",
  "facility": "CETAM Diagnostico",
  "facilityCity": "Sao Paulo",
  "facilityCountry": "Brazil",
  "reportingDoctor": "Dr. Marco Antonio de Carvalho",
  "requestingDoctor": null,

  "ways": [
    {
      "key": "region", "labelEn": "Region", "labelPt": "Regiao",
      "values": [
        { "key": "cervical", "labelEn": "Cervical", "labelPt": "Cervical" },
        { "key": "lombar",   "labelEn": "Lumbar",   "labelPt": "Lombar" }
      ]
    },
    {
      "key": "plane", "labelEn": "Plane", "labelPt": "Plano",
      "values": [
        { "key": "sag", "labelEn": "Sagittal", "labelPt": "Sagital" },
        { "key": "axi", "labelEn": "Axial",    "labelPt": "Axial" },
        { "key": "cor", "labelEn": "Coronal",  "labelPt": "Coronal" }
      ]
    }
  ],

  "defaultSelect": { "region": "cervical", "plane": "sag" },

  "stacks": [
    {
      "select": { "region": "cervical", "plane": "sag" },
      "count": 13,
      "slices": [
        "region-cervical/plane-sag/0001.jpg",
        "region-cervical/plane-sag/0002.jpg"
      ]
    }
  ],

  "report": [
    {
      "match": { "region": "cervical" },
      "pdf": "report-cervical.pdf",
      "textEn": null,
      "textPt": "Laudo ...",
      "aiSummary": null
    }
  ]
}
```

Notes on the schema:
- **`studyInstanceUID`** — record it when the study came from DICOM. It is the merge-guard key:
  two manifests with different UIDs are always different studies, even at the same date/modality.
- **`render`** on each `stacks[]` entry selects the surface: `"slices"` (default — the 2D stack
  shown above), `"mesh"`, `"volume"`, or `"turntable"`. Omit it for plain slice stacks.
- **`report` is always present** — never null or omitted. It is a single object (one PDF for the
  whole study) or an array matched by way-value (separate PDFs per region). `pdf` is required and
  points at the served copy under the study's web folder; `textPt`/`textEn` hold the
  library-extracted text (PT-primary, EN often null). A manifest with no `report` is a bug, not a
  valid state.
- A way-value with no entry for a given combination simply has no `stacks[]` entry — the viewer
  disables that option contextually (see Step 10).
- Omit `aiSummary` unless a de-identified summary pass was run (see Compliance). If present, it
  renders behind the AI-pill.

**3D assets in the manifest.** A `stacks[]` entry can resolve to a 3D model instead of slices.
A mesh:

```json
{
  "select": { "region": "cervical", "type": "mesh" },
  "render": "mesh",
  "model": "region-cervical/type-mesh/cervical-spine.glb",
  "upAxis": "Y",
  "units": "mm"
}
```

A volume, carrying a turntable fallback for the pre-WebGL-viewer interim:

```json
{
  "select": { "region": "cervical", "type": "volume" },
  "render": "volume",
  "volume": "region-cervical/type-volume/cervical.nrrd",
  "spacing": [0.5, 0.5, 1.0],
  "window": { "center": 40, "width": 400 },
  "turntable": {
    "count": 36,
    "degreesPerFrame": 10,
    "frames": ["region-cervical/type-volume/turntable/0001.jpg", "..."]
  }
}
```

Also create/upsert the `imaging_studies` row for **this study** in Postgres, pointing at the R2
originals and the manifest, so the study is queryable through the patient API rather than
hard-coded. **One row per study** — never collapse two distinct `StudyInstanceUID`s (or two
distinct exams) into a single row, even when modality and date match.

---

## Step 9 — Emit the patient imaging index (once, after all studies)

After every study in the folder has its manifest and `imaging_studies` row, produce the **index**
that lists them and drives the viewer's top-level study switcher. This layer is **additive** —
existing single-study manifests keep working untouched.

**Prefer the API.** The index is best **derived from the `imaging_studies` rows** for the patient
and served by the patient API (the generic, manifest-driven path). Only if you must ship before
that endpoint exists, write a static index to `web/scans/{patientSlug}-imaging-index.json` (flat,
hyphen-joined to match the per-study folder naming) and cache-bust it with `?v=N`.

```json
{
  "type": "imaging-index",
  "patient": "Paulo Silotto Souza",
  "patientSlug": "paulo-silotto",
  "defaultStudy": "spine-mri-2026-05-15",
  "studies": [
    {
      "studySlug": "spine-mri-2026-05-15",
      "manifest": "paulo-silotto-spine-mri-2026-05-15/manifest.json",
      "labelEn": "Spine MRI", "labelPt": "RM da Coluna",
      "modality": "MRI",
      "region": "spine",
      "date": "2026-05-15",
      "has3D": false,
      "studyInstanceUID": "1.2.840.113619.2.55.3.…"
    },
    {
      "studySlug": "cranio-ct-2026-03-02",
      "manifest": "paulo-silotto-cranio-ct-2026-03-02/manifest.json",
      "labelEn": "Head CT", "labelPt": "TC de Cranio",
      "modality": "CT",
      "region": "head",
      "date": "2026-03-02",
      "has3D": false,
      "studyInstanceUID": "1.2.840.113619.2.55.3.…"
    }
  ]
}
```

- `studies[]` are ordered as presented in Step 3 (newest first by default).
- `manifest` is the path, relative to `web/scans/`, to that study's `manifest.json`.
- `defaultStudy` is the slug the viewer opens on (most recent unless the operator says otherwise).
- A **single-study** folder may skip the index entirely or emit a one-entry index; the viewer
  collapses the study switcher when there is only one study.

## Step 10 — Emit the viewer

The viewer is a **single generic component** that consumes either an **index** (a study switcher
over many manifests) or a **single manifest** (one study, today's behavior) — not a new
per-patient function.

**Detect the input shape.** If handed an object with `type: "imaging-index"` (or a `studies[]`
array), render the **study switcher** and lazy-load each study's manifest on selection. If handed
a plain manifest, render it directly with no study switcher. A one-study index behaves like a
plain manifest (no switcher).

It renders, top to bottom:

**Study control — the top row, only when more than one study.** Read `studies[]`.
- **≤ 5 studies -> segmented buttons. ≥ 6 -> a dropdown.** (Same rule as ways.)
- Label each as `labelEn`/`labelPt` + date, e.g. "Spine MRI · 2026-05-15" / "RM da Coluna · 2026-05-15".
  When several studies share a modality (two MRIs), the date disambiguates them and the row reads
  as a small timeline.
- Default to `defaultStudy`. On change, **lazy-load** the selected study's `manifest.json`, then
  rebuild the per-study ways, surface, and report beneath. **Tear down** the previous study's heavy
  assets (3D context, large preview sets) on switch.

**Controls — one row per way (per the selected study's manifest).** Read `ways[]` in order. For each way:
- **≤ 5 values -> segmented buttons. ≥ 6 values -> a dropdown.**
- Default the selection from `defaultSelect` (or the first value of each way).
- When the current selection across the *other* ways yields no `stacks[]` entry for a value (e.g.
  cervical has no coronal series), **disable that value** rather than showing an empty viewer.

**Slice surface (`render: "slices"`, the default).**
- Resolve the current selection to its stack; render the ordered previews.
- Provide a scrubber/slider, prev/next buttons, **arrow-key** navigation, and a slice counter
  (`12 / 40`).
- If `count === 1`, hide the scrubber and counter and show the single image.

**3D surface (`render: "mesh"` / `"volume"` / `"turntable"`).** When a selection resolves to a 3D
asset, swap the slice surface for a WebGL canvas:
- Universal controls: **rotate/orbit** (left-drag), **zoom** (scroll / pinch), **pan** (right-drag
  or modifier+drag), a **reset view** button, and **fullscreen**.
- **Mesh** — load the web-optimized GLB; basic three-point lighting; optional **wireframe** toggle
  and per-part visibility when the model has named sub-meshes. Render with three.js.
- **Volume** — volume-render the dataset with **window/level**, tissue **presets** (bone / soft
  tissue), and an **opacity** slider. This is the heavy path — cornerstone3D or VTK.js — and part
  of the still-open DICOM-viewer decision; until it's settled, fall back to the turntable.
- **Turntable** — when `render` is `"turntable"`, or for any 3D asset where WebGL is unavailable:
  play the pre-rendered frame ring through the same scrubber as the slice surface, labeled in
  degrees. Gives rotate-to-inspect with no 3D engine.
- **Lazy-load** the 3D library only when a 3D asset is first selected — never ship three.js / VTK
  on pages that show only 2D slices.

**Report — always below the viewer.** Every view shows the doctor's report directly beneath it;
this section is never empty for a valid study.
- Show the report matching the current selection (for per-region PDFs) or the single study report.
  **Embed the PDF** (the served `report.pdf`) **and** render the extracted text beneath/beside it.
- The report sits below the slice/3D surface for *every* study — including single-image studies and
  report-only studies (where it is the whole view).
- If `textEn`/`textPt` exist, respect the bilingual toggle; if only `textPt` exists, show it under
  both toggle states. Any `aiSummary` renders inside a card with the purple `.ai-pill` badge and the
  standard AI disclaimer — never styled as source data.
- Defensive only: if a manifest somehow arrives with no `report`, show a clear "report unavailable"
  state rather than rendering nothing — but treat that as a bug to fix upstream (run the backfill
  prompt), not a normal path.

---

## Conventions to honor

- **Hero-first.** If this populates a patient's `/home` or a physical-exams page, the page still
  opens with the hero block (`Health Summary · [DATE]` / *From scattered data to a clinical
  picture.*). The study switcher, viewer, and any AI summary go **below** the Reports/Browse
  section — never above the hero.
- **Study switcher follows the ways rules.** ≤ 5 -> buttons, ≥ 6 -> dropdown; bilingual labels;
  shown only when more than one study exists.
- **Bilingual everywhere.** EN ↔ BR-PT via `.lang-en` / `.lang-pt`, including the study switcher
  labels, control labels, the slice counter unit, and report text. Pull labels from the index's and
  manifests' `labelEn`/`labelPt`.
- **AI-pill on anything inferred.** Slice images and report text are patient data and carry no
  badge. Any model-written summary, impression, or synthesis carries the `.ai-pill`.
- **Brand tokens.** Use the design system — surface stack, petrol/gold accents, Raleway + IBM
  Plex. The viewer must read correctly in both light and dark themes.
- **One row per study; never merge.** Each study is one `imaging_studies` row and one manifest.
  Distinct `StudyInstanceUID`s stay distinct even at identical modality + date. The folder is a
  container, not a study.
- **DICOM / volume viewer is still undecided** (OHIF vs cornerstone3D vs VTK.js vs custom). The
  interim 2D path is the JPEG-preview slider; the interim 3D path is three.js for meshes and a
  pre-rendered turntable for volumes. Full in-browser volume rendering waits on that decision.
  Originals (DICOM, mesh, volume) stay in R2 so a richer viewer can be layered on later without
  re-ingesting.
- **3D rendering is modular and lazy-loaded** — three.js for surface meshes, cornerstone3D or
  VTK.js for volume rendering, Plotly's `mesh3d` / `volume` / `scatter3d` for any derived 3D chart,
  and the turntable as the no-WebGL fallback.
- **Integration.** Prefer feeding the generic, manifest-driven renderer via the patient API — the
  per-study manifests and the patient index both derive from the `imaging_studies` rows. Only if
  you must ship before that component exists, follow the existing bespoke pattern (constant at the
  top of `patient-context.js`, a branch in the `section === 'physical-exams'` dispatch and in the
  catch-all Physical dispatch, and the page class added to the `hidePageBody()` whitelist) — and
  remember `hidePageBody()` whitelists `<nav>` only, never `<header>`, or Patient Zero's static
  hero leaks onto this patient's pages.

## Compliance guardrail

On the current non-BAA tier, identifiable PHI must not reach the model. Run segmentation,
discovery, classification, ordering, and manifest assembly on file structure and DICOM tags —
which you can handle without sending pixel data or identifiable report text to the model. If you
run a vision or summary pass, **de-identify first** (strip burned-in patient identifiers from
previews and remove identifiers from report text), or defer the AI summary entirely until the
HIPAA tier flip. This applies per study. Raw originals always stay in R2; the model sees
de-identified previews and structure only.

3D data re-identifies more readily than slices: a head or face surface render is biometric.
**Deface** head/neck volumes and meshes (strip the facial surface) before any web exposure or
vision pass, and crop to the clinically relevant region where you can.

## Edge cases

- **Several exams, one folder (the headline case)** -> segment into studies in Step 3 (DICOM
  `StudyInstanceUID` first; else folder grouping / modality+date tokens / reports). One manifest +
  one `imaging_studies` row each, and a patient index driving the study switcher.
- **MRI, then a CT/TC, then another MRI** -> three distinct studies; the two MRIs never merge.
  Disambiguate their slugs by region/body-part, then a numeric or short-UID suffix if needed.
- **Same modality, same date, two studies** -> still distinct if `StudyInstanceUID` differs (or the
  series sets / reports / body regions clearly differ); keep separate, unique slugs.
- **Same modality, different dates (longitudinal: MRI 2024 vs MRI 2026)** -> distinct studies; the
  study switcher reads as a timeline. (A side-by-side compare view is out of MVP scope.)
- **One exam split across sibling folders** (`axi/ cor/ sag/`, or `T1/ T2/ STIR/`) -> these are
  planes/sequences of **one** study, not separate studies. Do not over-segment.
- **Folder with a single exam** -> behaves exactly as the prior single-exam prompt; index optional
  or one-entry; no study switcher. Fully backward compatible.
- **Mixed-patient folder** -> flag and stop; ask whether to split by patient first.
- **Study folder with no PDF** -> breaks the always-a-report invariant. Re-check whether the PDF is
  nested deeper, mis-extensioned, or sitting at the container level; if truly absent, flag it and
  ask before shipping a report-less study.
- **Multiple PDFs in one study** -> map them to regions (per-region reports) if they line up with a
  way; otherwise ask which is the report.
- **Report covering multiple exams** vs **one report per exam** -> associate each report with its
  study; split a combined report by section, or attach it to each study it references.
- **Report only, no images** (for a given study) -> the report card *is* the whole view; render it,
  no slice/3D surface, no controls. The report still shows.
- **Image-only or scanned PDF (no text layer)** -> embed the PDF; leave `textPt`/`textEn` null, or
  OCR after de-identification. Never block on a missing text layer.
- **One image, no ways** -> minimal viewer for that study, no control row, no scrubber.
- **DICOM with a flat structure** -> derive ways from `SeriesDescription` / orientation tags (after
  grouping into studies by `StudyInstanceUID`).
- **Mixed extensions in one stack** -> fine; order by index/instance regardless of type.
- **Unpadded numeric filenames** -> numeric sort, never lexical.
- **Derived "Type" assets** -> `score` / charts are single-image stacks; `volume` / `mesh` are 3D
  assets (see above).
- **Laterality (left/right) or contrast (pre/post)** -> just additional ways; the model is general
  — don't hard-code them.
- **Localizers / scout / duplicate series** -> flag and offer to exclude from the stacks.
- **Pure 3D asset, no slices/planes** -> 3D canvas only; no scrubber and no Plane control unless the
  operator also defined a Plane way for 2D MPR alongside it.
- **Volume *and* a slice stack of the same data** -> offer both: 2D MPR via the Plane ways and a 3D
  volume render. Reconstruct the volume from the stack where feasible rather than storing the pixels
  twice.
- **Oversized / dense mesh** -> Draco-compress and decimate the web copy; keep the original.
- **WebGL unavailable** -> turntable frames; if none, a single rendered still.
- **Multiple meshes for one selection** -> load as named parts in one scene with visibility toggles,
  not separate viewers.
- **Patient name in DICOM disagrees with answer 1** -> stop and ask; do not guess.

---

## Provenance — capture AND persist (the five facts)

An imaging study is a **clinician-ordered** source, so **all five provenance facts
apply**. Capture **one provenance set per study** and persist it to `imaging_studies`
on ingestion (in addition to the `manifest.json`, which is the front-end contract).

| Fact | `imaging_studies` column | Required? | Manifest key | Notes |
|---|---|---|---|---|
| Exam date | `study_date` (date, NOT NULL) | **required** | `date` | When the study was performed. Coerce partial dates to best-guess full `YYYY-MM-DD`. |
| Requesting doctor | `requesting_doctor` (text, null) | if shown | `requestingDoctor` | Who ordered it. Name + title + reg ID inline. |
| Performing doctor | `performing_doctor` (text, null) | if shown | `reportingDoctor` | Reporting/performing radiologist who signed the report. Reg ID inline. |
| Lab name | `lab_name` (text, null) | if shown | `facility` | Imaging center / clinic, original spelling. |
| Lab city | `lab_city` (text, null) | if shown | `facilityCity` | Original spelling. |
| Lab country | `lab_country` (text, null) | if shown | `facilityCountry` | Do not infer from language. |
| Ingestion date | `created_at` (timestamptz, `now()`) | auto | — | System-set at write time; never typed; never conflated with `study_date`. |

**Rules:** read provenance from the report text / DICOM tags first; ask the user only
for what is missing; absent fields are `n/a` -> NULL (not empty string, not a guess);
do not translate doctor / facility / city names. The columns were added in migration
`0015_provenance_columns.sql`; confirm names against `db/schema.ts` before any insert.
