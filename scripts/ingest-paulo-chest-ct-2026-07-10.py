#!/usr/bin/env python3
"""Ingest Paulo's contrast chest CT (2026-07-10, HURP) into web previews + manifest.

Source: flat DICOM export whose filenames embed 'studyUID\\seriesUID\\instanceUID.dcm'
(literal backslashes in the names). 13 series; scout (1) and dose summary (9000)
are excluded per operator decision. Ways: window x plane, per the Imagery
ingestion prompt (Management Prompts/Exam Ingestion/Imagery Ingestion Prompt.md).

Idempotent: wipes and regenerates the output preview folder on each run.
"""
import collections
import json
import os
import shutil
import sys

import numpy as np
import pydicom
from PIL import Image

SRC = "/Users/joaocreste/Downloads/TOMOGRAFIA COMPUTADORIZADA DE TÓRAX COM CONTRASTE"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "web", "scans", "paulo-chest-ct-2026-07-10")
REPORT_PDF = os.path.join(SRC, "TOMOGRAFIA COMPUTADORIZADA DE TÓRAX COM CONTRASTE.pdf")
MAX_DIM = 640
QUALITY = 80

# SeriesNumber -> (window value, plane value)
SERIES_MAP = {
    3: ("mediastino-fino", "axi"),
    4: ("mediastino", "axi"),
    5: ("mediastino", "cor"),
    6: ("mediastino", "sag"),
    7: ("pulmao-fino", "axi"),
    8: ("pulmao", "axi"),
    9: ("pulmao", "cor"),
    10: ("pulmao", "sag"),
    11: ("mip", "axi"),
    12: ("mip", "cor"),
    13: ("mip", "sag"),
}  # 1 (scout) and 9000 (dose summary) intentionally absent

REPORT_TEXT_PT = """TOMOGRAFIA COMPUTADORIZADA DE TÓRAX COM CONTRASTE

TÉCNICA: Realizado estudo do tórax em aparelho de tomografia computadorizada, com imagens obtidas após a administração endovenosa de meio de contraste iodado.

DESCRIÇÃO:
PARTES MOLES: sem alterações.
ARCABOUÇO ÓSSEO: Alterações degenerativas da coluna vertebral.
BRÔNQUIOS: Brônquios com paredes espessadas bilateralmente.
TRAMA VASCULAR PULMONAR: aspecto habitual.
PARÊNQUIMA PULMONAR: Micronódulo pulmonar em segmento X esquerdo, medindo 3 mm, inespecífico.
CAVIDADES PLEURAIS: sem derrames ou espessamentos.
ESTRUTURAS CARDIOVASCULARES: Ateromatose aórtica, supra-aórtica e coronariana.
MEDIASTINO: sem linfonodopatias ou massas.
Pequena hérnia diafragmática posterior à esquerda, contendo gordura.

CONCLUSÃO:
Broncopatia.
Micronódulo pulmonar esquerdo inespecífico.
Demais achados vide descrição.

GREGORY MARTINS GARCIA — CRM: 184406
HURP - Hospital Unimed Ribeirão Preto · Centro de Diagnóstico por Imagem"""


def window_image(ds):
    px = ds.pixel_array.astype(np.float32)
    px = px * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
    wc, ww = ds.get("WindowCenter"), ds.get("WindowWidth")
    wc = float(wc[0] if hasattr(wc, "__iter__") else wc)
    ww = float(ww[0] if hasattr(ww, "__iter__") else ww)
    lo, hi = wc - ww / 2.0, wc + ww / 2.0
    img = np.clip((px - lo) / (hi - lo), 0, 1) * 255
    return Image.fromarray(img.astype(np.uint8))


def target_size(ds):
    """True-aspect target from PixelSpacing (reformats have non-square physical extents)."""
    rows, cols = int(ds.Rows), int(ds.Columns)
    ps = ds.get("PixelSpacing")
    rh = float(ps[0]) if ps else 1.0
    cw = float(ps[1]) if ps else 1.0
    h_phys, w_phys = rows * rh, cols * cw
    scale = MAX_DIM / max(h_phys, w_phys)
    return (max(1, round(w_phys * scale)), max(1, round(h_phys * scale)))


def main():
    files = [f for f in os.listdir(SRC) if f.endswith(".dcm")]
    by_series_num = collections.defaultdict(list)
    for f in files:
        d = pydicom.dcmread(os.path.join(SRC, f), stop_before_pixels=True,
                            specific_tags=["SeriesNumber", "InstanceNumber"])
        by_series_num[int(d.SeriesNumber)].append((int(d.get("InstanceNumber", 0)), f))

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    stacks = []
    for snum, (win, plane) in sorted(SERIES_MAP.items()):
        inst = sorted(by_series_num.get(snum, []))  # numeric InstanceNumber sort
        if not inst:
            print(f"WARN: series {snum} empty", file=sys.stderr)
            continue
        rel = f"window-{win}/plane-{plane}"
        os.makedirs(os.path.join(OUT, rel), exist_ok=True)
        slices = []
        for i, (_, fname) in enumerate(inst, 1):
            ds = pydicom.dcmread(os.path.join(SRC, fname))
            im = window_image(ds).resize(target_size(ds), Image.LANCZOS)
            out_rel = f"{rel}/{i:04d}.jpg"
            im.save(os.path.join(OUT, out_rel), quality=QUALITY)
            slices.append(out_rel)
        stacks.append({"select": {"window": win, "plane": plane}, "count": len(slices), "slices": slices})
        print(f"series {snum} -> {rel}: {len(slices)} slices")

    shutil.copyfile(REPORT_PDF, os.path.join(OUT, "report.pdf"))

    manifest = {
        "patient": "Paulo Augusto Silotto Dias de Souza",
        "patientSlug": "paulo-silotto",
        "study": "Chest CT with contrast",
        "studySlug": "paulo-chest-ct-2026-07-10",
        "studyInstanceUID": "1.2.826.0.1.3680043.2.951.1905435",
        "accessionNumber": "1056973",
        "date": "2026-07-10",
        "modality": "CT",
        "facility": "HURP — Hospital Unimed Ribeirão Preto · Centro de Diagnóstico por Imagem",
        "facilityCity": "Ribeirão Preto",
        "facilityCountry": "Brazil",
        "reportingDoctor": "Gregory Martins Garcia — CRM 184406",
        "requestingDoctor": "Helton de Oliveira Couto",
        "ways": [
            {
                "key": "window", "labelEn": "Window", "labelPt": "Janela", "control": "segmented",
                "values": [
                    {"key": "mediastino", "labelEn": "Mediastinal", "labelPt": "Mediastino"},
                    {"key": "pulmao", "labelEn": "Lung", "labelPt": "Pulmão"},
                    {"key": "mip", "labelEn": "MIP", "labelPt": "MIP"},
                    {"key": "mediastino-fino", "labelEn": "Mediastinal 1 mm", "labelPt": "Mediastino 1 mm"},
                    {"key": "pulmao-fino", "labelEn": "Lung 1 mm", "labelPt": "Pulmão 1 mm"},
                ],
            },
            {
                "key": "plane", "labelEn": "Plane", "labelPt": "Plano", "control": "segmented",
                "values": [
                    {"key": "axi", "labelEn": "Axial", "labelPt": "Axial"},
                    {"key": "cor", "labelEn": "Coronal", "labelPt": "Coronal"},
                    {"key": "sag", "labelEn": "Sagittal", "labelPt": "Sagital"},
                ],
            },
        ],
        "defaultSelect": {"window": "pulmao", "plane": "axi"},
        "stacks": stacks,
        "report": {
            "pdf": "report.pdf",
            "textPt": REPORT_TEXT_PT,
            "textEn": None,
            "aiSummary": None,
        },
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    total = sum(s["count"] for s in stacks)
    print(f"manifest written; {total} preview slices in {OUT}")


if __name__ == "__main__":
    main()
