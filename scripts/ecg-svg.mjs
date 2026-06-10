#!/usr/bin/env node
/**
 * Reusable ECG chart -> light, Lumen-branded SVG generator.
 *
 *   node scripts/ecg-svg.mjs <input.pdf|input.svg> <output.svg>
 *
 * Scope today: VECTOR ECG PDFs (the machine drew the grid + traces as PDF path
 * geometry, not a raster). `pdfimages -list <pdf>` returning no images confirms
 * this. We convert with pdftocairo (preserves the true vector geometry), then
 * recolor into the Lumen cardiac palette. This is a faithful "vector
 * reconstruction from source PDF geometry" -- NOT a raster trace, NOT fabricated
 * samples. Raster/DICOM branches are TODO (throw clearly for now).
 *
 * Palette (light surface, soft red-pastel ECG paper, deep-red trace):
 *   fine grid   rgb(100%,75%,75%) -> #F7DADA
 *   bold grid   rgb(100%,50%,50%) -> #E8AFAF
 *   trace+ticks rgb(0%,0%,0%) stroke -> #9B3535
 *   text/labels rgb(0%,0%,0%) fill   -> #4A5B73
 *
 * The result is responsive (viewBox kept, width 100%), self-contained, and small
 * over the wire (SVG gzips ~85%). It is a VISUAL rendering for the dashboard, not
 * a diagnostic instrument -- the doctor's report is the clinical source of truth.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const [, , INPUT, OUTPUT] = process.argv;
if (!INPUT || !OUTPUT) {
  console.error("usage: node scripts/ecg-svg.mjs <input.pdf|input.svg> <output.svg>");
  process.exit(1);
}

function pdfIsVector(pdfPath) {
  // No embedded raster images => the page is vector (grid+trace are paths).
  try {
    const out = execFileSync("pdfimages", ["-list", pdfPath], { encoding: "utf8" });
    const dataRows = out.trim().split("\n").slice(2).filter((l) => l.trim());
    return dataRows.length === 0;
  } catch { return false; }
}

function rawSvgFromPdf(pdfPath) {
  const tmp = path.join(os.tmpdir(), `ecg-raw-${process.pid}.svg`);
  execFileSync("pdftocairo", ["-svg", pdfPath, tmp]);
  const svg = fs.readFileSync(tmp, "utf8");
  fs.rmSync(tmp, { force: true });
  return svg;
}

// Lumen cardiac palette + responsive root. Color matches are tolerant of
// pdftocairo's percentage rounding (e.g. 74.901961%).
function brandify(svg) {
  const near = (v, t) => Math.abs(v - t) < 1.2;
  // Recolor every rgb(...) occurrence by role.
  svg = svg.replace(/(stroke|fill)="rgb\(\s*([\d.]+)%\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)"/g,
    (m, attr, r, g, b) => {
      r = +r; g = +g; b = +b;
      const isBlack = near(r, 0) && near(g, 0) && near(b, 0);
      const isRedGrid = near(r, 100) && g === b && g > 20 && g < 99;
      if (isBlack) return `${attr}="${attr === "stroke" ? "#9B3535" : "#4A5B73"}"`;
      if (isRedGrid) return `${attr}="${near(g, 50) ? "#E8AFAF" : "#F7DADA"}"`;
      return m;
    });

  // Responsive: keep viewBox, drop fixed pt dimensions, tag the root.
  const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1] || "0 0 2296 1728";
  const [, , vbW, vbH] = vb.split(/\s+/).map(Number);
  svg = svg.replace(
    /<svg\b[^>]*>/,
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `viewBox="${vb}" width="100%" preserveAspectRatio="xMidYMid meet" ` +
    `class="ecg-svg" role="img" aria-label="12-lead electrocardiogram">`
  );

  // Small Lumen mark, top-left inside the frame (absolute href resolves when the
  // SVG is injected inline on the site).
  const mark =
    `<image href="/assets/logo.svg" xlink:href="/assets/logo.svg" ` +
    `x="${Math.round(vbW * 0.012)}" y="${Math.round(vbH * 0.012)}" ` +
    `height="${Math.round(vbH * 0.045)}" width="${Math.round(vbH * 0.045)}" ` +
    `opacity="0.9"/>`;
  svg = svg.replace(/<\/svg>\s*$/, `${mark}\n</svg>`);

  // Trim XML prolog / comments / trailing whitespace for weight.
  svg = svg.replace(/<\?xml[^>]*\?>\s*/i, "").replace(/<!--[\s\S]*?-->/g, "").trim();
  return svg;
}

const ext = path.extname(INPUT).toLowerCase();
let raw;
if (ext === ".svg") {
  raw = fs.readFileSync(INPUT, "utf8");
} else if (ext === ".pdf") {
  if (!pdfIsVector(INPUT)) {
    console.error(`✗ ${path.basename(INPUT)} is a RASTER PDF (embedded image). ` +
      `Raster/DICOM branch not implemented yet -- embed the optimized source image ` +
      `honestly rather than faking a vector trace.`);
    process.exit(2);
  }
  raw = rawSvgFromPdf(INPUT);
} else {
  console.error(`✗ unsupported input: ${ext}`); process.exit(1);
}

const out = brandify(raw);
fs.writeFileSync(OUTPUT, out);
const kb = (Buffer.byteLength(out) / 1024).toFixed(0);
console.log(`✓ ${path.basename(OUTPUT)} written (${kb} KB raw; gzips ~85%). ` +
  `Fidelity: vector reconstruction from source PDF geometry.`);
