#!/usr/bin/env node
/**
 * Reusable RASTER clinical-ECG ingestion (Case B/C/D): an ECG that exists only
 * as pixels — a DICOM Secondary Capture, a PNG/JPEG, or a rasterized PDF page.
 *
 * Sibling of scripts/ingest-ecg.mjs (which handles VECTOR ECG PDFs and derives
 * a true vector SVG). Here there is no waveform signal, so we embed the cleaned
 * source raster in the Lumen frame (scripts/ecg-svg-raster.mjs) and label it
 * "Source image (not vectorized)". Honesty is the whole point: never fake a
 * vector trace from pixels.
 *
 * Because raster charts rarely carry machine-readable text, ALL study metadata
 * is supplied by flags (read from the doctor's report, not guessed). Anything
 * not passed stays NULL. Crucially, --validating-doctor drives whether the
 * front-end frames the reading as a clinician's validated finding; omit it for
 * an unsigned / AI-inferred study and the amber card stays honest.
 *
 *   node scripts/ingest-ecg-raster.mjs \
 *     --patient pending:maria-regina-coury-0cfb1b \
 *     --original "Patients/.../ECG/xxx.dcm" \   # untouched chart -> R2 record of truth
 *     --report   "Patients/.../ECG/Laudo.pdf" \ # the report PDF
 *     --image    "/tmp/ecg-clean.jpg" \         # PHI-cleaned raster to embed in the SVG
 *     --date 2025-01-21 --modality 12-lead --layout 3x4+rhythm \
 *     --calib "25 mm/s · 10 mm/mV · 50 Hz" --svg-layout "3×4 + II" \
 *     --fidelity "Source image (not vectorized) — DICOM Secondary Capture, no digital waveform" \
 *     --interpretation "…" [--apply]
 *
 * R2 writes go through the deployed Worker binding (no S3 creds). Dry run by
 * default; pass --apply to POST to /api/admin/ecg-ingest.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes("--apply");

const PATIENT = arg("--patient");
const ORIGINAL = arg("--original");           // untouched source chart (dcm/png/jpg/pdf)
const REPORT = arg("--report");               // report PDF (optional)
const IMAGE = arg("--image");                 // PHI-cleaned raster to embed in the SVG
const ENDPOINT = (arg("--endpoint", "https://lumenhealth.io")).replace(/\/$/, "");
const VIEWER = arg("--viewer", "pending:admin");

const study = {
  study_date: arg("--date"),
  recorded_at: arg("--recorded-at") || null,
  modality: arg("--modality", "12-lead"),
  lead_layout: arg("--layout") || null,
  source_format: arg("--source-format", "image"),
  fidelity: arg("--fidelity", "Source image (not vectorized)"),
  ordering_doctor: arg("--ordering-doctor") || null,
  validating_doctor: arg("--validating-doctor") || null,
  clinic: arg("--clinic") || null,
  lab_city: arg("--lab-city") || null,
  lab_country: arg("--lab-country") || null,
  // Raster has no machine measurements; never invent. Pass only if the report shows them.
  heart_rate: arg("--hr") ? parseInt(arg("--hr"), 10) : null,
  pr_ms: arg("--pr") ? parseInt(arg("--pr"), 10) : null,
  qrs_ms: arg("--qrs") ? parseInt(arg("--qrs"), 10) : null,
  qt_ms: arg("--qt") ? parseInt(arg("--qt"), 10) : null,
  qtc_ms: arg("--qtc") ? parseInt(arg("--qtc"), 10) : null,
  interpretation: arg("--interpretation") || null,
  report_text: arg("--report-text") || null,
};

if (!PATIENT) { console.error("✗ --patient required"); process.exit(1); }
if (!ORIGINAL || !fs.existsSync(ORIGINAL)) { console.error(`✗ --original not found: ${ORIGINAL}`); process.exit(1); }
if (!IMAGE || !fs.existsSync(IMAGE)) { console.error(`✗ --image (cleaned raster) not found: ${IMAGE}`); process.exit(1); }
if (!study.study_date) { console.error("✗ --date YYYY-MM-DD required (raster carries no parsable date)"); process.exit(1); }

// ── generate the Lumen embedded-raster SVG ───────────────────────────────────
const svgTmp = path.join(os.tmpdir(), `ecg-raster-${process.pid}.svg`);
const svgArgs = [path.join(root, "scripts/ecg-svg-raster.mjs"), IMAGE, svgTmp];
if (arg("--calib")) svgArgs.push("--calib", arg("--calib"));
if (arg("--svg-layout")) svgArgs.push("--layout", arg("--svg-layout"));
execFileSync("node", svgArgs, { stdio: "inherit" });
const svgBuf = fs.readFileSync(svgTmp);
fs.rmSync(svgTmp, { force: true });

// dedupe sha is over the UNTOUCHED original (the record of truth), not the SVG.
const origBuf = fs.readFileSync(ORIGINAL);
study.source_sha = crypto.createHash("sha256").update(origBuf).digest("hex");

const b64 = (buf) => Buffer.from(buf).toString("base64");
const origIsPdf = ORIGINAL.toLowerCase().endsWith(".pdf");
const files = {
  original: { b64: b64(origBuf), contentType: origIsPdf ? "application/pdf" : "application/octet-stream", name: path.basename(ORIGINAL) },
  svg: { b64: b64(svgBuf), contentType: "image/svg+xml", name: "ecg.svg" },
};
if (REPORT && fs.existsSync(REPORT)) {
  files.report = { b64: b64(fs.readFileSync(REPORT)), contentType: "application/pdf", name: path.basename(REPORT) };
}

// ── report ───────────────────────────────────────────────────────────────────
console.log("\n── ECG raster ingest ──");
console.log(`patient   : ${PATIENT}`);
console.log(`original  : ${path.basename(ORIGINAL)}  (sha ${study.source_sha.slice(0, 12)}…, ${(origBuf.length / 1024).toFixed(0)} KB)`);
console.log(`report    : ${REPORT ? path.basename(REPORT) : "(none)"}`);
console.log(`embed img : ${path.basename(IMAGE)}`);
console.log(`svg       : ${(svgBuf.length / 1024).toFixed(0)} KB`);
console.log("study     :");
for (const [k, v] of Object.entries(study)) if (k !== "source_sha") console.log(`   ${k.padEnd(17)} ${v ?? "—"}`);
if (!study.validating_doctor) console.log("note      : no validating_doctor -> front-end renders this as UNVALIDATED / AI-inferred (honest).");

if (!APPLY) { console.log("\n(dry run — nothing posted. Re-run with --apply.)"); process.exit(0); }

// ── POST to the deployed admin endpoint (writes R2 + DB) ─────────────────────
const res = await fetch(`${ENDPOINT}/api/admin/ecg-ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Viewer-Clerk": VIEWER },
  body: JSON.stringify({ patient_clerk: PATIENT, study, files }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok || !out.ok) { console.error(`\n✗ ingest failed: HTTP ${res.status} ${JSON.stringify(out)}`); process.exit(1); }
console.log(`\n✓ ingested. study id = ${out.id}`);
console.log(`  R2 keys: ${Object.entries(out.keys).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  verify : ${ENDPOINT}/api/patient-ecg-object?clerk=${encodeURIComponent(PATIENT)}&id=${out.id}&kind=svg`);
