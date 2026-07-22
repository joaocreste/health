#!/usr/bin/env python3
"""Ingest Silvana's thyroid ultrasound (2026-07-03, DMI) into web previews + manifest.

Source: DICOMDIR + IMAGES/IM0..IM9 — 10 RGB B-mode/Doppler captures from a
Toshiba TUS-A300 (one StudyInstanceUID, one series). Per the Imagery ingestion
prompt (Management Prompts/Imagery.md): a single study, no categorical "ways"
(these are discrete sonographer captures, not a volumetric slice stack), so the
viewer is one scrubber over the 10 frames.

Compliance: ultrasound frames carry a burned-in identity banner (patient name /
DOB / date / institution) ABOVE the calibrated B-mode sector. The DICOM
`SequenceOfUltrasoundRegions` gives the sector's top edge (y0); every row above
it is annotation/identity and is blacked out before the JPEG is written. No
pixel data leaves the machine and no PHI reaches the model — previews are
de-identified at write time. The clinically-relevant sector and its caliper /
measurement annotations (which sit inside/below the sector) are preserved.

Idempotent: wipes and regenerates the output preview folder + manifest on each run.
"""
import json
import os
import shutil
import sys

import numpy as np
import pydicom
from PIL import Image

SRC = "/Users/joaocreste/Downloads/US Tireoide Jul 3 2026"
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SLUG = "silvana-thyroid-us-2026-07-03"
OUT = os.path.join(REPO, "web", "scans", SLUG)                       # previews + report (folder)
MANIFEST_PATH = os.path.join(REPO, "web", "scans", SLUG + "-manifest.json")  # manifest (hyphen, at root)
REPORT_PDF = os.path.join(SRC, "US Tireoide Jul 3 2026.pdf")
QUALITY = 88

# Verbatim clinical report body (PT), library-extracted with pypdf. The top
# identity banner (name / DOB / address) is intentionally omitted — this mirrors
# the Paulo ingest, where textPt is the clinical laudo without patient identifiers.
# textEn stays null (no English original); aiSummary stays null (de-identified
# summary pass deferred to the HIPAA tier — see the compliance guardrail).
REPORT_TEXT_PT = """RELATÓRIO ULTRASSONOGRAFIA DA TIREÓIDE COM AVALIAÇÃO DOPPLER

Dados clínicos e motivo do exame: Avaliação da tireóide.

Exames anteriores: Disponível para comparação exame de 30/03/2023.

Técnica de exame: Utilizou-se transdutor linear, multifrequencial, de até 14 MHz para estudo tireoidiano e uso complementar com Doppler colorido. Paciente posicionada em decúbito dorsal, com hiperextensão cervical.

Os seguintes aspectos foram observados:
O padrão glandular é heterogêneo, identificando-se nódulos descritos a seguir:
LOBO ESQUERDO:
No terço superior, nódulo heterogêneo com calcificação medindo 0,8 x 0,7 cm (padrão III de Chammas / TI-RADS 4) (estável).
No terço inferior, nódulo hipoecoico medindo 0,7 x 0,4 cm (padrão III de Chammas / TI-RADS 3) (estável).
A tireóide apresenta contornos regulares e dimensões reduzidas.
Ao Doppler colorido a glândula apresenta vascularização habitual.

Medidas da glândula:
Lobo direito medindo 0,8 x 1,0 x 3,3 cm em seus eixos longitudinal, transversal e antero posterior respectivamente, com volume de 1,51 cm³.
Lobo esquerdo medindo 0,8 x 0,9 x 4,2 cm em seus eixos longitudinal, transversal e antero posterior respectivamente, com volume de 1,71 cm³.
O istmo mediu 1,2 x 0,8 x 0,2 cm de espessura em seus eixos transversal e antero posterior respectivamente, com volume de 0,10 cm³.
Volume total da tireoide de 3,32 cm³.
As glândulas submandibulares e parótidas apresentaram aspecto ecográfico normal.
Em relação ao exame anterior não se observam alterações ecográficas significativas.

Impressão diagnóstica: Exame ultrassonográfico evidencia tireoide de dimensões reduzidas com nódulos conforme descritos acima.

RICARDO ISSA — MÉDICO ESPECIALISTA EM RADIOLOGIA E DIAGNÓSTICO POR IMAGEM — CRM: 67417 / SP"""


def sector_top(ds):
    """Top edge (y) of the calibrated ultrasound sector; everything above is the
    burned-in identity banner. Falls back to a conservative 90px if the tag is
    absent."""
    regs = getattr(ds, "SequenceOfUltrasoundRegions", None)
    if regs:
        ys = [int(getattr(r, "RegionLocationMinY0", 10**9)) for r in regs]
        y0 = min(y for y in ys if y < 10**9)
        return max(0, y0)
    return 90


def deidentified_frame(ds):
    """RGB pixel array with the top identity banner blacked out."""
    px = ds.pixel_array  # (rows, cols, 3), already RGB (PhotometricInterpretation RGB)
    if px.ndim == 2:
        px = np.stack([px] * 3, axis=-1)
    px = px.copy()
    y0 = sector_top(ds)
    px[:y0, :, :] = 0  # mask the identity banner above the sector
    return Image.fromarray(px.astype(np.uint8), mode="RGB")


def main():
    files = [f for f in os.listdir(os.path.join(SRC, "IMAGES"))]
    # numeric InstanceNumber sort (never lexical)
    inst = []
    for f in files:
        d = pydicom.dcmread(os.path.join(SRC, "IMAGES", f), stop_before_pixels=True,
                            specific_tags=["InstanceNumber"])
        inst.append((int(getattr(d, "InstanceNumber", 0)), f))
    inst.sort()

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)

    slices = []
    for i, (_, fname) in enumerate(inst, 1):
        ds = pydicom.dcmread(os.path.join(SRC, "IMAGES", fname))
        im = deidentified_frame(ds)
        out_rel = f"{i:04d}.jpg"
        im.save(os.path.join(OUT, out_rel), quality=QUALITY)
        slices.append(out_rel)
        print(f"  {fname} -> {out_rel}  ({im.width}x{im.height}, banner masked <y{sector_top(ds)})")

    shutil.copyfile(REPORT_PDF, os.path.join(OUT, "report.pdf"))

    manifest = {
        "patient": "Silvana Aparecida Creste Dias de Souza",
        "patientSlug": "silvana",
        "study": "Thyroid ultrasound with Doppler",
        "studySlug": SLUG,
        "studyInstanceUID": "1.2.840.113663.1500.1.403154046.1.1.20260703.74005.89317",
        "accessionNumber": "89317",
        "date": "2026-07-03",
        "modality": "US",
        "facility": "DMI · Diagnóstico Médico Integrado",
        "facilityCity": "Ribeirão Preto",
        "facilityCountry": "Brazil",
        "reportingDoctor": "Dr. Ricardo Issa — CRM 67417/SP",
        "requestingDoctor": "Dr. José Roberto Chodraui",
        # No categorical axes: 10 discrete captures render as a single scrubber.
        "ways": [],
        "defaultSelect": {},
        "stacks": [
            {"select": {}, "count": len(slices), "slices": slices},
        ],
        "report": {
            "pdf": "report.pdf",
            "textPt": REPORT_TEXT_PT,
            "textEn": None,
            "aiSummary": None,
        },
    }
    with open(MANIFEST_PATH, "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=1)
    print(f"\nmanifest -> {MANIFEST_PATH}")
    print(f"{len(slices)} de-identified previews + report.pdf in {OUT}")


if __name__ == "__main__":
    main()
