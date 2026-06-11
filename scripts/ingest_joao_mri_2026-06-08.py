#!/usr/bin/env python3
"""Ingest Joao's 3 MRIs (Face / Brain / Knee, 2026-06-08, Sirio-Libanes).

Renders previews DIRECTLY FROM DICOM PIXEL DATA (apply_voi_lut + normalize),
NOT from the CD's pre-rendered JPEGs. The CD JPEGs carry a viewer-rendered
overlay (patient name / MRN / DOB burned into the corners); the stored DICOM
pixel data is clean, so rendering from it is inherently de-identified with no
masking artifacts and no PHI. Handles 512/768/1024 series uniformly.

- One DICOM series (SeriesNumber) -> one Sequence value; instances ordered by
  InstanceNumber. Writes 512px JPEGs to web/scans/{slug}/image_sNNNN_iMMMM.jpg.
- Emits {ways,stacks,defaultSelect} manifest (live .ct-viewer contract) with the
  KEY_IMAGES series as default.
- Copies each report PDF to web/scans/{slug}-report.pdf.

Re-runnable / idempotent. Pixel data is rendered locally and never sent anywhere.
"""
import os, re, glob, json, shutil, sys
from collections import defaultdict
import numpy as np
import pydicom
from pydicom.pixel_data_handlers.util import apply_voi_lut
from PIL import Image

ROOT = "/Users/joaocreste/Claude Agent/Health WebbApp"
ING  = os.path.join(ROOT, "Patients/Joao Victor Creste/Ingestion")
SCANS = os.path.join(ROOT, "web/scans")

MAXSIDE = 512       # longest side of web preview
JPEG_Q  = 85

def render_dicom(path):
    """DICOM file -> de-identified PIL image (clean pixel data, no overlay)."""
    ds = pydicom.dcmread(path, force=True)
    arr = ds.pixel_array
    pi = str(ds.get("PhotometricInterpretation", "MONOCHROME2"))
    if arr.ndim == 3 and pi.startswith(("RGB", "YBR")):          # colour capture
        img = Image.fromarray(arr.astype("uint8")[..., :3], "RGB")
    else:
        if arr.ndim == 3:                                        # multiframe mono -> middle
            arr = arr[arr.shape[0] // 2]
        try:
            a = apply_voi_lut(arr, ds).astype(float)
        except Exception:
            a = arr.astype(float)
        if pi == "MONOCHROME1":
            a = a.max() - a
        a = a - a.min()
        a = a / (a.max() or 1) * 255.0
        img = Image.fromarray(a.astype("uint8"), "L").convert("RGB")
    if max(img.size) > MAXSIDE:
        img.thumbnail((MAXSIDE, MAXSIDE), Image.LANCZOS)
    return img

STUDIES = [
    dict(folder="MRI Face June 10 2026",  pdf="Rm De Face Ou Seios Da Face.pdf",
         slug="mri-face-2026-06-08",  studyEn="Face MRI", studyPt="RM de Face"),
    dict(folder="MRI Crane June 10 2026", pdf="Rm De Crânio Difusão.pdf",
         slug="mri-brain-2026-06-08", studyEn="Brain MRI", studyPt="RM de Cranio"),
    dict(folder="MRI Knee June 10 2026",  pdf="Rm De Joelho Unilateral.pdf",
         slug="mri-knee-2026-06-08",  studyEn="Knee MRI (left)", studyPt="RM de Joelho (esq.)"),
]

# Exact SeriesDescription -> (EN, PT) labels. Clinically faithful; PT keeps BR radiology usage.
LABELS = {
    "KEY_IMAGES": ("Key images", "Imagens-chave"),
    # Face
    "t2_tse_stir_cor": ("T2 STIR · Coronal", "T2 STIR · Coronal"),
    "t1_tse_cor": ("T1 · Coronal", "T1 · Coronal"),
    "t2_tse_stir_tra": ("T2 STIR · Axial", "T2 STIR · Axial"),
    "t1_tse_tra": ("T1 · Axial", "T1 · Axial"),
    "ep2d_diff_b50_1000_tra_p2_TRACEW": ("Diffusion · Axial", "Difusão · Axial"),
    "ep2d_diff_b50_1000_tra_p2_ADC": ("Diffusion ADC · Axial", "Difusão ADC · Axial"),
    "AXI_PERFUSAO_T1": ("T1 Perfusion · Axial", "Perfusão T1 · Axial"),
    "t1_tse_dixon_tra_p2_POS_W": ("T1 Dixon post-contrast · Axial", "T1 Dixon pós-contraste · Axial"),
    "t1_vibe_dixon_tra_p2 POS_W": ("T1 VIBE Dixon post · Axial", "T1 VIBE Dixon pós · Axial"),
    "t1_tse_dixon_cor_p2 POS_W": ("T1 Dixon post · Coronal", "T1 Dixon pós · Coronal"),
    # Brain
    "resolve_4scan-trace_tra_p2_s2_TRACEW": ("Diffusion RESOLVE · Axial", "Difusão RESOLVE · Axial"),
    "resolve_4scan-trace_tra_p2_s2_ADC": ("Diffusion ADC RESOLVE · Axial", "Difusão ADC RESOLVE · Axial"),
    "Sagital_t2_space_flair_fs": ("T2 FLAIR · Sagittal", "T2 FLAIR · Sagital"),
    "Sagital_t2_space_flair_fs_MPR_Tra": ("T2 FLAIR MPR · Axial", "T2 FLAIR MPR · Axial"),
    "Sagital_t2_space_flair_fs_MPR_Cor": ("T2 FLAIR MPR · Coronal", "T2 FLAIR MPR · Coronal"),
    "t1_se_tra": ("T1 · Axial", "T1 · Axial"),
    "t2_tse_tra_p4": ("T2 · Axial", "T2 · Axial"),
    "t2_tse_cor_fs_p4": ("T2 FS · Coronal", "T2 FS · Coronal"),
    "t2_swi_tra_p2_Mag": ("SWI Magnitude · Axial", "SWI Magnitude · Axial"),
    "t2_swi_tra_p2_Pha": ("SWI Phase · Axial", "SWI Fase · Axial"),
    "t2_swi_tra_p2_SWI": ("SWI · Axial", "SWI · Axial"),
    "t2_swi_tra_p2_SWI_mIP": ("SWI minIP · Axial", "SWI minIP · Axial"),
    "Ax_t1_vol_fs_pos": ("T1 VOL FS post · Axial", "T1 VOL FS pós · Axial"),
    "t1_se_tra_fs POS": ("T1 FS post · Axial", "T1 FS pós · Axial"),
    "t1_se_tra POS": ("T1 post · Axial", "T1 pós · Axial"),
    "SAG T1 SPACE POS": ("T1 SPACE post · Sagittal", "T1 SPACE pós · Sagital"),
    # Knee
    "pd_tse_fs_sag_p4": ("PD FS · Sagittal", "DP FS · Sagital"),
    "pd_tse_sag": ("PD · Sagittal", "DP · Sagital"),
    "pd_tse_fs_tra_p4": ("PD FS · Axial", "DP FS · Axial"),
    "COR_T2_FS": ("T2 FS · Coronal", "T2 FS · Coronal"),
    "COR_T1": ("T1 · Coronal", "T1 · Coronal"),
}

def slugify(s):
    s = s.lower().replace("·", " ")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "series"

def label_for(desc):
    if desc in LABELS:
        return LABELS[desc]
    # generic fallback: clean tokens
    return (desc.replace("_", " ").strip(), desc.replace("_", " ").strip())

def dicom_series(folder):
    """Return list of (SeriesNumber, SeriesDescription, [instance_paths]) sorted
    by SeriesNumber; instances sorted by InstanceNumber (fallback SliceLocation,
    then filename)."""
    base = os.path.join(folder, "exam")
    roots = [d for d in glob.glob(os.path.join(base, "*"))
             if os.path.isdir(d) and os.path.basename(d) != "jpeg"]
    out = []
    for r in roots:
        for sd in sorted(glob.glob(os.path.join(r, "*"))):
            if not os.path.isdir(sd):
                continue
            files = [f for f in glob.glob(os.path.join(sd, "*"))
                     if os.path.isfile(f) and os.path.basename(f) not in ("VERSION", "LOCKFILE")]
            if not files:
                continue
            keyed = []
            sn = sd_desc = None
            for f in files:
                h = pydicom.dcmread(f, stop_before_pixels=True, force=True)
                if sn is None:
                    sn = int(h.get("SeriesNumber", 0) or 0)
                    sd_desc = str(h.get("SeriesDescription", "?"))
                inst = h.get("InstanceNumber", None)
                loc = h.get("SliceLocation", None)
                keyed.append(((int(inst) if inst is not None else 1 << 30,
                               float(loc) if loc is not None else 0.0,
                               os.path.basename(f)), f))
            paths = [f for _, f in sorted(keyed)]
            out.append((sn, sd_desc, paths))
    return sorted(out, key=lambda t: t[0])

def process(study, dry=False):
    folder = os.path.join(ING, study["folder"])
    slug = study["slug"]
    outdir = os.path.join(SCANS, slug)
    dser = dicom_series(folder)
    print(f"\n=== {study['studyEn']}  ->  {slug}")
    print(f"    DICOM series: {len(dser)}")
    used_keys = {}
    values, stacks, default_key = [], [], None
    total_imgs = 0
    for i, (sn, desc, paths) in enumerate(dser, start=1):
        en, pt = label_for(desc)
        # de-dupe value keys + labels (e.g. face has t2_tse_stir_cor twice)
        base_key = slugify(en)
        cnt = used_keys.get(base_key, 0) + 1
        used_keys[base_key] = cnt
        if cnt > 1:
            key = f"{base_key}-{cnt}"
            en = f"{en} ({cnt})"
            pt = f"{pt} ({cnt})"
        else:
            key = base_key
        names = [f"image_s{i:04d}_i{j:04d}.jpg?v=2" for j in range(1, len(paths) + 1)]
        print(f"    s{sn:02d} {desc:<36} -> {en:<28} [{len(paths)} img]")
        if "KEY_IMAGES" in desc.upper():
            default_key = key
        values.append(dict(key=key, labelEn=en, labelPt=pt))
        stacks.append(dict(select={"sequence": key}, count=len(paths), slices=names,
                           _paths=paths))
        total_imgs += len(paths)
    if default_key is None and values:
        default_key = values[0]["key"]
    print(f"    total images: {total_imgs}   default: {default_key}")

    if dry:
        return total_imgs

    # render previews from DICOM pixel data (clean / de-identified)
    if os.path.isdir(outdir):
        shutil.rmtree(outdir)
    os.makedirs(outdir, exist_ok=True)
    n = 0
    for st in stacks:
        for name, src in zip(st["slices"], st.pop("_paths")):
            render_dicom(src).save(os.path.join(outdir, name), "JPEG",
                                   quality=JPEG_Q, optimize=True)
            n += 1
            if n % 300 == 0:
                print(f"      rendered {n}/{total_imgs}")
    print(f"      rendered {n}/{total_imgs} -> {outdir}")

    # report pdf
    shutil.copyfile(os.path.join(folder, study["pdf"]),
                    os.path.join(SCANS, f"{slug}-report.pdf"))

    manifest = dict(
        patient="Joao Victor Creste", patientSlug="joao-victor-creste",
        study=study["studyEn"], studyPt=study["studyPt"], studySlug=slug,
        date="2026-06-08", modality="MRI", facility="Hospital Sirio-Libanes",
        ways=[dict(key="sequence", labelEn="Sequence", labelPt="Sequencia", values=values)],
        defaultSelect={"sequence": default_key},
        stacks=stacks,
        report=dict(pdf=f"{slug}-report.pdf", textEn=None, textPt=None, aiSummaryEn=None, aiSummaryPt=None),
    )
    with open(os.path.join(SCANS, f"{slug}-manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False)
    print(f"      manifest -> {slug}-manifest.json")
    return total_imgs

if __name__ == "__main__":
    dry = "--dry" in sys.argv
    grand = 0
    for s in STUDIES:
        grand += process(s, dry=dry)
    print(f"\nGRAND TOTAL images: {grand}  (dry={dry})")
