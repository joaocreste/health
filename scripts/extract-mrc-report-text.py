#!/usr/bin/env python3
"""
Extract each imaging study's radiology report text (library-side, de-identified)
and store it in the manifest's report.textPt + reportingDoctor, so the viewer can
render the doctor's report below the study. Patient identifiers are stripped;
clinical text + reporting physician are kept. Preserves aiFinding. No model pass.
"""
import re, json, os
from pypdf import PdfReader

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCANS = os.path.join(ROOT, "web", "scans")
SRC = os.path.join(ROOT, "Patients", "Maria Regina Coury")

STUDIES = {
  "maria-regina-coury-lumbar-mri-2026-05-14": {
    "pdf": os.path.join(SRC, "Imagery", "Lombar MRI May 2026", "Rm De Coluna Lombar.pdf"),
    "start": r"(?is)(t[ée]cnica\s*:)", "end": r"(?is)(preliminar por|aprovado por|validado)",
  },
  "maria-regina-coury-femur-mri-2026-05-14": {
    "pdf": os.path.join(SRC, "Imagery", "Coxa MRI May 2026", "Rm De Coxa Ou Fêmur Unilateral.pdf"),
    "start": r"(?is)(t[ée]cnica\s*:)", "end": r"(?is)(preliminar por|aprovado por|validado)",
  },
  "maria-regina-coury-echocardiogram-2025-01-21": {
    "pdf": os.path.join(SRC, "Imagery", "Angiotomo Coronaria", "ECOCARDIOGRAMA TRANSTORÁCICO.pdf"),
    "start": r"(?is)(par[âa]metros estruturais)", "end": r"(?is)(\bav\.|fone:)",
  },
}

def deident(t):
    t = re.sub(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b", "", t)              # CPF
    t = re.sub(r"(?i)\b(maria|regina|coury|souza|silotto|dias)\b", "", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"\n{3,}", "\n\n", t)
    return t.strip(" -·\n")

def reporting_doctor(full):
    m = re.search(r"(?is)aprovado por:\s*Dr\.?\(?a?\)?\s*([A-Za-zÀ-ÿ .]+?)\s*-\s*CRM[/\s]*[A-Z]*\s*\d+", full)
    if m: return "Dr(a). " + m.group(1).strip()
    m = re.search(r"([A-ZÀ-Ý][A-ZÀ-Ý ]{6,})\s*CRM:\s*\d+", full)  # echo: NAME CRM: ####
    if m: return "Dr(a). " + m.group(1).strip().title()
    return None

for slug, cfg in STUDIES.items():
    txt = "\n".join((pg.extract_text() or "") for pg in PdfReader(cfg["pdf"]).pages)
    s = re.search(cfg["start"], txt)
    spos = s.start() if s else 0
    rest = txt[spos:]
    e = re.search(cfg["end"], rest)
    body = rest[:e.start()] if e else rest[:900]
    body = deident(body)
    doc = reporting_doctor(txt)
    mpath = os.path.join(SCANS, slug + "-manifest.json")
    m = json.load(open(mpath))
    rep = m.get("report")
    if not rep or not isinstance(rep, dict):
        rep = {"match": {}, "pdf": "report.pdf", "textEn": None, "aiSummary": None}
    rep["textPt"] = body
    m["report"] = rep
    if doc: m["reportingDoctor"] = doc
    json.dump(m, open(mpath, "w"), ensure_ascii=False, indent=2)
    print(f"{slug}: {len(body)} chars, doctor={doc!r}")
    print("   preview:", body[:160].replace("\n", " "))
