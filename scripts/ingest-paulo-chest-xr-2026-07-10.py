#!/usr/bin/env python3
"""Ingest Paulo's 2-view chest X-ray (2026-07-10, HURP) into web previews + manifest.

Source: 2 DX DICOM instances (PA + lateral) + report PDF, same flat export
pattern as the same-day contrast CT (filenames embed studyUID\\seriesUID\\
instanceUID.dcm). One way: view = pa / lateral, each a count-1 stack.
Idempotent: wipes and regenerates the output folder on each run.
"""
import json
import os
import shutil

import numpy as np
import pydicom
from PIL import Image

SRC = "/Users/joaocreste/Downloads/RX Torax"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(REPO, "web", "scans", "paulo-chest-xr-2026-07-10")
REPORT_PDF = os.path.join(SRC, "1.2.826.0.1.3680043.2.951.1905436.pdf")
MAX_DIM = 1600  # radiographs reward resolution; only 2 images so size is cheap
QUALITY = 85

REPORT_TEXT_PT = """RADIOGRAFIA DO TÓRAX

Arcos costais visualizados íntegros.
Hilos e trama vascular pulmonar normais.
Mediastino centrado, sem evidências de alargamentos.
Parênquima pulmonar sem áreas de opacidades, consolidações ou nódulos.
Cúpulas e seios costofrênicos livres.
Aorta de morfologia, dimensões e topografia normais.
Área cardíaca mostrando índice cardiotorácico dentro da normalidade.

I.D.: Tórax radiologicamente normal.

RENATO CAMPOS SOARES DE FARIA — CRM: 82077
HURP - Hospital Unimed Ribeirão Preto · Centro de Diagnóstico por Imagem"""


def render(ds):
    px = ds.pixel_array.astype(np.float32)
    px = px * float(getattr(ds, "RescaleSlope", 1)) + float(getattr(ds, "RescaleIntercept", 0))
    wc, ww = ds.get("WindowCenter"), ds.get("WindowWidth")
    wc = float(wc[0] if hasattr(wc, "__iter__") else wc)
    ww = float(ww[0] if hasattr(ww, "__iter__") else ww)
    lo, hi = wc - ww / 2.0, wc + ww / 2.0
    img = np.clip((px - lo) / (hi - lo), 0, 1)
    if str(ds.get("PhotometricInterpretation", "")) == "MONOCHROME1":
        img = 1.0 - img
    im = Image.fromarray((img * 255).astype(np.uint8))
    scale = MAX_DIM / max(im.size)
    return im.resize((round(im.size[0] * scale), round(im.size[1] * scale)), Image.LANCZOS)


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    stacks = []
    for f in os.listdir(SRC):
        if not f.endswith(".dcm"):
            continue
        ds = pydicom.dcmread(os.path.join(SRC, f))
        view = "pa" if str(ds.get("ViewPosition", "")).upper() == "PA" else "lateral"
        rel = f"view-{view}"
        os.makedirs(os.path.join(OUT, rel), exist_ok=True)
        render(ds).save(os.path.join(OUT, rel, "0001.jpg"), quality=QUALITY)
        stacks.append({"select": {"view": view}, "count": 1, "slices": [f"{rel}/0001.jpg"]})
        print(f"{view}: {ds.Rows}x{ds.Columns} -> {rel}/0001.jpg")
    stacks.sort(key=lambda s: 0 if s["select"]["view"] == "pa" else 1)

    shutil.copyfile(REPORT_PDF, os.path.join(OUT, "report.pdf"))

    manifest = {
        "patient": "Paulo Augusto Silotto Dias de Souza",
        "patientSlug": "paulo-silotto",
        "study": "Chest X-ray (2 views)",
        "studySlug": "paulo-chest-xr-2026-07-10",
        "studyInstanceUID": "1.2.826.0.1.3680043.2.951.1905436",
        "accessionNumber": "1056974",
        "date": "2026-07-10",
        "modality": "XR",
        "facility": "HURP — Hospital Unimed Ribeirão Preto · Centro de Diagnóstico por Imagem",
        "facilityCity": "Ribeirão Preto",
        "facilityCountry": "Brazil",
        "reportingDoctor": "Renato Campos Soares de Faria — CRM 82077",
        "requestingDoctor": "Helton de Oliveira Couto",
        "ways": [
            {
                "key": "view", "labelEn": "View", "labelPt": "Incidência", "control": "segmented",
                "values": [
                    {"key": "pa", "labelEn": "PA", "labelPt": "PA"},
                    {"key": "lateral", "labelEn": "Lateral", "labelPt": "Perfil"},
                ],
            },
        ],
        "defaultSelect": {"view": "pa"},
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
    print("manifest written:", OUT)


if __name__ == "__main__":
    main()
