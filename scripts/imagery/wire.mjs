#!/usr/bin/env node
/**
 * Companion to scripts/imagery/ingest.py — the DB + wiring half of the generic
 * imagery ingester. Reads the `_studies.json` descriptor ingest.py emitted,
 * upserts one imaging_studies row per study (additive, delete-by-blob_prefix,
 * per the Paulo imaging-backfill-clobber lesson), then PRINTS the front-end
 * wiring: the SCAN_OWNERS gate line and, for bespoke patients, the exact
 * studies[] `viewer{}` snippet to paste. It prints rather than auto-edits
 * _worker.js / bespoke data files — access-control and hand-curated pages are
 * not things to silently mutate.
 *
 * Usage:
 *   node scripts/imagery/wire.mjs --studies .staging/imagery/<slug>-studies.json \
 *       --clerk pending:<patient-clerk> [--apply]
 *
 *   --clerk   the patient's clerk_user_id (explicit — no fuzzy name matching on
 *             medical data). Find it in web/assets/patient-context.js or the DB.
 *   --apply   run the DB upserts; without it, dry-runs and still prints wiring.
 *
 * No model calls, no PHI to any model — this only moves structured rows + text
 * the ingester already extracted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(__dirname, "..", "..");

const arg = (k, def = null) => {
  const i = process.argv.indexOf(k);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const STUDIES = arg("--studies");
const CLERK = arg("--clerk");
const APPLY = process.argv.includes("--apply");
if (!STUDIES || !CLERK) {
  console.error("usage: node scripts/imagery/wire.mjs --studies <file.json> --clerk pending:<id> [--apply]");
  process.exit(1);
}

// Bespoke patients whose pages don't call the generic renderImagingStudy — they
// need a paste-in viewer{} snippet + a page that mounts .ct-viewer. Everyone
// else is turnkey: the generic DB-driven renderer picks up the imaging_studies
// row with no code edits.
const BESPOKE = {
  "pending:silvana-creste-18ba19": { file: "web/assets/silvana-labs.js", array: "studies[]", token: "silvana",
    renderer: "silvanaStudiesList (mounts .ct-viewer for entries with a viewer{})" },
  "pending:paulo-silotto-df3441": { file: "web/assets/paulo-*.js", array: "bespoke exam renderer", token: "paulo",
    renderer: "renderPauloPhysicalExams (hand-built .pl-ct-viewer blocks)" },
};

const desc = JSON.parse(fs.readFileSync(STUDIES, "utf8"));
const slug = desc.slug;

const url = (process.env.DATABASE_URL ||
  fs.readFileSync(path.join(repo, ".env"), "utf8").match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)[1])
  .trim().replace(/["']/g, "");
const sql = neon(url);

const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${CLERK} LIMIT 1`;
if (!u.length) { console.error(`✗ patient not found for clerk ${CLERK}`); process.exit(1); }
const pid = u[0].id;
console.log(`Patient: ${u[0].full_name} (${pid})   clerk ${CLERK}`);
console.log(`Descriptor: ${desc.studies.length} study(ies) for token '${slug}'\n`);

for (const s of desc.studies) {
  const notes = s.notes_seed
    ? s.notes_seed
    : `${(s.modality || "Imaging")} study (${s.kind}) — ${s.date}. ${s.file_count} image(s)` +
      `${s.facility ? `, ${s.facility}` : ""}. Provenance from DICOM tags; refine findings/city/country as needed.`;
  const row = {
    modality: s.modality || "OTHER",
    body_part: s.kind.replace(new RegExp(`-${(s.modality || "").toLowerCase()}$`), "") || null,
    study_date: s.date,
    source_format: s.source_format,
    blob_prefix: s.blob_prefix,
    manifest_blob_key: s.manifest_blob_key,
    report_blob_key: s.report_blob_key,
    jpeg_preview_prefix: s.jpeg_preview_prefix,
    file_count: s.file_count,
    requesting_doctor: s.requestingDoctor,
    performing_doctor: s.reportingDoctor,
    lab_name: s.facility,
    lab_city: s.facilityCity,
    lab_country: s.facilityCountry,
    notes,
  };
  console.log(`  • ${s.date} ${row.modality.padEnd(4)} ${s.web_slug}  imgs=${s.file_count} report=${s.report}`);
  if (APPLY) {
    await sql`DELETE FROM imaging_studies WHERE patient_id = ${pid} AND blob_prefix = ${row.blob_prefix}`;
    await sql`
      INSERT INTO imaging_studies
        (patient_id, modality, body_part, study_date, source_format, blob_prefix,
         manifest_blob_key, report_blob_key, jpeg_preview_prefix, file_count, notes,
         requesting_doctor, performing_doctor, lab_name, lab_city, lab_country)
      VALUES
        (${pid}, ${row.modality}, ${row.body_part}, ${row.study_date}, ${row.source_format}, ${row.blob_prefix},
         ${row.manifest_blob_key}, ${row.report_blob_key}, ${row.jpeg_preview_prefix}, ${row.file_count}, ${row.notes},
         ${row.requesting_doctor}, ${row.performing_doctor}, ${row.lab_name}, ${row.lab_city}, ${row.lab_country})`;
  }
}

if (APPLY) {
  await markSourceWritten(sql, pid, { writer: "imagery-wire" });
  console.log("\n✓ imaging_studies upserted.");
} else {
  console.log("\n(dry run — re-run with --apply to upsert imaging_studies rows)");
}

// ── front-end wiring instructions ────────────────────────────────────────────
const worker = fs.readFileSync(path.join(repo, "web", "_worker.js"), "utf8");
const scanPrefix = `/scans/${slug}-`;
const hasScanRule = worker.includes(`prefix: "${scanPrefix}"`) &&
  worker.slice(worker.indexOf(`prefix: "${scanPrefix}"`), worker.indexOf(`prefix: "${scanPrefix}"`) + 160).includes('"imaging"');

console.log("\n──────── FRONT-END WIRING ────────");
if (hasScanRule) {
  console.log(`✓ SCAN_OWNERS already gates ${scanPrefix} (imaging). No change needed.`);
} else {
  console.log(`1) web/_worker.js — add to SCAN_OWNERS (BELOW any narrower /scans/${slug}-...-pdfs labs rule, first-match wins):`);
  console.log(`     { prefix: "${scanPrefix}", patient: PATIENT_CLERKS.${slug}, anyOf: ["imaging"], honorFilter: true },`);
  console.log(`   (confirm PATIENT_CLERKS.${slug} exists; else use the literal clerk string.)`);
}

const bespoke = BESPOKE[CLERK];
if (bespoke) {
  console.log(`\n2) BESPOKE patient — ${u[0].full_name} renders via ${bespoke.renderer}.`);
  console.log(`   Add each study below to ${bespoke.file} → ${bespoke.array} (newest first), then bump its ?v= in PATIENT_DATA_ASSETS:`);
  for (const s of desc.studies) {
    console.log(`
     {
       date: '${s.date}', category: 'imaging',
       modality_en: '${s.modality} study', modality_pt: '${s.modality}',
       title_en: '${(s.study_instance_uid ? s.kind.replace(/-/g, " ") : s.kind)}', title_pt: '${s.kind.replace(/-/g, " ")}',
       laboratory: ${JSON.stringify(s.facility || "")}, requested_by: ${JSON.stringify(s.requestingDoctor || "")}, doctor: ${JSON.stringify(s.reportingDoctor || "")},
       conclusion_en: '<fill: findings/impression EN>', conclusion_pt: '<fill: findings/impression PT>',
       viewer: {
         manifest: '${s.manifest_blob_key}',
         prefix: '${s.blob_prefix}/',
         count: ${s.file_count},
         report: ${JSON.stringify(s.report_blob_key || "")},
       },
     },`);
  }
  console.log(`\n   (The bespoke renderer must mount a .ct-viewer for entries with viewer{} and call`);
  console.log(`    window.JCInitCtViewers() in its dispatch 'after' callback — Silvana's already does.)`);
} else {
  console.log(`\n2) GENERIC patient — turnkey. The DB-driven renderImagingStudy will mount the`);
  console.log(`   .ct-viewer from the imaging_studies row automatically. No code edits needed.`);
}

console.log(`\n3) Deploy web/ (clean-worktree deploy, --branch main). Verify:`);
console.log(`     curl -sI "https://lumenhealth.io/${desc.studies[0].manifest_blob_key}?viewer=pending:admin"  (expect 200)`);
console.log(`     curl -sI "https://lumenhealth.io/${desc.studies[0].manifest_blob_key}"                       (expect 403)`);
