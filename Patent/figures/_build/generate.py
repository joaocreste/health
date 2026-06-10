# -*- coding: utf-8 -*-
"""
Generate the Lumen Health branded flowchart set (light theme).
9 figures x {pt, en} x {svg, pdf, png-300dpi}, plus reference-numerals.json,
LEGENDA.md / LEGEND.md and a consistency check.

NOTE: these are BRANDED deck/explainer figures, not INPI/PCT filing drawings
(they carry color, the Lumen mark and brand fonts). Geometry + reference
numerals are kept identical across pt/en.
"""
import json, os, re, subprocess, sys
from collections import OrderedDict
import lumen_svg as S

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # Patent/figures
LAND = (1122, 793)   # A4 landscape @96dpi
PORT = (793, 1122)   # A4 portrait

# ---------------------------------------------------------------- registry
class Registry:
    def __init__(self):
        self.map = OrderedDict()       # num -> {"pt","en","figures":[...]}
    def add(self, num, pt, en, fig):
        num = str(num)
        if num in self.map:
            e = self.map[num]
            if e["pt"] != pt or e["en"] != en:
                raise SystemExit(
                    f"NUMERAL CONFLICT {num}: '{e['pt']}/{e['en']}' vs '{pt}/{en}'")
            if fig not in e["figures"]:
                e["figures"].append(fig)
        else:
            self.map[num] = {"pt": pt, "en": en, "figures": [fig]}
        return int(num)

REG = Registry()

# global recurring elements (label registered lazily via REG.add on first use)
G = {
 10: ("Paciente", "Patient"),
 20: ("Plataforma Lumen", "Lumen platform"),
 30: ("Client Services", "Client Services"),
 40: ("Médico", "Physician"),
 50: ("Registro unificado do paciente", "Unified patient record"),
 60: ("Armazenamento de blobs (UE)", "Blob storage (EU)"),
 70: ("Banco de dados relacional", "Relational database"),
 80: ("Agente de IA por paciente", "Per-patient AI agent"),
 90: ("Portão de aprovação humana", "Human approval gate"),
}
def g(num, fig):
    pt, en = G[num]
    return REG.add(num, pt, en, fig)

def caption(cx, y, pt, en, lang):
    txt = pt if lang == "pt" else en
    return S.text_block(cx, y, txt, size=9.5, fill=S.TEXT_3, font=S.FONT_MONO,
                        weight="400")

# ================================================================ FIG 1
def fig1(lang):
    W, H = LAND
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.1"
    b = []
    y, h, w = 250, 92, 138
    xs = [60 + i * 173 for i in range(6)]
    cy = y + h/2

    # step 1
    b.append(S.rect(xs[0], y, w, h, t("Consentimento\ne envio", "Consent\n& submit"),
                    num=g(10, F), kind="human"))
    b.append(caption(xs[0]+w/2, y+h+16, "humano", "human", lang))

    # step 2 - duality (human + genAI) converging
    sb_h = 40
    b.append(S.rect(xs[1], y, w, sb_h, t("Humano", "Human"), kind="human", tsize=12))
    b.append(S.rect(xs[1], y+h-sb_h, w, sb_h, t("IA generativa", "Generative AI"),
                    kind="ai", tsize=11))
    b.append(S.numeral(xs[1]+w-6, y-4, g(30, F)))
    mx = xs[1] + w + 17
    b.append(S.arrow(xs[1]+w, y+sb_h/2, mx, cy))
    b.append(S.arrow(xs[1]+w, y+h-sb_h/2, mx, cy))
    b.append(caption(xs[1]+w/2, y+h+16, "Client Services", "Client Services", lang))
    b.append(S.text_block(xs[1]+w/2, y+h/2, t("Ingestao", "Ingestion"),
                          size=12, fill=S.TEXT_2, font=S.FONT_MONO))

    # steps 3,4 - platform automation (20)
    b.append(S.rect(xs[2], y, w, h, t("Organização\nem 3 dimensões",
                    "Three-dimension\norganization"), num=g(20, F), kind="auto"))
    b.append(caption(xs[2]+w/2, y+h+16, "automação", "automation", lang))
    b.append(S.rect(xs[3], y, w, h, t("Camada de\ntransparência",
                    "Transparency\nlayer"), num=g(20, F), kind="auto"))
    b.append(caption(xs[3]+w/2, y+h+16, "automação", "automation", lang))

    # step 5 - per-patient insights (genAI)
    b.append(S.rect(xs[4], y, w, h, t("Insights\npor paciente", "Per-patient\ninsights"),
                    num=g(80, F), kind="ai"))
    b.append(caption(xs[4]+w/2, y+h+16, "IA generativa", "generative AI", lang))

    # step 6 - better conversation (10 + 40)
    b.append(S.rect(xs[5], y, w, h, t("Conversa\nmelhor", "A better\nconversation"),
                    kind="human"))
    b.append(S.numeral(xs[5]+w-6, y+6, g(10, F)))
    b.append(S.numeral(xs[5]+w-6, y+34, g(40, F)))
    b.append(caption(xs[5]+w/2, y+h+16, "humano", "human", lang))

    # main arrows
    b.append(S.arrow(mx, cy, xs[2], cy))
    b.append(S.arrow(xs[2]+w, cy, xs[3], cy))
    b.append(S.arrow(xs[3]+w, cy, xs[4], cy))
    b.append(S.arrow(xs[4]+w, cy, xs[5], cy))

    # feedback loop step6 -> step1 (continuous cycle)
    fy = y + h + 60
    b.append(f'<path d="M{xs[5]+w/2},{y+h+24} L{xs[5]+w/2},{fy} '
             f'L{xs[0]+w/2},{fy} L{xs[0]+w/2},{y+h+24}" fill="none" '
             f'stroke="{S.GOLD}" stroke-width="1.8" stroke-dasharray="6 5" '
             f'marker-end="url(#arrowGold)"/>')
    b.append(S.text_block((xs[0]+xs[5])/2+w/2, fy+15,
             t("ciclo continuo", "continuous cycle"), size=10, fill=S.GOLD,
             font=S.FONT_MONO))

    # legend (only on FIG.1)
    ly, lh = 470, 168
    b.append(f'<rect x="60" y="{ly}" width="1002" height="{lh}" rx="12" '
             f'fill="{S.SUBTLE}" stroke="{S.BORDER_DEF}" stroke-width="1"/>')
    b.append(S.text_block(80, ly+22, t("Legenda", "Legend"), size=12,
             fill=S.TEXT_2, font=S.FONT_MONO, anchor="start"))
    items = [
      ("human", t("Ação humana", "Human action")),
      ("auto",  t("Automação da plataforma", "Platform automation")),
      ("ai",    t("Etapa de IA generativa", "Generative AI step")),
      ("dec",   t("Ponto de decisão", "Decision point")),
      ("store", t("Armazenamento", "Data store")),
      ("gate",  t("Portão de aprovação", "Approval gate")),
    ]
    col_w = 166
    gx = 80
    gy = ly + 56
    for i, (k, lab) in enumerate(items):
        ex = gx + i * col_w
        if k == "human":
            b.append(f'<rect x="{ex}" y="{gy}" width="58" height="34" rx="2" '
                     f'fill="{S.SURFACE}" stroke="{S.PETROL}" stroke-width="1.6"/>')
        elif k == "auto":
            b.append(f'<rect x="{ex}" y="{gy}" width="58" height="34" rx="10" '
                     f'fill="{S.SURFACE}" stroke="{S.PETROL}" stroke-width="1.6"/>')
        elif k == "ai":
            b.append(f'<rect x="{ex}" y="{gy}" width="58" height="34" rx="10" '
                     f'fill="url(#goldHatch)" stroke="{S.GOLD}" stroke-width="1.6"/>')
        elif k == "dec":
            ccx, ccy = ex+29, gy+17
            b.append(f'<polygon points="{ccx},{ccy-19} {ccx+30},{ccy} '
                     f'{ccx},{ccy+19} {ccx-30},{ccy}" fill="{S.SUBTLE}" '
                     f'stroke="{S.PETROL}" stroke-width="1.6"/>')
        elif k == "store":
            b.append(S.cylinder(ex, gy-2, 58, 38, "", None))
        elif k == "gate":
            b.append(f'<rect x="{ex}" y="{gy}" width="58" height="34" rx="3" '
                     f'fill="{S.GOLD_FILL}" stroke="{S.GOLD}" stroke-width="2.4"/>')
            b.append(f'<rect x="{ex+4}" y="{gy+4}" width="50" height="26" rx="2" '
                     f'fill="none" stroke="{S.GOLD}" stroke-width="1"/>')
        b.append(S.text_block(ex+29, gy+58, lab, size=10.5, fill=S.TEXT_2,
                 font=S.FONT_BODY, lh=1.15))
    return W, H, t("Fluxo geral ponta a ponta", "End-to-end method flow"), "".join(b)

# ================================================================ FIG 2
def fig2(lang):
    W, H = PORT
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.2"
    b = []
    cx = 430
    bw = 300
    bx = cx - bw/2
    rows = [
        ("A", 130, "human", t("Aceitar termo de\nconfidencialidade",
                               "Accept confidentiality\nagreement"), g(10, F)),
        ("B", 255, "human", t("Selecionar arquivos / pasta",
                               "Select files / folder"), None),
        ("C", 400, "auto",  t("Upload via URLs assinadas",
                              "Upload via signed URLs"), None),
        ("D", 525, "store", t("Custódia: armazenamento UE",
                              "Custody: EU storage"), g(60, F)),
        ("E", 650, "auto",  t("Estado: pendente de revisão",
                              "State: pending review"), None),
        ("F", 775, "human", t("Notificar Client Services",
                              "Notify Client Services"), g(30, F)),
    ]
    bh = 66
    centers = {}
    for key, yy, kind, lab, num in rows:
        if kind == "store":
            b.append(S.cylinder(bx, yy, bw, bh+8, lab, num=num))
            centers[key] = (cx, yy, yy+bh+8)
        else:
            b.append(S.rect(bx, yy, bw, bh, lab, num=num, kind=kind, tsize=13))
            centers[key] = (cx, yy, yy+bh)

    # four converging inputs into B
    inputs = [t("qualquer formato", "any format"),
              t("qualquer idioma", "any language"),
              t("qualquer país", "any country"),
              t("qualquer origem", "any source")]
    iy = [196, 232, 268, 304]
    for lab, yy in zip(inputs, iy):
        b.append(f'<rect x="70" y="{yy-13}" width="150" height="26" rx="13" '
                 f'fill="{S.GOLD_FILL}" stroke="{S.GOLD}" stroke-width="1.2"/>')
        b.append(S.text_block(145, yy, lab, size=10, fill="#7C5B15",
                 font=S.FONT_MONO))
        b.append(S.arrow(220, yy, bx, 255+bh/2))

    # vertical arrows
    seq = ["A", "B", "C", "D", "E", "F"]
    for i in range(len(seq)-1):
        a, c = seq[i], seq[i+1]
        b.append(S.arrow(cx, centers[a][2], cx, centers[c][1]))

    # callout: no ingestion here (clear of the centred column)
    nx, nw = 588, 150
    b.append(f'<rect x="{nx}" y="430" width="{nw}" height="180" rx="12" '
             f'fill="{S.GOLD_FILL}" stroke="{S.GOLD}" stroke-width="2"/>')
    b.append(S.text_block(nx+nw/2, 460, t("ATENÇÃO", "NOTE"), size=11, fill="#7C5B15",
             font=S.FONT_MONO, letter=1.5))
    b.append(S.text_block(nx+nw/2, 535, t("Nenhuma ingestão\nnesta etapa.\nUpload e ingestão\nsão etapas separadas\ndo método.",
             "No ingestion in this\nstep. Upload and\ningestion are\nseparate steps of\nthe method."),
             size=11, fill=S.TEXT_2, font=S.FONT_BODY, lh=1.4))
    return W, H, t("Paciente -> portal", "Patient -> portal"), "".join(b)

# ================================================================ FIG 3
def fig3(lang):
    W, H = LAND
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.3"
    b = []
    panels = [
        (60,  t("EXTRAÇÃO", "EXTRACT")),
        (426, t("TRANSFORMAÇÃO", "TRANSFORM")),
        (792, t("CARGA", "LOAD")),
    ]
    pw, py, ph = 270, 150, 470
    for px, lab in panels:
        b.append(f'<rect x="{px}" y="{py}" width="{pw}" height="{ph}" rx="14" '
                 f'fill="{S.BG}" stroke="{S.BORDER_DEF}" stroke-width="1.4"/>')
        b.append(S.text_block(px+pw/2, py+24, lab, size=13, fill=S.PETROL,
                 font=S.FONT_MONO, weight="400", letter=2.0))
    iy = [196, 314, 432]
    ih = 92
    ix = lambda px: px + 20
    iw = 230

    # EXTRACT
    px = 60
    b.append(S.rect(ix(px), iy[0], iw, ih,
             t("Portal de upload", "Upload portal"),
             sub="(Cloudflare Pages/Workers)", kind="auto"))
    b.append(S.cylinder(ix(px), iy[1], iw, ih,
             t("Object storage, UE", "Object storage, EU"),
             sub="(R2)", num=g(60, F)))
    b.append(S.diamond(px+pw/2, iy[2]+ih/2, 210, 84,
             t("Classificar\ntipo de arquivo", "Classify\nfile type"),
             num=REG.add(301, "Classificação de tipo de arquivo",
                         "File-type classification", F)))
    b.append(S.arrow(ix(px)+iw/2, iy[0]+ih, ix(px)+iw/2, iy[1]))
    b.append(S.arrow(ix(px)+iw/2, iy[1]+ih, px+pw/2, iy[2]+ih/2-42))

    # TRANSFORM
    px = 426
    b.append(S.rect(ix(px), iy[0], iw, ih,
             t("Registro de prompts", "Prompt registry"),
             sub=t("(lookup, determinístico)", "(lookup, deterministic)"),
             num=REG.add(302, "Registro de prompts", "Prompt registry", F),
             kind="auto"))
    b.append(S.rect(ix(px), iy[1], iw, ih,
             t("Parsing / estruturação IA", "AI parsing / structuring"),
             sub="(Anthropic API)",
             num=REG.add(303, "Estruturação por IA", "AI structuring", F),
             kind="ai"))
    b.append(S.rect(ix(px), iy[2], iw, ih,
             t("Normalização", "Normalization"),
             sub=t("(taxonomia canônica)", "(canonical taxonomy)"),
             num=REG.add(304, "Normalização (taxonomia canônica)",
                         "Normalization (canonical taxonomy)", F), kind="auto"))
    b.append(S.arrow(ix(px)+iw/2, iy[0]+ih, ix(px)+iw/2, iy[1]))
    b.append(S.arrow(ix(px)+iw/2, iy[1]+ih, ix(px)+iw/2, iy[2]))

    # LOAD
    px = 792
    b.append(S.cylinder(ix(px), iy[0], iw, ih,
             t("Linhas -> Postgres", "Rows -> Postgres"),
             sub=t("(Neon, Frankfurt; Hyperdrive)", "(Neon, Frankfurt; Hyperdrive)"),
             num=g(70, F)))
    b.append(S.cylinder(ix(px), iy[1], iw, ih,
             t("Blobs permanecem (ponteiros)", "Blobs remain (pointer rows)"),
             sub="(R2, UE)" if lang == "pt" else "(R2, EU)", num=g(60, F)))
    b.append(S.rect(ix(px), iy[2], iw, ih,
             t("Registro unificado\npublicado", "Unified record\npublished"),
             num=g(50, F), kind="auto"))
    b.append(S.arrow(ix(px)+iw/2, iy[0]+ih, ix(px)+iw/2, iy[1]))
    b.append(S.arrow(ix(px)+iw/2, iy[1]+ih, ix(px)+iw/2, iy[2]))

    # cross-panel arrows + approval gate (in the 96px gaps between panels)
    midy = 385
    b.append(S.arrow(330, midy, 426, midy))             # extract -> transform
    # gate centred in the TRANSFORM->LOAD gap (696..792)
    gx, gw = 706, 76
    b.append(S.rect(gx, midy-30, gw, 60,
             t("Aprovação\nhumana", "Human\napproval"), num=g(90, F),
             kind="gate", tsize=11))
    b.append(S.arrow(696, midy, gx, midy))              # transform -> gate
    b.append(S.arrow(gx+gw, midy, 792, midy))           # gate -> load
    return W, H, t("Pipeline ETL", "ETL pipeline"), "".join(b)

# ================================================================ FIG 4
def fig4(lang):
    W, H = PORT
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.4"
    b = []
    cx = 396
    bw = 330
    bx = cx - bw/2
    # A file received (document)
    b.append(S.document(bx+45, 120, bw-90, 76,
             t("Arquivo recebido", "File received"),
             num=REG.add(401, "Arquivo recebido", "File received", F)))
    # B classifier (genAI)
    b.append(S.rect(bx, 235, bw, 74, t("Classificador", "Classifier"),
             sub=t("(IA generativa)", "(generative AI)"),
             num=REG.add(402, "Classificador", "Classifier", F), kind="ai"))
    # C structured output
    b.append(S.rect(bx, 345, bw, 84,
             t("Saída estruturada\n{tipo, idioma, classe de render.}",
               "Structured output\n{type, language, render class}"),
             num=REG.add(403, "Saída estruturada", "Structured output", F),
             kind="auto", tsize=12))
    # D registry lookup
    b.append(S.rect(bx, 465, bw, 74,
             t("Consulta ao registro\ntipo -> prompt", "Registry lookup\ntype -> prompt"),
             sub=t("(tabela determinística)", "(deterministic table)"),
             num=REG.add(404, "Consulta ao registro de prompts",
                         "Prompt-registry lookup", F), kind="auto", tsize=12))
    # E decision
    dcy = 640
    b.append(S.diamond(cx, dcy, 280, 130,
             t("Classe de\nrenderização\n= padrão?", "Render class\n= standard?"),
             num=REG.add(405, "Classe de renderização padrão?",
                         "Standard render class?", F), tsize=12))
    # vertical arrows
    b.append(S.arrow(cx, 196, cx, 235))
    b.append(S.arrow(cx, 309, cx, 345))
    b.append(S.arrow(cx, 429, cx, 465))
    b.append(S.arrow(cx, 539, cx, dcy-65))
    # no -> human review gate (left)
    b.append(S.rect(80, dcy-36, 140, 72,
             t("Encaminhar a\nrevisão humana", "Forward to\nhuman review"),
             num=g(90, F), kind="gate", tsize=12))
    b.append(S.arrow(cx-140, dcy, 220, dcy, label=t("não-padrão", "non-standard")))
    # yes -> fan-out
    b.append(S.arrow(cx, dcy+65, cx, 790, label=t("padrão", "standard"),
             loff=(28, 0)))
    b.append(S.rect(bx, 790, bw, 70,
             t("Fan-out de ingestão\n(1 job por tipo detectado)",
               "Ingestion fan-out\n(1 job per detected type)"),
             num=REG.add(406, "Fan-out de ingestão", "Ingestion fan-out", F),
             kind="auto", tsize=12))
    # three example jobs (mixed folder)
    jobs = [t("Job: exames", "Job: labs"), t("Job: imagem", "Job: imaging"),
            t("Job: ECG", "Job: ECG")]
    jw = 190
    jxs = [cx - jw - 18, cx - jw/2, cx + 18]
    # arrange 3 across centered
    total = 3*jw + 2*16
    startx = cx - total/2
    for i, j in enumerate(jobs):
        jx = startx + i*(jw+16)
        b.append(S.rect(jx, 905, jw, 56, j, kind="auto", tsize=12))
        b.append(S.arrow(cx, 860, jx+jw/2, 905))
    return W, H, t("Classificação e registro de prompts",
                   "Classification & prompt registry"), "".join(b)

# ================================================================ FIG 5
def fig5(lang):
    W, H = LAND
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.5"
    b = []
    bw, bh = 200, 70
    xs = [60, 327, 594, 861]
    r1, r2 = 200, 430
    def st(x, y, kind, lab, num=None, sub=None):
        b.append(S.rect(x, y, bw, bh, lab, num=num, kind=kind, sub=sub, tsize=12))
        return (x, y)
    # row 1 (left -> right)
    st(xs[0], r1, "auto", t("Enviado", "Submitted"),
       REG.add(501, "Enviado", "Submitted", F))
    st(xs[1], r1, "auto", t("Classificado", "Classified"),
       REG.add(502, "Classificado", "Classified", F))
    st(xs[2], r1, "gate", t("Aguardando\naprovação", "Awaiting\napproval"), g(90, F))
    st(xs[3], r1, "auto", t("Em ingestão", "Ingesting"),
       REG.add(503, "Em ingestão", "Ingesting", F))
    for i in range(3):
        lab = [t("enviar", "submit"), t("aprovar", "approve"),
               t("ingerir", "ingest")][i]
        b.append(S.arrow(xs[i]+bw, r1+bh/2, xs[i+1], r1+bh/2, label=lab))
    # row 2 (right -> left)
    st(xs[3], r2, "ai", t("Em verificação", "Verifying"),
       REG.add(504, "Em verificação", "Verifying", F),
       sub=t("(diff IA)", "(AI diff)"))
    st(xs[2], r2, "gate", t("Aguardando\npublicação", "Awaiting\npublication"), g(90, F))
    st(xs[1], r2, "auto", t("Publicado", "Published"),
       REG.add(505, "Publicado", "Published", F))
    # down arrow r1->r2 at col4
    b.append(S.arrow(xs[3]+bw/2, r1+bh, xs[3]+bw/2, r2, label=t("verificar", "verify"),
             loff=(36, 0)))
    b.append(S.arrow(xs[3], r2+bh/2, xs[2]+bw, r2+bh/2,
             label=t("publicar", "publish")))
    b.append(S.arrow(xs[2], r2+bh/2, xs[1]+bw, r2+bh/2, label="OK"))
    # failed state + retry
    fx, fy = xs[0], r2
    st(fx, fy, "human", t("Falhou", "Failed"),
       REG.add(506, "Falhou", "Failed", F))
    b.append(f'<rect x="{fx}" y="{fy}" width="{bw}" height="{bh}" rx="2" '
             f'fill="#F4C5C5" fill-opacity="0.5" stroke="#9B3535" '
             f'stroke-width="1.6"/>')
    b.append(S.text_block(fx+bw/2, fy+bh/2, t("Falhou", "Failed"), size=13,
             fill="#9B3535"))
    b.append(S.numeral(fx+bw-6, fy+6, 506))
    # verifying -> failed (diff mismatch), routed via a lane below the row
    lane = r2 + bh + 45
    b.append(f'<path d="M{xs[3]+bw/2},{r2+bh} L{xs[3]+bw/2},{lane} '
             f'L{fx+bw/2},{lane} L{fx+bw/2},{fy+bh}" fill="none" '
             f'stroke="{S.PETROL}" stroke-width="1.8" marker-end="url(#arrow)"/>')
    b.append(S.text_block((xs[3]+fx)/2+bw/2, lane-9,
             t("divergência no diff", "diff mismatch"), size=10,
             fill=S.TEXT_2, font=S.FONT_MONO))
    # failed -> classified retry
    b.append(f'<path d="M{fx+bw/2},{fy} L{fx+bw/2},{r1+bh+40} '
             f'L{xs[1]+bw/2},{r1+bh+40} L{xs[1]+bw/2},{r1+bh}" fill="none" '
             f'stroke="{S.GOLD}" stroke-width="1.8" stroke-dasharray="6 5" '
             f'marker-end="url(#arrowGold)"/>')
    b.append(S.text_block((fx+xs[1])/2+bw/2, r1+bh+54, t("retry", "retry"),
             size=10, fill=S.GOLD, font=S.FONT_MONO))
    return W, H, t("Máquina de estados da importação",
                   "Import job state machine"), "".join(b)

# ================================================================ FIG 6
def fig6(lang):
    W, H = PORT
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.6"
    b = []
    cx = 396
    # unified record
    b.append(S.cylinder(cx-150, 120, 300, 76, t("Registro unificado", "Unified record"),
             num=g(50, F)))
    # canonical taxonomy mapping
    b.append(S.rect(cx-170, 250, 340, 74,
             t("Mapeamento p/ taxonomia canônica",
               "Mapping to canonical taxonomy"),
             sub=t("(determinístico)", "(deterministic)"),
             num=REG.add(601, "Mapeamento p/ taxonomia canônica",
                         "Canonical-taxonomy mapping", F), kind="auto", tsize=12))
    b.append(S.arrow(cx, 196, cx, 250))
    # three dimensions
    dims = [
        (t("Físico", "Physical"), REG.add(602, "Físico", "Physical", F)),
        (t("Mental", "Mental"),   REG.add(603, "Mental", "Mental", F)),
        (t("Espiritual", "Spiritual"), REG.add(604, "Espiritual", "Spiritual", F)),
    ]
    dw = 200
    dxs = [60, 296, 532]
    dy = 410
    for (lab, num), dx in zip(dims, dxs):
        b.append(S.rect(dx, dy, dw, 76, lab, num=num, kind="auto"))
        b.append(S.arrow(cx, 324, dx+dw/2, dy))
    # Fisico subdivides
    subs = [
        (t("Vitais", "Vitals"), REG.add(605, "Vitais", "Vitals", F)),
        (t("Exames", "Exams"),  REG.add(606, "Exames", "Exams", F)),
        (t("Genética", "Genetics"), REG.add(607, "Genética", "Genetics", F)),
    ]
    sw = 180
    sy = 600
    total = 3*sw + 2*30
    sx0 = cx - total/2
    for i, (lab, num) in enumerate(subs):
        sx = sx0 + i*(sw+30)
        b.append(S.rect(sx, sy, sw, 66, lab, num=num, kind="auto", tsize=13))
        b.append(S.arrow(dxs[0]+dw/2, dy+76, sx+sw/2, sy))
    return W, H, t("Organização em três dimensões",
                   "Three-dimension organization"), "".join(b)

# ================================================================ FIG 7
def fig7(lang):
    W, H = PORT
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.7"
    b = []
    cx = 396
    # claimed-method boundary
    b.append(f'<rect x="55" y="150" width="683" height="640" rx="16" '
             f'fill="none" stroke="{S.GOLD}" stroke-width="{S.STROKE_EMPH}" '
             f'stroke-dasharray="3 0"/>')
    b.append(S.text_block(cx, 178, t("Fronteira do método reivindicado",
             "Claimed-method boundary"), size=10.5, fill=S.GOLD, font=S.FONT_MONO,
             letter=1.2))
    # central record
    b.append(S.cylinder(cx-130, 230, 260, 80, t("Registro único", "Single record"),
             num=g(50, F)))
    # patient view (left)
    pv_lines = t("- Resumo em linguagem clara\n- Selos de status\n- Alternância bilíngue",
                 "- Plain-language summary\n- Status seals\n- Bilingual toggle")
    b.append(S.rect(90, 470, 280, 250, "", kind="auto"))
    b.append(S.text_block(230, 500, t("Visão do paciente", "Patient view"),
             size=15, fill=S.PETROL, font=S.FONT_HEAD))
    b.append(S.numeral(90+280-6, 470+6,
             REG.add(701, "Visão do paciente", "Patient view", F)))
    b.append(S.text_block(230, 595, pv_lines, size=12, fill=S.TEXT_2,
             font=S.FONT_BODY, lh=1.7))
    # physician view (right)
    dv_lines = t("- Tendências e valores\n- Faixas de referência\n- Documentos-fonte a 1 clique",
                 "- Trends and values\n- Reference ranges\n- Source documents 1 click away")
    b.append(S.rect(422, 470, 280, 250, "", kind="auto"))
    b.append(S.text_block(562, 500, t("Visão do médico", "Physician view"),
             size=15, fill=S.PETROL, font=S.FONT_HEAD))
    b.append(S.numeral(422+280-6, 470+6,
             REG.add(702, "Visão do médico", "Physician view", F)))
    b.append(S.numeral(422+280-6, 470+34, g(40, F)))
    b.append(S.text_block(562, 595, dv_lines, size=12, fill=S.TEXT_2,
             font=S.FONT_BODY, lh=1.7))
    # arrows from record to both views
    b.append(S.arrow(cx-60, 310, 230, 470, label=t("lê", "reads")))
    b.append(S.arrow(cx+60, 310, 562, 470, label=t("lê", "reads")))
    b.append(S.text_block(cx, 745, t("Mesma fonte, duas leituras",
             "Same source, two readings"), size=12, fill=S.TEXT_3,
             font=S.FONT_MONO))
    return W, H, t("Um registro, duas visões", "One record, two views"), "".join(b)

# ================================================================ FIG 8
def fig8(lang):
    W, H = PORT
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.8"
    b = []
    cx = 396
    # patient data boundary
    b.append(f'<rect x="60" y="150" width="673" height="600" rx="16" fill="none" '
             f'stroke="{S.GOLD}" stroke-width="{S.STROKE_EMPH}"/>')
    b.append(S.text_block(cx, 178, t("Limite de dados do paciente",
             "Patient data boundary"), size=10.5, fill=S.GOLD, font=S.FONT_MONO,
             letter=1.0))
    b.append(S.numeral(733-18, 168,
             REG.add(801, "Limite de dados do paciente", "Patient data boundary", F)))
    # three stores (reuse dimension numerals)
    stores = [
        (t("Físico", "Physical"), REG.add(602, "Físico", "Physical", F)),
        (t("Mental", "Mental"),   REG.add(603, "Mental", "Mental", F)),
        (t("Espiritual", "Spiritual"), REG.add(604, "Espiritual", "Spiritual", F)),
    ]
    sw = 180
    sxs = [110, 306, 502]
    for (lab, num), sx in zip(stores, sxs):
        b.append(S.cylinder(sx, 215, sw, 70, lab, num=num, tsize=13))
    # single agent
    ax, ay, aw, ah = cx-150, 380, 300, 90
    b.append(S.rect(ax, ay, aw, ah, t("Uma instância de agente",
             "One agent instance"), sub=t("(IA generativa)", "(generative AI)"),
             num=g(80, F), kind="ai"))
    for sx in sxs:
        b.append(S.arrow(sx+sw/2, 285, sx+sw/2 if abs(sx+sw/2-cx) < 5 else cx +
                 (-90 if sx < cx else 90), ay))
    # tagline box
    b.append(f'<rect x="{cx-130}" y="510" width="260" height="40" rx="20" '
             f'fill="{S.GOLD_FILL}" stroke="{S.GOLD}" stroke-width="1.4"/>')
    b.append(S.text_block(cx, 530, t("revela, não inventa", "reveals, does not invent"),
             size=12, fill="#7C5B15", font=S.FONT_HEAD))
    b.append(S.arrow(cx, 470, cx, 510))
    # insight cards with AI marker
    cw = 180
    cxs = [110, 306, 502]
    cy = 610
    for i, sx in enumerate(cxs):
        b.append(S.rect(sx, cy, cw, 90, "", kind="auto"))
        b.append(f'<rect x="{sx+10}" y="{cy+10}" width="34" height="18" rx="9" '
                 f'fill="{S.GOLD}"/>')
        b.append(S.text_block(sx+27, cy+19.5, "AI", size=11, fill="#FFFFFF",
                 font=S.FONT_MONO, weight="600"))
        b.append(S.text_block(sx+cw/2, cy+55, t("Cartão de\ninsight", "Insight\ncard"),
                 size=12, fill=S.TEXT_1))
    b.append(S.text_block(cx, cy-14, t("Saída: cartões com marcador de origem IA",
             "Output: cards carrying an AI-origin marker"), size=10.5,
             fill=S.TEXT_3, font=S.FONT_MONO))
    b.append(S.numeral(502+cw-6, cy+6,
             REG.add(802, "Cartões de insight", "Insight cards", F)))
    for sx in cxs:
        b.append(S.arrow(cx, 550, sx+cw/2, cy))
    # other patient (outside) + no access
    b.append(S.cylinder(cx-110, 830, 220, 70,
             t("Dados de outro paciente", "Other patient data"),
             num=REG.add(803, "Dados de outro paciente", "Other patient data", F),
             tsize=12))
    b.append(S.no_access(cx, 750, cx, 830,
             t("sem modelo entre pacientes", "no cross-patient model")))
    return W, H, t("Agente de IA por paciente", "Per-patient AI agent"), "".join(b)

# ================================================================ FIG 9
def fig9(lang):
    W, H = PORT
    t = lambda pt, en: pt if lang == "pt" else en
    F = "FIG.9"
    b = []
    cx = 396
    b.append(S.rect(cx-110, 120, 220, 64, t("Paciente", "Patient"),
             num=g(10, F), kind="human"))
    b.append(S.rect(cx-150, 230, 300, 64, t("Direito de exclusão", "Right to erasure"),
             num=REG.add(901, "Direito de exclusão", "Right to erasure", F),
             kind="human"))
    b.append(S.arrow(cx, 184, cx, 230))
    # scope decision
    b.append(S.diamond(cx, 380, 280, 110, t("Escopo?", "Scope?"), tsize=14))
    b.append(S.arrow(cx, 294, cx, 325))
    # total (left)
    lx = 130
    b.append(S.rect(lx, 540, 240, 70, t("Exclusão total", "Total erasure"),
             sub=t("(ação única, agnóstica à origem)", "(single action, origin-agnostic)"),
             num=REG.add(902, "Exclusão total", "Total erasure", F),
             kind="human", tsize=13))
    b.append(S.elbow(cx-140, 380, lx+120, 540, via="h",
             label=t("total", "total")))
    # total wipes 60 + 70
    b.append(S.cylinder(lx-10, 670, 120, 66, "R2", sub="(UE)" if lang=="pt" else "(EU)",
             num=g(60, F), tsize=12))
    b.append(S.cylinder(lx+140, 670, 120, 66, "Postgres", num=g(70, F), tsize=12))
    b.append(S.arrow(lx+60, 610, lx+50, 670))
    b.append(S.arrow(lx+180, 610, lx+200, 670))
    # partial (right)
    rx = 470
    b.append(S.rect(rx, 540, 240, 70, t("Exclusão parcial", "Partial erasure"),
             sub=t("(via Client Services)", "(via Client Services)"),
             num=REG.add(903, "Exclusão parcial", "Partial erasure", F),
             kind="human", tsize=13))
    b.append(S.numeral(rx+240-6, 540+34, g(30, F)))
    b.append(S.elbow(cx+140, 380, rx+120, 540, via="h",
             label=t("parcial", "partial")))
    # partial removes a document/exam/section
    b.append(S.document(rx+50, 670, 140, 70,
             t("Documento /\nexame / seção", "Document /\nexam / section")))
    b.append(S.arrow(rx+120, 610, rx+120, 670))
    # audit log write on every deletion -> DB 70
    ay = 850
    b.append(S.rect(cx-150, ay, 300, 70,
             t("Gravação em log de auditoria", "Audit-log write"),
             sub=t("(em cada exclusão)", "(on every deletion event)"),
             num=REG.add(904, "Registro de auditoria", "Audit log", F),
             kind="auto", tsize=12))
    b.append(S.elbow(lx+120, 736, cx-40, ay, via="v"))
    b.append(S.elbow(rx+120, 740, cx+40, ay, via="v"))
    b.append(S.numeral(cx+150-6, ay+34, g(70, F)))
    return W, H, t("Governança e exclusão", "Governance & erasure"), "".join(b)

# ---------------------------------------------------------------- driver
FIGS = [
    ("1", "fluxo-geral", "end-to-end", fig1),
    ("2", "paciente-portal", "patient-portal", fig2),
    ("3", "etl-nuvem", "etl-cloud", fig3),
    ("4", "classificacao-prompts", "classification-prompts", fig4),
    ("5", "estados-importacao", "import-state-machine", fig5),
    ("6", "tres-dimensoes", "three-dimensions", fig6),
    ("7", "registro-duas-visoes", "record-two-views", fig7),
    ("8", "agente-ia-paciente", "per-patient-ai-agent", fig8),
    ("9", "governanca-exclusao", "governance-erasure", fig9),
]

def render(svg_path, lang):
    base = os.path.splitext(os.path.basename(svg_path))[0]
    d = os.path.dirname(svg_path)
    pdf = os.path.join(d, "pdf", base + ".pdf")
    png = os.path.join(d, "png", base + ".png")
    subprocess.run(["rsvg-convert", "-f", "pdf", "-o", pdf, svg_path], check=True)
    # 300dpi: SVG is sized in 96dpi px, so zoom 300/96 = 3.125 for a true 300dpi raster
    subprocess.run(["rsvg-convert", "-f", "png", "-z", "3.125",
                    "-o", png, svg_path], check=True)
    return pdf, png

def main():
    svgs = []
    for lang in ("pt", "en"):
        slug_i = 1 if lang == "pt" else 2
        for no, ptslug, enslug, fn in FIGS:
            slug = ptslug if lang == "pt" else enslug
            W, H, title, body = fn(lang)
            svg = S.sheet(W, H, lang, no, title, body)
            path = os.path.join(ROOT, lang, f"fig-{no}-{slug}.svg")
            with open(path, "w", encoding="utf-8") as f:
                f.write(svg)
            svgs.append((path, lang, no))
    # render
    for path, lang, no in svgs:
        render(path, lang)
    # reference numerals
    refmap = OrderedDict()
    for num in sorted(REG.map, key=lambda x: int(x)):
        e = REG.map[num]
        refmap[num] = {"pt": e["pt"], "en": e["en"],
                       "figures": sorted(e["figures"], key=lambda s: int(s[4:]))}
    with open(os.path.join(ROOT, "reference-numerals.json"), "w",
              encoding="utf-8") as f:
        json.dump(refmap, f, ensure_ascii=False, indent=2)
    # legends
    def legend(path, lang):
        head = ("# Lumen Health - Legenda de numerais de referência\n\n"
                if lang == "pt" else
                "# Lumen Health - Reference numeral legend\n\n")
        note = ("> Figuras de marca (tema claro) - não são desenhos de patente INPI/PCT.\n\n"
                if lang == "pt" else
                "> Branded figures (light theme) - not INPI/PCT patent drawings.\n\n")
        col = "| No | Elemento | Figuras |\n|---:|---|---|\n" if lang == "pt" \
              else "| No | Element | Figures |\n|---:|---|---|\n"
        rows = ""
        for num in sorted(refmap, key=lambda x: int(x)):
            e = refmap[num]
            label = e["pt"] if lang == "pt" else e["en"]
            rows += f"| {num} | {label} | {', '.join(e['figures'])} |\n"
        with open(path, "w", encoding="utf-8") as f:
            f.write(head + note + col + rows)
    legend(os.path.join(ROOT, "LEGENDA.md"), "pt")
    legend(os.path.join(ROOT, "LEGEND.md"), "en")
    # consistency check
    print("=== CONSISTENCY CHECK ===")
    ok = True
    # (a) every numeral appears in >=1 svg text node ; (c) every fig has FIG. N
    svg_text = {}
    for path, lang, no in svgs:
        svg_text[path] = open(path, encoding="utf-8").read()
    for num in refmap:
        figs = refmap[num]["figures"]
        found = False
        for path, lang, no in svgs:
            if "FIG." + no in figs:
                # numeral rendered inside a <text>...num...</text>
                if re.search(r">%s<" % re.escape(num), svg_text[path]):
                    found = True
                    break
        if not found:
            ok = False
            print(f"  [FAIL] numeral {num} not found as text node in its figures")
    for path, lang, no in svgs:
        if f"FIG. {no}" not in svg_text[path]:
            ok = False
            print(f"  [FAIL] {path} missing 'FIG. {no}' label")
    # (b) enforced at build time by Registry
    print(f"  numerals: {len(refmap)}  |  svg files: {len(svgs)}")
    print(f"  (a) all numerals present as text nodes: {'PASS' if ok else 'FAIL'}")
    print(f"  (b) no numeral reused for two labels: PASS (enforced at build)")
    print(f"  (c) every figure carries its FIG. N label: "
          f"{'PASS' if ok else 'see above'}")
    print("=== DONE ===" if ok else "=== CHECK FAILED ===")
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main())
