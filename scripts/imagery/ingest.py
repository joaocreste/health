#!/usr/bin/env python3
"""Generic imagery ingester — DICOM/JPEG -> de-identified web previews + manifest.

Reusable across patients (Silvana, Paulo, and any future patient). Implements the
local, no-model half of Management Prompts/Imagery.md: it segments a folder into
studies, de-identifies, generates previews + a manifest per study, attaches the
report, and reads provenance from DICOM tags. It writes NOTHING to the DB and
sends NOTHING to a model — that keeps every run at ~$0 of AI cost. The DB upsert
and front-end wiring are the companion `wire.mjs` step, which reads the
`_studies.json` this script emits.

Usage:
  python3 scripts/imagery/ingest.py --slug silvana --name "Silvana Aparecida Creste Dias de Souza" \
      --src "/path/to/folder-or-zip" [--kind thyroid-us] [--deid us|auto|none] [--max-dim 900] [--apply]

  --slug     short web token used for the folder prefix + SCAN_OWNERS gate
             (e.g. `silvana`, `paulo`). Folders become web/scans/{slug}-{kind}-{date}/.
  --name     patient's full name for the manifest (display only).
  --src      source folder or .zip (a container of one or more studies).
  --kind     override the auto study-kind for a single-study drop (e.g. `thyroid-us`);
             for multi-study drops, edit the printed slugs in _studies.json instead.
  --deid     us  = mask the identity banner above the US sector (default when Modality=US)
             auto= per-study: US -> banner-mask, monochrome CT/MR/XR -> none (tags aren't
                   rendered, so those previews carry no burned-in identity)  [default]
             none= no masking (use only when you've confirmed frames are already clean)
  --max-dim  longest preview edge in px (default 900).
  --apply    actually write previews/manifests; without it, does a dry-run summary.

Outputs (with --apply):
  web/scans/{slug}-{kind}-{date}/0001.jpg ...      (+ series-*/ subfolders for multi-series)
  web/scans/{slug}-{kind}-{date}/report.pdf
  web/scans/{slug}-{kind}-{date}-manifest.json
  .staging/imagery/{slug}-studies.json             (descriptor for wire.mjs)

Segmentation: DICOM grouped by StudyInstanceUID (authoritative); 1 series -> single
scrubber stack, >1 series -> a `series` way (one value per SeriesInstanceUID). Non-DICOM
folders fall back to a single JPEG/PNG stack per top-level folder. Ambiguity is FLAGGED,
never silently guessed.
"""
import argparse
import collections
import json
import os
import re
import shutil
import sys
import tempfile
import zipfile

import numpy as np
import pydicom
from PIL import Image

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover
    PdfReader = None

IMG_EXT = {".jpg", ".jpeg", ".png"}


# ── helpers ──────────────────────────────────────────────────────────────────
def log(msg):
    print(msg, file=sys.stderr)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")


def is_dicom(path):
    try:
        with open(path, "rb") as fh:
            fh.seek(128)
            return fh.read(4) == b"DICM"
    except Exception:
        return False


def coerce_date(raw):
    """DICOM StudyDate YYYYMMDD -> YYYY-MM-DD; passthrough if already dashed."""
    if not raw:
        return None
    raw = str(raw).strip()
    if re.fullmatch(r"\d{8}", raw):
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    return m.group(0) if m else None


def dcm_val(ds, tag, default=None):
    v = getattr(ds, tag, None)
    return default if v in (None, "") else v


def sector_top(ds):
    """Top y of the calibrated US sector; rows above it hold the identity banner."""
    regs = getattr(ds, "SequenceOfUltrasoundRegions", None)
    if regs:
        ys = [int(getattr(r, "RegionLocationMinY0", 10**9)) for r in regs]
        cand = [y for y in ys if 0 <= y < 10**9]
        if cand:
            return max(0, min(cand))
    return int(round(int(ds.Rows) * 0.12))  # fallback: top 12%


def render_frame(ds, deid_us):
    """DICOM pixels -> PIL RGB image, windowing monochrome, masking US banner."""
    px = ds.pixel_array
    photo = str(dcm_val(ds, "PhotometricInterpretation", "")).upper()
    if px.ndim == 3 and px.shape[-1] == 3:  # already colour (US / secondary capture)
        img = px.astype(np.uint8)
    else:                                    # monochrome: rescale + window to 8-bit
        f = px.astype(np.float32) * float(dcm_val(ds, "RescaleSlope", 1)) + float(dcm_val(ds, "RescaleIntercept", 0))
        wc, ww = dcm_val(ds, "WindowCenter"), dcm_val(ds, "WindowWidth")
        if wc is not None and ww is not None:
            wc = float(wc[0] if hasattr(wc, "__iter__") else wc)
            ww = float(ww[0] if hasattr(ww, "__iter__") else ww)
        else:
            wc, ww = float(f.mean()), max(1.0, float(f.max() - f.min()))
        lo, hi = wc - ww / 2.0, wc + ww / 2.0
        g = np.clip((f - lo) / max(1e-6, (hi - lo)), 0, 1) * 255
        img = np.stack([g.astype(np.uint8)] * 3, axis=-1)
        if "MONOCHROME1" in photo:
            img = 255 - img
    if deid_us:
        img = img.copy()
        img[: sector_top(ds), :, :] = 0
    return Image.fromarray(img, mode="RGB")


def save_preview(ds, out_path, deid_us, max_dim):
    im = render_frame(ds, deid_us)
    if max(im.size) > max_dim:
        scale = max_dim / max(im.size)
        im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    im.save(out_path, quality=88)


def extract_pdf_text(pdf_path):
    if PdfReader is None:
        return None
    try:
        r = PdfReader(pdf_path)
        return "\n".join((p.extract_text() or "") for p in r.pages).strip() or None
    except Exception as e:
        log(f"  ! PDF text extraction failed: {e}")
        return None


def inst_sort_key(ds):
    n = dcm_val(ds, "InstanceNumber")
    if n is not None:
        try:
            return (0, int(n))
        except Exception:
            pass
    sl = dcm_val(ds, "SliceLocation")
    return (1, float(sl)) if sl is not None else (2, 0)


# ── segmentation ─────────────────────────────────────────────────────────────
def discover(root):
    files = []
    for dirpath, _dirs, names in os.walk(root):
        for n in names:
            if n in (".DS_Store", "Thumbs.db"):
                continue
            files.append(os.path.join(dirpath, n))
    return files


def segment(files):
    """-> (studies, report_pdfs, warnings). studies: list of dicts keyed by StudyInstanceUID."""
    warnings = []
    dicoms, pdfs, rasters = [], [], []
    for f in files:
        ext = os.path.splitext(f)[1].lower()
        if ext == ".pdf":
            pdfs.append(f)
        elif ext in IMG_EXT:
            rasters.append(f)
        elif ext in (".dcm", "") or is_dicom(f):
            if is_dicom(f):
                dicoms.append(f)
            elif ext in IMG_EXT:
                rasters.append(f)
    studies = []
    if dicoms:
        by_study = collections.defaultdict(list)
        for f in dicoms:
            if os.path.basename(f).upper() == "DICOMDIR":
                continue  # media-directory index, not an image instance
            ds = pydicom.dcmread(f, stop_before_pixels=True)
            if getattr(ds, "Rows", None) is None or getattr(ds, "Columns", None) is None:
                continue  # directory record / structured report / non-image object
            by_study[str(dcm_val(ds, "StudyInstanceUID", "UNKNOWN"))].append((f, ds))
        for uid, items in by_study.items():
            series = collections.defaultdict(list)
            for f, ds in items:
                series[str(dcm_val(ds, "SeriesInstanceUID", "S"))].append(f)
            ref = items[0][1]
            studies.append({
                "uid": uid, "series": series, "ref_tags": ref, "kind_src": "dicom",
                "modality": str(dcm_val(ref, "Modality", "")).upper(),
                "date": coerce_date(dcm_val(ref, "StudyDate")),
                "patient_name": str(dcm_val(ref, "PatientName", "")),
            })
    elif rasters:
        warnings.append("No DICOM found — falling back to a single JPEG/PNG stack. "
                        "Provide --kind and verify de-identification manually.")
        studies.append({"uid": None, "series": {"S": sorted(rasters)}, "ref_tags": None,
                        "kind_src": "raster", "modality": "", "date": None, "patient_name": ""})
    else:
        warnings.append("No imaging assets (DICOM/JPEG/PNG) found under the source.")
    return studies, pdfs, warnings


# ── report ↔ study association ────────────────────────────────────────────────
def _dir_is_ancestor(anc, path):
    """True if `anc` is `path` itself or a directory above it."""
    anc, path = os.path.abspath(anc), os.path.abspath(path)
    return path == anc or path.startswith(anc + os.sep)


def assign_reports(studies, pdfs):
    """Map each study UID -> (pdf_path|None, note|None).

    A PDF belongs to a study when its directory sits at or above that study's image
    dirs — the common hospital export puts the report at the study-folder root with
    the images in an `IMAGES/` subdir — AND that directory is not also above another
    study's images (a shared container-level PDF, which stays flagged for manual
    attachment). Falls back to the lone-PDF/single-study case.
    """
    imgdirs = {st["uid"]: {os.path.dirname(f) for sl in st["series"].values() for f in sl}
               for st in studies}
    assign = {}
    for st in studies:
        uid, dirs = st["uid"], imgdirs[st["uid"]]
        own = []
        for p in pdfs:
            pdir = os.path.dirname(p)
            if dirs and all(_dir_is_ancestor(pdir, d) for d in dirs):
                covers_other = any(
                    o["uid"] != uid and imgdirs[o["uid"]]
                    and all(_dir_is_ancestor(pdir, d2) for d2 in imgdirs[o["uid"]])
                    for o in studies)
                if not covers_other:
                    own.append(p)
        if len(own) == 1:
            assign[uid] = (own[0], None)
        elif len(own) > 1:
            assign[uid] = (own[0], f"{len(own)} PDFs under this study's folder — using {os.path.basename(own[0])}; verify which is the report.")
        elif len(pdfs) == 1 and len(studies) == 1:
            assign[uid] = (pdfs[0], None)
        else:
            assign[uid] = (None, f"{len(pdfs)} PDFs, none uniquely under this study's folder — attach manually." if pdfs else None)
    return assign


# ── per-study build ──────────────────────────────────────────────────────────
def study_kind(study, override):
    if override:
        return slugify(override)
    ref = study["ref_tags"]
    mod = (study["modality"] or "img").lower()
    bodypart, desc = "", ""
    if ref is not None:
        bodypart = str(dcm_val(ref, "BodyPartExamined", "") or "")
        desc = str(dcm_val(ref, "StudyDescription", "") or dcm_val(ref, "SeriesDescription", "") or "")
    # US technique split: a colour-Doppler exam reads as 'doppler', plain B-mode as 'us'.
    technique = "doppler" if (mod == "us" and "doppler" in desc.lower()) else None
    if bodypart:
        bp = slugify(bodypart)
    elif desc.strip() and not technique:
        bp = slugify(desc.split()[0])
    else:
        bp = ""
    if technique:
        return slugify(f"{bp}-{technique}") if bp else technique
    if not bp:
        return mod
    # avoid duplicating the modality token ('us' + 'us' -> 'us-us')
    return bp if (bp == mod or mod in bp.split("-")) else slugify(f"{bp}-{mod}")


def build_study(study, slug, name, out_base, staging_slugs, assigned, deid_mode, max_dim, apply):
    date = study["date"] or "undated"
    kind = study_kind(study, staging_slugs.get(study["uid"]))
    web_slug = f"{slug}-{kind}-{date}"
    # uniqueness within this run
    base = web_slug
    i = 2
    while web_slug in build_study.seen:
        web_slug = f"{base}-{i}"
        i += 1
    build_study.seen.add(web_slug)

    modality = study["modality"]
    deid_us = (deid_mode == "us") or (deid_mode == "auto" and modality == "US")

    out_dir = os.path.join(out_base, web_slug)
    manifest_path = os.path.join(out_base, f"{web_slug}-manifest.json")
    series_ids = list(study["series"].keys())
    multi = len(series_ids) > 1

    if apply:
        if os.path.isdir(out_dir):
            shutil.rmtree(out_dir)
        os.makedirs(out_dir, exist_ok=True)

    ways, stacks = [], []
    total = 0
    if study["kind_src"] == "dicom":
        way_values = []
        for si, sid in enumerate(series_ids, 1):
            files = study["series"][sid]
            loaded = [(pydicom.dcmread(f), f) for f in files]
            loaded.sort(key=lambda t: inst_sort_key(t[0]))
            sdesc = str(dcm_val(loaded[0][0], "SeriesDescription", "") or f"Series {si}").strip()
            skey = slugify(sdesc) or f"series-{si}"
            subdir = f"series-{skey}" if multi else ""
            slices = []
            for j, (ds, _f) in enumerate(loaded, 1):
                rel = f"{subdir}/{j:04d}.jpg" if subdir else f"{j:04d}.jpg"
                if apply:
                    os.makedirs(os.path.join(out_dir, subdir) if subdir else out_dir, exist_ok=True)
                    save_preview(ds, os.path.join(out_dir, rel), deid_us, max_dim)
                slices.append(rel)
            total += len(slices)
            if multi:
                way_values.append({"key": skey, "labelEn": sdesc, "labelPt": sdesc})
                stacks.append({"select": {"series": skey}, "count": len(slices), "slices": slices})
            else:
                stacks.append({"select": {}, "count": len(slices), "slices": slices})
        if multi:
            ways.append({"key": "series", "labelEn": "Series", "labelPt": "Série", "values": way_values})
    else:  # raster fallback — single stack
        files = sorted(study["series"]["S"], key=lambda p: [int(x) if x.isdigit() else x for x in re.split(r"(\d+)", p)])
        slices = []
        for j, f in enumerate(files, 1):
            rel = f"{j:04d}.jpg"
            if apply:
                im = Image.open(f).convert("RGB")
                if max(im.size) > max_dim:
                    s = max_dim / max(im.size)
                    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
                im.save(os.path.join(out_dir, rel), quality=88)
            slices.append(rel)
        total += len(slices)
        stacks.append({"select": {}, "count": len(slices), "slices": slices})

    # report: pre-assigned by assign_reports() (folder-ancestry match, container-aware)
    report = None
    chosen, report_note = assigned
    if chosen:
        if apply:
            shutil.copyfile(chosen, os.path.join(out_dir, "report.pdf"))
        text_pt = extract_pdf_text(chosen)
        report = {"pdf": "report.pdf", "textPt": text_pt, "textEn": None, "aiSummary": None}

    ref = study["ref_tags"]
    provenance = {
        "reportingDoctor": str(dcm_val(ref, "PerformingPhysicianName", "") or "") or None,
        "requestingDoctor": str(dcm_val(ref, "ReferringPhysicianName", "") or "") or None,
        "facility": str(dcm_val(ref, "InstitutionName", "") or "") or None,  # NB: InstitutionAddress is unreliable
        "facilityCity": None, "facilityCountry": None,
    } if ref is not None else {"reportingDoctor": None, "requestingDoctor": None, "facility": None, "facilityCity": None, "facilityCountry": None}

    manifest = {
        "patient": name, "patientSlug": slug,
        "study": (str(dcm_val(ref, "StudyDescription", "")) if ref is not None else "") or kind.replace("-", " ").title(),
        "studySlug": web_slug, "studyInstanceUID": study["uid"],
        "date": study["date"], "modality": modality or None,
        **provenance,
        "ways": ways, "defaultSelect": ({"series": ways[0]["values"][0]["key"]} if ways else {}),
        "stacks": stacks, "report": report,
    }
    if apply:
        with open(manifest_path, "w", encoding="utf-8") as fh:
            json.dump(manifest, fh, ensure_ascii=False, indent=1)

    return {
        "web_slug": web_slug, "kind": kind, "modality": modality, "date": study["date"],
        "study_instance_uid": study["uid"], "series": len(series_ids), "file_count": total,
        "deid_us": deid_us, "report": bool(report), "report_note": report_note,
        "patient_name_dicom": study.get("patient_name") or None,
        "blob_prefix": f"scans/{web_slug}",
        "manifest_blob_key": f"scans/{web_slug}-manifest.json",
        "report_blob_key": f"scans/{web_slug}/report.pdf" if report else None,
        "jpeg_preview_prefix": f"scans/{web_slug}",
        "source_format": "DICOM" if study["kind_src"] == "dicom" else "JPEG",
        **provenance,
        "notes_seed": (report["textPt"] if report and report["textPt"] else None),
    }


build_study.seen = set()


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--slug", required=True)
    ap.add_argument("--name", default="")
    ap.add_argument("--src", required=True)
    ap.add_argument("--kind", default=None, help="override study-kind (single-study drops)")
    ap.add_argument("--deid", default="auto", choices=["us", "auto", "none"])
    ap.add_argument("--max-dim", type=int, default=1280,
                    help="longest preview edge in px; default 1280 keeps typical US/CT native so "
                         "the US de-id mask boundary stays pixel-exact (larger MIPs still cap)")
    ap.add_argument("--repo", default=os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()

    out_base = os.path.join(args.repo, "web", "scans")
    staging_dir = os.path.join(args.repo, ".staging", "imagery")

    # open source (folder or zip)
    tmp = None
    src = args.src
    if src.lower().endswith(".zip"):
        tmp = tempfile.mkdtemp(prefix="imagery-")
        with zipfile.ZipFile(src) as z:
            z.extractall(tmp)
        entries = [os.path.join(tmp, e) for e in os.listdir(tmp)]
        dirs = [e for e in entries if os.path.isdir(e)]
        src = dirs[0] if len(dirs) == 1 and not any(os.path.isfile(e) for e in entries) else tmp
    if not os.path.isdir(src):
        log(f"✗ source is not a folder: {src}")
        sys.exit(1)

    files = discover(src)
    studies, pdfs, warnings = segment(files)
    for w in warnings:
        log(f"⚠ {w}")
    if not studies:
        sys.exit(1)

    build_study.seen = set()
    descriptors = []
    report_assign = assign_reports(studies, pdfs)
    log(f"\nPatient token: {args.slug}   source: {src}")
    log(f"Detected {len(studies)} study(ies), {len(pdfs)} PDF(s). deid={args.deid}  apply={args.apply}\n")
    for st in sorted(studies, key=lambda s: (s["date"] or ""), reverse=True):
        d = build_study(st, args.slug, args.name or (st.get("patient_name") or args.slug),
                        out_base, {st["uid"]: args.kind} if args.kind else {}, report_assign[st["uid"]],
                        args.deid, args.max_dim, args.apply)
        descriptors.append(d)
        flag = ""
        if d["report_note"]:
            flag += f"  ⚠ {d['report_note']}"
        if not d["report"]:
            flag += "  ⚠ NO REPORT (imagery invariant — verify)"
        if d["patient_name_dicom"] and args.name and slugify(d["patient_name_dicom"]).find(slugify(args.name).split("-")[0]) < 0:
            flag += f"  ⚠ DICOM PatientName='{d['patient_name_dicom']}' — confirm match"
        log(f"  {d['date']}  {d['modality']:<4}  {d['web_slug']:<42} series={d['series']} imgs={d['file_count']} "
            f"deid_us={d['deid_us']} report={d['report']}{flag}")

    if args.apply:
        os.makedirs(staging_dir, exist_ok=True)
        out = os.path.join(staging_dir, f"{args.slug}-studies.json")
        with open(out, "w", encoding="utf-8") as fh:
            json.dump({"slug": args.slug, "name": args.name, "studies": descriptors}, fh, ensure_ascii=False, indent=1)
        log(f"\n✓ wrote previews + manifests under web/scans/{args.slug}-*")
        log(f"✓ descriptor -> {out}")
        log(f"→ next: node scripts/imagery/wire.mjs --studies {out} --clerk <patient-clerk> --apply")
    else:
        log("\n(dry run — re-run with --apply to write previews, manifests, and the descriptor)")

    if tmp:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    main()
