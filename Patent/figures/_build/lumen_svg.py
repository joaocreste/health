# -*- coding: utf-8 -*-
"""
Lumen Health - branded flowchart primitives (light theme).
Hand-authored SVG (no diagram library). Shared by generate.py.

Light theme tokens are lifted verbatim from lumenhealth-branding.html.
Actor-type encoding (color-allowed, branded version of the patent legend):
  human action        -> square-corner rect, petrol border, white fill
  platform automation -> rounded rect, petrol border, subtle fill
  generative AI step  -> rounded rect, gold border, gold diagonal hatch fill
  decision point      -> diamond, petrol border
  data store          -> cylinder, petrol border, subtle fill
  document / blob      -> document symbol, petrol border
  approval gate       -> double-border rect, gold border (emphasis)
"""

# ---------- LIGHT THEME TOKENS ----------
BG          = "#FFFFFF"
SURFACE     = "#FFFFFF"
SUBTLE      = "#F1F4F8"
BORDER_SUB  = "#E4E9F0"
BORDER_DEF  = "#C9D2DD"
TEXT_1      = "#0D1B33"
TEXT_2      = "#4A5B73"
TEXT_3      = "#8895AC"
PETROL      = "#244E6E"
PETROL_LT   = "#4D7BA0"
PETROL_FILL = "#EAF0F5"          # flattened rgba(36,78,110,0.10) on white
GOLD        = "#B8860B"
GOLD_FILL   = "#F7EFD9"          # flattened gold-soft on white

FONT_HEAD = "Raleway, 'Helvetica Neue', Arial, sans-serif"
FONT_BODY = "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif"
FONT_MONO = "'IBM Plex Mono', Menlo, monospace"

STROKE      = 1.6
STROKE_EMPH = 2.6

# Logo mark (lumen drop + ECG), scaled small for a figure header.
def logo(x, y, scale=0.52):
    return f'''<g transform="translate({x},{y}) scale({scale})">
  <g transform="translate(32,32) scale(1.0)">
    <path d="M 0 22 C -20 6, -28 -2, -20 -14 C -12 -22, -4 -18, 0 -10 C 4 -18, 12 -22, 20 -14 C 28 -2, 20 6, 0 22 Z"
          fill="{PETROL_FILL}" stroke="{PETROL_LT}" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M -36 0 L -22 0 L -16 4 L -10 -4 L -2 -16 L 6 14 L 12 -4 L 18 0 L 36 0"
          stroke="{GOLD}" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</g>'''


def defs():
    return f'''<defs>
  <marker id="arrow" markerWidth="11" markerHeight="11" refX="8.5" refY="4"
          orient="auto" markerUnits="userSpaceOnUse">
    <path d="M0,0 L9,4 L0,8 Z" fill="{PETROL}"/>
  </marker>
  <marker id="arrowGold" markerWidth="11" markerHeight="11" refX="8.5" refY="4"
          orient="auto" markerUnits="userSpaceOnUse">
    <path d="M0,0 L9,4 L0,8 Z" fill="{GOLD}"/>
  </marker>
  <pattern id="goldHatch" patternUnits="userSpaceOnUse" width="9" height="9"
           patternTransform="rotate(45)">
    <rect width="9" height="9" fill="{GOLD_FILL}"/>
    <line x1="0" y1="0" x2="0" y2="9" stroke="{GOLD}" stroke-width="0.9" stroke-opacity="0.55"/>
  </pattern>
</defs>'''


# ---------- text ----------
def _esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text_block(cx, cy, lines, size=14, fill=TEXT_1, font=FONT_HEAD,
               weight="400", anchor="middle", lh=1.25, letter=0.0):
    """Vertically-centered multi-line text centered on (cx, cy)."""
    if isinstance(lines, str):
        lines = lines.split("\n")
    n = len(lines)
    total = (n - 1) * size * lh
    y0 = cy - total / 2.0
    ls = f' letter-spacing="{letter}"' if letter else ""
    out = [f'<text x="{cx}" y="{y0:.1f}" font-family="{font}" font-size="{size}" '
           f'font-weight="{weight}" fill="{fill}" text-anchor="{anchor}"{ls} '
           f'dominant-baseline="middle">']
    for i, ln in enumerate(lines):
        dy = 0 if i == 0 else size * lh
        out.append(f'<tspan x="{cx}" dy="{dy:.1f}">{_esc(ln)}</tspan>')
    out.append('</text>')
    return "".join(out)


# ---------- numeral badge ----------
def numeral(x, y, n):
    """Gold chip with the reference numeral, centered on (x, y)."""
    return (f'<g><circle cx="{x}" cy="{y}" r="13" fill="{GOLD}"/>'
            f'<text x="{x}" y="{y+0.5}" font-family="{FONT_MONO}" font-size="12.5" '
            f'font-weight="600" fill="#FFFFFF" text-anchor="middle" '
            f'dominant-baseline="middle">{n}</text></g>')


def _numpos(x, y, w, h):
    # top-right corner, slightly inside
    return (x + w - 6, y + 6)


# ---------- node shapes ----------
def _label(cx, cy, title, sub, tsize, ssize):
    out = ""
    if sub:
        out += text_block(cx, cy - ssize*0.7, title, size=tsize, weight="400")
        out += text_block(cx, cy + tsize*0.75, sub, size=ssize, fill=TEXT_3,
                          font=FONT_MONO, weight="400")
    else:
        out += text_block(cx, cy, title, size=tsize, weight="400")
    return out


def rect(x, y, w, h, title, sub=None, num=None, kind="human",
         tsize=14, ssize=10):
    cx, cy = x + w/2, y + h/2
    s = []
    if kind == "human":
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="2" '
                 f'fill="{SURFACE}" stroke="{PETROL}" stroke-width="{STROKE}"/>')
    elif kind == "auto":
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
                 f'fill="{SUBTLE}" stroke="{PETROL}" stroke-width="{STROKE}"/>')
    elif kind == "ai":
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" '
                 f'fill="url(#goldHatch)" stroke="{GOLD}" stroke-width="{STROKE}"/>')
    elif kind == "gate":
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" '
                 f'fill="{GOLD_FILL}" stroke="{GOLD}" stroke-width="{STROKE_EMPH}"/>')
        s.append(f'<rect x="{x+4}" y="{y+4}" width="{w-8}" height="{h-8}" rx="2" '
                 f'fill="none" stroke="{GOLD}" stroke-width="1.1"/>')
    s.append(_label(cx, cy, title, sub, tsize, ssize))
    if num is not None:
        nx, ny = _numpos(x, y, w, h)
        s.append(numeral(nx, ny, num))
    return "".join(s)


def diamond(cx, cy, w, h, title, num=None, tsize=12):
    hw, hh = w/2, h/2
    pts = f"{cx},{cy-hh} {cx+hw},{cy} {cx},{cy+hh} {cx-hw},{cy}"
    s = [f'<polygon points="{pts}" fill="{SUBTLE}" stroke="{PETROL}" '
         f'stroke-width="{STROKE}"/>']
    s.append(text_block(cx, cy, title, size=tsize, weight="400"))
    if num is not None:
        s.append(numeral(cx + hw - 2, cy - hh + 12, num))
    return "".join(s)


def cylinder(x, y, w, h, title, sub=None, num=None, tsize=13, ssize=9):
    ry = 11
    cx = x + w/2
    body_top = y + ry
    s = []
    s.append(f'<path d="M{x},{body_top} '
             f'A{w/2},{ry} 0 0 1 {x+w},{body_top} '
             f'L{x+w},{y+h-ry} A{w/2},{ry} 0 0 1 {x},{y+h-ry} Z" '
             f'fill="{SUBTLE}" stroke="{PETROL}" stroke-width="{STROKE}"/>')
    s.append(f'<path d="M{x},{body_top} A{w/2},{ry} 0 0 0 {x+w},{body_top}" '
             f'fill="none" stroke="{PETROL}" stroke-width="{STROKE}"/>')
    s.append(_label(cx, y + h/2 + 3, title, sub, tsize, ssize))
    if num is not None:
        s.append(numeral(x + w - 6, y + ry + 4, num))
    return "".join(s)


def document(x, y, w, h, title, sub=None, num=None, tsize=12, ssize=9):
    cx = x + w/2
    wob = 12
    s = [f'<path d="M{x},{y} L{x+w},{y} L{x+w},{y+h-wob} '
         f'Q{x+w*0.75},{y+h} {x+w/2},{y+h-wob} '
         f'Q{x+w*0.25},{y+h-2*wob} {x},{y+h-wob} Z" '
         f'fill="{SURFACE}" stroke="{PETROL}" stroke-width="{STROKE}"/>']
    s.append(_label(cx, y + (h-wob)/2, title, sub, tsize, ssize))
    if num is not None:
        s.append(numeral(x + w - 6, y + 6, num))
    return "".join(s)


# ---------- connectors ----------
def arrow(x1, y1, x2, y2, label=None, gold=False, dashed=False, lsize=10,
          loff=(0, -7)):
    mk = "arrowGold" if gold else "arrow"
    col = GOLD if gold else PETROL
    da = ' stroke-dasharray="6 5"' if dashed else ""
    s = [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{col}" '
         f'stroke-width="1.8"{da} marker-end="url(#{mk})"/>']
    if label:
        mx, my = (x1+x2)/2 + loff[0], (y1+y2)/2 + loff[1]
        s.append(text_block(mx, my, label, size=lsize, fill=TEXT_2,
                            font=FONT_MONO, weight="400"))
    return "".join(s)


def elbow(x1, y1, x2, y2, label=None, gold=False, dashed=False,
          via=None, lsize=10):
    """Orthogonal connector. via='h' goes horizontal-then-vertical, 'v' the reverse."""
    mk = "arrowGold" if gold else "arrow"
    col = GOLD if gold else PETROL
    da = ' stroke-dasharray="6 5"' if dashed else ""
    if via == "h":
        d = f"M{x1},{y1} L{x2},{y1} L{x2},{y2}"
    elif via == "v":
        d = f"M{x1},{y1} L{x1},{y2} L{x2},{y2}"
    else:
        d = f"M{x1},{y1} L{x2},{y2}"
    s = [f'<path d="{d}" fill="none" stroke="{col}" stroke-width="1.8"{da} '
         f'marker-end="url(#{mk})"/>']
    if label:
        s.append(text_block((x1+x2)/2, min(y1, y2) - 8, label, size=lsize,
                            fill=TEXT_2, font=FONT_MONO, weight="400"))
    return "".join(s)


def no_access(x1, y1, x2, y2, label=None):
    """Crossed-out (forbidden) arrow."""
    mx, my = (x1+x2)/2, (y1+y2)/2
    s = [f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{TEXT_3}" '
         f'stroke-width="1.6" stroke-dasharray="5 5"/>']
    # red cross
    s.append(f'<line x1="{mx-11}" y1="{my-11}" x2="{mx+11}" y2="{my+11}" '
             f'stroke="#9B3535" stroke-width="3" stroke-linecap="round"/>')
    s.append(f'<line x1="{mx-11}" y1="{my+11}" x2="{mx+11}" y2="{my-11}" '
             f'stroke="#9B3535" stroke-width="3" stroke-linecap="round"/>')
    if label:
        s.append(text_block(mx, my + 24, label, size=10, fill="#9B3535",
                            font=FONT_MONO, weight="400"))
    return "".join(s)


# ---------- sheet scaffold ----------
def header(W, lang, fig_no, title):
    """Top-left logo + wordmark, top-right figure tag."""
    s = [logo(60, 44)]
    s.append(text_block(108, 60, "Lumen Health", size=19, fill=TEXT_1,
                        font=FONT_HEAD, weight="300", anchor="start", letter=0.5))
    tag = "Dos dados aos insights" if lang == "pt" else "From data to insights"
    s.append(f'<text x="108" y="77" font-family="{FONT_MONO}" font-size="9" '
             f'letter-spacing="1.6" fill="{TEXT_3}" text-anchor="start">'
             f'{tag.upper()}</text>')
    # figure title, top-right
    s.append(f'<text x="{W-60}" y="58" font-family="{FONT_MONO}" font-size="10" '
             f'letter-spacing="2.2" fill="{TEXT_3}" text-anchor="end">'
             f'FIG. {fig_no}</text>')
    s.append(text_block(W-60, 74, title, size=13, fill=PETROL, font=FONT_HEAD,
                        weight="400", anchor="end"))
    s.append(f'<line x1="60" y1="92" x2="{W-60}" y2="92" stroke="{BORDER_SUB}" '
             f'stroke-width="1"/>')
    return "".join(s)


def figlabel(W, H, fig_no):
    return (f'<text x="{W/2}" y="{H-30}" font-family="{FONT_HEAD}" '
            f'font-size="17" font-weight="400" fill="{TEXT_1}" '
            f'text-anchor="middle" letter-spacing="1.5">FIG. {fig_no}</text>')


def sheet(W, H, lang, fig_no, title, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'width="{W}" height="{H}">\n'
            f'<rect x="0" y="0" width="{W}" height="{H}" fill="{BG}"/>\n'
            f'{defs()}\n'
            f'{header(W, lang, fig_no, title)}\n'
            f'{body}\n'
            f'{figlabel(W, H, fig_no)}\n'
            f'</svg>\n')
