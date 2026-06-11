import Anthropic from "@anthropic-ai/sdk";
import { AwsClient } from "aws4fetch";
import { makeZip } from "client-zip";
import { neon } from "@neondatabase/serverless";
import { authenticate } from "../lib/auth.js";
import { handleIngest, reclassifyForPatient, backfillRequestingDoctor } from "../lib/ingest.js";
import { buildOneSection, fetchAllDashboards, DASHBOARD_SECTIONS } from "../lib/dashboard.js";
import { rebuildAiInsights, AI_INSIGHTS_SECTION } from "../lib/ai-insights.js";
import { buildManifest, validateSections } from "../lib/export-manifest.js";
import { buildReportPdf, reportFilename } from "../lib/export-render.js";
import { buildPatientContext, PATIENT_ZERO, PAULO_SILOTTO, SILVANA_CRESTE } from "../lib/chat-context.js";
import { createChatPdfExport, serveChatExport } from "../lib/chat-pdf.js";
import { deidentifyContext } from "../lib/deidentify.js";

const SYSTEM_INSTRUCTIONS = `You are the Lumen Health portal assistant for the patient Joao Victor Creste.

STRICT RULES — non-negotiable:
1. Answer ONLY using information present in the <patient_record> below. Treat the record as your single source of truth.
2. If the record does not contain enough information to answer, say so explicitly. Do not guess, infer beyond the text, or use general medical knowledge.
3. Never fabricate dates, values, names, diagnoses, medications, or events.
4. Reply in the same language the user wrote in (English or Portuguese). The record contains both languages interleaved — both are valid sources.
5. Be concise and direct. Plain prose. Use short line breaks when listing items, but no markdown syntax (no #, *, -, **bold**, [links], or backticks) — the UI renders plain text.
6. When you cite something specific, mention which section it comes from in parentheses (e.g. "(Vitals)", "(Mental)").
7. If asked about something outside this patient's health record (general advice, other people, off-topic questions), politely refuse and redirect: "I can only answer questions about Joao's health record."

You are not a doctor. You do not give clinical advice or diagnoses — only summarise what is in the record.`;

let cachedRecord = null;

async function loadPatientRecord(request, env) {
  if (cachedRecord) return cachedRecord;
  const url = new URL("/assets/patient-record.txt", request.url);
  const resp = await env.ASSETS.fetch(url);
  if (!resp.ok) throw new Error(`patient-record.txt fetch failed: ${resp.status}`);
  cachedRecord = await resp.text();
  return cachedRecord;
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Fire a simple Slack message via an Incoming Webhook. No-op (and never throws)
// when SLACK_WEBHOOK_URL isn't set, so it can ship before the webhook exists and
// a Slack outage can never break an upload. The webhook is bound to its channel
// at creation time (#client-services), so no channel needs to be specified here.
async function notifySlack(env, text) {
  if (!env.SLACK_WEBHOOK_URL) return;
  try {
    await fetch(env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (e) { /* notifications are best-effort */ }
}

// Send a transactional email via Resend (https://resend.com). No-op (never
// throws) when RESEND_API_KEY isn't set. `from` must be on a domain verified in
// Resend (lumenhealth.io); `to` is the Client Services inbox. Both overridable
// via env so nothing here is hardcoded beyond sane defaults.
async function notifyEmail(env, subject, text) {
  if (!env.RESEND_API_KEY) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: env.NOTIFY_EMAIL_FROM || "Lumen Health <notifications@lumenhealth.io>",
        to: (env.NOTIFY_EMAIL_TO || "clientservices@lumenhealth.io").split(",").map((s) => s.trim()),
        subject,
        text,
      }),
    });
  } catch (e) { /* notifications are best-effort */ }
}

async function handleChat(request, env) {
  // Chatbot deactivated across the webapp (UI widget removed from every page and
  // this endpoint disabled). Kept intact below for easy re-enable: delete this
  // guard and re-add <script src="assets/chatbot.js"> to the pages.
  return jsonError(410, "chat_disabled");
  if (!env.ANTHROPIC_API_KEY) {
    return jsonError(500, "Server is not configured (missing API key).");
  }
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "Invalid JSON body.");
  }

  const messages = Array.isArray(body?.messages) ? body.messages : null;
  if (!messages || messages.length === 0) {
    return jsonError(400, "messages array required.");
  }
  if (messages.length > 40) {
    return jsonError(400, "Conversation too long.");
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return jsonError(400, "Each message needs role (user|assistant) and string content.");
    }
    if (m.content.length > 4000) {
      return jsonError(400, "Message too long (max 4000 chars).");
    }
  }

  let record;
  try {
    record = await loadPatientRecord(request, env);
  } catch (e) {
    return jsonError(500, `Could not load patient record: ${e.message}`);
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 4 });

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const stream = client.messages.stream({
          model: "claude-opus-4-7",
          max_tokens: 2048,
          thinking: { type: "adaptive" },
          output_config: { effort: "high" },
          system: [
            { type: "text", text: SYSTEM_INSTRUCTIONS },
            {
              type: "text",
              text: `<patient_record>\n${record}\n</patient_record>`,
              cache_control: { type: "ephemeral", ttl: "1h" },
            },
          ],
          messages,
        });

        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            send({ text: event.delta.text });
          }
        }

        const final = await stream.finalMessage();
        send({
          done: true,
          stop_reason: final.stop_reason,
          usage: {
            input: final.usage.input_tokens,
            output: final.usage.output_tokens,
            cache_read: final.usage.cache_read_input_tokens ?? 0,
            cache_write: final.usage.cache_creation_input_tokens ?? 0,
          },
        });
      } catch (e) {
        send({ error: e?.message ?? String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

async function handleMe(request, env) {
  const auth = await authenticate(request, env);
  if (!auth.ok) {
    return new Response(JSON.stringify({ authenticated: false, reason: auth.reason }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({
    authenticated: true,
    clerkUserId: auth.clerkUserId,
    role: auth.role,
    email: auth.email,
    fullName: auth.fullName,
    locale: auth.locale,
  }), {
    headers: { "Content-Type": "application/json" },
  });
}

async function handlePatientSummary(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  if (!clerk) return jsonError(400, "clerk_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const patientRows = await sql`
      SELECT u.id, u.clerk_user_id, u.full_name, u.email, u.locale, u.created_at,
             pp.date_of_birth, pp.sex, pp.country_of_residence, pp.native_language
      FROM users u
      LEFT JOIN patient_profiles pp ON pp.user_id = u.id
      WHERE u.clerk_user_id = ${clerk} AND u.role = 'patient' AND u.archived_at IS NULL
      LIMIT 1
    `;
    if (patientRows.length === 0) return jsonError(404, "patient_not_found");
    const patient = patientRows[0];
    const pid = patient.id;

    // Single multi-pillar count query — saves round trips.
    const [pillars, recentDocs, recentLabs, pendingFiles, medications, supplements, procedures] = await Promise.all([
      sql`
        SELECT
          -- Physical
          (SELECT count(*)::int FROM lab_results      WHERE patient_id = ${pid}) AS lab_results,
          (SELECT count(*)::int FROM imaging_studies  WHERE patient_id = ${pid}) AS imaging_studies,
          (SELECT count(*)::int FROM medications      WHERE patient_id = ${pid}) AS medications,
          (SELECT count(*)::int FROM supplements      WHERE patient_id = ${pid}) AS supplements,
          (SELECT count(*)::int FROM encounters       WHERE patient_id = ${pid}) AS encounters,
          (SELECT count(*)::int FROM prescriptions    WHERE patient_id = ${pid}) AS prescriptions,
          (SELECT count(DISTINCT day)::int FROM vitals_daily WHERE patient_id = ${pid}) AS vitals_days,
          (SELECT count(*)::int FROM ecg_events       WHERE patient_id = ${pid}) AS ecg_events,
          (SELECT count(*)::int FROM pgx_findings     WHERE patient_id = ${pid}) AS pgx_findings,
          (SELECT count(*)::int FROM surgeries        WHERE patient_id = ${pid}) AS surgeries,
          (SELECT count(*)::int FROM injuries         WHERE patient_id = ${pid}) AS injuries,
          (SELECT count(*)::int FROM clinical_history WHERE patient_id = ${pid}) AS clinical_history,
          -- Mental
          (SELECT count(*)::int FROM psych_items      WHERE patient_id = ${pid}) AS psych_items,
          (SELECT count(*)::int FROM mood_entries     WHERE patient_id = ${pid}) AS mood_entries,
          (SELECT count(*)::int FROM panic_events     WHERE patient_id = ${pid}) AS panic_events,
          (SELECT count(*)::int FROM risk_assessments WHERE patient_id = ${pid}) AS risk_assessments,
          (SELECT count(*)::int FROM writings         WHERE patient_id = ${pid}) AS writings,
          -- Spiritual
          (SELECT count(*)::int FROM wheel_of_life_assessments WHERE patient_id = ${pid}) AS wheel_of_life,
          (SELECT count(*)::int FROM life_events      WHERE patient_id = ${pid}) AS life_events,
          -- Cross-cutting
          (SELECT count(*)::int FROM documents        WHERE patient_id = ${pid}) AS documents,
          (SELECT count(*)::int FROM imports          WHERE patient_id = ${pid}) AS imports
      `,
      sql`
        SELECT id, kind, title, original_filename, document_date, created_at
        FROM documents
        WHERE patient_id = ${pid}
        ORDER BY COALESCE(document_date, created_at::date) DESC, created_at DESC
        LIMIT 10
      `,
      sql`
        SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at, laboratory
        FROM lab_results
        WHERE patient_id = ${pid}
        ORDER BY taken_at DESC, created_at DESC
        LIMIT 10
      `,
      sql`
        SELECT if_.original_path, if_.status, if_.classified_as, if_.error_message, if_.created_at
        FROM import_files if_
        JOIN imports i ON i.id = if_.import_id
        WHERE i.patient_id = ${pid} AND if_.status NOT IN ('parsed', 'classified')
        ORDER BY if_.created_at DESC
        LIMIT 20
      `,
      sql`
        SELECT name, dose, frequency, daily_dose_amount, daily_dose_unit,
               drug_class, status, note, started_at, ended_at
        FROM medications
        WHERE patient_id = ${pid}
        ORDER BY (status = 'active') DESC, name ASC
      `,
      sql`
        SELECT name, dose, started_at, ended_at
        FROM supplements
        WHERE patient_id = ${pid}
        ORDER BY name ASC
      `,
      sql`
        SELECT event_date, date_raw, type, location, description, notes
        FROM patient_procedures
        WHERE patient_id = ${pid}
        ORDER BY event_date DESC NULLS LAST, created_at DESC
      `,
    ]);

    const c = pillars[0] || {};
    const physicalKeys = [
      "lab_results", "imaging_studies", "medications", "supplements",
      "encounters", "prescriptions", "vitals_days", "ecg_events",
      "pgx_findings", "surgeries", "injuries", "clinical_history",
    ];
    const mentalKeys = ["psych_items", "mood_entries", "panic_events", "risk_assessments", "writings"];
    const spiritualKeys = ["wheel_of_life", "life_events"];
    const totalIn = (keys) => keys.reduce((acc, k) => acc + (c[k] || 0), 0);

    return new Response(JSON.stringify({
      patient,
      pillars: {
        physical: { total: totalIn(physicalKeys), breakdown: pick(c, physicalKeys) },
        mental:   { total: totalIn(mentalKeys),   breakdown: pick(c, mentalKeys) },
        spiritual:{ total: totalIn(spiritualKeys),breakdown: pick(c, spiritualKeys) },
      },
      counts: { documents: c.documents || 0, imports: c.imports || 0 },
      recent_documents: recentDocs,
      recent_labs: recentLabs,
      pending_files: pendingFiles,
      medications,
      supplements,
      procedures,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Summary failed: ${e.message}`);
  }
}

function pick(obj, keys) {
  const out = {};
  keys.forEach((k) => { out[k] = obj[k] || 0; });
  return out;
}

// Ensure the clinical ECG table exists (migration 0012, self-applied — same
// precedent as the other ingestion paths). Idempotent.
async function ensureEcgStudiesTable(sql) {
  await sql`CREATE TABLE IF NOT EXISTS ecg_studies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    study_date date NOT NULL, recorded_at timestamptz,
    modality text NOT NULL DEFAULT '12-lead', lead_layout text,
    source_format text NOT NULL, fidelity text,
    ordering_doctor text, validating_doctor text, clinic text,
    heart_rate integer, pr_ms integer, qrs_ms integer, qt_ms integer, qtc_ms integer,
    axis_p integer, axis_qrs integer, axis_t integer,
    interpretation text, report_text text, source_sha text,
    original_key text, report_key text, svg_key text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ecg_studies_dedup UNIQUE NULLS NOT DISTINCT (patient_id, study_date, source_sha))`;
  await sql`CREATE INDEX IF NOT EXISTS ecg_studies_patient_date_idx ON ecg_studies (patient_id, study_date DESC)`;
}

// GET /api/patient-ecg-object?clerk=&id=&kind=svg|report|original
// Streams one ECG R2 object via the binding (no S3 token). svg/report inline so
// they render in-page; original is a download. Access is scoped by joining the
// study to the patient clerk, so a key can't be fetched cross-patient.
async function handleEcgObject(request, env) {
  if (!env.R2_BUCKET) return jsonError(500, "r2_bucket_not_bound");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  const id = url.searchParams.get("id");
  const kind = url.searchParams.get("kind") || "svg";
  if (!clerk || !id) return jsonError(400, "clerk_and_id_required");
  if (!["svg", "report", "original"].includes(kind)) return jsonError(400, "bad_kind");
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT s.svg_key, s.report_key, s.original_key
      FROM ecg_studies s JOIN users u ON u.id = s.patient_id
      WHERE u.clerk_user_id = ${clerk} AND s.id = ${id} LIMIT 1`;
    if (!rows.length) return jsonError(404, "study_not_found");
    const key = kind === "svg" ? rows[0].svg_key : kind === "report" ? rows[0].report_key : rows[0].original_key;
    if (!key) return jsonError(404, "object_not_found");
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return jsonError(404, "object_missing");
    const ct = kind === "svg" ? "image/svg+xml"
      : (obj.httpMetadata && obj.httpMetadata.contentType) || "application/pdf";
    const headers = new Headers();
    headers.set("Content-Type", ct);
    headers.set("Cache-Control", "private, max-age=300");
    if (kind === "original") {
      const fn = (key.split("/").pop() || "ecg").replace(/["\\\r\n]/g, "_");
      headers.set("Content-Disposition", `attachment; filename="${fn}"`);
    } else {
      headers.set("Content-Disposition", "inline");
    }
    return new Response(obj.body, { headers });
  } catch (e) {
    return jsonError(500, `ECG object failed: ${e.message}`);
  }
}

/* ── /api/vitals-range ─────────────────────────────────────────────
 * GET /api/vitals-range?clerk=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Date-truncated chart payloads for the Vitals page range selector. Returns
 * every series in EXACTLY the shape of the static data.js consts so the
 * frontend can swap them in and re-render without reshaping:
 *   weight            [[d, kg, fat_pct, muscle_kg], ...]          (WEIGHT)
 *   steps             [[d, steps], ...]                            (STEPS)
 *   hrvRhr            [[d, hrv, rhr], ...] per sleep period        (HRV_RHR)
 *   stressRes         [[d, stress_min, recovery_min, score, level, summary]]
 *   bp                [[d, sysMean, diaMean], ...]                 (BP)
 *   bpByWeek          [[wk, n, sysMed, sysMean, sysSd, diaMed, diaMean, diaSd]]
 *   sleepBox          {deep, rem, light, awake, total}             (SLEEP_BOX)
 *   sleepStagesByWeek [{week, n, deep, light, rem, awake, tst}]
 *   hrByTod           [[count, median, mean, sd] x 288]            (HR_BY_TOD)
 *
 * Sources: vitals_daily per-source rows + extras backfilled by
 * scripts/backfill-joao-vitals-range.mjs (sleep_periods, stress_*, bp_list)
 * and the hr_readings table (migration 0013). Aggregation math mirrors
 * bin/extract.py (Tukey 1.5xIQR box with Python-style exclusive quantiles,
 * population SD for BP weeks, fat% = fat_mass/weight, skip bf% < 5).
 * Trust model matches /api/patient-exams: clerk identifies the patient. */

function vrMean(a) { return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; }
function vrMedian(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function vrPstdev(a) {
  if (a.length < 2) return 0;
  const m = vrMean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length);
}
// Python statistics.quantiles(..., n=4) 'exclusive' method — (n+1)-position
// linear interpolation. Needed so a full-window custom range reproduces the
// extract.py-generated SLEEP_BOX exactly.
function vrQuantileExc(sorted, q) {
  const n = sorted.length;
  if (!n) return null;
  if (n === 1) return sorted[0];
  const pos = q * (n + 1);
  const lo = Math.floor(pos) - 1;
  const frac = pos - Math.floor(pos);
  if (lo < 0) return sorted[0];
  if (lo >= n - 1) return sorted[n - 1];
  return sorted[lo] + frac * (sorted[lo + 1] - sorted[lo]);
}
function vrBoxstats(values) {
  if (!values.length) return null;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const q1 = n >= 4 ? vrQuantileExc(s, 0.25) : s[0];
  const q3 = n >= 4 ? vrQuantileExc(s, 0.75) : s[n - 1];
  const med = vrMedian(s);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr, hi = q3 + 1.5 * iqr;
  const inside = s.filter((v) => v >= lo && v <= hi);
  const items = s.filter((v) => v < lo || v > hi).map(r3);
  if (!inside.length) return null;
  return {
    n, min: r3(inside[0]), q1: r3(q1), median: r3(med), q3: r3(q3),
    max: r3(inside[inside.length - 1]), mean: r3(vrMean(s)), items,
  };
}
function vrIsoMonday(day) {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function handleVitalsRange(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const DAY = /^\d{4}-\d{2}-\d{2}$/;
  if (!clerk) return jsonError(400, "clerk_required");
  if (!DAY.test(from || "") || !DAY.test(to || "")) return jsonError(400, "from_to_required_yyyy_mm_dd");
  if (from > to) return jsonError(400, "from_after_to");

  try {
    const sql = neon(env.DATABASE_URL);
    const patientRows = await sql`
      SELECT id FROM users
      WHERE clerk_user_id = ${clerk} AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
    if (!patientRows.length) return jsonError(404, "patient_not_found");
    const pid = patientRows[0].id;

    const [scale, oura, cuff, todRows] = await Promise.all([
      sql`SELECT day::text AS d, weight_kg, extras FROM vitals_daily
          WHERE patient_id = ${pid} AND source = 'withings_scale'
            AND day BETWEEN ${from} AND ${to} ORDER BY day`,
      sql`SELECT day::text AS d, steps, extras FROM vitals_daily
          WHERE patient_id = ${pid} AND source = 'oura'
            AND day BETWEEN ${from} AND ${to} ORDER BY day`,
      sql`SELECT day::text AS d, blood_pressure_sys, blood_pressure_dia, extras FROM vitals_daily
          WHERE patient_id = ${pid} AND source = 'withings_cuff'
            AND day BETWEEN ${from} AND ${to} ORDER BY day`,
      // HR-by-time-of-day: bin readings into 288 five-minute slots of the
      // local Europe/London day (DST-correct, unlike fixed-offset math).
      sql`SELECT floor((extract(hour from ts AT TIME ZONE 'Europe/London') * 60
                      + extract(minute from ts AT TIME ZONE 'Europe/London')) / 5)::int AS slot,
                 count(*)::int AS n,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY bpm) AS med,
                 avg(bpm) AS mean,
                 coalesce(stddev_pop(bpm), 0) AS sd
          FROM hr_readings
          WHERE patient_id = ${pid} AND source = 'oura'
            AND (ts AT TIME ZONE 'Europe/London')::date BETWEEN ${from} AND ${to}
          GROUP BY slot ORDER BY slot`,
    ]);

    const r1 = (v) => Math.round(v * 10) / 10;
    const r2 = (v) => Math.round(v * 100) / 100;

    // WEIGHT — fat% from fat_mass/weight; drop failed impedance reads (<5%).
    const weight = [];
    for (const r of scale) {
      const w = Number(r.weight_kg);
      if (!w) continue;
      const fm = Number(r.extras?.fat_mass_kg);
      const bf = Number.isFinite(fm) ? r2((fm / w) * 100) : null;
      if (bf == null || bf < 5) continue;
      const mm = Number(r.extras?.muscle_mass_kg);
      weight.push([r.d, r2(w), bf, Number.isFinite(mm) ? r2(mm) : null]);
    }

    // STEPS / HRV_RHR / STRESS_RES / sleep periods — all off the oura rows.
    const steps = [], hrvRhr = [], stressRes = [], periods = [];
    for (const r of oura) {
      if (r.steps != null) steps.push([r.d, r.steps]);
      const x = r.extras || {};
      for (const p of x.sleep_periods || []) {
        periods.push({ d: r.d, ...p });
        if (p.hrv != null) hrvRhr.push([r.d, p.hrv, p.rhr ?? null]);
      }
      if (x.stress_min !== undefined || x.resilience_score !== undefined) {
        stressRes.push([r.d, x.stress_min ?? null, x.recovery_min ?? null,
          x.resilience_score ?? null, x.resilience_level ?? null, x.stress_summary ?? null]);
      }
    }

    // SLEEP_BOX — Tukey box per stage, hours.
    const sleepBox = {};
    for (const stage of ["deep", "rem", "light", "awake", "total"]) {
      sleepBox[stage] = vrBoxstats(periods.map((p) => p[stage]).filter((v) => v != null));
    }

    // SLEEP_STAGES_BY_WEEK — weekly mean of per-night stage % + total hours.
    const wkSleep = new Map();
    for (const p of periods) {
      const sum = (p.deep ?? 0) + (p.light ?? 0) + (p.rem ?? 0) + (p.awake ?? 0);
      if (!sum) continue;
      const wk = vrIsoMonday(p.d);
      if (!wkSleep.has(wk)) wkSleep.set(wk, []);
      wkSleep.get(wk).push({
        deep: (p.deep / sum) * 100, light: (p.light / sum) * 100,
        rem: (p.rem / sum) * 100, awake: (p.awake / sum) * 100, tst: p.total,
      });
    }
    const sleepStagesByWeek = [...wkSleep.keys()].sort().map((wk) => {
      const ns = wkSleep.get(wk);
      return {
        week: wk, n: ns.length,
        deep: r1(vrMean(ns.map((x) => x.deep))), light: r1(vrMean(ns.map((x) => x.light))),
        rem: r1(vrMean(ns.map((x) => x.rem))), awake: r1(vrMean(ns.map((x) => x.awake))),
        tst: r2(vrMean(ns.map((x) => x.tst))),
      };
    });

    // BP daily means + weekly variability from the per-reading bp_list.
    const bp = [], wkBp = new Map();
    for (const r of cuff) {
      const list = r.extras?.bp_list;
      const wkAdd = (sys, dia) => {
        const wk = vrIsoMonday(r.d);
        if (!wkBp.has(wk)) wkBp.set(wk, { sys: [], dia: [] });
        wkBp.get(wk).sys.push(...sys);
        wkBp.get(wk).dia.push(...dia);
      };
      if (Array.isArray(list) && list.length) {
        const sys = list.map((x) => x[1]), dia = list.map((x) => x[2]);
        bp.push([r.d, r1(vrMean(sys)), r1(vrMean(dia))]);
        wkAdd(sys, dia);
      } else if (r.blood_pressure_sys != null && r.blood_pressure_dia != null) {
        bp.push([r.d, r.blood_pressure_sys, r.blood_pressure_dia]);
        wkAdd([r.blood_pressure_sys], [r.blood_pressure_dia]);
      }
    }
    const bpByWeek = [...wkBp.keys()].sort().map((wk) => {
      const { sys, dia } = wkBp.get(wk);
      return [wk, sys.length,
        r1(vrMedian(sys)), r2(vrMean(sys)), r2(vrPstdev(sys)),
        r1(vrMedian(dia)), r2(vrMean(dia)), r2(vrPstdev(dia))];
    });

    // HR_BY_TOD — dense 288-slot array; empty slots stay [0, null, null, null].
    const hrByTod = Array.from({ length: 288 }, () => [0, null, null, null]);
    let hrCount = 0;
    for (const r of todRows) {
      if (r.slot < 0 || r.slot > 287) continue;
      hrByTod[r.slot] = [r.n, r2(Number(r.med)), r2(Number(r.mean)), r2(Number(r.sd))];
      hrCount += r.n;
    }

    return new Response(JSON.stringify({
      range: { from, to },
      weight, steps, hrvRhr, stressRes, bp, bpByWeek,
      sleepBox, sleepStagesByWeek, hrByTod,
      meta: {
        nights: periods.length, hrReadings: hrCount,
        bpReadings: [...wkBp.values()].reduce((s, w) => s + w.sys.length, 0),
      },
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "private, max-age=300" } });
  } catch (e) {
    return jsonError(500, `vitals-range failed: ${e.message}`);
  }
}

async function handlePatientExams(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  if (!clerk) return jsonError(400, "clerk_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const patientRows = await sql`
      SELECT u.id, u.clerk_user_id, u.full_name
      FROM users u
      WHERE u.clerk_user_id = ${clerk} AND u.role = 'patient' AND u.archived_at IS NULL
      LIMIT 1
    `;
    if (patientRows.length === 0) return jsonError(404, "patient_not_found");
    const patient = patientRows[0];
    const pid = patient.id;

    const [labs, labDocs, imaging, medications, supplements] = await Promise.all([
      sql`
        SELECT panel, marker, value, value_text, unit, ref_low, ref_high, flag,
               taken_at, laboratory, requesting_doctor, source_blob_key
        FROM lab_results
        WHERE patient_id = ${pid}
        ORDER BY COALESCE(panel, 'zz') ASC, marker ASC, taken_at DESC
      `,
      sql`
        SELECT id, kind, title, original_filename, document_date, blob_key, created_at
        FROM documents
        WHERE patient_id = ${pid} AND (kind = 'lab_pdf' OR kind = 'unclassified')
        ORDER BY COALESCE(document_date, created_at::date) DESC, created_at DESC
      `,
      sql`
        SELECT id, modality, body_part, study_date, source_format,
               file_count, notes, blob_prefix, report_blob_key,
               manifest_blob_key, jpeg_preview_prefix
        FROM imaging_studies
        WHERE patient_id = ${pid}
        ORDER BY study_date DESC
      `,
      // Meds + supplements travel with the exams payload so the AI cards can flag
      // cross-specialty interactions and drug-driven marker shifts inline.
      sql`
        SELECT name, dose, frequency, daily_dose_amount, daily_dose_unit,
               drug_class, status, note, started_at, ended_at
        FROM medications
        WHERE patient_id = ${pid}
        ORDER BY (status = 'active') DESC, name ASC
      `,
      sql`
        SELECT name, dose, started_at, ended_at
        FROM supplements
        WHERE patient_id = ${pid}
        ORDER BY name ASC
      `,
    ]);

    // Group labs by panel → marker → array of points
    const panels = {};
    for (const row of labs) {
      const panel = row.panel || "Other";
      if (!panels[panel]) panels[panel] = {};
      if (!panels[panel][row.marker]) panels[panel][row.marker] = [];
      panels[panel][row.marker].push(row);
    }
    // Clinical ECG studies (migration 0012). Wrapped so a not-yet-created table
    // (fresh env, before first ingest) degrades to [] rather than 500-ing exams.
    // R2 keys are NOT exposed — the renderer fetches blobs via /api/patient-ecg-object
    // by study id, which re-checks patient ownership.
    let ecg_studies = [];
    try {
      ecg_studies = await sql`
        SELECT id, study_date, recorded_at, modality, lead_layout, source_format, fidelity,
               ordering_doctor, validating_doctor, clinic, heart_rate, pr_ms, qrs_ms, qt_ms, qtc_ms,
               axis_p, axis_qrs, axis_t, interpretation, report_text,
               (svg_key IS NOT NULL) AS has_svg,
               (report_key IS NOT NULL) AS has_report,
               (original_key IS NOT NULL) AS has_original
        FROM ecg_studies
        WHERE patient_id = ${pid}
        ORDER BY study_date DESC, created_at DESC`;
    } catch { ecg_studies = []; }

    // Convert to ordered arrays with summary per marker
    const groupedPanels = Object.keys(panels).sort().map((panelName) => {
      const markers = Object.keys(panels[panelName]).sort().map((markerName) => {
        const points = panels[panelName][markerName];
        const latest = points[0]; // already ordered by taken_at DESC
        return {
          marker: markerName,
          latest_value: latest.value,
          latest_value_text: latest.value_text,
          unit: latest.unit,
          ref_low: latest.ref_low,
          ref_high: latest.ref_high,
          flag: latest.flag,
          latest_taken_at: latest.taken_at,
          laboratory: latest.laboratory,
          requesting_doctor: latest.requesting_doctor,
          source_blob_key: latest.source_blob_key,
          points,
        };
      });
      return { panel: panelName, markers };
    });

    return new Response(JSON.stringify({
      patient,
      panels: groupedPanels,
      lab_documents: labDocs,
      imaging,
      medications,
      supplements,
      ecg_studies,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Exams query failed: ${e.message}`);
  }
}

async function handleLogin(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");
  if (!username || !password) return jsonError(400, "username_and_password_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT clerk_user_id, role, full_name, demo_password
      FROM users
      WHERE demo_username = ${username} AND archived_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0 || rows[0].demo_password !== password) {
      return jsonError(401, "invalid_credentials");
    }
    return new Response(JSON.stringify({
      ok: true,
      clerk_user_id: rows[0].clerk_user_id,
      role: rows[0].role,
      full_name: rows[0].full_name,
      username,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Login failed: ${e.message}`);
  }
}

async function handlePatientDashboard(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const clerk = url.searchParams.get("clerk");
  if (!clerk) return jsonError(400, "clerk_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT id FROM users WHERE clerk_user_id = ${clerk}
        AND role = 'patient' AND archived_at IS NULL LIMIT 1
    `;
    if (rows.length === 0) return jsonError(404, "patient_not_found");
    const sections = await fetchAllDashboards(sql, rows[0].id);
    return new Response(JSON.stringify({ sections }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return jsonError(500, `Dashboard fetch failed: ${e.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * "Update AI Insights" — async whole-patient AI Insight Update.
 *
 * Click -> POST /api/patient-dashboard-build { patient } -> 202 { job_id }.
 * The page polls GET /api/patient-dashboard-build/status?job_id=... until done.
 * The actual rebuild (lib/ai-insights.js, Opus, whole record) runs in
 * ctx.waitUntil() and writes ONLY to insight_jobs + patient_dashboards — never
 * to any clinical/source table. See runInsightJob().
 * ════════════════════════════════════════════════════════════════════════════ */

const INSIGHT_COOLDOWN_MS = 3 * 60 * 1000; // min gap between AI-insight rebuilds (3 min)
const INSIGHT_JOB_STAGES = ["fetching", "interpolating", "generating", "validating", "persisting"];

// The live DB is only reachable through the deployed Worker's secret, so we
// apply the 0008 migration idempotently here on first use (memoized per isolate).
// Mirrors db/migrations/0008_insight_jobs.sql exactly.
let _insightJobsReady = null;
function ensureInsightJobsTable(sql) {
  if (_insightJobsReady) return _insightJobsReady;
  _insightJobsReady = (async () => {
    await sql`DO $$ BEGIN
      CREATE TYPE "insight_job_status" AS ENUM ('queued','running','succeeded','failed');
    EXCEPTION WHEN duplicate_object THEN null; END $$`;
    await sql`CREATE TABLE IF NOT EXISTS insight_jobs (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status           insight_job_status NOT NULL DEFAULT 'queued',
      progress         integer NOT NULL DEFAULT 0,
      stage            text,
      error            text,
      insights_version integer,
      started_at       timestamptz NOT NULL DEFAULT now(),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      finished_at      timestamptz
    )`;
    await sql`CREATE INDEX IF NOT EXISTS insight_jobs_patient_status_idx ON insight_jobs (patient_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS insight_jobs_started_idx ON insight_jobs (patient_id, started_at)`;
  })().catch((e) => { _insightJobsReady = null; throw e; });
  return _insightJobsReady;
}

// Partial update of a job row. Null fields keep their existing value (COALESCE);
// finished_at is stamped to now() only when finished:true is passed.
async function updateInsightJob(sql, jobId, f) {
  await sql`
    UPDATE insight_jobs SET
      status           = COALESCE(${f.status ?? null}::insight_job_status, status),
      progress         = COALESCE(${f.progress ?? null}::int, progress),
      stage            = COALESCE(${f.stage ?? null}::text, stage),
      error            = COALESCE(${f.error ?? null}::text, error),
      insights_version = COALESCE(${f.insights_version ?? null}::int, insights_version),
      finished_at      = CASE WHEN ${f.finished === true} THEN now() ELSE finished_at END,
      updated_at       = now()
    WHERE id = ${jobId}`;
}

// Next insights_version for this patient (mirrors lib/ai-insights.js nextVersion).
async function nextInsightsVersion(sql, patientId) {
  const rows = await sql`
    SELECT cards_json FROM patient_dashboards
    WHERE patient_id = ${patientId} AND section = ${AI_INSIGHTS_SECTION} LIMIT 1`;
  const prev = rows[0]?.cards_json?.insights_version;
  return Number.isInteger(prev) ? prev + 1 : 1;
}

// Demo-phase access gate (Clerk not yet wired). The viewer asserts its
// clerk_user_id via the X-Viewer-Clerk header; we resolve it server-side and
// allow only: the patient themselves, an admin, or a user holding patient_access
// to this patient. Never trust the client's claim of role/identity beyond the id.
async function resolveInsightAccess(sql, viewerClerk, patientId) {
  if (!viewerClerk) return { ok: false, status: 401, reason: "viewer_required" };
  const rows = await sql`SELECT id, role FROM users
    WHERE clerk_user_id = ${viewerClerk} AND archived_at IS NULL LIMIT 1`;
  if (rows.length === 0) return { ok: false, status: 401, reason: "viewer_not_in_db" };
  const viewer = rows[0];
  if (viewer.id === patientId || viewer.role === "admin") {
    return { ok: true, viewerId: viewer.id, role: viewer.role };
  }
  const acc = await sql`SELECT 1 FROM patient_access
    WHERE user_id = ${viewer.id} AND patient_id = ${patientId} LIMIT 1`;
  if (acc.length > 0) return { ok: true, viewerId: viewer.id, role: viewer.role };
  return { ok: false, status: 403, reason: "forbidden" };
}

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/* POST /api/patient-dashboard-build
   - New (async) contract: body { patient } (or { patient_clerk }) with no/AI
     section -> START a whole-patient AI Insight Update job, return 202 { job_id }.
   - Legacy (sync) contract: body { patient_clerk, section } for a real dashboard
     section -> the per-section LLM build (admin tool), unchanged. */
async function handlePatientDashboardBuild(request, env, ctx) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!env.DATABASE_URL)       return jsonError(500, "DATABASE_URL not configured.");
  if (!env.ANTHROPIC_API_KEY)  return jsonError(500, "anthropic_api_key_not_configured");
  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const patientClerk = String(body?.patient || body?.patient_clerk || "").trim();
  const section = String(body?.section || "").trim();
  const mode = String(body?.mode || "").trim();
  if (!patientClerk) return jsonError(400, "patient_required");

  // Whole-patient async rebuild unless an explicit legacy dashboard section is asked for.
  const wantsRebuild = mode === "ai-insights" || section === AI_INSIGHTS_SECTION || (!section && !mode);
  const viewerClerk = request.headers.get("X-Viewer-Clerk") || "";

  try {
    const sql = neon(env.DATABASE_URL);
    const patientRows = await sql`SELECT id FROM users WHERE clerk_user_id = ${patientClerk}
          AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
    if (patientRows.length === 0) return jsonError(404, "patient_not_found");
    const patientId = patientRows[0].id;

    // ── Legacy per-section dashboard build (admin tool) — synchronous, unchanged ──
    if (!wantsRebuild) {
      if (!DASHBOARD_SECTIONS.includes(section)) return jsonError(400, "section_invalid");
      const viewerRows = viewerClerk
        ? await sql`SELECT id FROM users WHERE clerk_user_id = ${viewerClerk} AND archived_at IS NULL LIMIT 1`
        : [];
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 4 });
      const result = await buildOneSection({
        sql, anthropic, patientId, section, viewerId: viewerRows[0]?.id || null,
      });
      return new Response(JSON.stringify({ ok: true, ...result }), { headers: JSON_HEADERS });
    }

    // ── Async whole-patient AI Insight Update ──
    await ensureInsightJobsTable(sql);

    const access = await resolveInsightAccess(sql, viewerClerk, patientId);
    if (!access.ok) return jsonError(access.status, access.reason);

    // Concurrency lock: if a job is already queued/running for this patient,
    // attach to it instead of starting a second (no double runs, no swap race).
    const running = await sql`
      SELECT id, status, progress, stage, insights_version FROM insight_jobs
      WHERE patient_id = ${patientId} AND status IN ('queued','running')
      ORDER BY started_at DESC LIMIT 1`;
    if (running.length > 0) {
      const j = running[0];
      return new Response(JSON.stringify({
        ok: true, job_id: j.id, status: j.status, progress: j.progress,
        stage: j.stage, insights_version: j.insights_version, already_running: true,
      }), { status: 200, headers: JSON_HEADERS });
    }

    // Cooldown: refuse a rebuild < INSIGHT_COOLDOWN_MS after the last generation.
    const last = await sql`
      SELECT generated_at FROM patient_dashboards
      WHERE patient_id = ${patientId} AND section = ${AI_INSIGHTS_SECTION} LIMIT 1`;
    if (last.length > 0 && last[0].generated_at) {
      const ageMs = Date.now() - new Date(last[0].generated_at).getTime();
      if (ageMs >= 0 && ageMs < INSIGHT_COOLDOWN_MS) {
        return new Response(JSON.stringify({
          ok: false, error: "cooldown", generated_at: last[0].generated_at,
          minutes_ago: Math.floor(ageMs / 60000),
          retry_after_seconds: Math.ceil((INSIGHT_COOLDOWN_MS - ageMs) / 1000),
        }), { status: 429, headers: JSON_HEADERS });
      }
    }

    // Create the job row and return immediately; run the work after the response.
    const created = await sql`
      INSERT INTO insight_jobs (patient_id, status, progress, stage)
      VALUES (${patientId}, 'queued', 0, 'queued') RETURNING id`;
    const jobId = created[0].id;

    // TODO(scale): ctx.waitUntil keeps the isolate alive after the response, but a
    // long Opus high-effort run can approach Pages wall-clock limits. The upgrade
    // path is Cloudflare Queues (enqueue here, drain in a queue consumer). Not
    // blocking the feature now — the rebuild typically finishes well inside budget.
    const work = runInsightJob(jobId, patientId, access.viewerId, env);
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(work);
    else work.catch(() => {});

    return new Response(JSON.stringify({ ok: true, job_id: jobId, status: "queued", progress: 0 }), {
      status: 202, headers: JSON_HEADERS,
    });
  } catch (e) {
    const msg = e?.message || String(e);
    const rateLimited = /\b429\b|rate_limit/i.test(msg);
    return jsonError(rateLimited ? 429 : 500, `Build failed: ${msg}`);
  }
}

/* GET /api/patient-dashboard-build/status
   - ?job_id=...  -> that job's status (poll).
   - ?patient=... -> the latest in-flight (queued|running) job for this patient,
     or { status:"idle" } if none. Side-effect free — lets a freshly-loaded page
     attach to a job started elsewhere WITHOUT starting one. */
async function handleInsightJobStatus(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const jobId = String(url.searchParams.get("job_id") || "").trim();
  const patientClerk = String(url.searchParams.get("patient") || "").trim();
  const viewerClerk = request.headers.get("X-Viewer-Clerk") || url.searchParams.get("viewer") || "";
  try {
    const sql = neon(env.DATABASE_URL);
    await ensureInsightJobsTable(sql);

    // Patient-scoped probe (no job_id): return the latest active job, if any.
    if (!jobId) {
      if (!patientClerk) return jsonError(400, "job_id_or_patient_required");
      const pr = await sql`SELECT id FROM users WHERE clerk_user_id = ${patientClerk}
            AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
      if (pr.length === 0) return jsonError(404, "patient_not_found");
      const patientId = pr[0].id;
      const access = await resolveInsightAccess(sql, viewerClerk, patientId);
      if (!access.ok) return jsonError(access.status, access.reason);
      const active = await sql`
        SELECT id, status, progress, stage, insights_version FROM insight_jobs
        WHERE patient_id = ${patientId} AND status IN ('queued','running')
        ORDER BY started_at DESC LIMIT 1`;
      if (active.length === 0) return new Response(JSON.stringify({ status: "idle" }), { headers: JSON_HEADERS });
      const j = active[0];
      return new Response(JSON.stringify({
        job_id: j.id, status: j.status, progress: j.progress, stage: j.stage,
        insights_version: j.insights_version,
      }), { headers: JSON_HEADERS });
    }

    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
      return jsonError(404, "job_not_found");
    }
    const rows = await sql`
      SELECT id, patient_id, status, progress, stage, error, insights_version,
             started_at, updated_at, finished_at
      FROM insight_jobs WHERE id = ${jobId} LIMIT 1`;
    if (rows.length === 0) return jsonError(404, "job_not_found");
    const job = rows[0];
    const access = await resolveInsightAccess(sql, viewerClerk, job.patient_id);
    if (!access.ok) return jsonError(access.status, access.reason);
    return new Response(JSON.stringify({
      job_id: job.id, status: job.status, progress: job.progress, stage: job.stage,
      error: job.error, insights_version: job.insights_version,
      started_at: job.started_at, updated_at: job.updated_at, finished_at: job.finished_at,
    }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError(500, `Status failed: ${e.message}`);
  }
}

/* The background worker. Runs the ENTIRE update autonomously — no user input
   after the confirmation click. Stages update insight_jobs.progress/stage in
   Neon as they complete. GENERATE -> VALIDATE -> SWAP: rebuildAiInsights builds
   and validates the payload BEFORE it upserts the single patient_dashboards row,
   so a failure leaves the patient's previous insights fully intact. */
async function runInsightJob(jobId, patientId, viewerId, env) {
  const sql = neon(env.DATABASE_URL);
  // maxRetries:2 gives transient model/network errors a small fixed number of
  // automatic retries before the job is marked failed — autonomy, not a prompt.
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2 });
  try {
    await updateInsightJob(sql, jobId, { status: "running", stage: "fetching", progress: 8 });

    // interpolating: choose the next version up front so the job row reflects it.
    const version = await nextInsightsVersion(sql, patientId);
    await updateInsightJob(sql, jobId, { stage: "interpolating", progress: 18, insights_version: version });

    // generating: no real sub-progress on the long model call, so advance a timer
    // toward a 90 ceiling while awaiting (throttled DB writes ~every 1.5s).
    let progress = 20;
    let lastWrite = 0;
    await updateInsightJob(sql, jobId, { stage: "generating", progress });
    const onTick = () => {
      const now = Date.now();
      if (now - lastWrite < 1500) return;
      lastWrite = now;
      if (progress < 90) {
        progress += 1;
        updateInsightJob(sql, jobId, { stage: "generating", progress }).catch(() => {});
      }
    };

    // PHI / TIER TODO: on the current Anthropic standard tier, PHI must not reach
    // the model. There is no de-identification step at this boundary yet — the
    // assembled record is sent as-is, exactly as /api/chat already does. Run the
    // record through de-identification here (or gate this on the Scale-plan + BAA
    // flip) before onboarding real patients. See compliance posture memory.
    const result = await rebuildAiInsights({ sql, anthropic, patientId, viewerId, version, onTick });

    // validate/persist already happened inside rebuildAiInsights (parse + sanitize
    // + atomic upsert). Reflect that tail in the bar, then finish.
    await updateInsightJob(sql, jobId, { stage: "validating", progress: 93 });
    await updateInsightJob(sql, jobId, {
      status: "succeeded", stage: "persisting", progress: 100,
      insights_version: result.insights_version, finished: true,
    });
  } catch (e) {
    const msg = (e?.message || String(e)).slice(0, 500);
    await updateInsightJob(sql, jobId, { status: "failed", error: msg, finished: true }).catch(() => {});
  }
}

/* POST /api/patient-wipe-data — body: { patient_clerk }
   Header: X-Viewer-Clerk (must match patient OR be an admin).

   Deletes every health-data row for the patient AND every R2 object
   attached to them. Leaves users / patient_profiles / patient_access
   intact — the account, the password, and the doctor-access list
   survive so the patient can start fresh without re-registering.

   Patterned on /api/admin/patients/delete; the only intentional
   difference is skipping the final DELETE FROM users. */
async function handlePatientWipeData(request, env) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const patientClerk = String(body?.patient_clerk || "").trim();
  if (!patientClerk) return jsonError(400, "patient_clerk_required");

  const viewerClerk = request.headers.get("X-Viewer-Clerk") || "";
  if (!viewerClerk) return jsonError(401, "viewer_required");

  try {
    const sql = neon(env.DATABASE_URL);
    await ensureUploadsTables(sql); // wipe issues DELETE FROM uploads below
    const [patientRows, viewerRows] = await Promise.all([
      sql`SELECT id, full_name FROM users
            WHERE clerk_user_id = ${patientClerk} AND role = 'patient' AND archived_at IS NULL
            LIMIT 1`,
      sql`SELECT id, role FROM users
            WHERE clerk_user_id = ${viewerClerk} AND archived_at IS NULL
            LIMIT 1`,
    ]);
    if (patientRows.length === 0) return jsonError(404, "patient_not_found");
    if (viewerRows.length === 0) return jsonError(401, "viewer_not_found");
    const isSelf  = viewerRows[0].id === patientRows[0].id;
    const isAdmin = viewerRows[0].role === "admin";
    if (!isSelf && !isAdmin) return jsonError(403, "forbidden");
    const patientId = patientRows[0].id;

    // 1. Collect every R2 key attached to this patient.
    const keyQuery = await sql`
      SELECT blob_key AS k FROM documents      WHERE patient_id = ${patientId} AND blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM lab_results        WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT blob_key       FROM writings            WHERE patient_id = ${patientId} AND blob_key IS NOT NULL
      UNION
      SELECT if_.blob_key   FROM import_files if_
        JOIN imports i ON i.id = if_.import_id
        WHERE i.patient_id = ${patientId} AND if_.blob_key IS NOT NULL
      UNION
      SELECT blob_key       FROM ecg_events         WHERE patient_id = ${patientId} AND blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM clinical_history  WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM encounters        WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM injuries          WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM life_events       WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM medications       WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM panic_events      WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM pgx_findings      WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM prescriptions     WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM risk_assessments  WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM supplements       WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT source_blob_key FROM surgeries         WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
      UNION
      SELECT manifest_blob_key FROM imaging_studies WHERE patient_id = ${patientId} AND manifest_blob_key IS NOT NULL
      UNION
      SELECT report_blob_key   FROM imaging_studies WHERE patient_id = ${patientId} AND report_blob_key   IS NOT NULL
    `;
    const prefixQuery = await sql`
      SELECT DISTINCT blob_prefix FROM imaging_studies
      WHERE patient_id = ${patientId} AND blob_prefix IS NOT NULL
    `;
    const keys = new Set(keyQuery.map((r) => r.k).filter(Boolean));

    let r2Errors = 0;
    if (env.R2_BUCKET) {
      // Imaging prefixes + the patient's entire upload-portal namespace.
      const prefixes = prefixQuery.map((r) => r.blob_prefix).concat([`uploads/${patientId}/`]);
      for (const prefix of prefixes) {
        let cursor;
        do {
          const listed = await env.R2_BUCKET.list({ prefix, cursor });
          (listed.objects || []).forEach((obj) => keys.add(obj.key));
          cursor = listed.truncated ? listed.cursor : undefined;
        } while (cursor);
      }
      const keyArr = Array.from(keys);
      for (let i = 0; i < keyArr.length; i += 1000) {
        try { await env.R2_BUCKET.delete(keyArr.slice(i, i + 1000)); }
        catch { r2Errors++; }
      }
    }

    // 2. DELETE every patient-owned row from every health-data table.
    // Cascade FKs handle child tables (patient_dashboards → cards,
    // imports → import_files, psych_items → psych_evidence,
    // medications → taper_history).
    await sql`DELETE FROM lab_results              WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM vitals_daily             WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM glucose_points           WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM imaging_studies          WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM writings                 WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM documents                WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM wheel_of_life_assessments WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM medications              WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM supplements              WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM surgeries                WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM injuries                 WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM clinical_history         WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM risk_assessments         WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM psych_items              WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM mood_entries             WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM panic_events             WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM encounters               WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM prescriptions            WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM ecg_events               WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM pgx_findings             WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM life_events              WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM patient_dashboards       WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM imports                  WHERE patient_id = ${patientId}`;
    await sql`DELETE FROM uploads                  WHERE patient_id = ${patientId}`; // upload_objects cascades

    return new Response(JSON.stringify({
      ok: true,
      patient: { clerk_user_id: patientClerk, full_name: patientRows[0].full_name },
      r2_objects: keys.size,
      r2_delete_errors: r2Errors,
    }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch (e) {
    return jsonError(500, `Wipe failed: ${e.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════════════
 * Patient upload portal + admin review queue.
 *
 * Upload != Ingest. These endpoints store RAW blobs in R2 and metadata in Neon,
 * then expose a review queue. They never parse, classify, or write clinical rows;
 * ingestion stays manual/terminal-driven. Files go DIRECT to R2 via presigned
 * PUT URLs (the 100MB Worker body cap can't carry 2GB folders) — no file byte
 * ever passes through an /api route.
 *
 * R2 key scheme: uploads/{patient_id}/{upload_id}/{relative_path}
 * patient_id + upload_id are assigned server-side; the client never chooses them.
 * ════════════════════════════════════════════════════════════════════════════ */

// Idempotent DDL applied on first use — same pattern as ensureInsightJobsTable,
// because the live DB is only reachable through the deployed Worker's secret.
// Mirrors db/migrations/0009_uploads.sql exactly.
let _uploadsReady = null;
function ensureUploadsTables(sql) {
  if (_uploadsReady) return _uploadsReady;
  _uploadsReady = (async () => {
    await sql`DO $$ BEGIN
      CREATE TYPE "upload_status" AS ENUM ('pending_review','ingested','data_error');
    EXCEPTION WHEN duplicate_object THEN null; END $$`;
    await sql`CREATE TABLE IF NOT EXISTS uploads (
      id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      doc_ref          text NOT NULL UNIQUE,
      patient_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      uploader_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      original_name    text NOT NULL,
      kind             text NOT NULL,
      r2_prefix        text NOT NULL,
      file_count       integer NOT NULL DEFAULT 0,
      total_bytes      bigint NOT NULL DEFAULT 0,
      content_type     text,
      status           upload_status NOT NULL DEFAULT 'pending_review',
      error_note       text,
      created_at       timestamptz NOT NULL DEFAULT now(),
      reviewed_at      timestamptz,
      reviewed_by      uuid REFERENCES users(id) ON DELETE SET NULL
    )`;
    await sql`CREATE TABLE IF NOT EXISTS upload_objects (
      id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      upload_id     uuid NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
      r2_key        text NOT NULL,
      relative_path text NOT NULL,
      bytes         bigint,
      content_type  text
    )`;
    await sql`CREATE INDEX IF NOT EXISTS uploads_patient_created_idx ON uploads (patient_id, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS uploads_status_idx ON uploads (status)`;
    await sql`CREATE INDEX IF NOT EXISTS upload_objects_upload_idx ON upload_objects (upload_id)`;
  })().catch((e) => { _uploadsReady = null; throw e; });
  return _uploadsReady;
}

// R2 S3-API client (distinct from the env.R2_BUCKET Workers binding, which can't
// mint presigned URLs). Requires the R2 S3 token secrets — see §7 of the spec.
function r2S3Client(env) {
  if (!env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_ACCOUNT_ID || !env.R2_BUCKET_NAME) {
    return null;
  }
  return new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
}

function r2ObjectUrl(env, key) {
  const encoded = String(key).split("/").map(encodeURIComponent).join("/");
  // The bucket lives in the EU jurisdiction (GDPR-first), so the S3-API host is
  // {account}.eu.r2.cloudflarestorage.com — NOT the default {account}.r2...
  // host. A presign against the wrong host produces SignatureDoesNotMatch / 404.
  // Override with R2_S3_HOST if a bucket is ever moved out of the EU jurisdiction.
  const host = env.R2_S3_HOST || `${env.R2_ACCOUNT_ID}.eu.r2.cloudflarestorage.com`;
  return new URL(`https://${host}/${env.R2_BUCKET_NAME}/${encoded}`);
}

// Presigned PUT — sign METHOD ONLY via query (signQuery). We deliberately do NOT
// sign Content-Type: the browser sets it on the PUT, and a signed Content-Type
// that doesn't match the sent header is the #1 cause of presign failures.
async function presignPut(client, env, key, expires = 3600) {
  const u = r2ObjectUrl(env, key);
  u.searchParams.set("X-Amz-Expires", String(expires));
  const signed = await client.sign(u, { method: "PUT", aws: { signQuery: true } });
  return signed.url;
}

// Presigned GET — forces a download with the original filename via a SIGNED
// response-content-disposition query param.
async function presignGet(client, env, key, downloadName, expires = 3600) {
  const u = r2ObjectUrl(env, key);
  u.searchParams.set("X-Amz-Expires", String(expires));
  if (downloadName) {
    u.searchParams.set("response-content-disposition",
      `attachment; filename="${String(downloadName).replace(/["\\\r\n]/g, "_")}"`);
  }
  const signed = await client.sign(u, { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

// 8-char Crockford base32 (no I/L/O/U) display ID. Collisions are vanishingly
// unlikely; the doc_ref UNIQUE constraint + a regenerate-on-conflict loop in the
// caller make it safe regardless.
const DOC_REF_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function genDocRef() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let out = "";
  for (let i = 0; i < 8; i++) out += DOC_REF_ALPHABET[bytes[i] & 31];
  return out;
}

function sanitizeRelPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .split("/")
    .map((s) => s.trim())
    .filter((s) => s && s !== "." && s !== "..")
    .join("/");
}

/* POST /api/uploads/presign — auth: patient (self/access/admin).
   Body: { patient, items: [{ group_id, kind, name, files: [{ relative_path, size, content_type }] }] }
   Returns presigned PUT URLs per file. NO DB writes here (avoids orphans) — the
   rows are written at /complete. upload_id is minted only to namespace R2 keys. */
async function handleUploadsPresign(request, env) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  // Two upload transports:
  //  - "s3":    presigned PUT straight to R2 (needs the R2 S3-API token secrets;
  //             no per-file size ceiling beyond ~5GB; zero Worker bandwidth).
  //  - "proxy": PUT each file through the Worker via the env.R2_BUCKET binding
  //             (works with NO S3 token and NO bucket CORS; per-file cap = the
  //             Worker request-body limit, ~100MB on the free plan).
  // Prefer s3 when configured; fall back to the binding so uploads work today.
  const client = r2S3Client(env);
  const mode = client ? "s3" : "proxy";
  if (!client && !env.R2_BUCKET) return jsonError(500, "r2_not_configured");

  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const patientClerk = String(body?.patient || body?.patient_clerk || "").trim();
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!patientClerk) return jsonError(400, "patient_required");
  if (!items || items.length === 0) return jsonError(400, "items_required");
  if (items.length > 200) return jsonError(400, "too_many_items");

  const viewerClerk = request.headers.get("X-Viewer-Clerk") || "";
  try {
    const sql = neon(env.DATABASE_URL);
    const pr = await sql`SELECT id FROM users WHERE clerk_user_id = ${patientClerk}
          AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
    if (pr.length === 0) return jsonError(404, "patient_not_found");
    const patientId = pr[0].id;
    const access = await resolveInsightAccess(sql, viewerClerk, patientId);
    if (!access.ok) return jsonError(access.status, access.reason);

    const out = [];
    for (const item of items) {
      const kind = item?.kind === "folder" ? "folder" : "file";
      const name = String(item?.name || "").trim().slice(0, 300) || "upload";
      const files = Array.isArray(item?.files) ? item.files : [];
      if (files.length === 0 || files.length > 5000) return jsonError(400, "item_file_count_invalid");
      const uploadId = crypto.randomUUID();
      const prefix = `uploads/${patientId}/${uploadId}`;
      const signedFiles = [];
      for (const f of files) {
        const rel = sanitizeRelPath(f?.relative_path || f?.name || name) || name;
        const key = `${prefix}/${rel}`;
        const put_url = client
          ? await presignPut(client, env, key)
          : `/api/uploads/put?patient=${encodeURIComponent(patientClerk)}&key=${encodeURIComponent(key)}`;
        signedFiles.push({
          relative_path: rel,
          r2_key: key,
          content_type: f?.content_type || null,
          put_url,
        });
      }
      out.push({
        group_id: item?.group_id ?? null,
        upload_id: uploadId,
        kind,
        original_name: name,
        r2_prefix: kind === "folder" ? `${prefix}/` : signedFiles[0].r2_key,
        files: signedFiles,
      });
    }
    return new Response(JSON.stringify({ ok: true, mode, patient_id: patientId, items: out }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError(500, `Presign failed: ${e.message}`);
  }
}

/* PUT /api/uploads/put?patient=<clerk>&key=<r2-key> — auth: patient (self/access/admin).
   The "proxy" upload transport: the browser PUTs raw file bytes here and the
   Worker writes them to R2 via the env.R2_BUCKET binding. Used when the R2 S3-API
   token isn't configured (so no presigned URLs / no bucket CORS needed). The key
   is validated to the caller's own uploads/{patient_id}/ namespace — a viewer can
   only write within a patient they have access to. Per-file size is bounded by the
   Worker request-body limit (~100MB free plan). */
async function handleUploadsPut(request, env) {
  if (request.method !== "PUT") return jsonError(405, "method_not_allowed");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  if (!env.R2_BUCKET) return jsonError(500, "r2_bucket_not_bound");
  const url = new URL(request.url);
  const patientClerk = String(url.searchParams.get("patient") || "").trim();
  const key = String(url.searchParams.get("key") || "");
  if (!patientClerk || !key) return jsonError(400, "patient_and_key_required");
  const viewerClerk = request.headers.get("X-Viewer-Clerk") || "";
  try {
    const sql = neon(env.DATABASE_URL);
    const pr = await sql`SELECT id FROM users WHERE clerk_user_id = ${patientClerk}
          AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
    if (pr.length === 0) return jsonError(404, "patient_not_found");
    const patientId = pr[0].id;
    const access = await resolveInsightAccess(sql, viewerClerk, patientId);
    if (!access.ok) return jsonError(access.status, access.reason);
    if (!key.startsWith(`uploads/${patientId}/`)) return jsonError(403, "key_outside_patient_namespace");
    const ct = request.headers.get("content-type") || "";
    await env.R2_BUCKET.put(key, request.body, ct ? { httpMetadata: { contentType: ct } } : undefined);
    return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError(500, `Upload failed: ${e.message}`);
  }
}

/* POST /api/uploads/complete — auth: patient (self/access/admin).
   Body: { patient, items: [{ upload_id, kind, original_name, r2_prefix,
            files: [{ relative_path, r2_key, bytes, content_type, ok }] }] }
   Writes uploads (status pending_review) + upload_objects for the files that
   actually PUT (ok !== false). Re-derives patient_id server-side and rejects any
   key not under uploads/{patient_id}/ — a patient can only write their own rows. */
async function handleUploadsComplete(request, env) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");

  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const patientClerk = String(body?.patient || body?.patient_clerk || "").trim();
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!patientClerk) return jsonError(400, "patient_required");
  if (!items || items.length === 0) return jsonError(400, "items_required");

  const viewerClerk = request.headers.get("X-Viewer-Clerk") || "";
  try {
    const sql = neon(env.DATABASE_URL);
    await ensureUploadsTables(sql);
    const pr = await sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${patientClerk}
          AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
    if (pr.length === 0) return jsonError(404, "patient_not_found");
    const patientId = pr[0].id;
    const access = await resolveInsightAccess(sql, viewerClerk, patientId);
    if (!access.ok) return jsonError(access.status, access.reason);

    const keyPrefix = `uploads/${patientId}/`;
    const created = [];
    // Collect EVERY write (uploads + upload_objects + audit) into one statement
    // list and run it in chunked transactions — each chunk is a single Neon
    // round-trip (one Worker subrequest). A per-file INSERT here used to blow the
    // 50-subrequest cap on folder uploads. IDs are pre-generated so the inserts
    // need no RETURNING round-trips; doc_ref collisions are astronomically
    // unlikely (a clash just fails the tx and the client can retry complete).
    const stmts = [];
    for (const item of items) {
      const kind = item?.kind === "folder" ? "folder" : "file";
      const name = String(item?.original_name || item?.name || "").trim().slice(0, 300) || "upload";
      const r2Prefix = String(item?.r2_prefix || "");
      if (!r2Prefix.startsWith(keyPrefix)) return jsonError(403, "key_outside_patient_namespace");
      const okFiles = (Array.isArray(item?.files) ? item.files : []).filter((f) => f && f.ok !== false);
      if (okFiles.length === 0) continue; // whole item failed to upload — skip, no row
      for (const f of okFiles) {
        if (!String(f.r2_key || "").startsWith(keyPrefix)) return jsonError(403, "key_outside_patient_namespace");
      }
      const totalBytes = okFiles.reduce((a, f) => a + (Number(f.bytes) || 0), 0);
      const contentType = kind === "file" ? (okFiles[0].content_type || null) : null;
      const uploadId = crypto.randomUUID();
      const docRef = genDocRef();

      stmts.push(sql`
        INSERT INTO uploads (id, doc_ref, patient_id, uploader_user_id, original_name, kind,
                             r2_prefix, file_count, total_bytes, content_type, status)
        VALUES (${uploadId}, ${docRef}, ${patientId}, ${access.viewerId}, ${name}, ${kind},
                ${r2Prefix}, ${okFiles.length}, ${totalBytes}, ${contentType}, 'pending_review')`);
      for (const f of okFiles) {
        stmts.push(sql`
          INSERT INTO upload_objects (upload_id, r2_key, relative_path, bytes, content_type)
          VALUES (${uploadId}, ${f.r2_key}, ${sanitizeRelPath(f.relative_path || name) || name},
                  ${Number(f.bytes) || null}, ${f.content_type || null})`);
      }
      stmts.push(sql`
        INSERT INTO audit_log (actor_user_id, action, target_table, target_id, patient_context, metadata)
        VALUES (${access.viewerId}, 'upload_created', 'uploads', ${uploadId}, ${patientId},
                ${JSON.stringify({ doc_ref: docRef, kind, file_count: okFiles.length, total_bytes: totalBytes })}::jsonb)`);
      created.push({
        id: uploadId, doc_ref: docRef, original_name: name, kind,
        file_count: okFiles.length, total_bytes: totalBytes, status: "pending_review",
      });
    }
    if (stmts.length) await runChunked(sql, stmts, 500); // 500 statements/transaction = 1 subrequest each

    // Notify Client Services that a patient uploaded data (best-effort: Slack + email).
    if (created.length) {
      const who = pr[0].full_name || patientClerk;
      const refs = created.map((c) => c.doc_ref).join(", ");
      await notifySlack(env, `:inbox_tray: Patient *${who}* just uploaded new data`);
      await notifyEmail(env, `New upload — ${who}`,
        `Patient ${who} just uploaded new data to Lumen Health.\n\n` +
        `${created.length} item(s): ${refs}\n\n` +
        `Review queue: https://lumenhealth.io/uploads-review.html`);
    }
    return new Response(JSON.stringify({ ok: true, created }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError(500, `Complete failed: ${e.message}`);
  }
}

/* GET /api/uploads?patient=clerk — auth: patient (self/access/admin).
   The patient-visible table. Scoped to the resolved patient_id; never leaks
   another patient's rows (access is checked against the viewer). */
async function handleUploadsList(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const patientClerk = String(url.searchParams.get("patient") || "").trim();
  if (!patientClerk) return jsonError(400, "patient_required");
  const viewerClerk = request.headers.get("X-Viewer-Clerk") || url.searchParams.get("viewer") || "";
  try {
    const sql = neon(env.DATABASE_URL);
    await ensureUploadsTables(sql);
    const pr = await sql`SELECT id FROM users WHERE clerk_user_id = ${patientClerk}
          AND role = 'patient' AND archived_at IS NULL LIMIT 1`;
    if (pr.length === 0) return jsonError(404, "patient_not_found");
    const patientId = pr[0].id;
    const access = await resolveInsightAccess(sql, viewerClerk, patientId);
    if (!access.ok) return jsonError(access.status, access.reason);
    const rows = await sql`
      SELECT id, doc_ref, original_name, kind, file_count, total_bytes, content_type,
             status, error_note, created_at, reviewed_at
      FROM uploads WHERE patient_id = ${patientId}
      ORDER BY created_at DESC`;
    return new Response(JSON.stringify({ uploads: rows }), { headers: JSON_HEADERS });
  } catch (e) {
    return jsonError(500, `Uploads list failed: ${e.message}`);
  }
}

async function handlePatients(request, env) {
  if (!env.DATABASE_URL) {
    return jsonError(500, "DATABASE_URL not configured.");
  }
  const url = new URL(request.url);
  const forClerkId = url.searchParams.get("for");

  try {
    const sql = neon(env.DATABASE_URL);

    if (!forClerkId) {
      const rows = await sql`
        SELECT id, full_name, role, clerk_user_id
        FROM users
        WHERE archived_at IS NULL
        ORDER BY role, full_name
      `;
      return new Response(JSON.stringify({ users: rows }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    const viewer = await sql`
      SELECT id, full_name, role, clerk_user_id
      FROM users
      WHERE clerk_user_id = ${forClerkId} AND archived_at IS NULL
      LIMIT 1
    `;
    if (viewer.length === 0) {
      return new Response(JSON.stringify({
        viewer: null,
        patients: [],
        reason: "viewer_not_in_db",
      }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Admins see every patient; everyone else is gated by patient_access.
    const patients = viewer[0].role === "admin"
      ? await sql`
          SELECT
            u.id,
            u.clerk_user_id,
            u.full_name,
            u.locale,
            pp.date_of_birth,
            pp.sex,
            pp.country_of_residence,
            NULL::text AS relation
          FROM users u
          LEFT JOIN patient_profiles pp ON pp.user_id = u.id
          WHERE u.role = 'patient' AND u.archived_at IS NULL
          ORDER BY u.full_name
        `
      : await sql`
          SELECT
            u.id,
            u.clerk_user_id,
            u.full_name,
            u.locale,
            pp.date_of_birth,
            pp.sex,
            pp.country_of_residence,
            pa.notes AS relation
          FROM patient_access pa
          JOIN users u ON u.id = pa.patient_id
          LEFT JOIN patient_profiles pp ON pp.user_id = u.id
          WHERE pa.user_id = ${viewer[0].id}
            AND u.archived_at IS NULL
            AND u.role = 'patient'
          ORDER BY u.full_name
        `;
    return new Response(JSON.stringify({
      viewer: viewer[0],
      patients,
    }), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return jsonError(500, `DB query failed: ${e.message}`);
  }
}

/**
 * Demo-phase admin gate. Looks up the viewer's clerk_user_id (sent via the
 * `X-Viewer-Clerk` header or `?viewer=` query param) in the DB and verifies
 * role='admin'. When Clerk lands, swap this for requireAuth(['admin']) from
 * lib/auth.js. Trust model is identical to /api/patients?for=: the client
 * asserts its own clerk_user_id; this is fine for personal-demo phase only.
 */
async function getAdminViewer(request, sql) {
  const url = new URL(request.url);
  const viewerClerk =
    request.headers.get("x-viewer-clerk") ||
    url.searchParams.get("viewer") ||
    "";
  if (!viewerClerk) return { error: jsonError(401, "viewer_required") };
  const rows = await sql`
    SELECT id, clerk_user_id, role, full_name
    FROM users
    WHERE clerk_user_id = ${viewerClerk} AND archived_at IS NULL
    LIMIT 1
  `;
  if (rows.length === 0) return { error: jsonError(401, "viewer_not_in_db") };
  if (rows[0].role !== "admin") return { error: jsonError(403, "not_admin") };
  return { viewer: rows[0] };
}

function slugifyForClerkPlaceholder(name) {
  const base = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24) || "patient";
  // 6-hex random suffix → unique even across same-name collisions
  const suffix = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  return `pending:${base}-${suffix}`;
}

// Run an array of tagged-template queries in chunked transactions (one HTTP
// round-trip per chunk). Returns the number of statements executed.
async function runChunked(sql, queries, size = 150) {
  for (let i = 0; i < queries.length; i += size) {
    const slice = queries.slice(i, i + size);
    if (slice.length) await sql.transaction(slice);
  }
  return queries.length;
}

const N = (v) => (v === undefined ? null : v); // normalize undefined -> null for params

// Build INSERT queries for one clinical table from a rows array. Each table has
// an explicit column list; jsonb columns are cast inline. Idempotency is handled
// by the caller's wipe step + ON CONFLICT where a natural key exists.
function buildSeedQueries(sql, table, pid, rows) {
  switch (table) {
    case "vitals_daily":
      return rows.map((v) => sql`
        INSERT INTO vitals_daily (patient_id, day, source, steps, calories_active, calories_passive,
          hrv_ms, resting_hr, sleep_minutes, deep_sleep_minutes, rem_sleep_minutes, spo2_pct,
          weight_kg, blood_pressure_sys, blood_pressure_dia)
        VALUES (${pid}, ${v.day}, ${v.source || "aggregate"}, ${N(v.steps)}, ${N(v.calories_active)}, ${N(v.calories_passive)},
          ${N(v.hrv_ms)}, ${N(v.resting_hr)}, ${N(v.sleep_minutes)}, ${N(v.deep_sleep_minutes)}, ${N(v.rem_sleep_minutes)}, ${N(v.spo2_pct)},
          ${N(v.weight_kg)}, ${N(v.blood_pressure_sys)}, ${N(v.blood_pressure_dia)})
        ON CONFLICT (patient_id, day, source) DO UPDATE SET
          steps=EXCLUDED.steps, hrv_ms=EXCLUDED.hrv_ms, resting_hr=EXCLUDED.resting_hr,
          sleep_minutes=EXCLUDED.sleep_minutes, spo2_pct=EXCLUDED.spo2_pct, weight_kg=EXCLUDED.weight_kg,
          blood_pressure_sys=EXCLUDED.blood_pressure_sys, blood_pressure_dia=EXCLUDED.blood_pressure_dia`);
    case "glucose_points":
      return rows.map((g) => sql`
        INSERT INTO glucose_points (patient_id, ts, mg_dl, source)
        VALUES (${pid}, ${g.ts}, ${g.mg_dl}, ${g.source || "cgm"})
        ON CONFLICT (patient_id, ts) DO NOTHING`);
    case "ecg_events":
      return rows.map((e) => sql`
        INSERT INTO ecg_events (patient_id, recorded_at, classification, average_hr, duration_seconds, source, blob_key, notes)
        VALUES (${pid}, ${e.recorded_at}, ${N(e.classification)}, ${N(e.average_hr)}, ${N(e.duration_seconds)}, ${N(e.source)}, ${N(e.blob_key)}, ${N(e.notes)})`);
    case "medications":
      return rows.map((m) => sql`
        INSERT INTO medications (patient_id, name, dose, drug_class, status, note, started_at, ended_at)
        VALUES (${pid}, ${m.name}, ${N(m.dose)}, ${N(m.drug_class)}, ${N(m.status)}, ${N(m.note)}, ${N(m.started_at)}, ${N(m.ended_at)})`);
    case "supplements":
      return rows.map((s) => sql`
        INSERT INTO supplements (patient_id, name, dose, started_at, ended_at)
        VALUES (${pid}, ${s.name}, ${N(s.dose)}, ${N(s.started_at)}, ${N(s.ended_at)})`);
    case "surgeries":
      return rows.map((s) => sql`
        INSERT INTO surgeries (patient_id, name, performed_on, notes)
        VALUES (${pid}, ${s.name}, ${N(s.performed_on)}, ${N(s.notes)})`);
    case "injuries":
      return rows.map((i) => sql`
        INSERT INTO injuries (patient_id, name, occurred_on, notes)
        VALUES (${pid}, ${i.name}, ${N(i.occurred_on)}, ${N(i.notes)})`);
    case "clinical_history":
      return rows.map((c) => sql`
        INSERT INTO clinical_history (patient_id, category, heading, detail, occurred_on)
        VALUES (${pid}, ${c.category}, ${c.heading}, ${N(c.detail)}, ${N(c.occurred_on)})`);
    case "risk_assessments":
      return rows.map((r) => sql`
        INSERT INTO risk_assessments (patient_id, kind, payload, recorded_at)
        VALUES (${pid}, ${r.kind}, ${JSON.stringify(r.payload || {})}::jsonb, ${r.recorded_at})`);
    case "lab_results":
      return rows.map((l) => sql`
        INSERT INTO lab_results (patient_id, panel, marker, value, value_text, unit, ref_low, ref_high, flag, taken_at, laboratory, requesting_doctor)
        VALUES (${pid}, ${N(l.panel)}, ${l.marker}, ${N(l.value)}, ${N(l.value_text)}, ${N(l.unit)}, ${N(l.ref_low)}, ${N(l.ref_high)}, ${N(l.flag)}, ${l.taken_at}, ${N(l.laboratory)}, ${N(l.requesting_doctor)})`);
    case "imaging_studies":
      return rows.map((im) => sql`
        INSERT INTO imaging_studies (patient_id, modality, body_part, study_date, source_format, blob_prefix, report_blob_key, file_count, notes)
        VALUES (${pid}, ${im.modality}, ${N(im.body_part)}, ${im.study_date}, ${im.source_format || "MIXED"}, ${im.blob_prefix || ""}, ${N(im.report_blob_key)}, ${N(im.file_count)}, ${N(im.notes)})`);
    case "pgx_findings":
      return rows.map((p) => sql`
        INSERT INTO pgx_findings (patient_id, gene, variant, phenotype, category, drug_class_impact, recommendation, confidence, assay_name, reported_on)
        VALUES (${pid}, ${p.gene}, ${N(p.variant)}, ${N(p.phenotype)}, ${N(p.category)}, ${N(p.drug_class_impact)}, ${N(p.recommendation)}, ${N(p.confidence)}, ${N(p.assay_name)}, ${N(p.reported_on)})`);
    case "writings":
      return rows.map((w) => sql`
        INSERT INTO writings (patient_id, title, written_at, language, blob_key, extracted_text)
        VALUES (${pid}, ${w.title}, ${N(w.written_at)}, ${N(w.language)}, ${w.blob_key || ""}, ${N(w.extracted_text)})`);
    case "mood_entries":
      return rows.map((m) => sql`
        INSERT INTO mood_entries (patient_id, ts, valence, arousal, primary_emotion, note, source)
        VALUES (${pid}, ${m.ts}, ${N(m.valence)}, ${N(m.arousal)}, ${N(m.primary_emotion)}, ${N(m.note)}, ${m.source || "manual"})`);
    case "panic_events":
      return rows.map((p) => sql`
        INSERT INTO panic_events (patient_id, occurred_at, duration_minutes, severity, triggers, symptoms, location, intervention, notes)
        VALUES (${pid}, ${p.occurred_at}, ${N(p.duration_minutes)}, ${N(p.severity)}, ${N(p.triggers)}, ${p.symptoms ? JSON.stringify(p.symptoms) : null}::jsonb, ${N(p.location)}, ${N(p.intervention)}, ${N(p.notes)})`);
    case "life_events":
      return rows.map((e) => sql`
        INSERT INTO life_events (patient_id, occurred_on, category, title, description, location, significance)
        VALUES (${pid}, ${e.occurred_on}, ${e.category}, ${e.title}, ${N(e.description)}, ${N(e.location)}, ${N(e.significance)})`);
    case "psych_items":
      return rows.map((p) => sql`
        INSERT INTO psych_items (patient_id, dimension_id, legacy_anchor, title, synthesis, rank, generated_at, generated_by)
        VALUES (${pid}, ${p.dimension_id}, ${N(p.legacy_anchor)}, ${p.title}, ${p.synthesis}, ${N(p.rank)}, now(), ${p.generated_by || "llm:opus-4-7"})`);
    case "psych_evidence":
      // Links to psych_items (by legacy_anchor) and optionally to a writing (by title).
      return rows.map((e) => sql`
        INSERT INTO psych_evidence (psych_item_id, writing_id, quote, source_filename, source_paragraph, is_translated, original_language, rank)
        SELECT pi.id,
               (SELECT w.id FROM writings w WHERE w.patient_id=${pid} AND w.title=${N(e.writing_title)} LIMIT 1),
               ${e.quote}, ${N(e.source_filename)}, ${N(e.source_paragraph)}, ${e.is_translated === true}, ${N(e.original_language)}, ${N(e.rank)}
        FROM psych_items pi
        WHERE pi.patient_id=${pid} AND pi.legacy_anchor=${e.legacy_anchor}
        LIMIT 1`);
    case "wheel_of_life_assessments":
      return rows.map((w) => sql`
        INSERT INTO wheel_of_life_assessments (patient_id, taken_on, scores, notes)
        VALUES (${pid}, ${w.taken_on}, ${JSON.stringify(w.scores || {})}::jsonb, ${N(w.notes)})
        ON CONFLICT (patient_id, taken_on) DO UPDATE SET scores=EXCLUDED.scores, notes=EXCLUDED.notes`);
    default:
      return null; // unknown table
  }
}

// Scoped wipe before re-insert, so the seed is idempotent per table.
function wipeQuery(sql, table, pid) {
  switch (table) {
    case "vitals_daily":   return sql`DELETE FROM vitals_daily   WHERE patient_id=${pid} AND source='aggregate'`;
    case "glucose_points": return sql`DELETE FROM glucose_points WHERE patient_id=${pid}`;
    case "ecg_events":     return sql`DELETE FROM ecg_events     WHERE patient_id=${pid}`;
    case "medications":    return sql`DELETE FROM medications    WHERE patient_id=${pid}`;
    case "supplements":    return sql`DELETE FROM supplements    WHERE patient_id=${pid}`;
    case "surgeries":      return sql`DELETE FROM surgeries      WHERE patient_id=${pid}`;
    case "injuries":       return sql`DELETE FROM injuries       WHERE patient_id=${pid}`;
    case "clinical_history": return sql`DELETE FROM clinical_history WHERE patient_id=${pid}`;
    case "risk_assessments": return sql`DELETE FROM risk_assessments WHERE patient_id=${pid}`;
    case "lab_results":    return sql`DELETE FROM lab_results    WHERE patient_id=${pid}`;
    case "imaging_studies":return sql`DELETE FROM imaging_studies WHERE patient_id=${pid}`;
    case "pgx_findings":   return sql`DELETE FROM pgx_findings   WHERE patient_id=${pid}`;
    case "writings":       return sql`DELETE FROM writings       WHERE patient_id=${pid}`;
    case "mood_entries":   return sql`DELETE FROM mood_entries   WHERE patient_id=${pid}`;
    case "panic_events":   return sql`DELETE FROM panic_events   WHERE patient_id=${pid}`;
    case "life_events":    return sql`DELETE FROM life_events    WHERE patient_id=${pid}`;
    case "psych_items":    return sql`DELETE FROM psych_items    WHERE patient_id=${pid}`;
    case "psych_evidence": return null; // cascades from psych_items wipe
    case "wheel_of_life_assessments": return null; // ON CONFLICT handles update
    default: return null;
  }
}

async function handleAdmin(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const sql = neon(env.DATABASE_URL);

  const gate = await getAdminViewer(request, sql);
  if (gate.error) return gate.error;
  const admin = gate.viewer;

  const url = new URL(request.url);
  const path = url.pathname;

  // GET /api/admin/everything — single-shot bundle for the admin UI
  if (path === "/api/admin/everything" && request.method === "GET") {
    try {
      const [patients, users, access, pending] = await Promise.all([
        sql`
          SELECT u.id, u.clerk_user_id, u.full_name, u.email, u.locale, u.created_at,
                 u.demo_username, u.demo_password,
                 pp.date_of_birth, pp.sex, pp.country_of_residence, pp.native_language,
                 pp.height_cm, pp.weight_kg, pp.blood_type
          FROM users u
          LEFT JOIN patient_profiles pp ON pp.user_id = u.id
          WHERE u.role = 'patient' AND u.archived_at IS NULL
          ORDER BY u.full_name
        `,
        sql`
          SELECT id, clerk_user_id, full_name, email, role, locale,
                 demo_username, demo_password
          FROM users
          WHERE archived_at IS NULL
          ORDER BY role, full_name
        `,
        sql`
          SELECT
            pa.user_id, pa.patient_id, pa.notes, pa.granted_at,
            u_user.clerk_user_id   AS user_clerk,
            u_user.full_name       AS user_name,
            u_user.role            AS user_role,
            u_pat.clerk_user_id    AS patient_clerk,
            u_pat.full_name        AS patient_name
          FROM patient_access pa
          JOIN users u_user ON u_user.id = pa.user_id
          JOIN users u_pat  ON u_pat.id  = pa.patient_id
          ORDER BY u_pat.full_name, u_user.full_name
        `,
        sql`
          SELECT u.clerk_user_id AS patient_clerk,
                 sum(t.n)::int   AS pending
          FROM users u
          JOIN (
            SELECT i.patient_id AS pid, count(*)::int AS n
              FROM import_files if_
              JOIN imports i ON i.id = if_.import_id
              WHERE if_.status NOT IN ('parsed', 'classified')
                AND if_.blob_key IS NOT NULL
              GROUP BY i.patient_id
            UNION ALL
            SELECT patient_id AS pid, count(*)::int AS n
              FROM documents
              WHERE kind = 'unclassified'
              GROUP BY patient_id
          ) t ON t.pid = u.id
          WHERE u.role = 'patient' AND u.archived_at IS NULL
          GROUP BY u.clerk_user_id
        `,
      ]);
      const pendingMap = {};
      pending.forEach((r) => { pendingMap[r.patient_clerk] = r.pending; });
      return new Response(JSON.stringify({
        admin, patients, users, access,
        pending_by_patient: pendingMap,
      }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `DB query failed: ${e.message}`);
    }
  }

  // POST /api/admin/patients — create a new patient
  if (path === "/api/admin/patients" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const fullName = String(body?.full_name || "").trim();
    if (!fullName) return jsonError(400, "full_name_required");
    const email = String(body?.email || "").trim() || `${slugifyForClerkPlaceholder(fullName).replace(/^pending:/, "")}@placeholder.local`;
    const locale = body?.locale === "pt" ? "pt" : "en";
    const dob = body?.date_of_birth || null;
    const sex = body?.sex || null;
    const nativeLanguage = body?.native_language || null;
    const country = body?.country_of_residence || null;
    const clerk = slugifyForClerkPlaceholder(fullName);

    try {
      const inserted = await sql`
        INSERT INTO users (clerk_user_id, email, role, full_name, locale, created_by)
        VALUES (${clerk}, ${email}, 'patient', ${fullName}, ${locale}, ${admin.id})
        RETURNING id, clerk_user_id, full_name, email, locale, created_at
      `;
      const patient = inserted[0];
      await sql`
        INSERT INTO patient_profiles
          (user_id, date_of_birth, sex, native_language, country_of_residence)
        VALUES (${patient.id}, ${dob}, ${sex}, ${nativeLanguage}, ${country})
        ON CONFLICT (user_id) DO NOTHING
      `;
      // Self-access row so the patient can see their own record
      await sql`
        INSERT INTO patient_access (user_id, patient_id, notes, granted_by)
        VALUES (${patient.id}, ${patient.id}, 'self', ${admin.id})
        ON CONFLICT (user_id, patient_id) DO NOTHING
      `;
      return new Response(JSON.stringify({ ok: true, patient }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Insert failed: ${e.message}`);
    }
  }

  // POST /api/admin/users — create a user (role: patient | doctor) with login creds
  if (path === "/api/admin/users" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const fullName = String(body?.full_name || "").trim();
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");
    const role = body?.role;
    if (!fullName) return jsonError(400, "full_name_required");
    if (!username) return jsonError(400, "username_required");
    if (!password) return jsonError(400, "password_required");
    if (role !== "patient" && role !== "doctor") return jsonError(400, "role_must_be_patient_or_doctor");

    const email = String(body?.email || "").trim() || `${username}@placeholder.local`;
    const locale = body?.locale === "pt" ? "pt" : "en";
    const clerk = slugifyForClerkPlaceholder(fullName);

    try {
      // Pre-check username uniqueness for a clean 409 instead of a 500
      const existing = await sql`
        SELECT 1 FROM users WHERE demo_username = ${username} LIMIT 1
      `;
      if (existing.length > 0) return jsonError(409, "username_taken");

      const inserted = await sql`
        INSERT INTO users
          (clerk_user_id, email, role, full_name, locale,
           demo_username, demo_password, created_by)
        VALUES
          (${clerk}, ${email}, ${role}, ${fullName}, ${locale},
           ${username}, ${password}, ${admin.id})
        RETURNING id, clerk_user_id, full_name, email, role, locale, created_at
      `;
      const user = inserted[0];

      if (role === "patient") {
        const dob = body?.date_of_birth || null;
        const sex = body?.sex || null;
        const nativeLanguage = body?.native_language || null;
        const country = body?.country_of_residence || null;
        await sql`
          INSERT INTO patient_profiles
            (user_id, date_of_birth, sex, native_language, country_of_residence)
          VALUES (${user.id}, ${dob}, ${sex}, ${nativeLanguage}, ${country})
          ON CONFLICT (user_id) DO NOTHING
        `;
        await sql`
          INSERT INTO patient_access (user_id, patient_id, notes, granted_by)
          VALUES (${user.id}, ${user.id}, 'self', ${admin.id})
          ON CONFLICT (user_id, patient_id) DO NOTHING
        `;
      } else {
        const specialty = body?.specialty || null;
        const licenseCountry = body?.license_country || null;
        await sql`
          INSERT INTO doctor_profiles (user_id, specialty, license_country)
          VALUES (${user.id}, ${specialty}, ${licenseCountry})
          ON CONFLICT (user_id) DO NOTHING
        `;
      }

      return new Response(JSON.stringify({ ok: true, user }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Create user failed: ${e.message}`);
    }
  }

  // POST /api/admin/users/update — edit any user's info. For role='patient'
  // upserts patient_profiles in the same call. Client sends the full set of
  // editable fields; empty string / null clears the column.
  if (path === "/api/admin/users/update" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const userClerk = String(body?.user_clerk || "").trim();
    if (!userClerk) return jsonError(400, "user_clerk_required");

    const blank = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
    const num   = (v) => {
      if (v === undefined || v === null || v === "") return null;
      const n = Number(v); return Number.isFinite(n) ? n : null;
    };
    const date  = (v) => {
      const s = blank(v);
      if (!s) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;  // signal bad input
      return s;
    };
    const sexEnum = ["male", "female", "other", "unknown"];

    const fullName    = blank(body.full_name);
    const email       = blank(body.email);
    const locale      = blank(body.locale);
    const demoUser    = blank(body.demo_username);
    const demoPass    = blank(body.demo_password);
    const dob         = date(body.date_of_birth);
    if (dob === undefined) return jsonError(400, "date_of_birth_must_be_yyyy_mm_dd");
    const sex         = blank(body.sex);
    if (sex !== null && !sexEnum.includes(sex)) return jsonError(400, "sex_invalid");
    const country     = blank(body.country_of_residence);
    const lang        = blank(body.native_language);
    const heightCm    = num(body.height_cm);
    const weightKg    = num(body.weight_kg);
    const bloodType   = blank(body.blood_type);

    try {
      const rows = await sql`
        SELECT id, role FROM users
        WHERE clerk_user_id = ${userClerk} AND archived_at IS NULL
        LIMIT 1
      `;
      if (rows.length === 0) return jsonError(404, "user_not_found");
      const userId = rows[0].id;
      const role = rows[0].role;

      if (demoUser !== null) {
        const dup = await sql`
          SELECT id FROM users
          WHERE demo_username = ${demoUser} AND id <> ${userId} AND archived_at IS NULL
          LIMIT 1
        `;
        if (dup.length > 0) return jsonError(409, "demo_username_in_use");
      }

      await sql`
        UPDATE users SET
          full_name      = ${fullName},
          email          = ${email},
          locale         = ${locale},
          demo_username  = ${demoUser},
          demo_password  = ${demoPass},
          updated_at     = now()
        WHERE id = ${userId}
      `;

      if (role === "patient") {
        await sql`
          INSERT INTO patient_profiles (user_id, date_of_birth, sex, country_of_residence,
                                        native_language, height_cm, weight_kg, blood_type)
          VALUES (${userId}, ${dob}, ${sex}, ${country}, ${lang}, ${heightCm}, ${weightKg}, ${bloodType})
          ON CONFLICT (user_id) DO UPDATE SET
            date_of_birth        = EXCLUDED.date_of_birth,
            sex                  = EXCLUDED.sex,
            country_of_residence = EXCLUDED.country_of_residence,
            native_language      = EXCLUDED.native_language,
            height_cm            = EXCLUDED.height_cm,
            weight_kg            = EXCLUDED.weight_kg,
            blood_type           = EXCLUDED.blood_type,
            updated_at           = now()
        `;
      }

      return new Response(JSON.stringify({ ok: true, user_clerk: userClerk }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Update failed: ${e.message}`);
    }
  }

  // POST /api/admin/patients/delete — { patient_clerk }
  // HARD delete: removes the user row (cascades to lab_results, documents,
  // writings, imports, import_files, patient_profiles, patient_access,
  // patient_dashboards, mood entries, etc.) AND wipes every R2 object
  // attached to that patient. Irreversible by design.
  if (path === "/api/admin/patients/delete" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim();
    if (!patientClerk) return jsonError(400, "patient_clerk_required");

    try {
      const rows = await sql`
        SELECT id, role, full_name FROM users
        WHERE clerk_user_id = ${patientClerk} LIMIT 1
      `;
      if (rows.length === 0)          return jsonError(404, "patient_not_found");
      if (rows[0].role !== "patient") return jsonError(400, "target_must_be_patient");
      if (rows[0].id === admin.id)    return jsonError(400, "cannot_delete_self");
      const patientId = rows[0].id;

      // 1. Collect every R2 key and every R2 prefix attached to this patient.
      // Single-key columns from every table that stores a blob_key.
      const keyQuery = await sql`
        SELECT blob_key AS k FROM documents      WHERE patient_id = ${patientId} AND blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM lab_results        WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT blob_key       FROM writings            WHERE patient_id = ${patientId} AND blob_key IS NOT NULL
        UNION
        SELECT if_.blob_key   FROM import_files if_
          JOIN imports i ON i.id = if_.import_id
          WHERE i.patient_id = ${patientId} AND if_.blob_key IS NOT NULL
        UNION
        SELECT blob_key       FROM ecg_events         WHERE patient_id = ${patientId} AND blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM clinical_history  WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM encounters        WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM injuries          WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM life_events       WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM medications       WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM panic_events      WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM pgx_findings      WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM prescriptions     WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM risk_assessments  WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM supplements       WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT source_blob_key FROM surgeries         WHERE patient_id = ${patientId} AND source_blob_key IS NOT NULL
        UNION
        SELECT manifest_blob_key FROM imaging_studies WHERE patient_id = ${patientId} AND manifest_blob_key IS NOT NULL
        UNION
        SELECT report_blob_key   FROM imaging_studies WHERE patient_id = ${patientId} AND report_blob_key   IS NOT NULL
      `;
      const prefixQuery = await sql`
        SELECT DISTINCT blob_prefix FROM imaging_studies
        WHERE patient_id = ${patientId} AND blob_prefix IS NOT NULL
      `;

      const keys = new Set(keyQuery.map((r) => r.k).filter(Boolean));

      // 2. Expand every prefix to its concrete object list and union into the key set.
      let r2Errors = 0;
      if (env.R2_BUCKET) {
        // Imaging prefixes + the patient's entire upload-portal namespace.
        const prefixes = prefixQuery.map((r) => r.blob_prefix).concat([`uploads/${patientId}/`]);
        for (const prefix of prefixes) {
          let cursor;
          do {
            const listed = await env.R2_BUCKET.list({ prefix, cursor });
            (listed.objects || []).forEach((obj) => keys.add(obj.key));
            cursor = listed.truncated ? listed.cursor : undefined;
          } while (cursor);
        }
        // 3. Delete in batches of 1000 (R2 binding cap).
        const keyArr = Array.from(keys);
        for (let i = 0; i < keyArr.length; i += 1000) {
          try { await env.R2_BUCKET.delete(keyArr.slice(i, i + 1000)); }
          catch (e) { r2Errors++; }
        }
      }

      // 4. Drop the user row. Cascades wipe every dependent row.
      await sql`DELETE FROM users WHERE id = ${patientId}`;

      return new Response(JSON.stringify({
        ok: true,
        deleted: {
          clerk_user_id: patientClerk,
          full_name: rows[0].full_name,
          r2_objects: keys.size,
          r2_delete_errors: r2Errors,
        },
      }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      return jsonError(500, `Delete patient failed: ${e.message}`);
    }
  }

  // POST /api/admin/access — { action: 'grant' | 'revoke', user_clerk, patient_clerk, notes? }
  if (path === "/api/admin/access" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const action = body?.action;
    const userClerk = String(body?.user_clerk || "").trim();
    const patientClerk = String(body?.patient_clerk || "").trim();
    if (!userClerk || !patientClerk) return jsonError(400, "user_and_patient_required");
    if (action !== "grant" && action !== "revoke") return jsonError(400, "action_must_be_grant_or_revoke");

    try {
      const [userRow, patRow] = await Promise.all([
        sql`SELECT id, role FROM users WHERE clerk_user_id = ${userClerk} AND archived_at IS NULL LIMIT 1`,
        sql`SELECT id, role FROM users WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1`,
      ]);
      if (userRow.length === 0) return jsonError(404, "user_not_found");
      if (patRow.length === 0) return jsonError(404, "patient_not_found");
      if (patRow[0].role !== "patient") return jsonError(400, "target_must_be_patient");

      if (action === "grant") {
        const notes = String(body?.notes || "").trim() || null;
        await sql`
          INSERT INTO patient_access (user_id, patient_id, notes, granted_by)
          VALUES (${userRow[0].id}, ${patRow[0].id}, ${notes}, ${admin.id})
          ON CONFLICT (user_id, patient_id) DO UPDATE SET
            notes = COALESCE(EXCLUDED.notes, patient_access.notes),
            granted_by = EXCLUDED.granted_by,
            granted_at = now()
        `;
      } else {
        await sql`
          DELETE FROM patient_access
          WHERE user_id = ${userRow[0].id} AND patient_id = ${patRow[0].id}
        `;
      }
      return new Response(JSON.stringify({ ok: true, action }), {
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return jsonError(500, `Access change failed: ${e.message}`);
    }
  }

  // POST /api/admin/reclassify — { patient_clerk, limit? } batched re-run of
  // the ingest classifier (and lab/writing extractor) on stuck import_files
  // and documents.kind='unclassified'. Call multiple times until remaining=0.
  if (path === "/api/admin/reclassify" && request.method === "POST") {
    if (!env.ANTHROPIC_API_KEY) return jsonError(500, "anthropic_api_key_not_configured");
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim();
    if (!patientClerk) return jsonError(400, "patient_clerk_required");
    const limit = Math.min(Math.max(parseInt(body?.limit, 10) || 1, 1), 5);

    try {
      const patientRows = await sql`
        SELECT id, role FROM users
        WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1
      `;
      if (patientRows.length === 0 || patientRows[0].role !== "patient") {
        return jsonError(404, "patient_not_found");
      }
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 4 });
      const result = await reclassifyForPatient(sql, anthropic, env, patientRows[0].id, limit);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `Reclassify failed: ${e.message}`);
    }
  }

  // POST /api/admin/backfill-requesting-doctor — { patient_clerk?, limit? }
  // Re-reads each PDF that has lab rows with requesting_doctor IS NULL,
  // asks Claude (Haiku) for the doctor's name, UPDATEs the rows. Bounded
  // by `limit` PDFs per call (default 25, max 50). Call repeatedly until
  // remaining_pdfs = 0.
  if (path === "/api/admin/backfill-requesting-doctor" && request.method === "POST") {
    if (!env.ANTHROPIC_API_KEY) return jsonError(500, "anthropic_api_key_not_configured");
    if (!env.R2_BUCKET)         return jsonError(500, "r2_bucket_not_bound");
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim(); // optional
    const limit = Math.min(Math.max(parseInt(body?.limit, 10) || 25, 1), 50);

    try {
      let patientId = null;
      if (patientClerk) {
        const rows = await sql`
          SELECT id, role FROM users
          WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1
        `;
        if (rows.length === 0 || rows[0].role !== "patient") {
          return jsonError(404, "patient_not_found");
        }
        patientId = rows[0].id;
      }
      const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 4 });
      const result = await backfillRequestingDoctor(sql, anthropic, env, { patientId, limit });
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      const msg = e?.message || String(e);
      const rateLimited = /\b429\b|rate_limit/i.test(msg);
      return jsonError(rateLimited ? 429 : 500, `Backfill failed: ${msg}`);
    }
  }

  // POST /api/admin/seed-clinical — { patient_clerk, table, rows, wipe? }
  // Bulk-insert one clinical table for a patient. Idempotent when wipe=true
  // (default): scoped DELETE then INSERT. One table per call.
  if (path === "/api/admin/seed-clinical" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim();
    const table = String(body?.table || "").trim();
    const rows = Array.isArray(body?.rows) ? body.rows : null;
    const wipe = body?.wipe !== false;
    if (!patientClerk) return jsonError(400, "patient_clerk_required");
    if (!rows) return jsonError(400, "rows_array_required");

    try {
      const patientRows = await sql`
        SELECT id, role FROM users WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1`;
      if (patientRows.length === 0 || patientRows[0].role !== "patient") return jsonError(404, "patient_not_found");
      const pid = patientRows[0].id;

      const queries = buildSeedQueries(sql, table, pid, rows);
      if (queries === null) return jsonError(400, `unsupported_table: ${table}`);

      if (wipe) { const w = wipeQuery(sql, table, pid); if (w) await w; }
      const inserted = await runChunked(sql, queries);
      return new Response(JSON.stringify({ ok: true, table, inserted }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `Seed failed for ${table}: ${e.message}`);
    }
  }

  // POST /api/admin/ecg-ingest — ingest one clinical ECG study.
  // Body: { patient_clerk, study:{...fields}, files:{ original|report|svg:{ b64, contentType, name } } }
  // Writes blobs to R2 via the env.R2_BUCKET binding (no S3 token) under
  // patients/{id}/ecg/{study_date}/, then upserts an ecg_studies row (dedupe on
  // patient+date+source_sha). Re-running the same study is a no-op update.
  if (path === "/api/admin/ecg-ingest" && request.method === "POST") {
    if (!env.R2_BUCKET) return jsonError(500, "r2_bucket_not_bound");
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const patientClerk = String(body?.patient_clerk || "").trim();
    const s = body?.study || {};
    const files = body?.files || {};
    if (!patientClerk) return jsonError(400, "patient_clerk_required");
    if (!s.study_date) return jsonError(400, "study_date_required");
    if (!s.source_format) return jsonError(400, "source_format_required");
    try {
      await ensureEcgStudiesTable(sql);
      const p = await sql`SELECT id, role FROM users WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1`;
      if (!p.length || p[0].role !== "patient") return jsonError(404, "patient_not_found");
      const pid = p[0].id;

      const base = `patients/${pid}/ecg/${s.study_date}`;
      const keys = { original: null, report: null, svg: null };
      for (const kind of ["original", "report", "svg"]) {
        const meta = files[kind];
        if (!meta || !meta.b64) continue;
        const ext = kind === "svg" ? "svg" : (meta.name && meta.name.toLowerCase().endsWith(".pdf") ? "pdf" : "bin");
        const key = `${base}/${kind}.${ext}`;
        const bin = Uint8Array.from(atob(meta.b64), (c) => c.charCodeAt(0));
        await env.R2_BUCKET.put(key, bin, { httpMetadata: { contentType: meta.contentType || "application/octet-stream" } });
        keys[kind] = key;
      }

      const r = await sql`
        INSERT INTO ecg_studies
          (patient_id, study_date, recorded_at, modality, lead_layout, source_format, fidelity,
           ordering_doctor, validating_doctor, clinic, heart_rate, pr_ms, qrs_ms, qt_ms, qtc_ms,
           axis_p, axis_qrs, axis_t, interpretation, report_text, source_sha,
           original_key, report_key, svg_key)
        VALUES
          (${pid}, ${s.study_date}::date, ${s.recorded_at || null}, ${s.modality || "12-lead"},
           ${s.lead_layout || null}, ${s.source_format}, ${s.fidelity || null},
           ${s.ordering_doctor || null}, ${s.validating_doctor || null}, ${s.clinic || null},
           ${s.heart_rate ?? null}, ${s.pr_ms ?? null}, ${s.qrs_ms ?? null}, ${s.qt_ms ?? null}, ${s.qtc_ms ?? null},
           ${s.axis_p ?? null}, ${s.axis_qrs ?? null}, ${s.axis_t ?? null},
           ${s.interpretation || null}, ${s.report_text || null}, ${s.source_sha || null},
           ${keys.original}, ${keys.report}, ${keys.svg})
        ON CONFLICT ON CONSTRAINT ecg_studies_dedup DO UPDATE SET
          recorded_at = EXCLUDED.recorded_at, modality = EXCLUDED.modality, lead_layout = EXCLUDED.lead_layout,
          source_format = EXCLUDED.source_format, fidelity = EXCLUDED.fidelity,
          ordering_doctor = EXCLUDED.ordering_doctor, validating_doctor = EXCLUDED.validating_doctor,
          clinic = EXCLUDED.clinic, heart_rate = EXCLUDED.heart_rate, pr_ms = EXCLUDED.pr_ms,
          qrs_ms = EXCLUDED.qrs_ms, qt_ms = EXCLUDED.qt_ms, qtc_ms = EXCLUDED.qtc_ms,
          axis_p = EXCLUDED.axis_p, axis_qrs = EXCLUDED.axis_qrs, axis_t = EXCLUDED.axis_t,
          interpretation = EXCLUDED.interpretation, report_text = EXCLUDED.report_text,
          original_key = COALESCE(EXCLUDED.original_key, ecg_studies.original_key),
          report_key = COALESCE(EXCLUDED.report_key, ecg_studies.report_key),
          svg_key = COALESCE(EXCLUDED.svg_key, ecg_studies.svg_key)
        RETURNING id`;
      return new Response(JSON.stringify({ ok: true, id: r[0].id, keys }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `ECG ingest failed: ${e.message}`);
    }
  }

  // GET /api/admin/uploads — the review queue: every upload joined to patient identity.
  if (path === "/api/admin/uploads" && request.method === "GET") {
    try {
      await ensureUploadsTables(sql);
      const rows = await sql`
        SELECT up.id, up.doc_ref, up.original_name, up.kind, up.file_count, up.total_bytes,
               up.content_type, up.status, up.error_note, up.created_at, up.reviewed_at,
               up.patient_id, p.clerk_user_id AS patient_clerk, p.full_name AS patient_name,
               r.full_name AS reviewer_name, uploader.full_name AS uploader_name
        FROM uploads up
        JOIN users p ON p.id = up.patient_id
        LEFT JOIN users r ON r.id = up.reviewed_by
        LEFT JOIN users uploader ON uploader.id = up.uploader_user_id
        ORDER BY (up.status = 'pending_review') DESC, up.created_at DESC`;
      return new Response(JSON.stringify({ uploads: rows }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `Uploads query failed: ${e.message}`);
    }
  }

  // POST /api/admin/uploads/status — { upload_id, status, error_note? }
  if (path === "/api/admin/uploads/status" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const uploadId = String(body?.upload_id || "").trim();
    const status = String(body?.status || "").trim();
    const errorNote = body?.error_note != null ? String(body.error_note).trim().slice(0, 1000) : null;
    if (!uploadId) return jsonError(400, "upload_id_required");
    if (!["pending_review", "ingested", "data_error"].includes(status)) return jsonError(400, "status_invalid");
    try {
      await ensureUploadsTables(sql);
      const noteToStore = status === "data_error" ? errorNote : null;
      const upd = await sql`
        UPDATE uploads
        SET status = ${status}::upload_status,
            error_note = ${noteToStore},
            reviewed_by = ${admin.id},
            reviewed_at = now()
        WHERE id = ${uploadId}
        RETURNING id, doc_ref, patient_id, status, error_note, reviewed_at`;
      if (upd.length === 0) return jsonError(404, "upload_not_found");
      const row = upd[0];
      await sql`
        INSERT INTO audit_log (actor_user_id, action, target_table, target_id, patient_context, metadata)
        VALUES (${admin.id}, 'upload_status_changed', 'uploads', ${row.id}, ${row.patient_id},
                ${JSON.stringify({ doc_ref: row.doc_ref, status, error_note: noteToStore })}::jsonb)`;
      return new Response(JSON.stringify({ ok: true, upload: row }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    } catch (e) {
      return jsonError(500, `Status update failed: ${e.message}`);
    }
  }

  // POST /api/admin/uploads/delete — { upload_id }
  // Hard-deletes one upload everywhere: its R2 objects (via the binding), the
  // uploads row (cascades upload_objects), and so it also disappears from the
  // patient's upload table (GET /api/uploads no longer returns it).
  if (path === "/api/admin/uploads/delete" && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
    const uploadId = String(body?.upload_id || "").trim();
    if (!uploadId) return jsonError(400, "upload_id_required");
    try {
      await ensureUploadsTables(sql);
      const upRows = await sql`SELECT id, doc_ref, patient_id FROM uploads WHERE id = ${uploadId} LIMIT 1`;
      if (upRows.length === 0) return jsonError(404, "upload_not_found");
      const up = upRows[0];
      const objs = await sql`SELECT r2_key FROM upload_objects WHERE upload_id = ${uploadId}`;
      let r2Errors = 0;
      if (env.R2_BUCKET && objs.length) {
        const keys = objs.map((o) => o.r2_key).filter(Boolean);
        for (let i = 0; i < keys.length; i += 1000) {
          try { await env.R2_BUCKET.delete(keys.slice(i, i + 1000)); } catch { r2Errors++; }
        }
      }
      await sql`DELETE FROM uploads WHERE id = ${uploadId}`; // cascades upload_objects
      await sql`
        INSERT INTO audit_log (actor_user_id, action, target_table, target_id, patient_context, metadata)
        VALUES (${admin.id}, 'upload_deleted', 'uploads', ${uploadId}, ${up.patient_id},
                ${JSON.stringify({ doc_ref: up.doc_ref, objects: objs.length, r2_errors: r2Errors })}::jsonb)`;
      return new Response(JSON.stringify({
        ok: true, deleted: { id: uploadId, doc_ref: up.doc_ref, r2_objects: objs.length, r2_delete_errors: r2Errors },
      }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch (e) {
      return jsonError(500, `Delete failed: ${e.message}`);
    }
  }

  // GET /api/admin/uploads/:id/download.zip — stream the whole upload as a single
  // ZIP, built on the fly via the R2 binding (client-zip, STORE/streamed so memory
  // stays low). One click downloads a folder at once. viewer= in the URL lets a
  // plain window.open authenticate (getAdminViewer accepts ?viewer=).
  const zipMatch = path.match(/^\/api\/admin\/uploads\/([0-9a-f-]{36})\/download\.zip$/i);
  if (zipMatch && request.method === "GET") {
    if (!env.R2_BUCKET) return jsonError(500, "r2_bucket_not_bound");
    try {
      await ensureUploadsTables(sql);
      const uploadId = zipMatch[1];
      const upRows = await sql`SELECT id, doc_ref, original_name FROM uploads WHERE id = ${uploadId} LIMIT 1`;
      if (upRows.length === 0) return jsonError(404, "upload_not_found");
      const up = upRows[0];
      const objs = await sql`SELECT r2_key, relative_path, bytes FROM upload_objects WHERE upload_id = ${uploadId} ORDER BY relative_path`;
      if (objs.length === 0) return jsonError(404, "no_objects");
      const bucket = env.R2_BUCKET;
      const base = String(up.original_name || up.doc_ref || "folder").replace(/[\/\\]+/g, "_");
      async function* entries() {
        for (const o of objs) {
          const obj = await bucket.get(o.r2_key);
          if (!obj) continue;
          yield {
            name: o.relative_path || (o.r2_key.split("/").pop() || "file"),
            input: obj.body,
            size: typeof obj.size === "number" ? obj.size : (o.bytes || undefined),
            lastModified: obj.uploaded || undefined,
          };
        }
      }
      const zipName = `${base}.zip`.replace(/["\\\r\n]/g, "_");
      return new Response(makeZip(entries()), {
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${zipName}"`,
          "Cache-Control": "no-store",
        },
      });
    } catch (e) {
      return jsonError(500, `Zip failed: ${e.message}`);
    }
  }

  // GET /api/admin/uploads/:id/download — presigned GET URL(s).
  // Single file -> one URL. Folder -> per-file manifest + the R2 prefix (the
  // admin bulk-downloads the prefix on the terminal; in-Worker zipping of multi-GB
  // folders is infeasible). The UI also builds a copy-paste rclone/wrangler command.
  const dlMatch = path.match(/^\/api\/admin\/uploads\/([0-9a-f-]{36})\/download$/i);
  if (dlMatch && request.method === "GET") {
    const client = r2S3Client(env);                       // s3 path if the token is set
    if (!client && !env.R2_BUCKET) return jsonError(500, "r2_not_configured");
    // proxy download URL streams the object back through the Worker (binding).
    // viewer= is in the URL so a plain window.open / <a> click still authenticates
    // (getAdminViewer accepts ?viewer=); no header needed for the GET.
    const proxyUrl = (key) =>
      `/api/admin/uploads/object?key=${encodeURIComponent(key)}&viewer=${encodeURIComponent(admin.clerk_user_id)}`;
    const urlFor = async (key, downloadName) =>
      client ? await presignGet(client, env, key, downloadName) : proxyUrl(key);
    try {
      await ensureUploadsTables(sql);
      const uploadId = dlMatch[1];
      const upRows = await sql`SELECT id, doc_ref, original_name, kind, r2_prefix FROM uploads WHERE id = ${uploadId} LIMIT 1`;
      if (upRows.length === 0) return jsonError(404, "upload_not_found");
      const up = upRows[0];
      const objs = await sql`SELECT r2_key, relative_path, bytes, content_type
                             FROM upload_objects WHERE upload_id = ${uploadId} ORDER BY relative_path`;
      if (up.kind === "file" && objs.length <= 1) {
        const obj = objs[0] || { r2_key: up.r2_prefix, relative_path: up.original_name };
        const url = await urlFor(obj.r2_key, up.original_name);
        return new Response(JSON.stringify({ kind: "file", doc_ref: up.doc_ref, url }), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      }
      const files = [];
      for (const o of objs) {
        files.push({
          relative_path: o.relative_path,
          bytes: o.bytes,
          url: await urlFor(o.r2_key, o.relative_path.split("/").pop()),
        });
      }
      return new Response(JSON.stringify({
        kind: "folder", doc_ref: up.doc_ref, r2_prefix: up.r2_prefix,
        bucket: env.R2_BUCKET_NAME || "jc-health-uploads", files,
      }), { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
    } catch (e) {
      return jsonError(500, `Download failed: ${e.message}`);
    }
  }

  // GET /api/admin/uploads/object?key=<r2-key>&viewer=<adminClerk> — stream one
  // R2 object back to the admin via the binding (proxy-mode download; no S3 token).
  if (path === "/api/admin/uploads/object" && request.method === "GET") {
    if (!env.R2_BUCKET) return jsonError(500, "r2_bucket_not_bound");
    const key = String(url.searchParams.get("key") || "");
    if (!key.startsWith("uploads/")) return jsonError(400, "bad_key");
    const obj = await env.R2_BUCKET.get(key);
    if (!obj) return jsonError(404, "object_not_found");
    const filename = (key.split("/").pop() || "download").replace(/["\\\r\n]/g, "_");
    const headers = new Headers();
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
    headers.set("Cache-Control", "no-store");
    if (obj.httpMetadata && obj.httpMetadata.contentType) headers.set("Content-Type", obj.httpMetadata.contentType);
    else headers.set("Content-Type", "application/octet-stream");
    return new Response(obj.body, { headers });
  }

  return jsonError(404, "unknown_admin_route");
}

/* ───── PDF export ────────────────────────────────────────────────────────
 *
 * Architecture: data-driven manifest (GET /api/export-manifest) + a fully
 * SERVER-SIDE report build (POST /api/export-pdf). The Worker uses Cloudflare
 * Browser Rendering (lib/export-render.js) to open the patient's real pages in
 * headless Chrome, strip all app chrome, lay them out on A4 with normal margins,
 * and emit a true vector PDF (crisp text) merged behind the dark cover — then
 * streams it as a download. No client-side capture, no PHI in any URL.
 *
 * Auth posture: Clerk is dormant in the current POC (authenticate() returns
 * auth_not_configured) and the rest of _worker.js serves patient data trusting
 * ?clerk=. gateExportViewer() mirrors that: open while auth is unconfigured, and
 * the moment CLERK_SECRET_KEY is set it enforces viewer<->patient access with NO
 * code change.
 */

async function gateExportViewer(request, env, patientClerk) {
  // Best-effort gate that MATCHES the rest of this app. Today every data endpoint
  // (e.g. handlePatientSummary) is open and trusts the patient param — Clerk is
  // not fully wired (sessions don't validate via authenticateRequest), so calling
  // it here would 401 logged-in users. So: if Clerk genuinely authenticates a
  // patient, enforce viewer<->patient; otherwise fall OPEN like the rest of the
  // app. When real per-user auth lands app-wide, this tightens automatically.
  let auth;
  try {
    auth = await authenticate(request, env);
  } catch (e) {
    return { ok: true, mode: "open" };
  }
  if (!auth.ok) return { ok: true, mode: "open" };
  if (auth.role === "patient" && auth.clerkUserId !== patientClerk) {
    return jsonError(403, "forbidden");
  }
  return { ok: true, mode: "auth", auth };
}

async function resolveExportPatient(sql, clerk) {
  const rows = await sql`
    SELECT u.id, u.clerk_user_id, u.full_name, u.locale,
           pp.date_of_birth, pp.sex
    FROM users u
    LEFT JOIN patient_profiles pp ON pp.user_id = u.id
    WHERE u.clerk_user_id = ${clerk} AND u.role = 'patient' AND u.archived_at IS NULL
    LIMIT 1`;
  return rows[0] || null;
}

async function exportCounts(sql, pid) {
  const r = (await sql`
    SELECT
      (SELECT count(*)::int FROM lab_results WHERE patient_id=${pid}) AS lab_results,
      (SELECT count(*)::int FROM lab_results WHERE patient_id=${pid}
         AND (lower(coalesce(panel,'')) LIKE '%urin%' OR lower(coalesce(marker,'')) LIKE '%urin%')) AS urinalysis,
      (SELECT count(*)::int FROM imaging_studies WHERE patient_id=${pid}) AS imaging_studies,
      (SELECT count(*)::int FROM documents WHERE patient_id=${pid}
         AND (lower(coalesce(kind,'')) LIKE '%microbiota%' OR lower(coalesce(title,'')) LIKE '%microbiota%'
              OR lower(coalesce(title,'')) LIKE '%gut%')) AS microbiota,
      (SELECT count(DISTINCT day)::int FROM vitals_daily WHERE patient_id=${pid}) AS vitals_days,
      (SELECT count(*)::int FROM ecg_events WHERE patient_id=${pid}) AS ecg_events,
      (SELECT count(*)::int FROM glucose_points WHERE patient_id=${pid}) AS glucose_points,
      (SELECT count(*)::int FROM documents WHERE patient_id=${pid}
         AND (lower(coalesce(kind,'')) LIKE '%inbody%' OR lower(coalesce(title,'')) LIKE '%inbody%'
              OR lower(coalesce(title,'')) LIKE '%body composition%')) AS body_composition,
      (SELECT count(*)::int FROM pgx_findings WHERE patient_id=${pid}) AS pgx_findings,
      (SELECT count(*)::int FROM mood_entries WHERE patient_id=${pid}) AS mood_entries,
      (SELECT count(*)::int FROM panic_events WHERE patient_id=${pid}) AS panic_events,
      (SELECT count(*)::int FROM life_events WHERE patient_id=${pid}) AS life_events,
      (SELECT count(*)::int FROM clinical_history WHERE patient_id=${pid}) AS clinical_history,
      (SELECT count(*)::int FROM psych_items WHERE patient_id=${pid}) AS psych_items,
      (SELECT count(*)::int FROM writings WHERE patient_id=${pid}) AS writings,
      (SELECT count(*)::int FROM documents WHERE patient_id=${pid}) AS documents,
      (SELECT count(*)::int FROM wheel_of_life_assessments WHERE patient_id=${pid}) AS wheel_of_life,
      (SELECT count(*)::int FROM risk_assessments WHERE patient_id=${pid}) AS risk_assessments
  `)[0] || {};
  return {
    labResults: r.lab_results, urinalysis: r.urinalysis, imagingStudies: r.imaging_studies,
    microbiota: r.microbiota, vitalsDays: r.vitals_days, ecgEvents: r.ecg_events,
    glucosePoints: r.glucose_points, bodyComposition: r.body_composition, pgxFindings: r.pgx_findings,
    moodEntries: r.mood_entries, panicEvents: r.panic_events, lifeEvents: r.life_events,
    clinicalHistory: r.clinical_history, psychItems: r.psych_items, writings: r.writings,
    documents: r.documents, wheelOfLife: r.wheel_of_life, riskAssessments: r.risk_assessments,
    spiritual: r.wheel_of_life,
  };
}

async function handleExportManifest(request, env) {
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  const url = new URL(request.url);
  const patient = url.searchParams.get("patient") || url.searchParams.get("clerk");
  if (!patient) return jsonError(400, "patient_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const p = await resolveExportPatient(sql, patient);
    if (!p) return jsonError(404, "patient_not_found");
    const gate = await gateExportViewer(request, env, patient);
    if (gate instanceof Response) return gate;
    const counts = await exportCounts(sql, p.id);
    return new Response(JSON.stringify(buildManifest(counts)), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (e) {
    return jsonError(500, `manifest_failed: ${e.message}`);
  }
}

async function handleExportPdf(request, env) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");
  if (!env.BROWSER) return jsonError(501, "browser_rendering_not_enabled");
  let body;
  try { body = await request.json(); } catch { return jsonError(400, "bad_json"); }
  const patient = body.patientId || body.patient || body.clerk;
  const language = body.language === "pt" ? "pt" : "en";
  if (!patient) return jsonError(400, "patient_required");
  try {
    const sql = neon(env.DATABASE_URL);
    const p = await resolveExportPatient(sql, patient);
    if (!p) return jsonError(404, "patient_not_found");
    const gate = await gateExportViewer(request, env, patient);
    if (gate instanceof Response) return gate;
    const counts = await exportCounts(sql, p.id);
    const { ok, sections } = validateSections(body.sections, counts);
    if (!ok) return jsonError(400, "no_valid_sections");

    const pdf = await buildReportPdf(env, {
      patientClerk: patient,
      patientName: p.full_name,
      sections,
      language,
      origin: new URL(request.url).origin,
    });

    // RFC 5987 filename* carries accented patient names; filename= is the ASCII
    // fallback for older clients.
    const filename = reportFilename(p.full_name, new Date());
    const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
    return new Response(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return jsonError(500, `export_failed: ${e.message}`);
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Ask Lumen v2 — per-patient AI chat (claude-opus-4-8; was claude-fable-5)

   Dedicated key ANTHROPIC_API_KEY_CHAT (NEVER the insights key). Identity is
   resolved at this boundary: a patient can only chat over their OWN record;
   admins/doctors may target another patient only with patient_access. Clerk
   isn't wired yet (CLERK_SECRET_KEY unset) — until it is, the viewer asserts
   its id via X-Viewer-Clerk like every other endpoint here; the moment Clerk
   is configured this resolver switches to the verified session automatically.
   ════════════════════════════════════════════════════════════════════════ */

const CHAT_SYSTEM_V2 = `You are "Ask Lumen", a health assistant inside the Lumen Health patient portal. You speak with the patient about THEIR OWN health record, which is provided to you below inside <patient_record>.

GROUNDING — non-negotiable:
- Answer using ONLY the information in <patient_record>. It is your single source of truth.
- You may apply general medical knowledge to INTERPRET the patient's own data (explain what a marker means, why a value matters), but NEVER invent data — no labs, dates, medications, diagnoses, or events that are not in the record.
- If the record does not contain what is asked, say so plainly. Do not guess.

ROLE — you bridge the doctor-patient conversation, you do not replace it:
- You are NOT a doctor. Do not diagnose and do not prescribe. Frame things as preparation for the patient's own clinician.
- Strong outputs look like: "3 things worth raising with your cardiologist", "which of your current medications list weight gain as a known side effect — confirm with your prescriber", "your TSH trend over the last 3 years".
- Close any clinically actionable answer with a short pointer to discuss it with the treating physician.

LANGUAGE:
- Reply in the SAME language the patient wrote in — English or Brazilian Portuguese. The record may contain both; both are valid sources.

FORMAT:
- Be concise and direct. Light markdown is fine (short bold labels, simple bullet/numbered lists). Cite the section in parentheses when you quote a specific value, e.g. "(Labs)", "(Imaging)".

PDF EXPORT:
- When the patient asks for a PDF, summary document, report, or something to take/print, call the generate_pdf tool with a clear title, the language of the conversation, and well-structured sections (heading + body_markdown). After it returns, present the download link conversationally in one short sentence. Only use it when a document is genuinely requested.`;

const GENERATE_PDF_TOOL = {
  name: "generate_pdf",
  description: "Render a branded Lumen Health PDF document for the patient to download or print. Use only when the patient asks for a PDF, report, summary document, or printable handout. Build the sections from the patient's own record.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Document title, in the conversation language." },
      language: { type: "string", enum: ["en", "pt"], description: "Language of the document." },
      sections: {
        type: "array",
        description: "Ordered sections of the document.",
        items: {
          type: "object",
          properties: {
            heading: { type: "string", description: "Section heading." },
            body_markdown: { type: "string", description: "Section body in light markdown (paragraphs, bold, bullet/numbered lists)." },
          },
          required: ["heading", "body_markdown"],
        },
      },
    },
    required: ["title", "sections"],
  },
};

const CHAT_BESPOKE = new Set([PATIENT_ZERO, PAULO_SILOTTO, SILVANA_CRESTE]);
const CHAT_HISTORY_CAP = 24; // messages kept, oldest dropped first

function validateChatMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return "messages array required.";
  if (messages.length > 60) return "Conversation too long.";
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") {
      return "Each message needs role (user|assistant) and string content.";
    }
    if (m.content.length > 6000) return "Message too long.";
  }
  return null;
}

function trimChatHistory(messages) {
  let out = messages.length > CHAT_HISTORY_CAP ? messages.slice(-CHAT_HISTORY_CAP) : messages.slice();
  while (out.length && out[0].role !== "user") out = out.slice(1); // must start on a user turn
  return out;
}

// Resolve which patient this chat is over, and authorize the viewer. Handles
// bespoke patients (Paulo/Silvana) that have no users row yet.
async function resolveChatPatient(sql, env, request, requestedClerk) {
  // The platform's live auth model is the X-Viewer-Clerk header + DB lookup
  // (resolveInsightAccess), exactly like every other /api/* endpoint here — the
  // demo login does not mint real Clerk session cookies, so authenticate() would
  // 401 everyone even though CLERK_SECRET_KEY is set. When real Clerk sessions
  // are issued, this single function is where you swap the header for
  // authenticate(request, env) and lock identity to the verified session.
  const viewerClerk = request.headers.get("X-Viewer-Clerk") || "";
  if (!viewerClerk) return { error: jsonError(401, "viewer_required") };

  const patientClerk = String(requestedClerk || viewerClerk).trim();
  const [patientRows, viewerRows] = await Promise.all([
    sql`SELECT id, full_name FROM users WHERE clerk_user_id = ${patientClerk} AND archived_at IS NULL LIMIT 1`,
    sql`SELECT id, role FROM users WHERE clerk_user_id = ${viewerClerk} AND archived_at IS NULL LIMIT 1`,
  ]);

  if (patientRows.length > 0) {
    const patientId = patientRows[0].id;
    const access = await resolveInsightAccess(sql, viewerClerk, patientId);
    if (!access.ok) return { error: jsonError(access.status, access.reason) };
    return { patientId, patientClerk, fullName: patientRows[0].full_name, actorId: access.viewerId };
  }

  // Patient not in DB — only the documented bespoke patients are valid here.
  if (!CHAT_BESPOKE.has(patientClerk)) return { error: jsonError(404, "patient_not_found") };
  const isSelf = viewerClerk === patientClerk;
  const isAdmin = viewerRows[0]?.role === "admin";
  if (!isSelf && !isAdmin) return { error: jsonError(403, "forbidden") };
  return { patientId: null, patientClerk, fullName: null, actorId: viewerRows[0]?.id || null };
}

async function handleChatV2Message(request, env) {
  if (request.method !== "POST") return jsonError(405, "method_not_allowed");
  // Fail loud and clearly — the insights engine (ANTHROPIC_API_KEY) is unaffected.
  if (!env.ANTHROPIC_API_KEY_CHAT) return jsonError(503, "chat_not_configured");
  if (!env.DATABASE_URL) return jsonError(500, "DATABASE_URL not configured.");

  let body;
  try { body = await request.json(); } catch { return jsonError(400, "invalid_json"); }
  const validationError = validateChatMessages(body?.messages);
  if (validationError) return jsonError(400, validationError);
  const messages = trimChatHistory(body.messages);
  if (messages.length === 0) return jsonError(400, "messages array required.");

  const sql = neon(env.DATABASE_URL);
  const resolved = await resolveChatPatient(sql, env, request, body?.patient_clerk);
  if (resolved.error) return resolved.error;
  const { patientId, patientClerk, fullName, actorId } = resolved;

  let context;
  try {
    context = await buildPatientContext({ id: patientId, clerkUserId: patientClerk, fullName }, env, request);
  } catch (e) {
    return jsonError(500, `could_not_build_context: ${e.message}`);
  }
  const recordText = deidentifyContext(context.text, env, { names: fullName ? [fullName] : [] });
  const origin = new URL(request.url).origin;
  const storageId = patientId || patientClerk.replace(/[^a-z0-9-]/gi, "_");

  // Best-effort audit (groundwork for the compliance flip): only when we have a
  // real users actor. Bespoke demo patients without rows aren't logged yet.
  if (actorId) {
    try {
      await sql`INSERT INTO audit_log (actor_user_id, action, target_table, patient_context, metadata)
        VALUES (${actorId}, 'chat_message', 'chat', ${patientId},
          ${JSON.stringify({ route: "/api/chat/v2/message", render_class: context.renderClass, turns: messages.length })}::jsonb)`;
    } catch { /* never let audit break the chat */ }
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY_CHAT, maxRetries: 3 });
  const system = [
    { type: "text", text: CHAT_SYSTEM_V2 },
    { type: "text", text: `<patient_record>\n${recordText}\n</patient_record>`, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];

  const encoder = new TextEncoder();
  const readable = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const convo = messages.map((m) => ({ role: m.role, content: m.content }));
      try {
        for (let turn = 0; turn < 4; turn++) {
          const stream = client.messages.stream({
            model: "claude-opus-4-8", // switched from claude-fable-5 for cost (~half the per-token price); same request surface
            max_tokens: 8192,
            output_config: { effort: "medium" }, // interactive chat — keep turns snappy
            system,
            tools: [GENERATE_PDF_TOOL],
            messages: convo,
          });
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              send({ text: event.delta.text });
            }
          }
          const final = await stream.finalMessage();

          if (final.stop_reason === "refusal") {
            send({ error: "refusal", message: "I couldn't process that one — please rephrase or ask about a specific part of your record." });
            break;
          }

          if (final.stop_reason === "tool_use") {
            convo.push({ role: "assistant", content: final.content });
            const toolResults = [];
            for (const block of final.content) {
              if (block.type !== "tool_use" || block.name !== "generate_pdf") continue;
              send({ status: "generating_pdf" });
              try {
                const exp = await createChatPdfExport(env, { patientId: storageId, doc: block.input, origin });
                send({ pdf_ready: { url: exp.url, filename: exp.filename, size: exp.size, expires_at: new Date(exp.exp).toISOString() } });
                toolResults.push({ type: "tool_result", tool_use_id: block.id,
                  content: JSON.stringify({ ok: true, download_url: exp.url, filename: exp.filename, expires_in_days: 7 }) });
              } catch (e) {
                send({ pdf_error: e.message });
                toolResults.push({ type: "tool_result", tool_use_id: block.id, is_error: true,
                  content: `PDF generation failed: ${e.message}` });
              }
            }
            convo.push({ role: "user", content: toolResults });
            continue; // re-stream so the model presents the link
          }

          // end_turn (or anything terminal)
          send({ done: true, stop_reason: final.stop_reason,
            usage: { input: final.usage.input_tokens, output: final.usage.output_tokens,
              cache_read: final.usage.cache_read_input_tokens ?? 0 } });
          break;
        }
      } catch (e) {
        send({ error: "server_error", message: e?.message ?? String(e) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}

async function handleChatV2Export(request, env, token) {
  if (!env.CHAT_EXPORT_SIGNING_KEY) return jsonError(503, "export_not_configured");
  if (!env.R2_BUCKET) return jsonError(503, "storage_unavailable");
  try {
    return await serveChatExport(env, token);
  } catch (e) {
    return jsonError(500, e?.message ?? "export_failed");
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/api/chat") {
      return handleChat(request, env);
    }
    if (url.pathname === "/api/chat/v2/message") {
      return handleChatV2Message(request, env);
    }
    if (url.pathname.startsWith("/api/chat/v2/export/")) {
      return handleChatV2Export(request, env, decodeURIComponent(url.pathname.slice("/api/chat/v2/export/".length)));
    }
    if (url.pathname === "/api/me") {
      return handleMe(request, env);
    }
    if (url.pathname === "/api/login") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/patient-summary") {
      return handlePatientSummary(request, env);
    }
    if (url.pathname === "/api/patient-exams") {
      return handlePatientExams(request, env);
    }
    if (url.pathname === "/api/patient-ecg-object") {
      return handleEcgObject(request, env);
    }
    if (url.pathname === "/api/vitals-range") {
      return handleVitalsRange(request, env);
    }
    if (url.pathname === "/api/patient-dashboard") {
      return handlePatientDashboard(request, env);
    }
    if (url.pathname === "/api/patient-dashboard-build/status") {
      return handleInsightJobStatus(request, env);
    }
    if (url.pathname === "/api/patient-dashboard-build") {
      return handlePatientDashboardBuild(request, env, ctx);
    }
    if (url.pathname === "/api/patient-wipe-data") {
      return handlePatientWipeData(request, env);
    }
    if (url.pathname === "/api/uploads/presign") {
      return handleUploadsPresign(request, env);
    }
    if (url.pathname === "/api/uploads/put") {
      return handleUploadsPut(request, env);
    }
    if (url.pathname === "/api/uploads/complete") {
      return handleUploadsComplete(request, env);
    }
    if (url.pathname === "/api/uploads") {
      return handleUploadsList(request, env);
    }
    if (url.pathname === "/api/patients") {
      return handlePatients(request, env);
    }
    if (url.pathname.startsWith("/api/admin/")) {
      return handleAdmin(request, env);
    }
    if (url.pathname === "/api/ingest") {
      return handleIngest(request, env);
    }
    if (url.pathname === "/api/export-manifest") {
      return handleExportManifest(request, env);
    }
    if (url.pathname === "/api/export-pdf") {
      return handleExportPdf(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
