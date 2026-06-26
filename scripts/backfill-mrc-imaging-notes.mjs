#!/usr/bin/env node
/**
 * Backfill Maria Regina Coury's imaging_studies so the DB is the complete source
 * of truth for what her front-end shows — matching how Patient Zero (Joao) stores
 * imaging: a rich clinical narrative in `notes` (technique + facility + doctors +
 * date + findings + report pointer), NOT a terse one-liner with the real text
 * stranded in the static manifest JSON.
 *
 * Each note is grounded in the radiologist's report text (the clinical source of
 * truth, OCR'd into the manifest's report.textPt), de-identified (no admin/PHI
 * footer), and English to match Joao's notes and the insight engine's input. The
 * bilingual viewer copy stays in the manifest; this makes the same content
 * DB-queryable and visible to the AI Insights engine (which reads Postgres only).
 *
 * Also fills lab_country for the studies with an unambiguous Brazilian city.
 * Keyed on manifest_blob_key (stable, unique per study). Idempotent: re-running
 * sets the same values. Reads DATABASE_URL from .env.
 *
 *   node scripts/backfill-mrc-imaging-notes.mjs [--apply]
 */
import { neon } from "@neondatabase/serverless";
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  })
);
const sql = neon(env.DATABASE_URL);
const PID = "edaee222-655d-454f-98a2-652bdd58fd75"; // Maria Regina Coury

// manifest filename -> { notes, lab_country?, requesting_doctor?, performing_doctor?, lab_name?, lab_city? }
const UPDATES = {
  "maria-regina-coury-coronary-ct-2025-01-21-manifest.json": {
    notes:
      "Cardiac CT — coronary calcium score (Agatston) plus CT angiography of the coronary arteries, 21 Jan 2025. " +
      "Image series available (44 calcium-score slices + 4 secondary-capture key images; the full angiographic volume was not included in the export; previews rendered from DICOM). " +
      "No written radiologist's report was included with this exam in the records, so there is no impression on file — the original report should be obtained for interpretation.",
    // provenance genuinely absent in the source (manifest facility/doctor null); do not infer.
  },
  "maria-regina-coury-echocardiogram-2025-01-21-manifest.json": {
    notes:
      "Transthoracic echocardiogram, Hospital Unimed Piracicaba (Piracicaba, Brazil); requested by Dr. Carlos Augusto Ferreira Salles, reported by Dr. Walter Alonso Checoli (CRM 49748), 21 Jan 2025. " +
      "Structural parameters within normal reference ranges: aortic root 29 mm, left atrium 34 mm, right ventricle 22 mm, LV end-diastolic 45 mm / end-systolic 29 mm, septum and posterior wall 11 mm; LA/Ao ratio 1.2. " +
      "Normal systolic function — ejection fraction 64% (ref >58%), fractional shortening 35%, LV mass 179 g (ref 94–276 g). No specific abnormality flagged. Report-only record (no image series). Report PDF on file.",
    lab_country: "Brazil",
  },
  "maria-regina-coury-lumbar-mri-2026-05-14-manifest.json": {
    notes:
      "Lumbar spine MRI (T1/T2, multiplanar), Hospital Sírio-Libanês (São Paulo, Brazil); requested by Dr. Luisa Oliveira de Paiva (CRM-204012), reported by Dr. Marcos Felippe de Paula Correa (CRM/SP 114060 RQE 52154), 14 May 2026. " +
      "Multisegmental degenerative disc disease with marginal osteophytes; Schmorl nodes and Modic I (edema) endplate change, most prominent at the left L4-L5 margin. " +
      "Disc bulges from D12-L1 through L5-S1 with dural sac compression; at L4-L5 an annular fissure with a left foraminal/extraforaminal disco-osteophyte complex contacting the emerging L4 root, plus facet hypertrophy and ligamentum flavum thickening (left-predominant) and faint right facet bone edema. " +
      "Perineural (Tarlov) cysts at S2-S3 with mild bony remodelling; degenerative sacroiliac changes; partial atrophy and fatty replacement of the posterior paravertebral muscles. No fracture or aggressive bone lesion; spinal canal and remaining foramina preserved; conus normal. Report PDF on file. (CD export — 8 sequences + key images.)",
    lab_country: "Brazil",
  },
  "maria-regina-coury-femur-mri-2026-05-14-manifest.json": {
    notes:
      "Right thigh/femur MRI (T1/T2, multiplanar), Hospital Sírio-Libanês (São Paulo, Brazil); requested by Dr. Luisa Oliveira de Paiva (CRM-204012), reported by Dr. Marcos Felippe de Paula Correa (CRM/SP 114060 RQE 52154), 14 May 2026. " +
      "Complete rupture of the hamstring tendons at the ischial tuberosity origin with bone edema; degenerative, retracted tendon stumps (semimembranosus ~2.3 cm, conjoint ~4.8 cm) and an adjacent ~7 ml haematoma; the neighbouring sciatic nerve is continuous with preserved fascicular signal. " +
      "Gluteus medius tendinopathy/peritendinitis without tear, with peritrochanteric edema. Right hip degenerative change (chondral thinning, marginal osteophytes, degenerative ligamentum teres). Degenerative pubic symphysis. Right knee joint effusion with synovial thickening. Prior left knee arthroplasty noted. " +
      "No fracture or aggressive bone lesion. Report PDF on file. (CD export — 6 sequences + key images.)",
    lab_country: "Brazil",
  },
};

const before = await sql`SELECT manifest_blob_key, length(notes) AS n FROM imaging_studies WHERE patient_id=${PID}`;
const lenByKey = Object.fromEntries(before.map((r) => [(r.manifest_blob_key || "").split("/").pop(), r.n]));

for (const [file, u] of Object.entries(UPDATES)) {
  const key = `web/scans/${file}`;
  console.log(`\n${file}`);
  console.log(`  notes: ${lenByKey[file] ?? "?"} -> ${u.notes.length} chars` + (u.lab_country ? `  | lab_country -> ${u.lab_country}` : ""));
  if (!APPLY) continue;
  const r = await sql`
    UPDATE imaging_studies
       SET notes = ${u.notes},
           lab_country = COALESCE(${u.lab_country ?? null}, lab_country)
     WHERE patient_id = ${PID}
       AND manifest_blob_key LIKE ${"%" + file}
     RETURNING id`;
  console.log(`  updated rows: ${r.length}`);
  if (r.length !== 1) console.log(`  ⚠ expected exactly 1 row for ${file}`);
}

if (!APPLY) console.log("\n(dry run — re-run with --apply)");
else console.log("\n✓ backfill applied");
