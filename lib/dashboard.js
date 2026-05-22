/**
 * LLM-authored patient dashboards.
 *
 * One section per call so the client can sequence (and show progress).
 * Sections: home, physical, mental, spiritual, assessment.
 *
 * Each call:
 *   1. Gathers a small structured payload for the section from Neon.
 *   2. Sends it to Claude with a strict prompt (no invention, ~120 words).
 *   3. Stores the markdown in patient_dashboards (replaces any prior copy).
 *   4. Returns the summary + token usage to the caller.
 *
 * Token budget per call is modest because the structured input is curated,
 * not raw PDFs.
 */

import { neon } from "@neondatabase/serverless";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

export const DASHBOARD_SECTIONS = ["home", "physical", "mental", "spiritual", "assessment"];

const SYSTEM_PROMPT = `You are a health-data synthesist writing a section summary for a clinical dashboard.

RULES (strict):
- Use ONLY the data in the user message. Never invent markers, dates, conditions, medications, or events.
- Be concrete: cite the actual values, dates, and panel names from the data. Quantify when possible.
- 80–160 words, two short paragraphs at most. Plain markdown. No headings, no bullet lists, no emojis.
- If there is no signal worth surfacing in this section, say so plainly in one sentence ("No data ingested yet for this section; drop relevant exports from Add data."). Do NOT pad.
- Tone: clinical, restrained, second-person ("your"). No marketing language. No hedging like "may suggest" unless the data actually warrants it.
- Flagged markers (H/HH/L/LL) deserve explicit mention with the value, unit, and reference range. Latest reading wins.
- Return ONLY the markdown body of the summary. No preamble, no JSON.`;

/* ───── Section payload builders ────────────────────────────────── */

async function profileLine(sql, patientId) {
  const r = await sql`
    SELECT u.full_name,
           pp.date_of_birth, pp.sex, pp.country_of_residence
    FROM users u
    LEFT JOIN patient_profiles pp ON pp.user_id = u.id
    WHERE u.id = ${patientId}
    LIMIT 1
  `;
  if (r.length === 0) return "Unknown patient";
  const p = r[0];
  const bits = [p.full_name || "(unnamed)"];
  if (p.date_of_birth) {
    const dob = new Date(p.date_of_birth);
    const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000));
    bits.push(`age ${age}`);
  }
  if (p.sex) bits.push(p.sex);
  if (p.country_of_residence) bits.push(p.country_of_residence);
  return bits.join(", ");
}

async function buildPhysicalPayload(sql, patientId) {
  const [panels, flagged, docs, vitals, ecg, imaging] = await Promise.all([
    sql`
      SELECT panel,
             count(*)::int AS marker_count,
             max(taken_at)::date AS latest_date,
             max(laboratory) AS lab
      FROM lab_results
      WHERE patient_id = ${patientId}
      GROUP BY panel
      ORDER BY latest_date DESC NULLS LAST, marker_count DESC
      LIMIT 16
    `,
    sql`
      SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at::date AS taken_at
      FROM lab_results
      WHERE patient_id = ${patientId} AND flag IS NOT NULL AND flag <> ''
      ORDER BY taken_at DESC NULLS LAST
      LIMIT 24
    `,
    sql`
      SELECT kind, title, document_date, metadata->'classifier'->>'summary' AS summary
      FROM documents
      WHERE patient_id = ${patientId}
        AND kind IN ('doctor_report', 'ecg_pdf', 'imaging_image', 'dicom_series', 'genetics_report')
      ORDER BY COALESCE(document_date, created_at::date) DESC
      LIMIT 12
    `,
    sql`
      SELECT count(*)::int AS days,
             min(day)::date AS first_day, max(day)::date AS last_day
      FROM vitals_daily WHERE patient_id = ${patientId}
    `,
    sql`SELECT count(*)::int AS n FROM ecg_events WHERE patient_id = ${patientId}`,
    sql`
      SELECT modality, body_part, study_date, source_format
      FROM imaging_studies WHERE patient_id = ${patientId}
      ORDER BY study_date DESC NULLS LAST LIMIT 8
    `,
  ]);
  return { panels, flagged_markers: flagged, recent_docs: docs, vitals: vitals[0], ecg_events: ecg[0].n, imaging };
}

async function buildMentalPayload(sql, patientId) {
  const [writings, moods, psych, panic, risk] = await Promise.all([
    sql`
      SELECT title, written_at::date AS written_at, language,
             COALESCE(LEFT(extracted_text, 240), '') AS excerpt
      FROM writings WHERE patient_id = ${patientId}
      ORDER BY written_at DESC NULLS LAST LIMIT 8
    `,
    sql`
      SELECT count(*)::int AS n, min(occurred_at)::date AS first, max(occurred_at)::date AS last
      FROM mood_entries WHERE patient_id = ${patientId}
    `,
    sql`
      SELECT category, count(*)::int AS n
      FROM psych_items WHERE patient_id = ${patientId}
      GROUP BY category ORDER BY n DESC LIMIT 10
    `,
    sql`SELECT count(*)::int AS n FROM panic_events WHERE patient_id = ${patientId}`,
    sql`SELECT count(*)::int AS n FROM risk_assessments WHERE patient_id = ${patientId}`,
  ]);
  return {
    writings,
    mood_entries: moods[0],
    psych_categories: psych,
    panic_events: panic[0].n,
    risk_assessments: risk[0].n,
  };
}

async function buildSpiritualPayload(sql, patientId) {
  const [wheel, events] = await Promise.all([
    sql`
      SELECT taken_at::date AS taken_at, scores
      FROM wheel_of_life_assessments
      WHERE patient_id = ${patientId}
      ORDER BY taken_at DESC NULLS LAST LIMIT 4
    `,
    sql`
      SELECT title, category, started_at::date AS started_at
      FROM life_events WHERE patient_id = ${patientId}
      ORDER BY started_at DESC NULLS LAST LIMIT 12
    `,
  ]);
  return { wheel_of_life: wheel, life_events: events };
}

async function buildHomePayload(sql, patientId) {
  // Cross-pillar bird's-eye for the home page. Cheaper than running each
  // section's full payload — just the headline counts and the flagged labs.
  const [counts, flagged] = await Promise.all([
    sql`
      SELECT
        (SELECT count(*)::int FROM lab_results        WHERE patient_id = ${patientId}) AS labs,
        (SELECT count(DISTINCT panel)::int FROM lab_results WHERE patient_id = ${patientId}) AS panels,
        (SELECT count(*)::int FROM documents          WHERE patient_id = ${patientId}) AS docs,
        (SELECT count(*)::int FROM writings           WHERE patient_id = ${patientId}) AS writings,
        (SELECT count(*)::int FROM imaging_studies    WHERE patient_id = ${patientId}) AS imaging,
        (SELECT count(*)::int FROM ecg_events         WHERE patient_id = ${patientId}) AS ecg,
        (SELECT count(*)::int FROM pgx_findings       WHERE patient_id = ${patientId}) AS pgx,
        (SELECT count(*)::int FROM vitals_daily       WHERE patient_id = ${patientId}) AS vitals_days,
        (SELECT min(taken_at)::date FROM lab_results  WHERE patient_id = ${patientId}) AS first_lab,
        (SELECT max(taken_at)::date FROM lab_results  WHERE patient_id = ${patientId}) AS last_lab
    `,
    sql`
      SELECT panel, marker, value, unit, ref_low, ref_high, flag, taken_at::date AS taken_at
      FROM lab_results
      WHERE patient_id = ${patientId} AND flag IS NOT NULL AND flag <> ''
      ORDER BY taken_at DESC NULLS LAST LIMIT 12
    `,
  ]);
  return { counts: counts[0], flagged_markers: flagged };
}

async function buildAssessmentPayload(sql, patientId) {
  // The clinical "AI overview" view. Wider than home: pulls flagged labs,
  // recent docs, writings excerpts, panic+risk markers.
  const [physical, mental, spiritual] = await Promise.all([
    buildPhysicalPayload(sql, patientId),
    buildMentalPayload(sql, patientId),
    buildSpiritualPayload(sql, patientId),
  ]);
  return { physical, mental, spiritual };
}

const PAYLOAD_BUILDERS = {
  home:       buildHomePayload,
  physical:   buildPhysicalPayload,
  mental:     buildMentalPayload,
  spiritual:  buildSpiritualPayload,
  assessment: buildAssessmentPayload,
};

/* ───── Generation ──────────────────────────────────────────────── */

async function generateSection(client, section, profile, payload) {
  const userText =
    `Patient: ${profile}\n` +
    `Section: ${section}\n\n` +
    `Data (JSON):\n${JSON.stringify(payload, null, 2)}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  const text = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  return {
    summary_md: text,
    input_tokens: resp.usage?.input_tokens ?? null,
    output_tokens: resp.usage?.output_tokens ?? null,
  };
}

/* ───── Public API ──────────────────────────────────────────────── */

export async function buildOneSection({ sql, anthropic, patientId, section, viewerId }) {
  if (!DASHBOARD_SECTIONS.includes(section)) {
    throw new Error(`unknown_section: ${section}`);
  }
  const profile = await profileLine(sql, patientId);
  const payload = await PAYLOAD_BUILDERS[section](sql, patientId);
  const gen = await generateSection(anthropic, section, profile, payload);

  await sql`
    INSERT INTO patient_dashboards
      (patient_id, section, summary_md, model, input_tokens, output_tokens, generated_by, generated_at)
    VALUES
      (${patientId}, ${section}, ${gen.summary_md}, ${MODEL},
       ${gen.input_tokens}, ${gen.output_tokens}, ${viewerId || null}, now())
    ON CONFLICT (patient_id, section) DO UPDATE SET
      summary_md    = EXCLUDED.summary_md,
      model         = EXCLUDED.model,
      input_tokens  = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      generated_by  = EXCLUDED.generated_by,
      generated_at  = now()
  `;
  return {
    section,
    summary_md: gen.summary_md,
    input_tokens: gen.input_tokens,
    output_tokens: gen.output_tokens,
    generated_at: new Date().toISOString(),
  };
}

export async function fetchAllDashboards(sql, patientId) {
  const rows = await sql`
    SELECT section, summary_md, generated_at, model, input_tokens, output_tokens
    FROM patient_dashboards
    WHERE patient_id = ${patientId}
  `;
  const out = {};
  rows.forEach((r) => { out[r.section] = r; });
  return out;
}
