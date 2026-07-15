#!/usr/bin/env node
/* Backfill viewer pointers into Joao's imaging_studies rows (PZ pattern:
   DB is source of truth — the generic renderer needs manifest_blob_key +
   file_count > 0 to build a .ct-viewer, exactly like Maria Regina's rows).

   Joao's DB rows were metadata-only mirrors of his static physical-exams
   shell, so any DB-driven surface (/consult for granted doctors, generic
   assembler pages) rendered "empty cards" — title + date, no screen viewer.
   His scan folders + sibling manifests (scans/<slug>-manifest.json) already
   exist as deployed static assets and are SCAN_OWNERS-gated (imaging scope,
   honorFilter), so this is a pure DB pointer fill.

   Idempotent + additive: only fills columns that are currently NULL/empty,
   never clobbers. Report-only studies (ct-brain 2026-01-03, sinus CT
   2026-01-12) are intentionally absent — no frame assets exist for them.
   Usage: node scripts/backfill-joao-imaging-viewers.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/)?.[1] || null;
}
const sql = neon(loadDatabaseUrl());

const JOAO = "pending:joao";

// modality + body_part + study_date -> static-asset slug (web/scans/<slug>/)
const MAP = [
  { modality: "MRI", body_part: "knee_left",                date: "2026-06-08", slug: "mri-knee-2026-06-08",     report: true  },
  { modality: "MRI", body_part: "brain",                    date: "2026-06-08", slug: "mri-brain-2026-06-08",    report: true  },
  { modality: "MRI", body_part: "face_soft_tissue",         date: "2026-06-08", slug: "mri-face-2026-06-08",     report: true  },
  { modality: "US",  body_part: "forehead",                 date: "2026-06-08", slug: "us-face-2026-06-08",      report: false },
  { modality: "MRI", body_part: "cervical_spine",           date: "2026-03-26", slug: "mri-cervical-spine",      report: true  },
  { modality: "CT",  body_part: "lumbosacral_spine",        date: "2024-10-29", slug: "ct-lumbar-sacral",        report: true  },
  { modality: "MRI", body_part: "lumbar_spine",             date: "2024-10-29", slug: "mri-lumbar-spine",        report: true  },
  { modality: "CT",  body_part: "heart_coronary",           date: "2023-07-19", slug: "tc-heart",                report: true  },
  { modality: "EEG", body_part: "brain",                    date: "2023-03-29", slug: "eeg",                     report: true  },
  { modality: "US",  body_part: "left_frontal_soft_tissue", date: "2023-03-16", slug: "punction-2023",           report: true  },
  { modality: "MRI", body_part: "brain",                    date: "2022-04-23", slug: "mri-head",                report: true  },
];

// Sanity: every mapped asset must exist on disk before we point the DB at it.
for (const m of MAP) {
  const manifest = path.join(root, "web/scans", `${m.slug}-manifest.json`);
  const dir = path.join(root, "web/scans", m.slug);
  if (!fs.existsSync(manifest)) throw new Error(`missing manifest: ${manifest}`);
  if (!fs.existsSync(dir)) throw new Error(`missing frame dir: ${dir}`);
  if (m.report && !fs.existsSync(path.join(root, "web/scans", `${m.slug}-report.pdf`)))
    throw new Error(`missing report: ${m.slug}-report.pdf`);
}

let updated = 0;
for (const m of MAP) {
  const manifestKey = `scans/${m.slug}-manifest.json`;
  const previewPrefix = `web/scans/${m.slug}/`;
  const reportKey = m.report ? `scans/${m.slug}-report.pdf` : null;
  const frameCount = fs.readdirSync(path.join(root, "web/scans", m.slug)).length;
  const rows = await sql`
    UPDATE imaging_studies i SET
      manifest_blob_key   = COALESCE(NULLIF(i.manifest_blob_key, ''), ${manifestKey}),
      jpeg_preview_prefix = COALESCE(NULLIF(i.jpeg_preview_prefix, ''), ${previewPrefix}),
      report_blob_key     = COALESCE(NULLIF(i.report_blob_key, ''), ${reportKey}),
      file_count          = COALESCE(i.file_count, ${frameCount})
    FROM users u
    WHERE u.id = i.patient_id AND u.clerk_user_id = ${JOAO}
      AND i.modality = ${m.modality} AND i.body_part = ${m.body_part}
      AND i.study_date = ${m.date}
    RETURNING i.id`;
  if (rows.length !== 1) throw new Error(`expected 1 row for ${m.slug}, got ${rows.length}`);
  updated += rows.length;
}
console.log(`updated ${updated} studies`);

const check = await sql`
  SELECT i.modality, i.body_part, i.study_date::text AS d, i.file_count,
         i.manifest_blob_key, (i.report_blob_key <> '') IS TRUE AS has_report
  FROM imaging_studies i JOIN users u ON u.id = i.patient_id
  WHERE u.clerk_user_id = ${JOAO} ORDER BY i.study_date DESC`;
check.forEach((r) => console.log([r.modality, r.body_part, r.d, r.file_count, r.manifest_blob_key || "(report-only)", r.has_report ? "report" : "-"].join(" | ")));
