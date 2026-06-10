#!/usr/bin/env node
/**
 * Reusable clinical-ECG ingestion: chart PDF + report PDF -> Lumen SVG + R2 + DB.
 *
 *   node scripts/ingest-ecg.mjs --patient pending:joao \
 *        --folder "Patients/Joao Victor Creste/ECG/ECG 8 July 2026" [--apply]
 *
 * Pipeline (no special-casing any patient):
 *   1. Locate the chart PDF (vector ECG) + the report PDF in the folder.
 *   2. pdftotext both and best-effort extract study metadata (date, HR, intervals,
 *      ordering/validating doctor, clinic, interpretation). Format-tolerant: any
 *      field it can't find stays null and is reported. CLI flags override.
 *   3. Generate the light Lumen SVG via scripts/ecg-svg.mjs (true vector geometry).
 *   4. POST chart + report + svg + metadata to /api/admin/ecg-ingest, which writes
 *      the blobs to R2 (patients/{id}/ecg/{date}/) via the Worker binding and
 *      upserts the ecg_studies row (dedupe on patient+date+source_sha).
 *
 * R2 writes go through the deployed Worker binding, so NO S3 credentials are
 * needed locally. The endpoint must be deployed first (default lumenhealth.io).
 *
 *   --apply     actually POST (default: dry run — extract + generate + print)
 *   --endpoint  base URL of the deployed site (default https://lumenhealth.io)
 *   --date      override study date (YYYY-MM-DD)
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
const PATIENT = arg("--patient", "pending:joao");
const FOLDER = arg("--folder");
const ENDPOINT = (arg("--endpoint", "https://lumenhealth.io")).replace(/\/$/, "");
const DATE_OVERRIDE = arg("--date");
if (!FOLDER) { console.error("✗ --folder required"); process.exit(1); }

const folderAbs = path.isAbsolute(FOLDER) ? FOLDER : path.join(root, FOLDER);
if (!fs.existsSync(folderAbs)) { console.error(`✗ folder not found: ${folderAbs}`); process.exit(1); }

// ── locate chart + report ────────────────────────────────────────────────────
const pdfs = fs.readdirSync(folderAbs).filter((f) => f.toLowerCase().endsWith(".pdf"));
const isReportName = (f) => /report|laudo/i.test(f);
let reportFile = pdfs.find(isReportName);
let chartFile = pdfs.find((f) => !isReportName(f) && /ecg|eletro|electro/i.test(f)) || pdfs.find((f) => !isReportName(f));
if (!chartFile) { console.error(`✗ no chart PDF in ${folderAbs}`); process.exit(1); }
const chartPath = path.join(folderAbs, chartFile);
const reportPath = reportFile ? path.join(folderAbs, reportFile) : null;

const pdftext = (p) => { try { return execFileSync("pdftotext", ["-layout", p, "-"], { encoding: "utf8" }); } catch { return ""; } };
const chartTxt = pdftext(chartPath);
const reportTxt = reportPath ? pdftext(reportPath) : "";

// ── metadata extraction (best-effort, format-tolerant) ───────────────────────
const m = (re, txt, g = 1) => { const x = (txt || "").match(re); return x ? x[g].trim() : null; };
const num = (re, txt) => { const x = m(re, txt); return x == null ? null : parseInt(x, 10); };

// Date: prefer report "Data do Exame: DD/MM/YYYY"; fall back to chart "D/M/YYYY".
function toIso(d) {
  if (!d) return null;
  let x = d.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (x) return `${x[3]}-${String(x[2]).padStart(2, "0")}-${String(x[1]).padStart(2, "0")}`;
  x = d.match(/(\d{4})-(\d{2})-(\d{2})/);
  return x ? `${x[1]}-${x[2]}-${x[3]}` : null;
}
const study_date = DATE_OVERRIDE
  || toIso(m(/Data do Exame:\s*([\d/]+)/i, reportTxt))
  || toIso(m(/(\d{1,2}\/\d{1,2}\/\d{4})\s+\d{1,2}:\d{2}/, chartTxt));
const timeM = m(/(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2})/, chartTxt);
const recorded_at = (study_date && timeM)
  ? `${study_date}T${timeM.split(/\s+/)[1]}-03:00` : null;

const doctor = (re, txt) => {
  const x = (txt || "").match(re);
  if (!x) return null;
  const name = x[1].replace(/Dr\.?\(a\)?/i, "").trim();
  return x[2] ? `${name} (${x[2].trim()})` : name;
};
const interpretationBlock = (() => {
  const x = reportTxt.match(/Conclus[ãa]o\s*([\s\S]*?)(?:Obs\.?:|Aprovado por|Unidade|P[áa]gina|$)/i);
  return x ? x[1].replace(/\s*\n\s*/g, " ").trim() : null;
})();

const study = {
  study_date,
  recorded_at,
  modality: /12\s*deriv|12\s*lead/i.test(chartTxt) ? "12-lead" : "ECG",
  lead_layout: /12\s*deriv/i.test(chartTxt) ? "3x4+rhythm" : null,
  source_format: "vector_pdf",
  fidelity: "Vector reconstruction from source PDF geometry",
  ordering_doctor: doctor(/M[ée]dico solicitante:\s*([^\n-]+?)\s*-\s*(CRM[-/\w]*\s*[\d.]+)/i, reportTxt),
  validating_doctor: doctor(/Aprovado por:\s*([^\n-]+?)\s*-\s*(CRM[-/\w]*\s*[\d.]+)/i, reportTxt),
  clinic: m(/(Hospital\s+S[íi]rio[\s-]?Liban[êe]s[^\n]*?)(?:\n|CRM|$)/i, reportTxt)
    || (/HSL/i.test(chartTxt) ? "Hospital Sírio-Libanês" : null),
  heart_rate: num(/Freq\s+(\d+)/i, chartTxt) || num(/frequ[êe]ncia card[íi]aca de\s+(\d+)/i, reportTxt),
  pr_ms: num(/\bPR\s+(\d+)/i, chartTxt),
  qrs_ms: num(/QRSD\s+(\d+)/i, chartTxt),
  qt_ms: num(/\bQT\s+(\d+)/i, chartTxt),
  qtc_ms: num(/QTcF?\s+(\d+)/i, chartTxt),
  axis_p: num(/--EIXO--[\s\S]*?\bP\s+(-?\d+)/i, chartTxt),
  axis_qrs: num(/--EIXO--[\s\S]*?\bQRS\s+(-?\d+)/i, chartTxt),
  axis_t: num(/--EIXO--[\s\S]*?\bT\s+(-?\d+)/i, chartTxt),
  interpretation: interpretationBlock,
  report_text: [m(/Descri[çc][ãa]o:\s*([^\n]+)/i, reportTxt), interpretationBlock].filter(Boolean).join(" — ") || null,
};

if (!study.study_date) { console.error("✗ could not determine study_date — pass --date YYYY-MM-DD"); process.exit(1); }

// ── generate the Lumen SVG ───────────────────────────────────────────────────
const svgTmp = path.join(os.tmpdir(), `ecg-ingest-${process.pid}.svg`);
execFileSync("node", [path.join(root, "scripts/ecg-svg.mjs"), chartPath, svgTmp], { stdio: "inherit" });
const svgBuf = fs.readFileSync(svgTmp);
fs.rmSync(svgTmp, { force: true });

const chartBuf = fs.readFileSync(chartPath);
study.source_sha = crypto.createHash("sha256").update(chartBuf).digest("hex");
const b64 = (buf) => Buffer.from(buf).toString("base64");
const files = {
  original: { b64: b64(chartBuf), contentType: "application/pdf", name: chartFile },
  svg: { b64: b64(svgBuf), contentType: "image/svg+xml", name: "ecg.svg" },
};
if (reportPath) files.report = { b64: b64(fs.readFileSync(reportPath)), contentType: "application/pdf", name: reportFile };

// ── report ───────────────────────────────────────────────────────────────────
console.log("\n── ECG ingest ──");
console.log(`patient   : ${PATIENT}`);
console.log(`folder    : ${folderAbs}`);
console.log(`chart     : ${chartFile}  (sha ${study.source_sha.slice(0, 12)}…, ${(chartBuf.length / 1024).toFixed(0)} KB)`);
console.log(`report    : ${reportFile || "(none)"}`);
console.log(`svg       : ${(svgBuf.length / 1024).toFixed(0)} KB`);
console.log("extracted :");
for (const [k, v] of Object.entries(study)) if (k !== "source_sha") console.log(`   ${k.padEnd(17)} ${v ?? "—"}`);
const missing = ["study_date", "heart_rate", "interpretation", "ordering_doctor"].filter((k) => !study[k]);
if (missing.length) console.log(`⚠ unfilled key fields: ${missing.join(", ")} — review / pass overrides.`);

if (!APPLY) { console.log("\n(dry run — nothing posted. Re-run with --apply once the endpoint is deployed.)"); process.exit(0); }

// ── POST to the deployed admin endpoint (writes R2 + DB) ─────────────────────
const res = await fetch(`${ENDPOINT}/api/admin/ecg-ingest`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ patient_clerk: PATIENT, study, files }),
});
const out = await res.json().catch(() => ({}));
if (!res.ok || !out.ok) { console.error(`\n✗ ingest failed: HTTP ${res.status} ${JSON.stringify(out)}`); process.exit(1); }
console.log(`\n✓ ingested. study id = ${out.id}`);
console.log(`  R2 keys: ${Object.entries(out.keys).filter(([, v]) => v).map(([k, v]) => `${k}=${v}`).join("  ")}`);
console.log(`  verify : ${ENDPOINT}/api/patient-ecg-object?clerk=${encodeURIComponent(PATIENT)}&id=${out.id}&kind=svg`);
