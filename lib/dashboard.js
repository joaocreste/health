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

const SYSTEM_PROMPT = `You are a clinical dashboard architect. Given a patient's structured data for one section, decide which CARDS best surface what is medically meaningful for THIS patient. Return strict JSON.

OUTPUT — exactly one JSON object, no code fences, no prose:
{ "cards": [Card, ...] }

CARD KINDS — pick the right kind for each card:

1. "narrative" — an interpretive paragraph about a finding, period, or panel.
   { "kind": "narrative",
     "title": "<short clinical title>",
     "subtitle": "<short context, e.g. lab + date | null>",
     "body_md": "<plain markdown, no headings, no bullets, ≤120 words>" }

2. "panel-snapshot" — ONE panel at ONE timepoint, showing its markers.
   Only use when the panel has ≥3 markers at the same date.
   { "kind": "panel-snapshot",
     "title": "<panel + date>",
     "subtitle": "<lab name | null>",
     "panel": "<panel string from data>",
     "taken_at": "<YYYY-MM-DD>",
     "markers": [ { "marker": "...", "value": <number|null>, "value_text": "<string|null>",
                    "unit": "<string|null>", "ref_low": <number|null>, "ref_high": <number|null>,
                    "flag": "<L|H|LL|HH|null>" } ] }

3. "marker-timeline" — ONE marker across multiple dates. Renders as a line chart.
   Only use when the data shows ≥2 timepoints for that marker.
   { "kind": "marker-timeline",
     "title": "<marker + time span>",
     "subtitle": "<short context | null>",
     "marker": "<marker name from data>",
     "unit": "<unit | null>",
     "ref_low": <number|null>, "ref_high": <number|null>,
     "points": [ { "date": "<YYYY-MM-DD>", "value": <number>, "lab": "<string|null>", "flag": "<string|null>" } ] }

4. "multi-marker-timeline" — MULTIPLE related markers tracked together on one chart.
   Use for clinically grouped markers (lipid fractions, CBC subset, thyroid TSH/T4/T3,
   hepatic enzymes, etc.) when each series has ≥2 timepoints. 2–5 series max.
   { "kind": "multi-marker-timeline",
     "title": "<group name + time span>",
     "subtitle": "<short context | null>",
     "series": [
       { "marker": "<name>", "unit": "<unit|null>",
         "ref_low": <number|null>, "ref_high": <number|null>,
         "points": [ { "date": "<YYYY-MM-DD>", "value": <number>, "flag": "<string|null>" } ] }
     ] }

5. "flag-list" — flagged markers (H/HH/L/LL) worth clinical attention.
   { "kind": "flag-list",
     "title": "<short title>",
     "subtitle": "<short context | null>",
     "items": [ { "marker": "...", "value": <number|null>, "value_text": "<string|null>",
                  "unit": "<string|null>", "ref_low": <number|null>, "ref_high": <number|null>,
                  "flag": "<L|H|LL|HH>", "date": "<YYYY-MM-DD>", "panel": "<string|null>" } ] }

RULES (strict):
- 3 to 8 cards total. Quality over quantity. If the patient's data is sparse, output 1–2 honest cards or a single narrative card stating what is and isn't available.
- Every value, date, marker name, and panel name must come verbatim from the input data. Never invent.
- Order cards by clinical relevance — flagged findings and active concerns first, broad context after.
- Use "narrative" for interpretation; use the structured kinds when the user benefits from seeing the actual numbers.
- PREFER the chart kinds when the data supports them: "marker-timeline" for any marker with ≥2 timepoints, "multi-marker-timeline" for clinically related markers each with ≥2 timepoints. Plain "panel-snapshot" tables are appropriate only when there is just one timepoint for that panel.
- Tone: clinical, restrained, second-person ("your"). No marketing language. No emojis. No hedging unless the data warrants it.
- Output ONLY the JSON object — no preamble, no commentary, no code fences.`;

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

const VALID_KINDS = new Set([
  "narrative", "panel-snapshot", "marker-timeline", "multi-marker-timeline", "flag-list",
]);

function sanitizeCards(raw) {
  // Trust nothing — make sure every card has the required shape so the UI
  // never crashes on a malformed model response.
  if (!raw || !Array.isArray(raw.cards)) return [];
  const out = [];
  raw.cards.forEach((c) => {
    if (!c || typeof c !== "object" || !VALID_KINDS.has(c.kind)) return;
    const card = {
      kind: c.kind,
      title: typeof c.title === "string" ? c.title.slice(0, 200) : "",
      subtitle: typeof c.subtitle === "string" ? c.subtitle.slice(0, 200) : null,
    };
    if (c.kind === "narrative") {
      card.body_md = typeof c.body_md === "string" ? c.body_md : "";
    } else if (c.kind === "panel-snapshot") {
      card.panel = typeof c.panel === "string" ? c.panel : null;
      card.taken_at = typeof c.taken_at === "string" ? c.taken_at : null;
      card.markers = Array.isArray(c.markers) ? c.markers.slice(0, 50) : [];
    } else if (c.kind === "marker-timeline") {
      card.marker = typeof c.marker === "string" ? c.marker : null;
      card.unit = c.unit ?? null;
      card.ref_low = c.ref_low ?? null;
      card.ref_high = c.ref_high ?? null;
      card.points = Array.isArray(c.points) ? c.points.slice(0, 30) : [];
    } else if (c.kind === "multi-marker-timeline") {
      card.series = Array.isArray(c.series)
        ? c.series.slice(0, 5).map((s) => ({
            marker:   typeof s.marker === "string" ? s.marker : null,
            unit:     s.unit ?? null,
            ref_low:  s.ref_low ?? null,
            ref_high: s.ref_high ?? null,
            points:   Array.isArray(s.points) ? s.points.slice(0, 30) : [],
          }))
        : [];
    } else if (c.kind === "flag-list") {
      card.items = Array.isArray(c.items) ? c.items.slice(0, 40) : [];
    }
    out.push(card);
  });
  return out.slice(0, 10);
}

async function generateSection(client, section, profile, payload) {
  const userText =
    `Patient: ${profile}\n` +
    `Section: ${section}\n\n` +
    `Data (JSON):\n${JSON.stringify(payload, null, 2)}`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 3500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userText }],
  });
  const raw = resp.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
  // Strip code fences in case the model wrapped them despite the instruction.
  const cleaned = raw.replace(/^```(?:json)?\s*|\s*```$/g, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); }
  catch (e) {
    throw new Error(`Model returned non-JSON for section "${section}": ${cleaned.slice(0, 200)}`);
  }
  const cards = sanitizeCards(parsed);
  return {
    cards_json: { cards },
    // Keep a plain-text rollup of narratives in summary_md so older
    // consumers (chat context, etc.) still have something readable.
    summary_md: cards
      .filter((c) => c.kind === "narrative" && c.body_md)
      .map((c) => "**" + c.title + "**\n\n" + c.body_md)
      .join("\n\n") || null,
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
      (patient_id, section, summary_md, cards_json, model,
       input_tokens, output_tokens, generated_by, generated_at)
    VALUES
      (${patientId}, ${section}, ${gen.summary_md}, ${JSON.stringify(gen.cards_json)}, ${MODEL},
       ${gen.input_tokens}, ${gen.output_tokens}, ${viewerId || null}, now())
    ON CONFLICT (patient_id, section) DO UPDATE SET
      summary_md    = EXCLUDED.summary_md,
      cards_json    = EXCLUDED.cards_json,
      model         = EXCLUDED.model,
      input_tokens  = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      generated_by  = EXCLUDED.generated_by,
      generated_at  = now()
  `;
  return {
    section,
    cards: gen.cards_json.cards,
    summary_md: gen.summary_md,
    input_tokens: gen.input_tokens,
    output_tokens: gen.output_tokens,
    generated_at: new Date().toISOString(),
  };
}

export async function fetchAllDashboards(sql, patientId) {
  const rows = await sql`
    SELECT section, summary_md, cards_json, generated_at, model, input_tokens, output_tokens
    FROM patient_dashboards
    WHERE patient_id = ${patientId}
  `;
  const out = {};
  rows.forEach((r) => {
    out[r.section] = {
      ...r,
      cards: (r.cards_json && Array.isArray(r.cards_json.cards)) ? r.cards_json.cards : [],
    };
  });
  return out;
}
