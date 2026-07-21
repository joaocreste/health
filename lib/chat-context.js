/**
 * Ask Lumen v2 — patient context builder.
 *
 * Single entry point `buildPatientContext(ref, env, request)` that dispatches on
 * the patient's render class and returns a compact, sectioned plain-text record
 * in the same shape/voice as web/assets/patient-record.txt, so the chat system
 * prompt is uniform regardless of where the data lives:
 *
 *   - Patient Zero (Joao)        -> the prebuilt patient-record.txt asset
 *   - Bespoke (Paulo, Silvana)   -> server-side modules under patient-context-data/
 *   - Default (everyone else)    -> Neon, via assembleRecord() reused from ai-insights
 *
 * `ref` is { id, clerkUserId, fullName } resolved at the Worker boundary.
 */
import { neon } from "@neondatabase/serverless";
import { assembleRecord } from "./ai-insights.js";
import SILVANA from "./patient-context-data/silvana.js";
import PAULO from "./patient-context-data/paulo.js";

// Clerk IDs mirror the constants in web/assets/patient-context.js.
export const PATIENT_ZERO = "pending:joao";
export const PAULO_SILOTTO = "pending:paulo-silotto-df3441";
export const SILVANA_CRESTE = "pending:silvana-creste-18ba19";

const stripTags = (s) => String(s ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const sec = (label, body) =>
  `========================================\nSECTION: ${label}\n========================================\n\n${String(body || "").trim()}`;
const fmtDate = (d) => (d ? String(d).slice(0, 10) : "—");

function header(name) {
  return `# Patient Health Record — ${name || "Patient"}

This record was assembled for the Ask Lumen assistant from the patient's own
data. It is bilingual (English / Portuguese); both languages may appear.`;
}

/* ───── Patient Zero ───── */
let zeroCache = null;
async function loadPatientZero(env, request) {
  if (zeroCache) return zeroCache;
  const url = new URL("/assets/patient-record.txt", request.url);
  const resp = await env.ASSETS.fetch(url);
  if (!resp.ok) throw new Error(`patient-record.txt fetch failed: ${resp.status}`);
  zeroCache = await resp.text();
  return zeroCache;
}

/* ───── Paulo (MRI studies) ───── */
function serializePaulo() {
  const studies = PAULO.studies || [];
  const name = stripTags((studies[0]?.identsEn || []).find((l) => /Patient/i.test(l)))
    .replace(/^Patient\.?\s*/i, "") || "Paulo Augusto Silotto Dias de Souza";
  const blocks = studies.map((s) => {
    const idents = (s.identsEn || []).map(stripTags).map((l) => `  - ${l}`).join("\n");
    const technique = (s.techniqueEn || []).map((l) => `  - ${stripTags(l)}`).join("\n");
    const findings = (s.findingsEn || []).map((l) => `  - ${stripTags(l)}`).join("\n");
    return [
      `### ${stripTags(s.titleEn)}`,
      stripTags(s.blurbEn),
      idents && `Identification:\n${idents}`,
      technique && `Technique:\n${technique}`,
      findings && `Findings:\n${findings}`,
      s.conclusionEn && `Conclusion: ${stripTags(s.conclusionEn)}`,
    ].filter(Boolean).join("\n\n");
  });
  return [header(name), sec("Imaging — MRI studies", blocks.join("\n\n---\n\n"))].join("\n\n");
}

/* ───── Silvana (7-yr labs + studies + InBody) ───── */
function serializeSilvana() {
  const { labs, inbody } = SILVANA;
  const p = labs.patient || {};
  const profile = [
    `Name: ${p.full_name || "—"}`,
    `Date of birth: ${fmtDate(p.dob)}`,
    `Sex: ${p.sex || "—"}`,
    `Country: ${p.country || "—"}`,
  ].join("\n");

  const docs = (labs.documents || [])
    .map((d) => `  - ${fmtDate(d.date)} · ${d.laboratory || "—"}${d.doctor ? ` · ${d.doctor}` : ""} · ${stripTags(d.title_en)}`)
    .join("\n");

  const studies = (labs.studies || [])
    .map((s) => `  - ${fmtDate(s.date)} · ${stripTags(s.modality_en) || s.category} · ${stripTags(s.title_en)}` +
      (s.conclusion_en ? `\n      Conclusion: ${stripTags(s.conclusion_en)}` : ""))
    .join("\n");

  const panels = (labs.panels || []).map((panel) => {
    const markers = (panel.markers || []).map((m) => {
      const range = (m.ref_low != null || m.ref_high != null)
        ? ` [ref ${m.ref_low ?? "?"}–${m.ref_high ?? "?"}${m.unit ? " " + m.unit : ""}]`
        : (m.ref_text_en ? ` [ref ${stripTags(m.ref_text_en)}]` : "");
      const pts = (m.points || [])
        .map((pt) => `${fmtDate(pt.date)}=${pt.value}${pt.unit || ""}${pt.flag ? "(" + pt.flag + ")" : ""}`)
        .join(", ");
      return `    · ${stripTags(m.marker_en)}${range}: ${pts}`;
    }).join("\n");
    return `${stripTags(panel.title_en)}${panel.subtitle_en ? " — " + stripTags(panel.subtitle_en) : ""}\n${markers}`;
  }).join("\n\n");

  const inbodyRows = [];
  if (inbody) {
    inbodyRows.push(`${inbody.device} · ${fmtDate(inbody.date)} · score ${inbody.score}/100 · height ${inbody.height_cm}cm`);
    for (const group of ["composition", "muscle_fat", "obesity"]) {
      for (const r of inbody[group] || []) {
        inbodyRows.push(`  - ${stripTags(r.marker_en)}: ${r.value}${r.unit || ""} [ref ${r.ref_low ?? "?"}–${r.ref_high ?? "?"}]`);
      }
    }
  }

  return [
    header(p.full_name),
    sec("Profile", profile),
    sec("Lab source documents (2019–2026)", docs),
    sec("Imaging, pathology & functional studies", studies),
    sec("Laboratory results — full time series", panels),
    inbody ? sec("Body composition (InBody)", inbodyRows.join("\n")) : "",
  ].filter(Boolean).join("\n\n");
}

/* ───── Database-default patients ───── */
function kv(obj, keys) {
  return keys.map(([k, label]) => (obj?.[k] != null && obj[k] !== "" ? `${label}: ${obj[k]}` : null)).filter(Boolean).join("\n");
}

function serializeDbRecord(r) {
  const out = [header(r.profile?.name)];
  out.push(sec("Profile", kv(r.profile, [
    ["name", "Name"], ["age", "Age"], ["sex", "Sex"], ["country_of_residence", "Country"],
    ["height_cm", "Height (cm)"], ["weight_kg", "Weight (kg)"], ["blood_type", "Blood type"],
    ["native_language", "Native language"],
  ])));

  const meds = (r.medications || []).map((m) =>
    `  - ${m.name}${m.dose ? " " + m.dose : ""}${m.frequency ? " · " + m.frequency : ""}${m.status ? " · " + m.status : ""}` +
    `${m.drug_class ? " · " + m.drug_class : ""}${m.note ? " — " + m.note : ""}`).join("\n");
  if (meds) out.push(sec("Medications", meds));

  const supps = (r.supplements || []).map((s) => `  - ${s.name}${s.dose ? " " + s.dose : ""}`).join("\n");
  if (supps) out.push(sec("Supplements", supps));

  const hist = (r.clinical_history || []).map((h) =>
    `  - ${fmtDate(h.occurred_on)} · ${h.category || ""}${h.heading ? " · " + h.heading : ""}${h.detail ? " — " + h.detail : ""}`).join("\n");
  const surg = (r.surgeries || []).map((s) => `  - ${fmtDate(s.performed_on)} · surgery · ${s.name}${s.notes ? " — " + s.notes : ""}`).join("\n");
  const inj = (r.injuries || []).map((i) => `  - ${fmtDate(i.occurred_on)} · injury · ${i.name}${i.notes ? " — " + i.notes : ""}`).join("\n");
  const histAll = [hist, surg, inj].filter(Boolean).join("\n");
  if (histAll) out.push(sec("Clinical history, surgeries & injuries", histAll));

  const flagged = (r.labs?.flagged_markers || []).map((l) =>
    `  - ${fmtDate(l.taken_at)} · ${l.panel || ""} · ${l.marker}: ${l.value ?? l.value_text ?? "?"}${l.unit ? " " + l.unit : ""}` +
    ` (${l.flag})${(l.ref_low != null || l.ref_high != null) ? ` [ref ${l.ref_low ?? "?"}–${l.ref_high ?? "?"}]` : ""}`).join("\n");
  // assembleRecord already bounds this at LAB_DUMP_CAP (800), newest-first;
  // serialize the whole set so long histories (Paulo's 840, Silvana's 216)
  // reach the model most-recent-to-eldest rather than being clipped at 300.
  const recent = (r.labs?.recent_results || []).slice(0, 800).map((l) =>
    `  - ${fmtDate(l.taken_at)} · ${l.panel || ""} · ${l.marker}: ${l.value ?? l.value_text ?? "?"}${l.unit ? " " + l.unit : ""}${l.flag ? " (" + l.flag + ")" : ""}`).join("\n");
  if (flagged || recent) {
    out.push(sec(`Labs (${r.labs?.total_results ?? 0} total${r.labs?.recent_results_truncated ? ", recent capped" : ""})`,
      [flagged && `Flagged / out-of-range:\n${flagged}`, recent && `Recent results:\n${recent}`].filter(Boolean).join("\n\n")));
  }

  if (r.vitals?.summary) {
    out.push(sec("Vitals (wearables / daily)", kv(r.vitals.summary, [
      ["days", "Days recorded"], ["first_day", "First day"], ["last_day", "Last day"],
      ["avg_hrv_ms", "Avg HRV (ms)"], ["avg_resting_hr", "Avg resting HR"], ["avg_sleep_minutes", "Avg sleep (min)"],
      ["avg_steps", "Avg steps"], ["avg_spo2_pct", "Avg SpO2 %"], ["avg_bp_sys", "Avg BP sys"], ["avg_bp_dia", "Avg BP dia"],
    ])));
  }
  if (r.glucose && r.glucose.points) {
    out.push(sec("Glucose", kv(r.glucose, [
      ["points", "Readings"], ["first_ts", "First"], ["last_ts", "Last"],
      ["avg_mg_dl", "Avg mg/dL"], ["pct_time_in_range", "Time in range %"],
    ])));
  }

  const imaging = (r.imaging_studies || []).map((i) =>
    `  - ${fmtDate(i.study_date)} · ${i.modality || ""} ${i.body_part || ""}${i.notes ? " — " + i.notes : ""}`).join("\n");
  if (imaging) out.push(sec("Imaging studies", imaging));

  // Electrodiagnostic studies (ENMG / NCS-EMG). The AI sees these regardless of
  // the patient-facing display_mode; the conclusion carries the clinical weight.
  const edx = (r.electrodiagnostic_studies || []).map((e) =>
    `  - ${fmtDate(e.exam_date)} · ${e.study_subtype || e.study_type || "electrodiagnostic"}` +
    `${e.lab ? " · " + e.lab : ""}${e.conclusion ? "\n      Conclusão: " + e.conclusion : ""}`).join("\n");
  if (edx) out.push(sec("Electrodiagnostic studies (ENMG)", edx));

  // Ergometric / stress tests — the conclusion + peak metrics carry the weight.
  const ergo = (r.ergometric_studies || []).map((e) =>
    `  - ${fmtDate(e.exam_date)} · ergometric${e.protocol ? " · " + e.protocol : ""}${e.lab ? " · " + e.lab : ""}` +
    `${e.met_max != null ? "\n      METs max: " + e.met_max : ""}${e.fc_max_bpm != null ? " · HR max: " + e.fc_max_bpm + " bpm" : ""}` +
    `${e.fc_max_pct_predicted != null ? " (" + e.fc_max_pct_predicted + "% predicted)" : ""}` +
    `${e.ischemia ? "\n      Ischemia: " + e.ischemia : ""}${e.aha_fitness ? " · fitness: " + e.aha_fitness : ""}` +
    `${e.conclusion_verbatim ? "\n      Conclusão: " + stripTags(e.conclusion_verbatim) : ""}`).join("\n");
  if (ergo) out.push(sec("Ergometric / stress tests", ergo));

  // Sleep studies (PSG / DISE) — AHI + oximetry + verbatim comments.
  const sleep = (r.sleep_studies || []).map((s) =>
    `  - ${fmtDate(s.exam_date)} · ${s.subtype || "sleep study"}${s.lab ? " · " + s.lab : ""}` +
    `${s.ahi_iah != null ? "\n      AHI/IAH: " + s.ahi_iah : ""}${s.severity ? " · " + s.severity : ""}` +
    `${s.sleep_efficiency_pct != null ? " · efficiency " + s.sleep_efficiency_pct + "%" : ""}` +
    `${s.spo2_nadir != null ? " · SpO2 nadir " + s.spo2_nadir + "%" : ""}` +
    `${s.comments_verbatim ? "\n      " + stripTags(s.comments_verbatim) : ""}`).join("\n");
  if (sleep) out.push(sec("Sleep studies (PSG / DISE)", sleep));

  // Clinical ECG studies (12-lead / rhythm) — distinct from wearable ecg_events.
  const ecgS = (r.ecg_studies || []).map((e) =>
    `  - ${fmtDate(e.study_date)} · ${e.modality || "ECG"}${e.clinic ? " · " + e.clinic : ""}` +
    `${e.heart_rate != null ? " · HR " + e.heart_rate : ""}${e.qtc_ms != null ? " · QTc " + e.qtc_ms + " ms" : ""}` +
    `${e.interpretation ? "\n      " + stripTags(e.interpretation) : ""}`).join("\n");
  if (ecgS) out.push(sec("ECG studies (clinical)", ecgS));

  const pgx = (r.pgx_findings || []).map((g) =>
    `  - ${g.gene}${g.variant ? " " + g.variant : ""}: ${g.phenotype || ""}${g.recommendation ? " — " + g.recommendation : ""}`).join("\n");
  if (pgx) out.push(sec("Pharmacogenomics", pgx));

  if (r.mood?.summary?.n) {
    out.push(sec("Mood", kv(r.mood.summary, [["n", "Entries"], ["first", "First"], ["last", "Last"], ["avg_valence", "Avg valence"], ["avg_arousal", "Avg arousal"]])));
  }
  const psych = (r.psych_architecture || []).map((x) =>
    `  - ${x.dimension || ""} · ${x.title || ""}${x.synthesis ? " — " + x.synthesis : ""}`).join("\n");
  if (psych) out.push(sec("Psychological architecture", psych));

  const docs = (r.documents || []).map((d) =>
    `  - ${fmtDate(d.document_date)} · ${d.kind || ""} · ${d.title || ""}${d.summary ? " — " + d.summary : ""}`).join("\n");
  if (docs) out.push(sec("Documents", docs));

  return out.join("\n\n");
}

/**
 * @param {{ id: string, clerkUserId: string, fullName?: string }} ref
 * @param {object} env       Worker env (DATABASE_URL, ASSETS)
 * @param {Request} request  for ASSETS.fetch origin
 * @returns {Promise<{ text: string, renderClass: string }>}
 */
export async function buildPatientContext(ref, env, request) {
  const clerk = ref?.clerkUserId || "";

  // Patient Zero keeps his hand-curated ~480KB record: it is richer than his DB
  // dump (his DB carries no clinical_history rows) and is regenerated with the
  // rest of his bespoke assets, so it is not the stale source here.
  if (clerk === PATIENT_ZERO) {
    return { text: await loadPatientZero(env, request), renderClass: "patient-zero" };
  }

  // The live database is the source of truth. Whenever the patient has a
  // resolved users.id, assemble the WHOLE record from Neon on every request —
  // every table ordered newest-first — so the chat always reflects the latest
  // ingests. This is what fixes the bespoke patients (Paulo, Silvana), who were
  // frozen on build-time JS snapshots (paulo.js / silvana.js) and never saw any
  // data added after the chatbot was first built.
  if (ref?.id) {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL not configured");
    const sql = neon(env.DATABASE_URL);
    const record = await assembleRecord(sql, ref.id);
    const rc = clerk === PAULO_SILOTTO ? "db-paulo"
             : clerk === SILVANA_CRESTE ? "db-silvana"
             : "db-default";
    return { text: serializeDbRecord(record), renderClass: rc };
  }

  // No DB row yet — fall back to the frozen bespoke snapshot so a not-yet-
  // backfilled demo patient still answers (stale, but never empty).
  if (clerk === PAULO_SILOTTO) return { text: serializePaulo(), renderClass: "bespoke-paulo-static" };
  if (clerk === SILVANA_CRESTE) return { text: serializeSilvana(), renderClass: "bespoke-silvana-static" };

  throw new Error("buildPatientContext: no users.id and no bespoke snapshot for " + (clerk || "unknown"));
}
