#!/usr/bin/env python3
"""
Ingest John Smith Jr imaging studies into the generic manifest-driven viewer.

John Smith Jr (pending:john-smith-jr-dbef5f) is a generic DB-driven (Class C)
patient: renderExams() in patient-context.js already builds a .ct-viewer from
each imaging_studies row's manifest_blob_key. So the deliverable per study is:
  - PHI-masked, instance-ordered JPEG previews under
      web/scans/john-smith-jr-{studySlug}/{seriesKey}/NNNN.jpg
  - a ways/stacks manifest.json the .ct-viewer reads
  - an anonymized report (clean PDF regenerated from de-identified text + textPt)
and (separate node step) an imaging_studies row.

PHI handling: every source slice carries burned-in identifiers in the top
corners (patient name top-left, facility/doctor top-right). We mask both top
corners with black rectangles, preserving the centered anatomy and the
non-identifying technical overlay (plane / sequence / position). Report text is
name-swapped to "John Smith Jr" and DOB / prontuário / accession lines dropped;
the served PDF is REGENERATED from the clean text so no original-PDF PHI ships.

Usage:
  python3 scripts/ingest_john_imagery.py --studies lumbar          # the comparative pair
  python3 scripts/ingest_john_imagery.py --studies lumbar --apply  # actually write previews
"""
import argparse, json, os, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC_ROOT = ROOT / "Patients" / "Johh Smith Jr" / "Imagery"
WEB_SCANS = ROOT / "web" / "scans"
PATIENT = "John Smith Jr"
PATIENT_SLUG = "john-smith-jr"

# Top-corner masks (512x512 slices): left box covers name/age/prontuario/
# accession; right box covers facility/doctor/date. Center gap preserves midline
# sagittal anatomy; technical overlay below y~90 (plane/sequence) is kept.
MASK_LEFT = (0, 0, 215, 90)
MASK_RIGHT = (300, 0, 512, 82)

def sh(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(f"cmd failed: {' '.join(str(c) for c in cmd)}\n{r.stderr[:500]}")
    return r.stdout

def instance_num(p: Path):
    m = re.search(r"_i(\d+)", p.name)
    return int(m.group(1)) if m else 0

def anonymize(text: str) -> str:
    names = [
        "Joao Victor Creste Dias De Souza", "Joao Victor Creste Dias de Souza",
        "João Victor Creste Dias De Souza", "João Victor Creste Dias de Souza",
        "Joao V C D Souza", "João V C D Souza",
        "Victor Creste Dias De Souza", "Victor Creste Dias de Souza",
        "Joao Victor Creste", "João Victor Creste", "Joao Creste", "João Creste",
    ]
    for n in names:
        text = re.sub(re.escape(n), "John Smith Jr", text, flags=re.IGNORECASE)
    text = re.sub(r"\bJo[ãa]o\b", "John", text)
    out = []
    for line in text.splitlines():
        low = line.lower()
        if any(k in low for k in ("data de nascimento", "nome:", "prontu", "º aces", "nº aces",
                                  "nº aces", "an:", "atendimento:", "sexo:")):
            continue
        out.append(line.rstrip())
    # collapse blank runs
    cleaned, blank = [], False
    for line in out:
        if not line.strip():
            if blank:
                continue
            blank = True
        else:
            blank = False
        cleaned.append(line)
    return "\n".join(cleaned).strip()

def extract_report_text(pdf: Path) -> str:
    return sh(["pdftotext", "-layout", str(pdf), "-"])

def make_clean_pdf(text: str, out_pdf: Path, title: str):
    body = (title + "\n\n" + text).replace("\\", " ")
    tmp = out_pdf.with_suffix(".txt")
    tmp.write_text(body, encoding="utf-8")
    # Render de-identified text to a clean multi-page PDF (no original-PDF PHI).
    sh(["magick", "-size", "1200x", "-background", "white", "-fill", "#12303a",
        "-font", "Helvetica", "-pointsize", "22", "-density", "150",
        f"caption:@{tmp}", "-bordercolor", "white", "-border", "48", str(out_pdf)])
    tmp.unlink(missing_ok=True)

def process_study(cfg, apply):
    study_slug = cfg["studySlug"]
    src_dir = SRC_ROOT / cfg["srcFolder"] / cfg["srcSub"]
    web_dir = WEB_SCANS / f"{PATIENT_SLUG}-{study_slug}"
    files = sorted(src_dir.glob("*.jpg"))
    by_series = {}
    for f in files:
        m = re.search(r"image_(s\d+)_", f.name)
        if m:
            by_series.setdefault(m.group(1), []).append(f)

    stacks, way_values = [], []
    print(f"\n== {cfg['study']} ({study_slug}) ==")
    for sv in cfg["series"]:
        raw = sv["raw"]
        slist = sorted(by_series.get(raw, []), key=instance_num)
        if sv.get("exclude"):
            print(f"   - {raw:8} EXCLUDED ({sv['label_en']}) [{len(slist)} imgs]")
            continue
        if not slist:
            print(f"   ! {raw:8} MISSING")
            continue
        key = sv["key"]
        # subsample very dense series if requested (kept full unless 'every' set)
        every = sv.get("every", 1)
        chosen = slist[::every]
        out_series = web_dir / key
        rel_slices = []
        if apply:
            if out_series.exists():
                shutil.rmtree(out_series)
            out_series.mkdir(parents=True, exist_ok=True)
            for i, s in enumerate(chosen, 1):
                shutil.copy2(s, out_series / f"{i:04d}.jpg")
            # batch-mask the whole folder in one mogrify call
            sh(["magick", "mogrify", "-fill", "black",
                "-draw", f"rectangle {MASK_LEFT[0]},{MASK_LEFT[1]} {MASK_LEFT[2]},{MASK_LEFT[3]}",
                "-draw", f"rectangle {MASK_RIGHT[0]},{MASK_RIGHT[1]} {MASK_RIGHT[2]},{MASK_RIGHT[3]}",
                str(out_series / "*.jpg")])
        rel_slices = [f"{key}/{i:04d}.jpg" for i in range(1, len(chosen) + 1)]
        stacks.append({"select": {"series": key}, "count": len(chosen), "slices": rel_slices})
        way_values.append({"key": key, "labelEn": sv["label_en"], "labelPt": sv["label_pt"]})
        note = f" (every {every})" if every > 1 else ""
        print(f"   + {raw:8} -> {key:14} {len(chosen):4} slices{note}  {sv['label_en']}")

    # report: extract -> anonymize -> clean PDF + textPt
    report_src = SRC_ROOT / cfg["srcFolder"] / cfg["reportFile"]
    raw_text = extract_report_text(report_src)
    clean_text = anonymize(raw_text)
    report_rel = "report.pdf"
    if apply:
        web_dir.mkdir(parents=True, exist_ok=True)
        make_clean_pdf(clean_text, web_dir / report_rel,
                       f"{cfg['study']} — {cfg['date']}")

    manifest = {
        "patient": PATIENT, "patientSlug": PATIENT_SLUG,
        "study": cfg["study"], "studySlug": study_slug,
        "date": cfg["date"], "modality": cfg["modality"],
        "facility": cfg.get("facility"), "facilityCity": cfg.get("facilityCity"),
        "facilityCountry": cfg.get("facilityCountry"),
        "reportingDoctor": cfg.get("reportingDoctor"),
        "requestingDoctor": cfg.get("requestingDoctor"),
        "ways": [{"key": "series", "labelEn": "Series", "labelPt": "Série", "values": way_values}],
        "defaultSelect": {"series": cfg.get("default") or (way_values[0]["key"] if way_values else None)},
        "stacks": stacks,
        "report": {"match": None, "pdf": report_rel, "textEn": None,
                   "textPt": clean_text, "aiSummary": None},
    }
    if apply:
        # manifest is a flat sibling named "<folder>-manifest.json" (the renderer
        # derives the preview prefix by stripping that suffix). See renderImagingStudy.
        manifest_path = WEB_SCANS / f"{PATIENT_SLUG}-{study_slug}-manifest.json"
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"   manifest: {manifest_path}")
    print(f"   report:   {len(clean_text)} chars textPt (anonymized)")
    return manifest


STUDY_SETS = {
    "lumbar": [
        {
            "study": "TC lombar (comparativo)", "studySlug": "tc-lumbar-spine-2024-10-29",
            "srcFolder": "TC lumbar spine 29 10 2024", "srcSub": "jpeg",
            "reportFile": "Report.pdf", "modality": "CT", "date": "2024-10-29",
            "facility": "Rede D'Or Sao Luiz - Vila Nova Star", "facilityCity": "Sao Paulo",
            "facilityCountry": "Brazil", "requestingDoctor": "Fausto Santana Celestino",
            "reportingDoctor": None, "default": "sag",
            "series": [
                {"raw": "s0004", "key": "sag", "label_en": "Sagittal (reformat)", "label_pt": "Sagital (reformatado)"},
                {"raw": "s0003", "key": "cor", "label_en": "Coronal (reformat)", "label_pt": "Coronal (reformatado)"},
                {"raw": "s0001", "key": "ax-bone", "label_en": "Axial - bone window", "label_pt": "Axial - janela ossea"},
                {"raw": "s0002", "key": "ax-soft", "label_en": "Axial - soft tissue", "label_pt": "Axial - partes moles"},
                {"raw": "s0005", "key": "dose", "label_en": "Dose report", "label_pt": "Relatorio de dose", "exclude": True},
                {"raw": "s0006", "key": "scout", "label_en": "Scout", "label_pt": "Localizador", "exclude": True},
            ],
        },
        {
            "study": "RM lombar (comparativo)", "studySlug": "mri-lumbar-spine-2024-10-29",
            "srcFolder": "MRI lumbar spine 29 10 2024", "srcSub": "images",
            "reportFile": "report.pdf", "modality": "MRI", "date": "2024-10-29",
            "facility": "Rede D'Or Sao Luiz - Vila Nova Star", "facilityCity": "Sao Paulo",
            "facilityCountry": "Brazil", "requestingDoctor": "Fausto Santana Celestino",
            "reportingDoctor": None, "default": "sag-t2",
            "series": [
                {"raw": "s0002", "key": "sag-t1", "label_en": "Sagittal T1", "label_pt": "Sagital T1"},
                {"raw": "s0003", "key": "sag-t2", "label_en": "Sagittal T2", "label_pt": "Sagital T2"},
                {"raw": "s0004", "key": "sag-t2fs", "label_en": "Sagittal T2 FS", "label_pt": "Sagital T2 FAT"},
                {"raw": "s0001", "key": "cor-stir", "label_en": "Coronal STIR", "label_pt": "Coronal STIR"},
                {"raw": "s0005", "key": "ax-t2-sup", "label_en": "Axial T2 (upper)", "label_pt": "Axial T2 (superior)"},
                {"raw": "s0006", "key": "ax-t2-inf", "label_en": "Axial T2 (lower)", "label_pt": "Axial T2 (inferior)"},
                {"raw": "s0007", "key": "ax-t1-inf", "label_en": "Axial T1 (lower)", "label_pt": "Axial T1 (inferior)"},
                {"raw": "s0008", "key": "key", "label_en": "Key images", "label_pt": "Imagens-chave"},
            ],
        },
    ],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--studies", default="lumbar")
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    cfgs = STUDY_SETS[args.studies]
    manifests = [process_study(c, args.apply) for c in cfgs]
    if not args.apply:
        print("\n(dry run - no files written. Re-run with --apply.)")
    else:
        print("\nDONE. Previews + manifests written. Next: create imaging_studies rows.")

if __name__ == "__main__":
    main()
