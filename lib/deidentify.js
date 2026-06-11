/**
 * Safe-Harbor-style de-identification boundary for the Ask Lumen chat context.
 *
 * This is the single switch point the compliance roadmap (HIPAA/LGPD/GDPR) flips
 * later: today `DEIDENTIFY_CHAT` defaults OFF, because the patient is chatting
 * over their *own* record and stripping their name/dates/labs would gut the
 * product (the assistant could no longer say "your TSH on 2026-04-25"). The rest
 * of the platform (lib/ai-insights.js) already sends raw records to the model and
 * there is no BAA yet — so this matches current posture. When a BAA + Scale plan
 * land, set DEIDENTIFY_CHAT=true and the assembled context is scrubbed here with
 * zero changes to the routes that call it.
 *
 * The scrub is a best-effort approximation of the HIPAA Safe Harbor identifier
 * list over free text — NOT a certified de-identification. It is deliberately
 * conservative (over-redacts) and is only meaningful once enabled.
 */

/** Read the mode switch. Defaults OFF when the env var is unset/blank. */
export function isDeidentifyOn(env) {
  return String(env?.DEIDENTIFY_CHAT ?? "").toLowerCase() === "true";
}

// Reduce any recognizable date to its year only (Safe Harbor keeps year alone).
const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|janeiro|fevereiro|março|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro";
const DATE_PATTERNS = [
  [/\b(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b/g, "$1"],                 // 2026-04-25
  [/\b(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{4})\b/g, "$3"],                 // 25/04/2026
  [new RegExp(`\\b(0?[1-9]|[12]\\d|3[01])\\s+(?:${MONTHS})[a-zç]*\\.?\\,?\\s+(\\d{4})\\b`, "gi"), "$2"], // 25 Apr 2026
  [new RegExp(`\\b(?:${MONTHS})[a-zç]*\\.?\\s+(\\d{4})\\b`, "gi"), "$1"],                 // Apr 2026
];

/**
 * Scrub Safe-Harbor identifiers from free text.
 * @param {string} text                 assembled patient record
 * @param {{ names?: string[] }} [opts] additional literal names to redact
 */
export function safeHarborScrub(text, opts = {}) {
  if (!text) return text;
  let out = text;

  // Dates first — reduce to year — so hyphenated dates (2026-04-25) aren't
  // swallowed by the phone-run pattern below.
  for (const [re, repl] of DATE_PATTERNS) out = out.replace(re, repl);

  // Emails, URLs, phone-shaped runs, then long numeric identifiers (MRN/accession/CPF).
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[EMAIL]");
  out = out.replace(/\bhttps?:\/\/\S+/gi, "[URL]");
  out = out.replace(/\+?\d[\d ().-]{7,}\d/g, "[PHONE]");             // phone-shaped runs
  out = out.replace(/\b[A-Z]{0,3}\d{6,}\b/g, "[ID]");               // accession/MRN-like

  // Caller-supplied proper names (patient + clinicians pulled from the record).
  for (const name of opts.names || []) {
    const n = String(name || "").trim();
    if (n.length < 3) continue;
    out = out.replace(new RegExp(escapeRe(n), "gi"), "[NAME]");
    // also redact each multi-char token of the name on its own
    for (const tok of n.split(/\s+/)) {
      if (tok.length >= 3) out = out.replace(new RegExp(`\\b${escapeRe(tok)}\\b`, "gi"), "[NAME]");
    }
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Boundary entry point used by the chat routes. No-op unless the switch is on.
 * @param {string} text
 * @param {object} env   Worker env (reads DEIDENTIFY_CHAT)
 * @param {{ names?: string[] }} [opts]
 */
export function deidentifyContext(text, env, opts = {}) {
  return isDeidentifyOn(env) ? safeHarborScrub(text, opts) : text;
}
