/* ── Lumen Health · Deterministic dashboard-card ordering (D1, contract §3) ──
 *
 * ONE source of truth for card order. Order is a pure function of card
 * properties — identical across rebuilds, loads and patients:
 *
 *   cardSortKey(card) = [ subpageOrdinal, prefixOrdinal, riskOrdinal, anchor ]
 *
 * `rank` = the card's index (0..n-1) after sorting the dashboard's full card
 * set with this key. Recomputed on every write (sanitizePayload) and by the
 * admin backfill; never hand-assigned. The client keeps a mirrored comparator
 * in web/assets/patient-context.js (classic IIFE, cannot import ESM) for its
 * defensive read-side sort — change BOTH together.
 *
 * Every lookup falls through to a sentinel (99 / 3) — this function never
 * throws, whatever shape the card is.
 */

const SUBPAGE_ORDINAL = {
  "home": 0, "physical": 1, "physical-vitals": 2, "physical-exams": 3,
  "physical-genetics": 4, "mental": 5, "spiritual": 6,
};
const PREFIX_ORDINAL = {
  lab: 0, imaging: 1, ecg: 2, vitals: 3, pgx: 4, interaction: 5, journal: 6,
};
const RISK_ORDINAL = { high: 0, medium: 1, low: 2 };

export function cardSortKey(card) {
  const c = card && typeof card === "object" ? card : {};
  const subpage = typeof c.subpage === "string" ? c.subpage : "";
  const anchor = typeof c.anchor === "string" ? c.anchor : "";
  const prefix = anchor.includes(":") ? anchor.slice(0, anchor.indexOf(":")) : "";
  const sub = SUBPAGE_ORDINAL[subpage] ?? 99;
  const pre = PREFIX_ORDINAL[prefix] ?? 99;
  const risk = RISK_ORDINAL[typeof c.risk_level === "string" ? c.risk_level : ""] ?? 3;
  // Unknown prefixes sort after all known ones, alphabetically among
  // themselves (the extra string element is empty for known prefixes).
  return [sub, pre, pre === 99 ? prefix : "", risk, anchor];
}

export function compareCards(a, b) {
  const ka = cardSortKey(a);
  const kb = cardSortKey(b);
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] < kb[i]) return -1;
    if (ka[i] > kb[i]) return 1;
  }
  return 0;
}

/* Sorts a copy of the card set and assigns contiguous rank 0..n-1. */
export function assignRanks(cards) {
  const arr = Array.isArray(cards) ? cards.slice() : [];
  arr.sort(compareCards);
  arr.forEach((c, i) => { if (c && typeof c === "object") c.rank = i; });
  return arr;
}

/* ── Deprecated-field fold (contract §3) ─────────────────────────────────
 * body / plain_language_reading / what_the_report_says are vestigial; the
 * canonical per-card text channel is `interpretation`. Folding preserves
 * content: existing interpretation wins; imaging cards join their two
 * channels as separate paragraphs; body is the last fallback.
 *
 * COPY, not move: the deprecated keys stay on the stored card so any
 * renderer still reading them (e.g. a production deploy older than this
 * job) keeps working. They are inert going forward — new builds never emit
 * them and the new renderer never reads them. Portuguese is never invented:
 * pt is populated only from pt sources already on the card.              */

export function joinBiling(a, b) {
  const has = (x) => x && (x.en || x.pt);
  if (!has(a) && !has(b)) return null;
  if (!has(a)) return b;
  if (!has(b)) return a;
  return {
    en: [a.en, b.en].filter(Boolean).join("\n\n"),
    pt: [a.pt, b.pt].filter(Boolean).join("\n\n"),
  };
}

export function foldDeprecatedCard(card) {
  if (!card || typeof card !== "object") return card;
  const has = (x) => x && (x.en || x.pt);
  const folded = has(card.interpretation)
    ? card.interpretation
    : (joinBiling(card.plain_language_reading, card.what_the_report_says) ||
       (has(card.body) ? card.body : null));
  return { ...card, interpretation: folded };
}
