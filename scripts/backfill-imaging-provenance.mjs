#!/usr/bin/env node
/* Backfill provenance (who/where) on existing imaging_studies rows.
 *
 * Reads each study's report PDF (the local static asset under web/<report_blob_key>)
 * and extracts requesting_doctor / performing_doctor / lab_name / lab_city /
 * lab_country with the same contract the live /api/ingest labs path uses
 * (reg ID inline, original spelling, null if absent — never invented).
 *
 * Idempotent + safe: every column is filled with COALESCE(existing, extracted),
 * so it only populates NULLs and never overwrites a value already present.
 * Rows with no report PDF on disk are skipped (cannot backfill without a source).
 *
 * Usage:
 *   node scripts/backfill-imaging-provenance.mjs            # dry run (no writes)
 *   node scripts/backfill-imaging-provenance.mjs --apply    # write to DB
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";
import Anthropic from "@anthropic-ai/sdk";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

function loadEnv(key) {
  if (process.env[key]) return process.env[key];
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  return env.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n]+)"?`))?.[1] || null;
}
const sql = neon(loadEnv("DATABASE_URL"));
const anthropic = new Anthropic({ apiKey: loadEnv("ANTHROPIC_API_KEY"), maxRetries: 4 });

const SYSTEM = `You read a single radiology / imaging report PDF and extract its PROVENANCE only.

Return STRICT JSON, no prose, no code fences:
{ "requesting_doctor": "<doctor who ORDERED/REQUESTED the study, or null>",
  "performing_doctor":  "<doctor who PERFORMED/SIGNED/REPORTED the study, or null>",
  "lab_name":    "<imaging center / clinic / hospital name, or null>",
  "lab_city":    "<city where it was performed, or null>",
  "lab_country": "<country where it was performed, or null>" }

REQUESTING DOCTOR — who ordered it:
  EN: "Requested by", "Ordering physician", "Referring physician", "Ordered by"
  PT: "Solicitante", "Médico solicitante", "Médico requisitante", "Solicitado por", "Requisitado por"
PERFORMING DOCTOR — who performed/signed/reported (the radiologist):
  EN: "Reported by", "Performed by", "Signed by", "Radiologist", "Responsible"
  PT: "Médico responsável", "Radiologista", "Assinado por", "Responsável pelo laudo", "Médico executor"
Append any registration ID (CRM, etc.) INLINE: "Dr. Marco Antonio de Carvalho — CRM-SP 12345".
LAB / LOCATION — facility name + city + country from the report header/footer/address.
Keep the ORIGINAL spelling and language (do NOT translate). Do NOT infer country from the language.
Return null for any field genuinely absent. Never invent.`;

const IMG_MEDIA = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

async function extract(base64, ext) {
  // Report assets are usually PDFs but some arrive as a scanned JPEG/PNG —
  // send a document block for PDFs and an image (vision) block otherwise.
  const e = (ext || "").toLowerCase();
  const block = IMG_MEDIA[e]
    ? { type: "image", source: { type: "base64", media_type: IMG_MEDIA[e], data: base64 } }
    : { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } };
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: SYSTEM,
    messages: [{
      role: "user",
      content: [
        block,
        { type: "text", text: "Extract the provenance. Strict JSON only." },
      ],
    }],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
}

const studies = await sql`
  SELECT i.id, u.full_name AS patient, i.modality, i.body_part, i.study_date, i.report_blob_key,
         i.lab_name, i.lab_city, i.lab_country, i.requesting_doctor, i.performing_doctor
  FROM imaging_studies i JOIN users u ON u.id = i.patient_id
  WHERE i.report_blob_key IS NOT NULL
  ORDER BY u.full_name, i.study_date`;

console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${studies.length} studies with a report PDF\n`);
let updated = 0, skippedNoFile = 0, skippedComplete = 0, errored = 0;

for (const s of studies) {
  const label = `${s.patient} · ${s.modality} ${s.body_part || ""} ${String(s.study_date).slice(0, 10)}`;
  const needs = !s.lab_name || !s.lab_city || !s.lab_country || !s.requesting_doctor || !s.performing_doctor;
  if (!needs) { skippedComplete++; console.log(`= ${label} — already complete, skip`); continue; }

  const diskPath = path.join(root, "web", s.report_blob_key);
  if (!fs.existsSync(diskPath)) { skippedNoFile++; console.log(`- ${label} — report PDF not on disk, skip`); continue; }

  try {
    const b64 = fs.readFileSync(diskPath).toString("base64");
    const ex = await extract(b64, path.extname(diskPath).slice(1));
    console.log(`+ ${label}`);
    console.log(`    reqDr=${ex.requesting_doctor || "∅"} | perfDr=${ex.performing_doctor || "∅"}`);
    console.log(`    lab=${ex.lab_name || "∅"} | city=${ex.lab_city || "∅"} | country=${ex.lab_country || "∅"}`);
    if (APPLY) {
      await sql`
        UPDATE imaging_studies SET
          requesting_doctor = COALESCE(requesting_doctor, ${ex.requesting_doctor || null}),
          performing_doctor = COALESCE(performing_doctor, ${ex.performing_doctor || null}),
          lab_name          = COALESCE(lab_name,          ${ex.lab_name || null}),
          lab_city          = COALESCE(lab_city,          ${ex.lab_city || null}),
          lab_country       = COALESCE(lab_country,       ${ex.lab_country || null})
        WHERE id = ${s.id}`;
      updated++;
    }
  } catch (e) {
    errored++;
    console.log(`! ${label} — extract failed: ${e.message}`);
  }
}

console.log(`\n${APPLY ? "applied" : "would update"}: ${APPLY ? updated : studies.length - skippedComplete - skippedNoFile - errored} · already-complete: ${skippedComplete} · no-file: ${skippedNoFile} · errors: ${errored}`);
