#!/usr/bin/env node
/**
 * Case B/C/D ECG raster -> light, Lumen-branded SVG (HONEST embedded image).
 *
 *   node scripts/ecg-svg-raster.mjs <clean.jpg|png> <out.svg> [--calib "..."] [--layout "..."]
 *
 * The companion scripts/ecg-svg.mjs handles VECTOR ECG PDFs (true geometry).
 * This is the branch it explicitly left as TODO: a chart that exists only as
 * PIXELS — a DICOM Secondary Capture, a PNG/JPEG, or a rasterized PDF page —
 * has NO sample data, so a "vector trace" would be a fabrication. When the
 * tracing is too low-contrast / noisy to trace its centerline reliably, the
 * honest move (per the ingestion contract) is to embed the optimized source
 * raster inside the Lumen frame and label it "Source image (not vectorized)",
 * NEVER to present a guessed path as a waveform.
 *
 * The CALLER is responsible for any PHI cleanup (cropping burned-in patient
 * identifiers / de-skew) BEFORE handing the cleaned image here; this script
 * only frames + embeds what it is given. The untouched original chart is
 * archived to R2 separately as the record of truth.
 *
 * Output: a self-contained, responsive (viewBox, width 100%) SVG that gzips
 * well, references the page web fonts (no embedded fonts), and carries the
 * Lumen heart+ECG mark top-left on a light surface. It is a VISUAL rendering
 * for the dashboard, not a diagnostic instrument.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [, , INPUT, OUTPUT] = process.argv;
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
if (!INPUT || !OUTPUT) {
  console.error("usage: node scripts/ecg-svg-raster.mjs <clean.jpg|png> <out.svg> [--calib \"25 mm/s · 10 mm/mV · 50 Hz\"] [--layout \"3×4 + II\"]");
  process.exit(1);
}
// Calibration notation is language-neutral (mm/s, mm/mV, Hz) — safe untranslated.
const CALIB = arg("--calib", "25 mm/s · 10 mm/mV · 50 Hz");
const LAYOUT = arg("--layout", ""); // e.g. "3×4 + II" — also language-neutral

const ext = path.extname(INPUT).toLowerCase().replace(".", "");
const mime = ext === "png" ? "image/png" : (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : null);
if (!mime) { console.error(`✗ unsupported image type: .${ext} (use png/jpg)`); process.exit(1); }

// Native pixel dimensions drive the viewBox so the trace is never resampled.
function dims(p) {
  const out = execFileSync("magick", ["identify", "-format", "%w %h", p], { encoding: "utf8" });
  const [w, h] = out.trim().split(/\s+/).map(Number);
  return { w, h };
}
const { w: iw, h: ih } = dims(INPUT);
const b64 = fs.readFileSync(INPUT).toString("base64");

// ── frame geometry (light card, header band for the mark, footer for calib) ──
const PAD = 12;        // gap between card edge and image
const HEAD = 64;       // top band: Lumen mark
const FOOT = 48;       // bottom band: calibration note
const imgX = PAD + 8;
const imgY = 8 + HEAD;
const vbW = imgX + iw + (PAD + 8);
const vbH = imgY + ih + FOOT;
const cardX = 8, cardY = 8, cardW = vbW - 16, cardH = vbH - 16;
const markH = 30;

const footRight = LAYOUT ? `<text x="${vbW - PAD - 8}" y="${imgY + ih + 31}" text-anchor="end" ` +
  `font-family="'IBM Plex Mono',monospace" font-size="17" fill="#8895AC">${LAYOUT}</text>` : "";

const svg =
`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${vbW} ${vbH}" width="100%" preserveAspectRatio="xMidYMid meet" class="ecg-svg" role="img" aria-label="12-lead electrocardiogram (source image)">` +
  `<rect x="0" y="0" width="${vbW}" height="${vbH}" fill="#F7F8FA"/>` +
  `<rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="14" fill="#FFFFFF" stroke="#E4E9F0" stroke-width="1"/>` +
  `<image href="/assets/logo.svg" xlink:href="/assets/logo.svg" x="${PAD + 8}" y="20" width="${markH}" height="${markH}"/>` +
  `<text x="${PAD + 8 + markH + 12}" y="41" font-family="Raleway,'Helvetica Neue',sans-serif" font-size="22" font-weight="600" fill="#1E2D3D" letter-spacing="0.02em">ECG</text>` +
  `<rect x="${PAD + 8 + markH + 12 + 54}" y="26" width="2" height="20" fill="#E4E9F0"/>` +
  `<text x="${PAD + 8 + markH + 12 + 68}" y="41" font-family="'IBM Plex Mono',monospace" font-size="15" fill="#9B3535" letter-spacing="0.04em">12-lead</text>` +
  // Embedded ONCE via href (well-supported for inline SVG); duplicating the data
  // URI under xlink:href would double the payload for no modern-browser benefit.
  `<image href="data:${mime};base64,${b64}" x="${imgX}" y="${imgY}" width="${iw}" height="${ih}"/>` +
  `<text x="${PAD + 8}" y="${imgY + ih + 31}" font-family="'IBM Plex Mono',monospace" font-size="17" fill="#4A5B73" letter-spacing="0.04em">${CALIB}</text>` +
  footRight +
`</svg>`;

fs.writeFileSync(OUTPUT, svg);
const kb = (Buffer.byteLength(svg) / 1024).toFixed(0);
console.log(`✓ ${path.basename(OUTPUT)} written (${kb} KB; gzips well). viewBox ${vbW}x${vbH}, image ${iw}x${ih}.`);
console.log(`  Fidelity: source image (not vectorized) — embedded raster, honest.`);
