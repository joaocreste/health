#!/usr/bin/env python3
"""
Build web previews + ways/stacks manifests for Maria Regina Coury's imaging.

Studies (operator-confirmed, Reading A — 4 studies):
  1. Lumbar spine MRI   (MR, 2026-05-14)  -> jpeg previews already exist (CD export)
  2. Thigh/femur MRI    (MR, 2026-05-14)  -> jpeg previews already exist
  3. Cardiac CT         (CT, 2025-01-21)  -> calcium score + coronary-CTA key imgs,
                                             rendered from DICOM (no CD jpegs)
  4. Echocardiogram     (US, 2025-01-21)  -> report-only, no images

Output (matches the existing tc-heart generic pipeline):
  web/scans/{patientSlug}-{studySlug}/...           preview jpegs + report.pdf
  web/scans/{patientSlug}-{studySlug}-manifest.json ways/stacks manifest

Compliance: structure + DICOM tags only; pixel data is copied/rendered by this
script, never read into a model context. CT secondary-capture key images may carry
burned-in identifiers — flagged in the summary for review/cropping.
"""
import os, re, json, shutil, glob
import pydicom
from pydicom.pixels import apply_voi_lut
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "Patients", "Maria Regina Coury")
OUT = os.path.join(ROOT, "web", "scans")
PSLUG = "maria-regina-coury"
PNAME = "Maria Regina Coury"

# jpeg-series-number -> bilingual label, derived from DICOM SeriesDescription
# (jpeg series are renumbered 0001.. in ascending DICOM SeriesNumber order;
# counts verified to match 1:1).
LOMBAR_LABELS = {
    "0001": ("Coronal T2", "Coronal T2"),
    "0002": ("Coronal T2 (fat-sat)", "Coronal T2 (sat. gordura)"),
    "0003": ("Sagittal T2", "Sagital T2"),
    "0004": ("Sagittal T1", "Sagital T1"),
    "0005": ("Sagittal STIR", "Sagital STIR"),
    "0006": ("Axial T2 (a)", "Axial T2 (a)"),
    "0007": ("Axial T2 (b)", "Axial T2 (b)"),
    "0008": ("Axial T1", "Axial T1"),
    "0009": ("Key images", "Imagens-chave"),
}
COXA_LABELS = {
    "0001": ("Coronal T1", "Coronal T1"),
    "0002": ("Coronal STIR", "Coronal STIR"),
    "0003": ("Axial T1", "Axial T1"),
    "0004": ("Sagittal STIR", "Sagital STIR"),
    "0005": ("Axial T2", "Axial T2"),
    "0006": ("Axial STIR", "Axial STIR"),
    "0007": ("Key images", "Imagens-chave"),
}

def fresh(d):
    if os.path.isdir(d): shutil.rmtree(d)
    os.makedirs(d, exist_ok=True)

def write_manifest(slug, manifest):
    p = os.path.join(OUT, f"{PSLUG}-{slug}-manifest.json")
    with open(p, "w") as f: json.dump(manifest, f, ensure_ascii=False, indent=2)
    return p

def build_mri(slug, src_subdir, study_en, study_pt, labels, report_src, body, default_series):
    src_jpeg = os.path.join(SRC, src_subdir, "exam", "jpeg")
    dest = os.path.join(OUT, f"{PSLUG}-{slug}")
    fresh(dest)
    files = [f for f in os.listdir(src_jpeg) if f.startswith("image_s")]
    by_series = {}
    for f in files:
        m = re.match(r"image_s(\d+)_i(\d+)\.jpg", f)
        if not m: continue
        by_series.setdefault(m.group(1), []).append((int(m.group(2)), f))
    ways_values, stacks = [], []
    for sn in sorted(by_series):
        items = sorted(by_series[sn], key=lambda t: t[0])  # numeric instance sort
        slices = []
        for idx, (_, fn) in enumerate(items, 1):
            shutil.copy2(os.path.join(src_jpeg, fn), os.path.join(dest, fn))
            slices.append(fn)
        en, pt = labels.get(sn, (f"Series {sn}", f"Série {sn}"))
        ways_values.append({"key": sn, "labelEn": en, "labelPt": pt})
        stacks.append({"select": {"series": sn}, "count": len(slices), "slices": slices})
    # report
    report = None
    if report_src and os.path.exists(report_src):
        shutil.copy2(report_src, os.path.join(dest, "report.pdf"))
        report = {"match": {}, "pdf": "report.pdf", "textEn": None, "textPt": None, "aiSummary": None}
    manifest = {
        "patient": PNAME, "patientSlug": PSLUG,
        "study": study_en, "studyPt": study_pt, "studySlug": slug,
        "date": "2026-05-14", "modality": "MRI", "facility": None,
        "reportingDoctor": None, "requestingDoctor": None,
        "ways": [{"key": "series", "labelEn": "Series", "labelPt": "Série", "values": ways_values}],
        "defaultSelect": {"series": default_series},
        "stacks": stacks,
    }
    if report: manifest["report"] = report
    write_manifest(slug, manifest)
    total = sum(s["count"] for s in stacks)
    return {"slug": slug, "series": len(stacks), "images": total, "report": bool(report)}

def dicom_to_jpeg(ds, path):
    arr = ds.pixel_array
    if arr.ndim == 3 and arr.shape[-1] in (3, 4):  # RGB secondary capture
        Image.fromarray(arr[..., :3].astype(np.uint8)).save(path, quality=88)
        return
    arr = arr.astype(np.float32)
    slope = float(getattr(ds, "RescaleSlope", 1) or 1)
    inter = float(getattr(ds, "RescaleIntercept", 0) or 0)
    arr = arr * slope + inter
    wc, ww = getattr(ds, "WindowCenter", None), getattr(ds, "WindowWidth", None)
    try:
        if isinstance(wc, pydicom.multival.MultiValue): wc = wc[0]
        if isinstance(ww, pydicom.multival.MultiValue): ww = ww[0]
        wc, ww = float(wc), float(ww)
    except Exception:
        wc = ww = None
    if not wc or not ww:
        lo, hi = np.percentile(arr, 1), np.percentile(arr, 99)
    else:
        lo, hi = wc - ww / 2, wc + ww / 2
    arr = np.clip((arr - lo) / max(hi - lo, 1), 0, 1) * 255
    Image.fromarray(arr.astype(np.uint8)).save(path, quality=88)

def build_cardiac_ct():
    slug = "coronary-ct-2025-01-21"
    dest = os.path.join(OUT, f"{PSLUG}-{slug}")
    fresh(dest)
    roots = [os.path.join(SRC, "Heart", "Calcium Score"),
             os.path.join(SRC, "Imagery", "Angiotomo Coronaria")]
    # collect DICOM by SeriesNumber, with InstanceNumber for ordering
    series = {}
    for root in roots:
        for p in glob.glob(os.path.join(root, "*")):
            if p.lower().endswith((".pdf", ".jpg", ".jpeg", ".png", ".txt")): continue
            try: ds = pydicom.dcmread(p, force=True)
            except Exception: continue
            if not getattr(ds, "StudyInstanceUID", None): continue
            sn = str(getattr(ds, "SeriesNumber", "?"))
            inst = int(getattr(ds, "InstanceNumber", 0) or 0)
            series.setdefault(sn, []).append((inst, p))
    LABELS = {"2": ("Calcium score", "Escore de cálcio"),
              "500": ("Coronary CTA (key images)", "Angio-TC coronária (imagens)")}
    ways_values, stacks = [], []
    for sn in sorted(series, key=lambda x: int(x)):
        items = sorted(series[sn], key=lambda t: t[0])
        slices = []
        for idx, (_, p) in enumerate(items, 1):
            fn = f"s{int(sn):03d}_{idx:04d}.jpg"
            try:
                dicom_to_jpeg(pydicom.dcmread(p, force=True), os.path.join(dest, fn))
                slices.append(fn)
            except Exception as e:
                print(f"   ! render fail {os.path.basename(p)}: {e}")
        if not slices: continue
        en, pt = LABELS.get(sn, (f"Series {sn}", f"Série {sn}"))
        ways_values.append({"key": sn, "labelEn": en, "labelPt": pt})
        stacks.append({"select": {"series": sn}, "count": len(slices), "slices": slices})
    manifest = {
        "patient": PNAME, "patientSlug": PSLUG,
        "study": "Cardiac CT — coronary calcium score + CT angiography",
        "studyPt": "TC cardíaca — escore de cálcio + angio-TC coronária",
        "studySlug": slug, "date": "2025-01-21", "modality": "CT",
        "facility": None, "reportingDoctor": None, "requestingDoctor": None,
        "ways": [{"key": "series", "labelEn": "Series", "labelPt": "Série", "values": ways_values}],
        "defaultSelect": {"series": "2"},
        "stacks": stacks,
        "notes": "Coronary-CTA folder held only 4 secondary-capture key images; full angiographic volume not in this export.",
    }
    write_manifest(slug, manifest)
    return {"slug": slug, "series": len(stacks), "images": sum(s["count"] for s in stacks), "report": False}

def build_echo():
    slug = "echocardiogram-2025-01-21"
    dest = os.path.join(OUT, f"{PSLUG}-{slug}")
    fresh(dest)
    rep = os.path.join(SRC, "Imagery", "Angiotomo Coronaria", "ECOCARDIOGRAMA TRANSTORÁCICO.pdf")
    has = os.path.exists(rep)
    if has: shutil.copy2(rep, os.path.join(dest, "report.pdf"))
    manifest = {
        "patient": PNAME, "patientSlug": PSLUG,
        "study": "Transthoracic echocardiogram", "studyPt": "Ecocardiograma transtorácico",
        "studySlug": slug, "date": "2025-01-21", "modality": "ultrasound",
        "facility": None, "reportingDoctor": None, "requestingDoctor": None,
        "ways": [], "stacks": [],
        "report": {"match": {}, "pdf": "report.pdf", "textEn": None, "textPt": None, "aiSummary": None} if has else None,
        "notes": "Report-only study (no image series in this export).",
    }
    write_manifest(slug, manifest)
    return {"slug": slug, "series": 0, "images": 0, "report": has}

if __name__ == "__main__":
    results = []
    results.append(build_mri("lumbar-mri-2026-05-14", "Imagery/Lombar MRI May 2026",
        "Lumbar spine MRI", "RM da coluna lombar", LOMBAR_LABELS,
        os.path.join(SRC, "Imagery", "Lombar MRI May 2026", "Rm De Coluna Lombar.pdf"),
        "lumbar_spine", "0003"))
    results.append(build_mri("femur-mri-2026-05-14", "Imagery/Coxa MRI May 2026",
        "Thigh / femur MRI", "RM de coxa / fêmur", COXA_LABELS,
        os.path.join(SRC, "Imagery", "Coxa MRI May 2026", "Rm De Coxa Ou Fêmur Unilateral.pdf"),
        "thigh", "0003"))
    results.append(build_cardiac_ct())
    results.append(build_echo())
    print("\n== Imaging build summary ==")
    for r in results:
        print(f"  {r['slug']}: {r['series']} series, {r['images']} images, report={r['report']}")
