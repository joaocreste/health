#!/usr/bin/env node
/**
 * Backfill Paulo Augusto Silotto's clinical record into Postgres so the
 * AI Insights pipeline (lib/ai-insights.js assembleRecord — DB-only) can see
 * it. Paulo is a bespoke/front-end patient: his clinical narrative lives in
 * web/assets/patient-context.js (PAULO_STUDIES + history/other-studies
 * builders) and was never written to the DB. This mirrors the authoritative
 * front-end content into imaging_studies (findings+impression in `notes`,
 * which is the only imaging text the pipeline reads), injuries and
 * clinical_history.
 *
 * Idempotent: deletes Paulo's rows in these three tables, then re-inserts.
 *
 * Usage:  node scripts/backfill-paulo-clinical.mjs [--apply]
 *   (dry-run by default; pass --apply to write)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

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
const CLERK = "pending:paulo-silotto-df3441";

const IMAGING = [
  {
    modality: "MRI", body_part: "Cervical spine", study_date: "2026-05-15",
    source_format: "JPEG", file_count: 92,
    blob_prefix: "scans/paulo-cervical-mri-2026-05-15",
    report_blob_key: "scans/paulo-cervical-mri-2026-05-15-report.pdf",
    jpeg_preview_prefix: "scans/paulo-cervical-mri-2026-05-15",
    notes:
      "MRI cervical spine, CETAM (Dr. Marco Antonio de Carvalho, CRM-99607). Multilevel cervical degenerative change. Sinistroconvex axis deviation. Arthrosis of uncovertebral and facet joints with diffuse ligamentum flavum thickening, more marked at lower levels. Disc dehydration predominating C6-C7 with reduced height. Mild C3-C4 and C4-C5 disc bulging flattening the ventral dural sac with mild bilateral foraminal narrowing. Diffuse C5-C6 disco-osteophytic bulge COMPRESSING THE VENTRAL SPINAL CORD without myelopathy, with bilateral foraminal narrowing contacting both exiting roots. Cord signal normal. Mild paravertebral muscle hypotrophy. IMPRESSION: multilevel cervical degenerative disease; C5-C6 ventral cord compression without myelopathy; bilateral foraminal narrowing.",
  },
  {
    modality: "MRI", body_part: "Lumbar spine", study_date: "2026-05-15",
    source_format: "JPEG", file_count: 85,
    blob_prefix: "scans/paulo-lombar-mri-2026-05-15",
    report_blob_key: "scans/paulo-lombar-mri-2026-05-15-report.pdf",
    jpeg_preview_prefix: "scans/paulo-lombar-mri-2026-05-15",
    notes:
      "MRI lumbar spine, CETAM (Dr. Marco Antonio de Carvalho). Diffuse multisegmental degenerative spondylodiscopathy. Sinistroconvex axis deviation; mild L3-over-L4 anterolisthesis; minimal L1-over-L2 retrolisthesis. Degenerative discopathy L1-L2, L2-L3, L4-L5 with Modic I (ACTIVE oedema) at all three levels and Modic II (fatty) at L4-L5. L2-L3 bulge with left foraminal stenosis and exiting-root compression. L3-L4 pseudo-bulge + facet hypertrophy + ligamentum flavum thickening producing SPINAL CANAL STENOSIS with anterior descending root compression. L4-L5 disco-osteophytic bulge contacting descending roots. L5-S1 LEFT paramedian/foraminal disc EXTRUSION with facet hypertrophy COMPRESSING THE DESCENDING LEFT S1 ROOT. Moderate paravertebral muscle hypotrophy. Interspinous ligament oedema L2-L3, L3-L4, L5-S1. IMPRESSION: active multilevel lumbar degeneration; L3-L4 canal stenosis; L5-S1 left S1 root compression.",
  },
  {
    modality: "MRI", body_part: "Cervical spine", study_date: "2023-04-26",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-cervical-mri-2023-04-26",
    report_blob_key: "scans/paulo-cervical-mri-2023-04-26-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "MRI cervical spine, CETAM (Dra. Juliane Giselle Hortolam). NEW sinistroconvex axis deviation vs 2015. C6-C7 stable (hypohydrated, reduced height). Disease migrated upward: C5-C6 now carries dominant median protrusion impressing ventral sac. C4-C5 bulge flattening dural sac. Mild paravertebral muscle hypotrophy (first mention). No cord contact, no extrusion. (Report-only, imagery not digitised.)",
  },
  {
    modality: "MRI", body_part: "Lumbar spine", study_date: "2023-04-26",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-lombar-mri-2023-04-26",
    report_blob_key: "scans/paulo-lombar-mri-2023-04-26-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "MRI lumbar spine, CETAM (Dra. Juliane Giselle Hortolam). FIRST lumbar study on file. Discrete L3-over-L4 anterolisthesis. Diffuse disc dehydration/height loss. L4-L5 discopathy with Modic II (fatty). Bulges L1-L2, L2-L3, L4-L5, L3-L4. Most acute: L5-S1 LEFT paramedian/foraminal protrusion + facet hypertrophy compressing the descending LEFT S1 root. Moderate paravertebral muscle hypotrophy. (Report-only, imagery not digitised.)",
  },
  {
    modality: "MRI", body_part: "Cervical spine", study_date: "2015-11-23",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-cervical-mri-2015-11-23",
    report_blob_key: "scans/paulo-cervical-mri-2015-11-23-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "MRI cervical spine, CETAM (Dr. André Luis Tucci Semeghini). EARLIEST study on file (baseline). Incipient cervical spondylopathy. Mild C6-C7 disc dehydration. Small posterior bulges C4-C5, C5-C6, C7-T1. Moderate posterocentral disc protrusion at C6-C7 compressing the ventral dural sac. Mild bilateral foraminal narrowing C6-C7 (right>left) without frank stenosis. No extrusions, no cord contact, no axis deviation. (Report-only, imagery not digitised.)",
  },
  {
    modality: "MRI", body_part: "Right shoulder", study_date: "2015-11-23",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-right-shoulder-mri-2015-11-23",
    report_blob_key: "scans/paulo-right-shoulder-mri-2015-11-23-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "MRI right shoulder, CETAM. INTENSE hypertrophic acromioclavicular arthropathy — irregular contours, marginal osteophytes, subchondral cysts, bone oedema/contusion, moderate capsular distension. Rotator cuff tendons normal thickness and signal. Long-head biceps tendon normal. No subacromial-subdeltoid bursal effusion, no joint effusion. Pain generator = AC joint (degenerative); cuff intact. (Report-only, imagery not digitised.)",
  },
  {
    modality: "MRI", body_part: "Right knee", study_date: "2019-08-01",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-right-knee-mri-2019-08-01",
    report_blob_key: "scans/paulo-right-knee-mri-2019-08-01-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "MRI right knee, CETAM (Dra. Carla Catarina Horr). Old anterior tibial spine avulsion with distal patellar tendon oedema/tendinosis (possible Osgood-Schlatter sequela). Cicatricial changes of collateral and medial patellofemoral ligaments, no current rupture. Mucinoid degeneration of medial meniscus. Free-border amputation at body/posterior-horn of LATERAL meniscus (possible prior radial tear). GRADE III femoropatellar chondropathy at medial margin. Moderate joint effusion. (Report-only, imagery not digitised.)",
  },
  {
    modality: "CT", body_part: "Abdomen & pelvis", study_date: "2022-03-31",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-abdomen-pelvis-ct-2022-03-31",
    report_blob_key: "scans/paulo-abdomen-pelvis-ct-2022-03-31-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "CT abdomen & pelvis with contrast, CETAM (Dr. Rodney Jose Massa Ferro Ferraz). Liver lobulated contours, mild right-lobe reduction, tiny 4mm hypodensity seg IVb (?small cyst). Pancreas moderate adipose substitution. Small aortic atheromatous calcification. BLADDER WALL THICKENING with irregular contours; mildly globose prostate with small calcifications impressing bladder floor — UROLOGY WORKUP RECOMMENDED. Sigmoid/descending colon DIVERTICULOSIS (no pericolic stranding). Marked dorsolumbar degenerative change with severe L4-L5 discopathy (corroborates spine MRI). Volume reduction of paraspinal + gluteal musculature. Calcified granuloma left gluteal subcutaneous. (Report-only, imagery not digitised.)",
  },
  {
    modality: "CT", body_part: "Cranium", study_date: "2023-04-26",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-cranium-ct-2023-04-26",
    report_blob_key: "scans/paulo-cranium-ct-2023-04-26-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "CT cranium non-contrast, CETAM. No haemorrhage; normal parenchymal attenuation; midline centred. Several small hyperdense foci in basal cisterns/sella/left sylvian fissure/posterior fossa — RESIDUAL CONTRAST FROM OLD MYELOGRAPHY (evidence of long-standing/decades-deep spine disease). Mild age-appropriate sulcal/sylvian widening. Falx calcifications. Mild left sphenoid + right maxillary mucosal thickening. No fracture, no mass. Reassuring. (Report-only, imagery not digitised.)",
  },
  {
    modality: "CT", body_part: "Face & sinuses", study_date: "2023-03-14",
    source_format: "JPEG", file_count: 0,
    blob_prefix: "scans/paulo-face-sinus-ct-2023-03-14",
    report_blob_key: "scans/paulo-face-sinus-ct-2023-03-14-report.pdf",
    jpeg_preview_prefix: null,
    notes:
      "CT face & sinuses non-contrast, CETAM. Mucosal thickening maxillary sinuses, left sphenoid, ethmoid cells — low-grade chronic sinus inflammation. Nasal SEPTAL DEVIATION (leftward mid-portion) with 4mm bony thickening. Irregular turbinate contours; patent osteomeatal complexes. Asymmetric olfactory fossae (Keros II). Incidental residual myelography contrast in basal cisterns (cross-ref cranium CT). ENT-referable; no aggressive sinonasal disease. (Report-only, imagery not digitised.)",
  },
];

const INJURIES = [
  {
    name: "Right knee — chronic internal derangement",
    occurred_on: "2019-08-01",
    notes:
      "Per 2019 MRI: grade III femoropatellar chondropathy (medial margin), mucinoid medial-meniscus degeneration, possible prior lateral-meniscus radial tear, old anterior tibial spine avulsion (possible Osgood-Schlatter sequela), moderate effusion. Chronic mechanical, load-bearing knee pain source; an antalgic gait reloads the compromised left lumbar segments.",
  },
  {
    name: "Right shoulder — acromioclavicular arthropathy",
    occurred_on: "2015-11-23",
    notes:
      "Per 2015 MRI: intense hypertrophic AC-joint arthropathy (osteophytes, subchondral cysts, bone oedema); rotator cuff intact. Mechanical AC-joint pain source amenable to local injection. Earliest evidence the degeneration is not spine-only.",
  },
];

const HISTORY = [
  {
    category: "musculoskeletal",
    heading: "Multilevel degenerative spine disease — 11-year progression",
    occurred_on: "2015-11-23",
    detail:
      "Cervical (MRIs 2015/2023/2026) + lumbar (MRIs 2023/2026), all CETAM. Dominant cervical lesion migrated C6-C7 (2015) -> C5-C6 (2023, still 2026), now with VENTRAL CORD CONTACT without myelopathy. Lumbar: L5-S1 LEFT S1 root compression stable since 2023; NEW L3-L4 canal stenosis; ACTIVE Modic I oedema at L1-L2/L2-L3/L4-L5 + interspinous-ligament oedema (inflammatory, not burnt-out). Consistent LEFT-sided radicular burden (S1 below, C6/C7 above). Paravertebral muscle hypotrophy (mild cervical, moderate lumbar), corroborated on 2022 CT (paraspinal+gluteal). Old myelography residue on head/face CT indicates decades-deep disease.",
  },
  {
    category: "pain",
    heading: "Chronic mechanical + neuropathic pain (imaging-inferred; no symptom record)",
    occurred_on: null,
    detail:
      "No documented symptom, pain-scale, exam or medication data in chart. Imaging substrate strongly supports chronic pain: axial low back pain (active Modic I), LEFT S1 sciatica (L5-S1 extrusion), neurogenic claudication (L3-L4 stenosis), cervical/arm radicular (C5-C6), AC-joint shoulder pain and patellofemoral knee pain. Action: capture actual symptoms, neuro exam and current medications to convert inference into record.",
  },
  {
    category: "urology",
    heading: "Incidental urological finding — workup recommended",
    occurred_on: "2022-03-31",
    detail:
      "2022 abdomen/pelvis CT: bladder-wall thickening with irregular contours + mildly globose prostate with calcifications impressing the bladder floor. Radiologist explicitly recommended urological investigation. Time-sensitive non-spine item; follow-up status unknown.",
  },
  {
    category: "gastrointestinal",
    heading: "Sigmoid/descending-colon diverticulosis",
    occurred_on: "2022-03-31",
    detail: "Incidental on 2022 CT; no pericolic stranding. Routine GI follow-up.",
  },
  {
    category: "ent",
    heading: "Chronic low-grade sinus disease + nasal septal deviation",
    occurred_on: "2023-03-14",
    detail:
      "2023 face/sinus CT: mucosal thickening (maxillary, left sphenoid, ethmoid) + leftward septal deviation with 4mm bony thickening. ENT-referable; plausible chronic nasal obstruction. Benign.",
  },
];

(async () => {
  const u = await sql`SELECT id, full_name FROM users WHERE clerk_user_id=${CLERK} AND role='patient' LIMIT 1`;
  if (!u.length) { console.error("✗ patient not found"); process.exit(1); }
  const pid = u[0].id;
  console.log(`Patient: ${u[0].full_name} (${pid})`);
  console.log(`Plan: imaging_studies=${IMAGING.length}, injuries=${INJURIES.length}, clinical_history=${HISTORY.length}`);

  if (!APPLY) {
    console.log("\n(dry-run — pass --apply to write)");
    for (const s of IMAGING) console.log(`  IMG  ${s.study_date} ${s.modality}/${s.body_part} (${s.notes.length} chars)`);
    for (const i of INJURIES) console.log(`  INJ  ${i.name}`);
    for (const h of HISTORY) console.log(`  HIST [${h.category}] ${h.heading}`);
    process.exit(0);
  }

  await sql`DELETE FROM imaging_studies WHERE patient_id=${pid}`;
  await sql`DELETE FROM injuries WHERE patient_id=${pid}`;
  await sql`DELETE FROM clinical_history WHERE patient_id=${pid}`;

  for (const s of IMAGING) {
    await sql`INSERT INTO imaging_studies
      (patient_id, modality, body_part, study_date, source_format, blob_prefix,
       report_blob_key, jpeg_preview_prefix, file_count, notes)
      VALUES (${pid}, ${s.modality}, ${s.body_part}, ${s.study_date}, ${s.source_format},
       ${s.blob_prefix}, ${s.report_blob_key}, ${s.jpeg_preview_prefix}, ${s.file_count}, ${s.notes})`;
  }
  for (const i of INJURIES) {
    await sql`INSERT INTO injuries (patient_id, name, occurred_on, notes)
      VALUES (${pid}, ${i.name}, ${i.occurred_on}, ${i.notes})`;
  }
  for (const h of HISTORY) {
    await sql`INSERT INTO clinical_history (patient_id, category, heading, detail, occurred_on)
      VALUES (${pid}, ${h.category}, ${h.heading}, ${h.detail}, ${h.occurred_on})`;
  }

  const c1 = await sql`SELECT count(*)::int n FROM imaging_studies WHERE patient_id=${pid}`;
  const c2 = await sql`SELECT count(*)::int n FROM injuries WHERE patient_id=${pid}`;
  const c3 = await sql`SELECT count(*)::int n FROM clinical_history WHERE patient_id=${pid}`;
  console.log(`\n✓ written — imaging_studies=${c1[0].n}, injuries=${c2[0].n}, clinical_history=${c3[0].n}`);
})().catch((e) => { console.error("✗ failed:", e.message); process.exit(1); });
