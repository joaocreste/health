/**
 * Full AI-insights rebuild for one patient (single-pass, whole-record).
 *
 * Distinct from lib/dashboard.js (per-section card generator, Sonnet). This is
 * the "complete rewrite of every AI insight" authoring pass:
 *
 *   1. Assemble the patient's ENTIRE structured record from Neon.
 *   2. Run claude-opus-4-7 (adaptive thinking, effort high) with the strict
 *      bilingual prompt below. The record is interpolated into the canonical
 *      user prompt at the {{PATIENT_RECORD}} placeholder and sent cached.
 *   3. Defensively parse + validate the JSON against the output contract.
 *   4. Persist the whole payload under a reserved dashboard section,
 *      atomically superseding the prior insights for this patient.
 *
 * Persistence note: the payload is stored as one row in `patient_dashboards`
 * (section = AI_INSIGHTS_SECTION) with the full object in `cards_json`. The
 * prompt's integration notes describe a normalized `patient_dashboard_cards`
 * table; that table does not exist yet (migration 0006 only added the
 * `cards_json` column). Storing the structured payload in jsonb keeps this
 * shippable today and cleanly migratable to a normalized schema later.
 *
 * PHI / tier caveat: on the current Anthropic standard tier the patient record
 * (PHI) reaches the model, exactly as the existing /api/chat endpoint already
 * does. De-identification at this boundary is a deferred line item that flips
 * with the Scale-plan + BAA upgrade — not handled here. See compliance memory.
 */

const MODEL = "claude-opus-4-7";
export const AI_INSIGHTS_SECTION = "ai-insights";

/* ════════════════════════════════════════════════════════════════════════════
 * CANONICAL PROMPT — Lumen Health "AI Insight Update"
 * Prompt-library entry id: `ai-insight-update`
 *
 * This is the canonical insight-generation prompt. The three machine-facing parts
 * are SYSTEM_PROMPT, OUTPUT_SCHEMA (appended to the system message — it is the
 * "schema below" the system prompt refers to), and USER_PROMPT_TEMPLATE. The
 * template keeps its four placeholders literal — {{PATIENT_NAME}}, {{CURRENT_DATE}},
 * {{INSIGHTS_VERSION}}, {{PATIENT_RECORD}} — and they are interpolated at call time
 * by fillUserPrompt(). Everything in the block comments below is human-facing
 * documentation and is NOT sent to the model.
 *
 * ── What this prompt does ───────────────────────────────────────────────────
 * Reviews ONE patient's complete record and produces a fresh, complete set of AI
 * insights for them in a single pass, replacing all of that patient's prior
 * insights and touching no other patient. It is the prompt behind the LLM
 * authoring pass (POST /api/patient-dashboard-build).
 *
 * ── How to use it (template — NOT runnable as-is) ───────────────────────────
 * Interpolate ALL four placeholders before sending. Sending it with placeholders
 * still in {{...}} form, or with an empty record, is a misuse.
 *   {{PATIENT_NAME}}      → the patient's full name (unique identifier for the run)
 *   {{CURRENT_DATE}}      → ISO date of this run (becomes generated_at)
 *   {{INSIGHTS_VERSION}}  → next version integer for this patient
 *   {{PATIENT_RECORD}}    → the full assembled record, inlined where the
 *                           BEGIN PATIENT RECORD block sits
 * Send: SYSTEM_PROMPT (+ OUTPUT_SCHEMA) as the system message; the filled
 * USER_PROMPT_TEMPLATE as the user message; model claude-opus-4-7, adaptive
 * thinking, effort "high".
 *
 * Pre-flight (all true before calling): placeholders interpolated; record is the
 * patient's actual data (not empty/stub); this is a real generation, not a review
 * of the prompt text. If not, fix interpolation/fetch first — do not call.
 *
 * ── Guaranteed behavior ─────────────────────────────────────────────────────
 * Deterministic in every case: returns the JSON object and nothing else (never
 * prose/questions/operator messages). Real record → full insight set. Genuinely
 * empty/missing record → a VALID object with empty arrays and every
 * data_sufficient / data_available false. No clarifying dialogue, ever.
 *
 * ── Integration notes ───────────────────────────────────────────────────────
 * - All output is inference: the renderer treats every card as AI synthesis
 *   (purple .ai-pill badge + global disclaimer); there is no is_inference flag in
 *   the persisted shape because it is universally true.
 * - Hero-first ordering: these cards render BELOW the Reports/Browse section on
 *   each page, never above the hero. Spiritual shows "TBD" when
 *   spiritual.data_available === false.
 * - Sparsity is expected: data_sufficient / data_available flags let the
 *   conditional renderers skip cleanly so a thin patient never lands on 0/0/0.
 * - Counts: 3+3 per page is a target, not a contract — fewer beats padding.
 *   Validate rank uniqueness and <= 3 per list at the Worker (see sanitizeList).
 * - Single patient, enforced: assert output.patient_name === {{PATIENT_NAME}} and
 *   a single object (not an array) before persisting; scope every DELETE/UPSERT by
 *   patient so a rebuild can never touch another patient's insights.
 * - PHI / tier: on the current Anthropic standard tier, de-identify
 *   {{PATIENT_RECORD}} at the Worker boundary, or run only after the Scale-plan +
 *   BAA flip. The prompt itself is tier-agnostic.
 * - JSON discipline: strip stray fences, JSON.parse in try/catch, reject and retry
 *   on schema-validation failure rather than persisting partial output.
 * ════════════════════════════════════════════════════════════════════════════ */

/* ───── SYSTEM PROMPT (system message) ──────────────────────────── */

const SYSTEM_PROMPT = `You are the clinical synthesis engine for Lumen Health, a platform that turns a
patient's scattered raw health data into a curated, clinician-style overview.

This is an AI INSIGHT UPDATE request. On this run you perform one job: review the
ENTIRE record for one patient and produce a fresh, complete set of AI insights for
them, replacing all of their prior insights. This is not an incremental edit and
not a per-section patch — it is a full update of every AI insight for this one
patient in a single pass.

HOW YOU RESPOND — ABSOLUTE, NO EXCEPTIONS
- You ALWAYS respond with exactly one JSON object conforming to the schema, and
  nothing else. No prose, no preamble, no explanation, no markdown fences, no
  questions, no message addressed to a human or operator.
- You never ask for clarification and never offer options. You are an automated
  engine; the caller cannot answer you. If something is missing, you express that
  through the JSON (the data_sufficient / data_available flags and empty arrays),
  not through a message.
- If the patient record below is empty, missing, or a stub: return a VALID object
  for this patient with empty attention_points/strengths arrays everywhere, every
  data_sufficient and data_available set to false, an empty summary, and empty
  inline_insights. Do NOT fabricate any health data. Do NOT ask what was intended.
- If you see literal unfilled placeholders (text still in {{...}} form): treat the
  record as missing and follow the empty-record rule above. Do not attempt to
  guess or invent values for them.
- Whatever the input, the output is always parseable JSON in the schema's shape.

SCOPE — EXACTLY ONE PATIENT, NO EXCEPTIONS
This run concerns ONE patient and one patient only: the patient identified by
patient_name in the user message, whose record is the only record provided below.
- Every insight, link, and inline finding you emit must be about THIS patient.
- The record you receive contains data for THIS patient only. If you somehow
  encounter a reference to any other person, that person is context (a clinician,
  a family member, a study cohort) — never a second subject. Do not generate
  insights about them.
- Do not compare this patient against, blend in, or borrow data from any other
  patient. There are no population baselines, no "other patients," no templates
  from another individual. Your only inputs are this patient's own data and
  standard clinical reference ranges.
- The "patient_name" you output must equal the input patient_name verbatim. Emit
  a single dashboard object for this one patient — never a list, never multiple.

Your job on THIS run: review the ENTIRE record for THIS ONE patient and REWRITE
ALL of their AI insights from scratch. Everything you emit replaces every prior
insight for THIS patient — and only this patient; no other patient's insights are
touched, read, or affected by this run. Do not assume continuity with earlier runs.

WHAT YOU ARE NOT
- You are not a diagnostician and you do not prescribe. You surface patterns,
  trends, and links for the patient and their clinicians to act on.
- You never instruct medication, dose, or treatment changes. Where action might
  be warranted, you phrase it as "worth discussing with your clinician."
- Every statement you produce is AI inference over patient data. It must be
  flaggable as such (the UI renders it behind a purple .ai-pill badge and a
  global "AI-generated synthesis" disclaimer).

THE CORE VALUE IS THE LINKS
Most of the platform's worth is cross-domain synthesis — connecting signals that
sit in different sections of the record. Actively look for them. Examples of the
KIND of link to surface (only if the data supports it):
- a lab trend + a current medication or supplement + a reported symptom
- an HRV / resting-HR decline + sleep changes + a dated life event or mood dip
- an imaging finding + a reported pain pattern + reduced activity in wearables
- a journal theme (rumination, sleep complaint, relationship stressor) recurring
  across multiple dated entries + a corresponding physiological marker
- a pharmacogenomic flag + a drug the patient is actually taking
You are explicitly rewarded for finding real links and explicitly penalized for
inventing ones.

EVIDENCE GROUNDING — NON-NEGOTIABLE
- Every insight must be traceable to specific data in the record: name the lab
  and date, the imaging study, the journal entry, the metric and window.
- If you cannot cite it, do not say it. No generic wellness advice, no claims the
  record does not support, no filler to reach a count.
- Quantify where the data allows (value, reference range, date, trend direction).

GRACEFUL SPARSITY
- Patients vary enormously in how much data they have. Never fabricate to fill a
  slot. If a page lacks enough data for an honest insight, return fewer items (or
  none) and set the page's "data_sufficient" flag to false.
- Spiritual data frequently does not exist yet. If there is no spiritual data,
  set spiritual.data_available = false, return empty arrays, and do not invent.

COUNTS & RANKING
- Physical, Mental, and Spiritual each target EXACTLY 3 attention points and 3
  strengths — but honesty beats the count. Emit fewer if the data cannot support
  3 well-grounded items, and say so via the page flag. Never pad.
- Rank within each list by clinical salience (1 = most important).
- Attention points = things to watch or raise with a clinician, ordered by how
  much they matter, not by how alarming they sound.
- Strengths = genuinely evidenced positives: protective factors, good trends,
  resilience signals, well-managed conditions. Not flattery; supported claims.

DATA-OVERLOAD RESTRAINT
- Keep the surface tight. The "summary" field of each insight is 1–2 sentences a
  layperson can absorb. Push depth, mechanism, and the full evidence chain into
  the "detail" field, which the UI defers behind an expander.
- Do not flatten everything to the top level. Curate.

DIAGNOSTIC CODES ARE REFERENTIAL, NOT DEFINITIVE
- If you reference an ICD-10 / CID-10 code, frame it as reference only and set
  diagnostic_code_caveat = true. Never present a code as a confirmed diagnosis.

BILINGUAL — ALWAYS BOTH
- Every human-readable string is an object {"en": "...", "pt": "..."} where pt is
  Brazilian Portuguese. Keep both sides faithful to each other.

SEVERITY VOCABULARY (attention points only)
- "info"     — context worth knowing, no concern
- "watch"    — monitor over time / mention at next visit
- "elevated" — outside normal range or a meaningful adverse trend
- "high"     — clinically notable; flag prominently for clinician review
Be calibrated. Reserve "high" for genuinely notable findings.

CONFIDENCE
- "low" / "moderate" / "high" reflecting strength + recency + corroboration of
  the underlying evidence. A single old data point is not "high".

INLINE (SUBPAGE) INSIGHTS
In addition to the page-level lists, emit an inline insight wherever a SPECIFIC
finding warrants it, anchored to the exact data point. Triggers include (use
clinical thresholds where they apply):
- out_of_range_lab        : a result outside its reference range
- trending_lab            : a result trending toward/past a threshold over time
- concerning_imaging      : an imaging report with significant findings
- abnormal_ecg            : ECG classification other than normal sinus
- vitals_anomaly          : BP beyond AHA stage thresholds, resting HR outside
                            its zone, glucose time-in-range breaches, SpO2 drops
- repetitive_journal_pattern : a theme recurring across multiple dated writings
- pgx_flag                : an actionable pharmacogenomic finding
- interaction_or_polypharmacy : a plausible med/supplement interaction worth review
Each inline insight names its subpage and an anchor identifying the data point.

LAB / EXAM OUTLIERS — ONE CARD PER OUTLIER, WITH STRUCTURED CONTENT
For any blood/urine panel (e.g. "Blood/urine — full panel"), emit a separate inline
insight for EVERY analyte that is an outlier — i.e. every result outside its
reference range, plus any analyte with a meaningful adverse trend over time. Do not
cover only the most dramatic one; cover each outlier. For these lab/exam inline
insights, populate the structured card fields so the UI can render the full
explanation card (interpretation + "POSSIBLE CONTRIBUTING FACTORS" + next steps):
- analyte              : the canonical analyte name (used to join its history)
- interpretation       : a short clinical reading of what THIS value means in context
- contributing_factors : list of plausible contributors, grounded in THIS patient's
                         meds/history/data — suggestive only, never asserted as cause
- next_steps           : list of sensible follow-ups (e.g. "recheck as taper progresses")
Always frame contributing_factors as suggestive and not a substitute for clinical
evaluation. These fields are required for out_of_range_lab / trending_lab; leave them
null for non-lab triggers (which use body instead).

OUTPUT CONTRACT
- Output ONLY a single JSON object conforming to the schema below. ONE object for
  ONE patient — never an array, never multiple patients, never a wrapper keyed by
  patient. If you produce more than one dashboard object, you have failed the task.
- No prose, no preamble, no markdown code fences, no trailing commentary, no
  questions. JSON object only — this holds even for an empty or missing record
  (return the valid empty object described above).
- All text fields are {"en","pt"} objects. is_inference is always true.
- Use the provided patient_name and generated_at verbatim. patient_name in the
  output MUST exactly equal the input patient_name.`;

/* ───── OUTPUT JSON SCHEMA (appended to the system message) ─────────
 * The "schema below" the SYSTEM PROMPT refers to. The model must return exactly
 * this shape. Concatenated onto the system message at call time. */

const OUTPUT_SCHEMA = `OUTPUT JSON SCHEMA — return exactly this shape:

{
  "request_type": "ai_insight_update",   // fixed: this payload is a full insight update
  "patient_name": "string",               // verbatim from input; unique identifier
  "generated_at": "ISO-8601 string",      // verbatim from input
  "insights_version": 0,                  // verbatim from input
  "model_run": { "model": "claude-opus-4-7", "effort": "high" },

  "pages": {
    "physical": {
      "data_sufficient": true,
      "attention_points": [ /* Insight, kind="attention", up to 3, ranked */ ],
      "strengths":        [ /* Insight, kind="strength",  up to 3, ranked */ ]
    },
    "mental": {
      "data_sufficient": true,
      "attention_points": [ /* ... */ ],
      "strengths":        [ /* ... */ ]
    },
    "spiritual": {
      "data_available": false,            // false when no spiritual data exists
      "data_sufficient": false,
      "attention_points": [],
      "strengths": []
    }
  },

  "summary": {
    "headline": { "en": "", "pt": "" },   // 1 sentence overall picture, as of generated_at
    "top_attention_points": [             // references into pages[].attention_points
      { "insight_id": "string", "page": "physical|mental|spiritual" }
    ],
    "top_strengths": [
      { "insight_id": "string", "page": "physical|mental|spiritual" }
    ],
    "cross_domain_links": [ /* CrossLink[] — the synthesis payload */ ]
  },

  "inline_insights": [ /* Inline[] */ ]
}

Insight = {
  "id": "string",                         // stable slug, unique within this run
  "page": "physical|mental|spiritual",
  "kind": "attention|strength",
  "rank": 1,                              // 1..3 within its list
  "title":   { "en": "", "pt": "" },      // short label
  "summary": { "en": "", "pt": "" },      // 1–2 sentences, surface level
  "detail":  { "en": "", "pt": "" },      // expandable depth / mechanism
  "evidence": [
    {
      "source": "lab_results",            // table/section the datum comes from
      "ref": "Vitamin D",                 // human-readable identifier
      "value": "18 ng/mL (ref 30–100)",   // value + range/context where applicable
      "date": "2026-04-12"
    }
  ],
  "cross_domain_links": [ "string" ],     // ids of CrossLinks this insight feeds
  "severity": "info|watch|elevated|high", // attention only; null for strengths
  "confidence": "low|moderate|high",
  "diagnostic_code_caveat": false,        // true if any ICD-10/CID-10 referenced
  "clinician_note": { "en": "", "pt": "" }// optional "discuss with your doctor" line
}

CrossLink = {
  "id": "string",
  "summary": { "en": "", "pt": "" },      // the link stated plainly
  "connects": [ "physical:insight-id", "mental:insight-id" ],
  "evidence": [ /* same evidence shape; cite each side of the link */ ],
  "confidence": "low|moderate|high"
}

Inline = {
  "id": "string",
  "subpage": "physical-exams|physical-vitals|physical-genetics|mental|spiritual|...",
  "anchor": "string",                     // identifies the exact data point
                                          // (lab id, imaging study id, writing id, metric+window)
  "trigger": "out_of_range_lab|trending_lab|concerning_imaging|abnormal_ecg|vitals_anomaly|repetitive_journal_pattern|pgx_flag|interaction_or_polypharmacy",
  "title": { "en": "", "pt": "" },
  "body":  { "en": "", "pt": "" },        // used for non-lab triggers

  // --- lab/exam-outlier card fields (out_of_range_lab | trending_lab); null otherwise ---
  "analyte":        "string",             // canonical name, used to join history
  "interpretation": { "en": "", "pt": "" }, // short clinical reading of this value
  "contributing_factors": [               // suggestive only, grounded in this patient
    { "en": "", "pt": "" }
  ],
  "next_steps": [                         // sensible follow-ups
    { "en": "", "pt": "" }
  ],
  // -------------------------------------------------------------------------------------

  "evidence": [ /* evidence shape */ ],
  "severity": "info|watch|elevated|high",
  "confidence": "low|moderate|high",
  "diagnostic_code_caveat": false
}`;

/* ───── USER PROMPT (user message — placeholders filled at call time) ─────────
 * The four {{...}} placeholders are kept LITERAL here on purpose. They are
 * interpolated by fillUserPrompt() at the call boundary — never edit them out. */

const USER_PROMPT_TEMPLATE = `AI INSIGHT UPDATE — rebuild ALL AI insights for THIS ONE patient, and only this
patient. The record below belongs to this single patient; everything you produce
must be about them alone. Do not reference, compare against, or pull from any
other patient.

patient_name: {{PATIENT_NAME}}
generated_at: {{CURRENT_DATE}}
insights_version: {{INSIGHTS_VERSION}}

Read the COMPLETE record below. Review every section — vitals, labs, glucose,
imaging, ECG, pharmacogenomics, medications, supplements, surgeries, injuries,
clinical history, risk assessments, writings/journals, mood, panic events, life
events, psych dimensions/items/evidence, wheel of life, and any spiritual data
or documents. Find the cross-domain links. Then produce:

1. Physical page  — up to 3 attention points + up to 3 strengths
2. Mental page    — up to 3 attention points + up to 3 strengths
3. Spiritual page — up to 3 attention points + up to 3 strengths (only if data exists)
4. Summary        — the strongest attention points and strengths drawn from all
                    three pages, PLUS the explicit cross-domain links
5. Inline insights — one per specific finding that warrants it, anchored to the
                    exact data point and subpage

Honesty over completeness: if a page lacks enough data for well-grounded items,
return fewer (or none) and flag it. Cite specific evidence for everything. Every
item must be about THIS patient and grounded in THIS patient's record.

=== BEGIN PATIENT RECORD ({{PATIENT_NAME}}) ===
{{PATIENT_RECORD}}
=== END PATIENT RECORD ===

Respond with the JSON object only.`;

// Interpolate the four canonical placeholders at call time. Replaces every
// occurrence (PATIENT_NAME appears twice). Keep the template's {{...}} literal.
function fillUserPrompt({ patientName, currentDate, insightsVersion, patientRecord }) {
  return USER_PROMPT_TEMPLATE
    .replaceAll("{{PATIENT_NAME}}", patientName ?? "")
    .replaceAll("{{CURRENT_DATE}}", currentDate ?? "")
    .replaceAll("{{INSIGHTS_VERSION}}", String(insightsVersion ?? ""))
    .replaceAll("{{PATIENT_RECORD}}", patientRecord ?? "");
}

/* ───── Record assembly ─────────────────────────────────────────── */

const LAB_DUMP_CAP = 800;
const WRITING_CAP = 40;
const EXCERPT_LEN = 400;

function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}

export async function assembleRecord(sql, patientId) {
  const [
    profile, meds, supps, surg, inj, hist, risk,
    flagged, labsRecent, labCount, vitalsAgg, vitalsRecent, glucose,
    imaging, ecg, pgx, writings, moodAgg, moodRecent, panic, life, psych, wheel, docs,
  ] = await Promise.all([
    sql`SELECT u.full_name, pp.date_of_birth, pp.sex, pp.country_of_residence,
               pp.height_cm, pp.weight_kg, pp.blood_type, pp.native_language
        FROM users u LEFT JOIN patient_profiles pp ON pp.user_id = u.id
        WHERE u.id = ${patientId} LIMIT 1`,
    sql`SELECT name, dose, drug_class, status, note, started_at, ended_at
        FROM medications WHERE patient_id = ${patientId}
        ORDER BY started_at DESC NULLS LAST`,
    sql`SELECT name, dose, started_at, ended_at
        FROM supplements WHERE patient_id = ${patientId}
        ORDER BY started_at DESC NULLS LAST`,
    sql`SELECT name, performed_on, notes FROM surgeries WHERE patient_id = ${patientId}
        ORDER BY performed_on DESC NULLS LAST`,
    sql`SELECT name, occurred_on, notes FROM injuries WHERE patient_id = ${patientId}
        ORDER BY occurred_on DESC NULLS LAST`,
    sql`SELECT category, heading, detail, occurred_on FROM clinical_history
        WHERE patient_id = ${patientId} ORDER BY occurred_on DESC NULLS LAST`,
    sql`SELECT kind, payload, recorded_at::date AS recorded_at FROM risk_assessments
        WHERE patient_id = ${patientId} ORDER BY recorded_at DESC NULLS LAST`,
    sql`SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag,
               taken_at::date AS taken_at, laboratory
        FROM lab_results WHERE patient_id = ${patientId}
          AND flag IS NOT NULL AND flag <> ''
        ORDER BY taken_at DESC NULLS LAST`,
    sql`SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag,
               taken_at::date AS taken_at, laboratory
        FROM lab_results WHERE patient_id = ${patientId}
        ORDER BY taken_at DESC NULLS LAST LIMIT ${LAB_DUMP_CAP}`,
    sql`SELECT count(*)::int AS n FROM lab_results WHERE patient_id = ${patientId}`,
    sql`SELECT count(*)::int AS days, min(day)::date AS first_day, max(day)::date AS last_day,
               round(avg(hrv_ms)::numeric, 1)        AS avg_hrv_ms,
               round(avg(resting_hr)::numeric, 1)    AS avg_resting_hr,
               round(avg(sleep_minutes)::numeric, 0) AS avg_sleep_minutes,
               round(avg(steps)::numeric, 0)         AS avg_steps,
               round(avg(spo2_pct)::numeric, 1)      AS avg_spo2_pct,
               round(avg(blood_pressure_sys)::numeric, 0) AS avg_bp_sys,
               round(avg(blood_pressure_dia)::numeric, 0) AS avg_bp_dia
        FROM vitals_daily WHERE patient_id = ${patientId}`,
    sql`SELECT day::date AS day, source, hrv_ms, resting_hr, sleep_minutes, steps,
               spo2_pct, blood_pressure_sys, blood_pressure_dia, weight_kg
        FROM vitals_daily WHERE patient_id = ${patientId}
        ORDER BY day DESC NULLS LAST LIMIT 45`,
    sql`SELECT count(*)::int AS points, min(ts)::date AS first_ts, max(ts)::date AS last_ts,
               round(avg(mg_dl)::numeric, 1) AS avg_mg_dl,
               round(100.0 * count(*) FILTER (WHERE mg_dl BETWEEN 70 AND 180) / NULLIF(count(*),0), 1) AS pct_time_in_range
        FROM glucose_points WHERE patient_id = ${patientId}`,
    sql`SELECT modality, body_part, study_date, source_format, file_count, notes
        FROM imaging_studies WHERE patient_id = ${patientId}
        ORDER BY study_date DESC NULLS LAST`,
    sql`SELECT recorded_at, classification, average_hr, duration_seconds, source, notes
        FROM ecg_events WHERE patient_id = ${patientId}
        ORDER BY recorded_at DESC NULLS LAST LIMIT 80`,
    sql`SELECT gene, variant, phenotype, category, drug_class_impact,
               recommendation, confidence, assay_name, reported_on
        FROM pgx_findings WHERE patient_id = ${patientId}
        ORDER BY gene ASC`,
    sql`SELECT title, written_at::date AS written_at, language,
               COALESCE(LEFT(extracted_text, ${EXCERPT_LEN}), '') AS excerpt
        FROM writings WHERE patient_id = ${patientId}
        ORDER BY written_at DESC NULLS LAST LIMIT ${WRITING_CAP}`,
    sql`SELECT count(*)::int AS n, min(ts)::date AS first, max(ts)::date AS last,
               round(avg(valence)::numeric, 2) AS avg_valence,
               round(avg(arousal)::numeric, 2) AS avg_arousal
        FROM mood_entries WHERE patient_id = ${patientId}`,
    sql`SELECT ts, valence, arousal, primary_emotion, LEFT(note, 160) AS note
        FROM mood_entries WHERE patient_id = ${patientId}
        ORDER BY ts DESC NULLS LAST LIMIT 30`,
    sql`SELECT occurred_at, severity, duration_minutes, triggers, intervention, notes
        FROM panic_events WHERE patient_id = ${patientId}
        ORDER BY occurred_at DESC NULLS LAST LIMIT 60`,
    sql`SELECT occurred_on, category, title, description, significance
        FROM life_events WHERE patient_id = ${patientId}
        ORDER BY occurred_on DESC NULLS LAST`,
    sql`SELECT d.name_en AS dimension, d.rank AS dim_rank,
               i.title, i.synthesis, i.rank AS item_rank
        FROM psych_items i JOIN psych_dimensions d ON d.id = i.dimension_id
        WHERE i.patient_id = ${patientId}
        ORDER BY d.rank ASC, i.rank ASC NULLS LAST`,
    sql`SELECT taken_on::date AS taken_on, scores, notes
        FROM wheel_of_life_assessments WHERE patient_id = ${patientId}
        ORDER BY taken_on DESC NULLS LAST LIMIT 6`,
    sql`SELECT kind, title, document_date,
               metadata->'classifier'->>'summary' AS summary
        FROM documents WHERE patient_id = ${patientId}
        ORDER BY document_date DESC NULLS LAST LIMIT 40`,
  ]);

  const p = profile[0] || {};
  const totalLabs = labCount[0]?.n ?? 0;

  return {
    profile: {
      name: p.full_name || null,
      age: ageFrom(p.date_of_birth),
      sex: p.sex || null,
      country_of_residence: p.country_of_residence || null,
      height_cm: p.height_cm ?? null,
      weight_kg: p.weight_kg ?? null,
      blood_type: p.blood_type || null,
      native_language: p.native_language || null,
    },
    medications: meds,
    supplements: supps,
    surgeries: surg,
    injuries: inj,
    clinical_history: hist,
    risk_assessments: risk,
    labs: {
      total_results: totalLabs,
      flagged_markers: flagged,
      recent_results: labsRecent,
      recent_results_truncated: totalLabs > LAB_DUMP_CAP,
    },
    vitals: {
      summary: vitalsAgg[0] || null,
      recent_days: vitalsRecent,
    },
    glucose: glucose[0] || null,
    imaging_studies: imaging,
    ecg_events: ecg,
    pgx_findings: pgx,
    writings: { recent: writings, truncated_at: WRITING_CAP },
    mood: { summary: moodAgg[0] || null, recent: moodRecent },
    panic_events: panic,
    life_events: life,
    psych_architecture: psych,
    wheel_of_life: wheel,
    documents: docs,
  };
}

/* ───── Validation / sanitization ───────────────────────────────── */

const SEVERITIES = new Set(["info", "watch", "elevated", "high"]);
const CONFIDENCES = new Set(["low", "moderate", "high"]);
const PAGES = new Set(["physical", "mental", "spiritual"]);
const TRIGGERS = new Set([
  "out_of_range_lab", "trending_lab", "concerning_imaging", "abnormal_ecg",
  "vitals_anomaly", "repetitive_journal_pattern", "pgx_flag", "interaction_or_polypharmacy",
]);

function biling(v) {
  if (v && typeof v === "object") {
    const en = typeof v.en === "string" ? v.en : "";
    const pt = typeof v.pt === "string" ? v.pt : "";
    if (!en && !pt) return null;
    return { en: en || pt, pt: pt || en };
  }
  if (typeof v === "string" && v.trim()) return { en: v, pt: v };
  return null;
}

function bilingOpt(v) {
  return biling(v); // null when absent — kept optional
}

function bilingArr(raw, cap = 8) {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => biling(v)).filter(Boolean).slice(0, cap);
}

function str(v, max = 400) {
  return typeof v === "string" ? v.slice(0, max) : null;
}

function evidenceList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((e) => ({
    source: str(e?.source, 80),
    ref: str(e?.ref, 200),
    value: str(e?.value, 300),
    date: str(e?.date, 40),
  })).filter((e) => e.source || e.ref || e.value);
}

function confidence(v) {
  return CONFIDENCES.has(v) ? v : "moderate";
}

function sanitizeInsight(raw, page, kind, rank) {
  const title = biling(raw?.title);
  const summary = biling(raw?.summary);
  if (!title || !summary) return null; // drop unusable items rather than emit blanks
  const out = {
    id: str(raw?.id, 120) || `${page}-${kind}-${rank}`,
    page,
    kind,
    rank,
    title,
    summary,
    detail: bilingOpt(raw?.detail),
    evidence: evidenceList(raw?.evidence),
    cross_domain_links: Array.isArray(raw?.cross_domain_links)
      ? raw.cross_domain_links.map((x) => str(x, 120)).filter(Boolean).slice(0, 8)
      : [],
    severity: kind === "attention" ? (SEVERITIES.has(raw?.severity) ? raw.severity : "watch") : null,
    confidence: confidence(raw?.confidence),
    diagnostic_code_caveat: raw?.diagnostic_code_caveat === true,
    clinician_note: bilingOpt(raw?.clinician_note),
  };
  return out;
}

function sanitizeList(raw, page, kind) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const item of arr) {
    const s = sanitizeInsight(item, page, kind, out.length + 1);
    if (s) out.push(s);
    if (out.length >= 3) break; // honesty-over-count cap enforced server-side
  }
  return out;
}

function sanitizePage(raw, { spiritual = false } = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const attention = sanitizeList(r.attention_points, spiritual ? "spiritual" : r._page, "attention");
  return { attention, strengths: sanitizeList(r.strengths, r._page, "strength") };
}

function sanitizeCrossLinks(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 12).map((l, i) => {
    const summary = biling(l?.summary);
    if (!summary) return null;
    return {
      id: str(l?.id, 120) || `link-${i + 1}`,
      summary,
      connects: Array.isArray(l?.connects) ? l.connects.map((x) => str(x, 160)).filter(Boolean).slice(0, 8) : [],
      evidence: evidenceList(l?.evidence),
      confidence: confidence(l?.confidence),
    };
  }).filter(Boolean);
}

function sanitizeRefs(raw, validIds) {
  if (!Array.isArray(raw)) return [];
  return raw.map((r) => ({
    insight_id: str(r?.insight_id, 120),
    page: PAGES.has(r?.page) ? r.page : null,
  })).filter((r) => r.insight_id && validIds.has(r.insight_id)).slice(0, 6);
}

function sanitizeInline(raw) {
  if (!Array.isArray(raw)) return [];
  // One card per outlier is wanted (a full panel can have many), so the cap is
  // generous. Lab/exam-outlier triggers carry structured card fields and may have
  // no `body` (the schema reserves body for non-lab triggers); we keep them as
  // long as they say something via interpretation / contributing_factors.
  return raw.slice(0, 80).map((x, i) => {
    const title = biling(x?.title);
    const body = bilingOpt(x?.body);
    const trigger = TRIGGERS.has(x?.trigger) ? x.trigger : "out_of_range_lab";
    const isLab = trigger === "out_of_range_lab" || trigger === "trending_lab";
    const interpretation = bilingOpt(x?.interpretation);
    const contributing_factors = bilingArr(x?.contributing_factors);
    const next_steps = bilingArr(x?.next_steps);
    if (!title) return null;
    if (!body && !interpretation && !contributing_factors.length && !next_steps.length) return null;
    return {
      id: str(x?.id, 120) || `inline-${i + 1}`,
      subpage: str(x?.subpage, 60) || "physical",
      anchor: str(x?.anchor, 200) || "",
      trigger,
      title,
      body, // may be null for lab/exam-outlier triggers
      // ── lab/exam-outlier card fields (null for non-lab triggers) ──
      analyte: isLab ? str(x?.analyte, 120) : null,
      interpretation: isLab ? interpretation : null,
      contributing_factors: isLab ? contributing_factors : [],
      next_steps: isLab ? next_steps : [],
      evidence: evidenceList(x?.evidence),
      severity: SEVERITIES.has(x?.severity) ? x.severity : "info",
      confidence: confidence(x?.confidence),
      diagnostic_code_caveat: x?.diagnostic_code_caveat === true,
    };
  }).filter(Boolean);
}

function sanitizePayload(parsed, { patientId, generatedAt, version }) {
  const pagesRaw = parsed?.pages && typeof parsed.pages === "object" ? parsed.pages : {};

  const physical = sanitizePage({ ...pagesRaw.physical, _page: "physical" });
  const mental = sanitizePage({ ...pagesRaw.mental, _page: "mental" });
  const spiritualRaw = pagesRaw.spiritual || {};
  const spiritual = sanitizePage({ ...spiritualRaw, _page: "spiritual" }, { spiritual: true });
  const spiritualHasData =
    spiritualRaw.data_available === true ||
    spiritual.attention.length > 0 || spiritual.strengths.length > 0;

  const validIds = new Set();
  [physical, mental, spiritual].forEach((pg) =>
    [...pg.attention, ...pg.strengths].forEach((i) => validIds.add(i.id)));

  const summaryRaw = parsed?.summary && typeof parsed.summary === "object" ? parsed.summary : {};

  return {
    patient_id: patientId,
    generated_at: generatedAt,
    insights_version: version,
    model_run: { model: MODEL, effort: "high" },
    pages: {
      physical: {
        data_sufficient: pagesRaw.physical?.data_sufficient !== false &&
          (physical.attention.length + physical.strengths.length > 0),
        attention_points: physical.attention,
        strengths: physical.strengths,
      },
      mental: {
        data_sufficient: pagesRaw.mental?.data_sufficient !== false &&
          (mental.attention.length + mental.strengths.length > 0),
        attention_points: mental.attention,
        strengths: mental.strengths,
      },
      spiritual: {
        data_available: spiritualHasData,
        data_sufficient: spiritualHasData &&
          (spiritual.attention.length + spiritual.strengths.length > 0),
        attention_points: spiritual.attention,
        strengths: spiritual.strengths,
      },
    },
    summary: {
      headline: biling(summaryRaw.headline) || { en: "", pt: "" },
      top_attention_points: sanitizeRefs(summaryRaw.top_attention_points, validIds),
      top_strengths: sanitizeRefs(summaryRaw.top_strengths, validIds),
      cross_domain_links: sanitizeCrossLinks(summaryRaw.cross_domain_links),
    },
    inline_insights: sanitizeInline(parsed?.inline_insights),
  };
}

/* ───── Model call ──────────────────────────────────────────────── */

// Best-effort completion of JSON truncated mid-structure (output-cap hit):
// close any open string and unbalanced {}/[] so the prefix parses. Trailing
// partial items get dropped by sanitizePayload.
function repairTruncatedJson(s) {
  let str = s.replace(/,\s*$/, "");
  const stack = [];
  let inStr = false, esc = false;
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();
  }
  if (inStr) str += '"';
  str = str.replace(/,\s*$/, "").replace(/:\s*$/, ": null");
  while (stack.length) str += stack.pop() === "{" ? "}" : "]";
  return str;
}

function parseModelJson(text) {
  const cleaned = String(text || "")
    .replace(/^﻿/, "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  // Fall back to the outermost { ... } if the model wrapped stray prose.
  let candidate = cleaned;
  if (!candidate.startsWith("{")) {
    const first = candidate.indexOf("{");
    if (first !== -1) candidate = candidate.slice(first);
  }
  const lastClose = candidate.lastIndexOf("}");
  const whole = lastClose !== -1 ? candidate.slice(0, lastClose + 1) : candidate;
  try { return JSON.parse(whole); }
  catch { return JSON.parse(repairTruncatedJson(candidate)); } // salvage truncation
}

async function callModel(anthropic, { record, displayName, currentDate, version }, onTick) {
  const userText = fillUserPrompt({
    patientName: displayName,
    currentDate,
    insightsVersion: version,
    patientRecord: JSON.stringify(record),
  });
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    system: [
      { type: "text", text: SYSTEM_PROMPT },
      { type: "text", text: OUTPUT_SCHEMA, cache_control: { type: "ephemeral", ttl: "1h" } },
    ],
    // The record is interpolated into the canonical user prompt at the
    // {{PATIENT_RECORD}} placeholder. Cache the block so the retry reuses it.
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: userText, cache_control: { type: "ephemeral", ttl: "1h" } }],
      },
    ],
  });
  // Drain events so a heartbeat can flow to the client during the long
  // thinking/generation phase (keeps Cloudflare from 524-ing the response).
  if (onTick) { for await (const _ev of stream) onTick(); }
  const final = await stream.finalMessage();
  const text = final.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return {
    text,
    usage: {
      input: final.usage?.input_tokens ?? null,
      output: final.usage?.output_tokens ?? null,
      cache_read: final.usage?.cache_read_input_tokens ?? 0,
      cache_write: final.usage?.cache_creation_input_tokens ?? 0,
    },
  };
}

/* ───── Persistence ─────────────────────────────────────────────── */

function rollupSummaryMd(payload) {
  // Plain-text rollup so older consumers (chat context, exports) have something
  // readable. English side only; the full bilingual payload lives in cards_json.
  const lines = [];
  if (payload.summary.headline?.en) lines.push(payload.summary.headline.en, "");
  for (const [pageName, page] of Object.entries(payload.pages)) {
    const items = [...(page.attention_points || []), ...(page.strengths || [])];
    if (!items.length) continue;
    lines.push(`## ${pageName}`);
    for (const it of items) {
      const tag = it.kind === "attention" ? `[${it.severity || "watch"}]` : "[strength]";
      lines.push(`- ${tag} ${it.title.en}: ${it.summary.en}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim() || null;
}

async function nextVersion(sql, patientId, override) {
  if (Number.isInteger(override) && override > 0) return override;
  const rows = await sql`
    SELECT cards_json FROM patient_dashboards
    WHERE patient_id = ${patientId} AND section = ${AI_INSIGHTS_SECTION} LIMIT 1`;
  const prev = rows[0]?.cards_json?.insights_version;
  return Number.isInteger(prev) ? prev + 1 : 1;
}

/* ───── Public API ──────────────────────────────────────────────── */

export async function rebuildAiInsights({
  sql, anthropic, patientId, viewerId = null,
  currentDate, version: versionOverride = null, onTick = null,
}) {
  const generatedAt = currentDate || new Date().toISOString();
  const version = await nextVersion(sql, patientId, versionOverride);

  const record = await assembleRecord(sql, patientId);
  const displayName = record.profile.name || "the patient";

  let parsed;
  let usage;
  let lastErr;
  // One retry — model occasionally emits a trailing token or stray fence.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await callModel(anthropic, {
      record, displayName,
      currentDate: generatedAt.slice(0, 10), version,
    }, onTick);
    usage = res.usage;
    try {
      parsed = parseModelJson(res.text);
      break;
    } catch (e) {
      lastErr = e;
      parsed = null;
    }
  }
  if (!parsed) {
    throw new Error(`ai_insights_unparseable: ${lastErr?.message || "no JSON"}`);
  }

  const payload = sanitizePayload(parsed, { patientId, generatedAt, version });
  const summaryMd = rollupSummaryMd(payload);

  await sql`
    INSERT INTO patient_dashboards
      (patient_id, section, summary_md, cards_json, model,
       input_tokens, output_tokens, generated_by, generated_at)
    VALUES
      (${patientId}, ${AI_INSIGHTS_SECTION}, ${summaryMd}, ${JSON.stringify(payload)}, ${MODEL},
       ${usage.input}, ${usage.output}, ${viewerId}, now())
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
    section: AI_INSIGHTS_SECTION,
    insights_version: version,
    generated_at: generatedAt,
    payload,
    usage,
  };
}
