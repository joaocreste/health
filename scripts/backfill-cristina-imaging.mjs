#!/usr/bin/env node
/**
 * Backfill Cristina Cresti's imaging into Postgres so the AI Insights pipeline
 * (lib/ai-insights.js assembleRecord — DB-only) can see it. Cristina is a
 * bespoke/front-end patient: her clinical narrative lives in
 * web/assets/cristina-labs.js (thyroid labs are already in the DB, but the
 * shoulder imaging was front-end-only). This mirrors the authoritative
 * front-end report text into imaging_studies (findings+impression in `notes`,
 * the only imaging text the pipeline reads).
 *
 * Two reads on one DIAGi sheet (15 Jun 2026): an MRI of the RIGHT shoulder
 * (full-thickness supraspinatus tear) and a plain X-ray of BOTH shoulders.
 *
 * Idempotent: deletes Cristina's imaging_studies rows, then re-inserts.
 *
 * Usage:  node scripts/backfill-cristina-imaging.mjs [--apply]
 *   (dry-run by default; pass --apply to write)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import { markSourceWritten } from "../lib/derived-freshness.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const APPLY = process.argv.includes("--apply");
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(root, ".env"), "utf8");
    const m = env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`));
    return m ? m[1] : null;
  } catch { return null; }
}
const DATABASE_URL = process.env.DATABASE_URL || fromEnv("DATABASE_URL");
if (!DATABASE_URL) { console.error("✗ DATABASE_URL not set"); process.exit(1); }
const sql = neon(DATABASE_URL);
const CLERK = "pending:cristina-cresti-d7479c";

const IMAGING = [
  {
    modality: "MRI", body_part: "Right shoulder", study_date: "2026-06-15",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/cristina-source-pdfs/cristina-diagi-shoulder-mri-2026-06-15",
    report_blob_key: "scans/cristina-source-pdfs/cristina-diagi-shoulder-mri-2026-06-15.jpeg",
    jpeg_preview_prefix: null,
    notes:
      "MRI right shoulder, DIAGi Jaú-SP (reported Dr. Fabiano Turi CRM-84648; requested Dr. Raul Bauab Filho). Technique: fast spin-echo, multiplanar, T2 and proton-density, with and without fat suppression. FINDINGS: FULL-THICKNESS TEAR OF THE SUPRASPINATUS TENDON, stump showing tendinopathy and RETRACTED 2 cm from its insertion; GOUTALLIER GRADE I (mild) fatty atrophy of the supraspinatus muscle belly. Subscapularis tendinopathy with diffuse irregularity and thinning, no full-thickness tear. Remaining rotator-cuff tendons and long head of biceps normal in morphology and signal. Acromioclavicular osteoarthritis (capsuloligamentous thickening, marginal osteophytes). Small glenohumeral joint effusion communicating with the subcoracoid space. Fluid distension of the subacromial/subdeltoid bursa (bursitis). Degenerative change of the glenoid labrum. Rotator interval normal; no significant atrophy of the other muscle bellies. IMPRESSION: full-thickness supraspinatus tear with 2 cm retraction + Goutallier grade I atrophy; subscapularis tendinopathy without full-thickness tear; AC osteoarthritis; glenoid labral degeneration; glenohumeral effusion and subacromial/subdeltoid bursitis. Picture of a degenerative age-related rotator-cuff tear; mild atrophy grade and intact remaining tendons are favourable for repair. Orthopaedic/shoulder-surgery referral warranted. (Report-only, imagery not digitised.)",
  },
  {
    modality: "XR", body_part: "Both shoulders", study_date: "2026-06-15",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/cristina-source-pdfs/cristina-diagi-shoulder-xray-2026-06-15",
    report_blob_key: "scans/cristina-source-pdfs/cristina-diagi-shoulder-xray-2026-06-15.jpeg",
    jpeg_preview_prefix: null,
    notes:
      "X-ray both shoulders (AP + axial), DIAGi Jaú-SP (reported Dr. Fabiano Turi CRM-84648; requested Dr. Raul Bauab Filho). FINDINGS: normal bone density; signs of mild acromioclavicular arthropathy; slight reduction of the glenohumeral joint space; no focal bone lesions; periarticular soft tissues preserved. Corroborates the right-shoulder MRI's AC-joint degeneration; no fracture or focal bone lesion. (Report-only, imagery not digitised.)",
  },
];

(async () => {
  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id=${CLERK} AND role='patient' LIMIT 1`;
  if (!u.length) { console.error("✗ patient not found"); process.exit(1); }
  const pid = u[0].id;
  console.log(`Patient: ${u[0].full_name} (${pid})`);
  console.log(`Plan: imaging_studies=${IMAGING.length}`);

  if (!APPLY) {
    console.log("\n(dry-run — pass --apply to write)");
    for (const s of IMAGING) console.log(`  IMG  ${s.study_date} ${s.modality}/${s.body_part} (${s.notes.length} chars)`);
    process.exit(0);
  }

  await sql`DELETE FROM imaging_studies WHERE patient_id=${pid}`;
  for (const s of IMAGING) {
    await sql`INSERT INTO imaging_studies
      (patient_id, modality, body_part, study_date, source_format, blob_prefix,
       report_blob_key, jpeg_preview_prefix, file_count, notes)
      VALUES (${pid}, ${s.modality}, ${s.body_part}, ${s.study_date}, ${s.source_format},
       ${s.blob_prefix}, ${s.report_blob_key}, ${s.jpeg_preview_prefix}, ${s.file_count}, ${s.notes})`;
  }
  const c1 = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`;
  console.log(`\n✓ written — imaging_studies=${c1[0].n}`);
  await markSourceWritten(sql, pid, { writer: "backfill-cristina-imaging" });
})().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
