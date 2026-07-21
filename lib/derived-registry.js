// The derived-data dependency registry — single source of truth for the
// invalidation invariants enforced by test/derived-invalidation.test.mjs and
// test/insight-read-coverage.test.mjs.
//
//   SOURCE_TABLES      every table a patient's CLINICAL data is written to. Any
//                      script/endpoint that writes one MUST call markSourceWritten()
//                      (lib/derived-freshness.js) so the AI narrative can't go stale.
//   INSIGHT_READ_SET   exactly the tables lib/ai-insights.js assembleRecord() reads.
//   KNOWN_NOT_READ     source tables deliberately NOT (yet) fed to the insight engine.
//
// Invariant (test/insight-read-coverage): SOURCE_TABLES === INSIGHT_READ_SET ∪ KNOWN_NOT_READ.
// Adding a new source table forces a conscious choice: wire it into assembleRecord
// or list it in KNOWN_NOT_READ — it cannot silently become invisible.

export const SOURCE_TABLES = [
  "lab_results", "imaging_studies", "vitals_daily", "glucose_points", "hr_readings",
  "ecg_events", "ecg_studies", "electrodiagnostic_studies", "sleep_studies",
  "ergometric_studies", "bioimpedance_exams", "medications", "supplements",
  "surgeries", "injuries", "clinical_history", "risk_assessments", "pgx_findings",
  "writings", "documents", "mood_entries", "panic_events", "life_events",
  "psych_items", "psych_evidence", "reflective_items", "wheel_of_life_assessments",
  "therapy_sessions", "patient_procedures",
];

export const INSIGHT_READ_SET = [
  "clinical_history", "documents", "ecg_events", "ecg_studies",
  "electrodiagnostic_studies", "ergometric_studies", "glucose_points",
  "imaging_studies", "injuries", "lab_results", "life_events", "medications",
  "mood_entries", "panic_events", "pgx_findings", "psych_items", "reflective_items",
  "risk_assessments", "sleep_studies", "supplements", "surgeries", "vitals_daily",
  "wheel_of_life_assessments", "writings",
];

// Deliberately not read by assembleRecord (acknowledged, not accidental).
export const KNOWN_NOT_READ = [
  "hr_readings", "bioimpedance_exams", "therapy_sessions", "psych_evidence",
  "patient_procedures",
];
