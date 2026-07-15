#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

// Bump on every change to what this assembler emits, so the chatbot context is
// visibly versioned. v2 = folded in reviewed therapy-session synthesis.
// v3 = current medications block from db/medications (daily doses) — the meds
// table is DB-rendered client-side, so the static-HTML strip never sees it.
const RECORD_VERSION = "v3";
const JOAO_CLERK = "pending:joao";

const PAGES = [
  ["Summary",         "web/home.html"],
  ["Physical",        "web/physical.html"],
  ["Vitals",          "web/physical-vitals.html"],
  ["Exams & Imaging", "web/physical-exams.html"],
  ["Genetics",        "web/physical-genetics.html"],
  ["Mental",          "web/mental.html"],
  ["Spiritual",       "web/spiritual.html"],
];

const ENTITIES = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
  "&quot;": '"', "&#39;": "'", "&apos;": "'", "&mdash;": "—",
  "&ndash;": "–", "&hellip;": "…", "&rsquo;": "’", "&lsquo;": "‘",
  "&ldquo;": "“", "&rdquo;": "”", "&middot;": "·",
};

function stripHtml(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/?(p|div|section|article|li|ul|ol|h[1-6]|tr|td|th|br|hr|header|footer|nav|figure|figcaption|main|aside|table|thead|tbody|details|summary|blockquote|pre|code)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m.toLowerCase()] ?? " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const sections = [];
for (const [label, relPath] of PAGES) {
  const html = readFileSync(join(root, relPath), "utf8");
  const text = stripHtml(html);
  sections.push(`========================================\nSECTION: ${label}\nSOURCE: ${relPath}\n========================================\n\n${text}`);
}

/* Therapy-session synthesis (migration 0020) for the chatbot context.
   THREE rules, enforced here, not downstream:
     - REVIEW GATE: only sessions a clinician has signed off (reviewed_at NOT
       NULL) are folded in. Pending sessions are counted but never quoted.
     - RISK EXCLUDED: therapy_risk_flags are NEVER read into this file — risk
       belongs to the clinician review surface, not a conversational answer.
     - LABELLED: everything here is flagged as AI synthesis of session content.
   Degrades gracefully (and offline) when DATABASE_URL is absent. */
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const env = readFileSync(join(root, ".env"), "utf8");
    const m = env.match(/DATABASE_URL\s*=\s*"?([^"\n]+)"?/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function buildTherapySection() {
  const dsn = loadDatabaseUrl();
  if (!dsn) {
    console.warn("  [therapy] no DATABASE_URL — skipping therapy synthesis (offline build).");
    return null;
  }
  const sql = neon(dsn);
  const prow = await sql`SELECT id FROM users WHERE clerk_user_id = ${JOAO_CLERK} AND role = 'patient' LIMIT 1`;
  if (!prow.length) return null;
  const pid = prow[0].id;

  const [pending, reviewed] = await Promise.all([
    sql`SELECT count(*)::int AS n FROM therapy_sessions WHERE patient_id = ${pid} AND reviewed_at IS NULL`,
    sql`SELECT id, session_date, session_type, therapist_name, session_summary, patient_overall_affect
          FROM therapy_sessions
          WHERE patient_id = ${pid} AND reviewed_at IS NOT NULL
          ORDER BY session_date DESC LIMIT 8`,
  ]);
  const pendingN = pending[0].n;

  if (reviewed.length === 0) {
    return [
      `No clinician-reviewed therapy sessions are available for the chatbot yet.`,
      pendingN ? `${pendingN} session(s) are ingested but pending clinician review and are therefore`
        + ` excluded from this record (interpretive content and any safety flags are review-gated).` : ``,
      `Risk/safety content is never included here by design.`,
    ].filter(Boolean).join(" ");
  }

  const ids = reviewed.map((r) => r.id);
  const [themes, strengths, lens] = await Promise.all([
    sql`SELECT canonical_label, max(display_label_en) AS label, count(*)::int AS n,
               max(session_date) AS last_seen
          FROM therapy_themes
          WHERE patient_id = ${pid} AND session_id = ANY(${ids})
          GROUP BY canonical_label ORDER BY n DESC, last_seen DESC LIMIT 12`,
    sql`SELECT polarity, label FROM therapy_strengths_growth
          WHERE patient_id = ${pid} AND session_id = ANY(${ids}) ORDER BY polarity`,
    sql`SELECT lens, construct, observation FROM therapy_lens_interpretations
          WHERE patient_id = ${pid} AND session_id = ANY(${ids})
          ORDER BY confidence DESC NULLS LAST LIMIT 6`,
  ]);

  const lines = [];
  lines.push(`AI synthesis of clinician-reviewed psychotherapy sessions (risk/safety content excluded by design).`);
  if (pendingN) lines.push(`(${pendingN} further session[s] are ingested but pending review and not included.)`);
  lines.push(``, `Recent sessions:`);
  for (const r of reviewed) {
    lines.push(`- ${String(r.session_date).slice(0, 10)} (${r.session_type}${r.therapist_name ? ", " + r.therapist_name : ""}): ${r.session_summary || ""}`);
    if (r.patient_overall_affect) lines.push(`  Affect: ${r.patient_overall_affect}`);
  }
  lines.push(``, `Most recurring themes (reviewed sessions):`);
  for (const t of themes) lines.push(`- ${t.label || t.canonical_label} — ${t.n} session(s), last ${String(t.last_seen).slice(0, 10)}`);
  lines.push(``, `Strengths & growth areas (AI inference):`);
  for (const s of strengths) lines.push(`- [${s.polarity}] ${s.label}`);
  lines.push(``, `Theoretical-lens highlights (AI inference, one register among several):`);
  for (const l of lens) lines.push(`- ${l.lens}/${l.construct}: ${l.observation}`);
  return lines.join("\n");
}

/* Current medications (db/medications) + supplements. Emitted with the
   normalized DAILY dose so the model can reason pharmacologically (check the
   med list FIRST when interpreting any lab / vital / symptom — a finding a
   current drug explains is attributed to the drug, not to pathology). */
async function buildMedicationsSection() {
  const dsn = loadDatabaseUrl();
  if (!dsn) {
    console.warn("  [meds] no DATABASE_URL — skipping medications (offline build).");
    return null;
  }
  const sql = neon(dsn);
  const prow = await sql`SELECT id FROM users WHERE clerk_user_id = ${JOAO_CLERK} AND role = 'patient' LIMIT 1`;
  if (!prow.length) return null;
  const pid = prow[0].id;
  const [meds, supps] = await Promise.all([
    sql`SELECT name, dose, frequency, daily_dose_amount, daily_dose_unit, drug_class, status, note
          FROM medications WHERE patient_id = ${pid}
          ORDER BY (status = 'active') DESC, name`,
    sql`SELECT name, dose FROM supplements WHERE patient_id = ${pid} ORDER BY name`,
  ]);
  if (!meds.length && !supps.length) return null;

  const lines = [];
  lines.push(`Current medication list (informational record confirmed by the patient — not a prescription).`);
  lines.push(`Daily dose = strength x units per dose x doses per day. Null daily dose = PRN / non-daily / needs review.`);
  lines.push(``, `Medications:`);
  for (const m of meds) {
    const daily = m.daily_dose_amount != null ? `${m.daily_dose_amount} ${m.daily_dose_unit || ""}/day` : "no fixed daily total";
    const bits = [daily];
    if (m.frequency) bits.push(`schedule: ${m.frequency}`);
    if (m.drug_class) bits.push(m.drug_class);
    bits.push(m.status || "status unknown");
    lines.push(`- ${m.name} — ${bits.join("; ")}`);
    if (m.note) lines.push(`  ${m.note}`);
  }
  if (supps.length) {
    lines.push(``, `Supplements:`);
    for (const s of supps) lines.push(`- ${s.name}${s.dose ? ` — ${s.dose}` : ""}`);
  }
  lines.push(``, `When interpreting any lab, vital or symptom in this record, check this list first: attribute drug-explained findings to the drug rather than to pathology, and surface plausible drug-finding correlations.`);
  return lines.join("\n");
}

const medsText = await buildMedicationsSection();
if (medsText) {
  sections.push(`========================================\nSECTION: Current Medications\nSOURCE: db/medications (daily doses)\n========================================\n\n${medsText}`);
}

const therapyText = await buildTherapySection();
if (therapyText) {
  sections.push(`========================================\nSECTION: Therapy Sessions (AI synthesis)\nSOURCE: db/therapy_sessions (migration 0020)\n========================================\n\n${therapyText}`);
}

const header = `# Patient Health Record — Joao Victor Creste

This file is the complete written record extracted from the patient's health portal.
The portal is bilingual (English / Portuguese); both languages appear interleaved.
Generated by scripts/build-patient-record.mjs (record ${RECORD_VERSION}).
`;

const out = header + "\n\n" + sections.join("\n\n");
writeFileSync(join(root, "web/assets/patient-record.txt"), out, "utf8");

const sizeKb = (out.length / 1024).toFixed(1);
console.log(`Wrote web/assets/patient-record.txt (${sizeKb} KB, ${sections.length} sections, record ${RECORD_VERSION})`);
