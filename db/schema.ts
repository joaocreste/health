/**
 * Lumen Health — Postgres schema (Drizzle).
 *
 * One file because the model is small. Sections, top → bottom:
 *   1. Identity & access  (users, profiles, doctor↔patient links)
 *   2. Clinical structured data (medications, surgeries, labs, vitals, glucose)
 *   3. Patient artifacts (imaging, writings, generic documents)
 *   4. Self-assessment (wheel of life)
 *   5. Pipeline (imports, import_files)
 *   6. Audit (audit_log)
 *
 * Conventions:
 *   - Every patient-owned row carries patient_id with ON DELETE CASCADE so a
 *     patient deletion is GDPR-clean (right to erasure).
 *   - Blobs live in R2; Postgres stores the R2 key, not the bytes.
 *   - JSONB is used sparingly: only for genuinely shape-flexible payloads
 *     (wheel-of-life scores snapshot, audit metadata, import error blobs).
 *   - Timestamps are timestamptz everywhere — never naive.
 */

import { sql } from "drizzle-orm";
import {
  pgTable, pgEnum, uuid, text, integer, real, boolean, timestamp, date,
  jsonb, bigint, index, uniqueIndex, primaryKey, check,
} from "drizzle-orm/pg-core";

/* ───── Enums ─────────────────────────────────────── */

export const userRole = pgEnum("user_role", ["admin", "doctor", "patient"]);
export const sex = pgEnum("sex", ["male", "female", "other", "unknown"]);
export const importStatus = pgEnum("import_status", [
  "pending", "uploading", "processing", "completed", "failed", "partial",
]);
export const importSource = pgEnum("import_source", [
  "self_zip", "self_files", "admin_upload", "migration",
]);
export const importFileStatus = pgEnum("import_file_status", [
  "received", "classified", "parsed", "skipped", "failed",
]);
export const imagingModality = pgEnum("imaging_modality", [
  "MRI", "CT", "PET", "US", "XR", "EEG", "ECG", "OTHER",
]);
export const imagingSourceFormat = pgEnum("imaging_source_format", [
  "DICOM", "JPEG", "PNG", "MIXED",
]);
export const encounterType = pgEnum("encounter_type", [
  "in_person", "remote", "phone", "er", "admission", "lab_followup", "other",
]);
// Electrodiagnostic studies (migration 0018). study_type is the typed routing
// field; display_mode governs the future patient-facing render surface only —
// storage + AI context are unaffected by it.
export const electrodiagnosticStudyType = pgEnum("electrodiagnostic_study_type", [
  "ncs_emg", "ncs", "emg", "evoked_potential", "repetitive_stimulation", "other",
]);
export const clinicalDisplayMode = pgEnum("clinical_display_mode", [
  "hidden", "report_only", "tables_only", "full",
]);
export const taperDirection = pgEnum("taper_direction", [
  "increase", "decrease", "hold", "stop", "restart",
]);
export const ecgClassification = pgEnum("ecg_classification", [
  "sinus_rhythm", "high_heart_rate", "low_heart_rate",
  "atrial_fibrillation", "poor_recording", "inconclusive", "other",
]);
export const pgxCategory = pgEnum("pgx_category", [
  "pharmacokinetic", "pharmacodynamic", "condition_risk", "other",
]);
/* Bioimpedance segmental analysis — InBody-class devices only. */
export const bioimpedanceSegment = pgEnum("bioimpedance_segment", [
  "right_arm", "left_arm", "trunk", "right_leg", "left_leg",
]);
export const bioimpedanceSegmentStatus = pgEnum("bioimpedance_segment_status", [
  "below", "normal", "above",   // abaixo / normal / acima
]);

export const lifeEventCategory = pgEnum("life_event_category", [
  "birth", "move", "marriage", "divorce", "job",
  "education", "hospitalization", "diagnosis", "loss", "crisis", "other",
]);
// Patient-upload review lifecycle. Distinct from import_status — an upload is
// raw blobs awaiting an admin's manual ingestion decision, NOT a parse pipeline.
export const uploadStatus = pgEnum("upload_status", [
  "pending_review", "ingested", "data_error",
]);

/* ───── 1. Identity & access ──────────────────────── */

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clerkUserId: text("clerk_user_id").notNull().unique(),
    email: text("email").notNull(),
    role: userRole("role").notNull(),
    locale: text("locale").default("en").notNull(), // 'en' | 'pt' | ...
    fullName: text("full_name"),
    // Demo-phase login credentials. Plaintext password is intentional —
    // this is replaced by Clerk + Google SSO before any real-patient data.
    demoUsername: text("demo_username").unique(),
    demoPassword: text("demo_password"),
    // Who created this row. Null for self-signup and for the original seed
    // (chicken-and-egg). Admin-created rows carry the admin's id.
    createdBy: uuid("created_by").references((): any => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("users_email_lower_idx").on(sql`lower(${t.email})`),
    index("users_role_idx").on(t.role),
  ],
);

export const doctorProfiles = pgTable("doctor_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  specialty: text("specialty"),
  licenseNo: text("license_no"),
  licenseCountry: text("license_country"), // ISO 3166-1 alpha-2
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const patientProfiles = pgTable("patient_profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  dateOfBirth: date("date_of_birth"),
  sex: sex("sex"),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  bloodType: text("blood_type"), // 'A+', 'O-', etc. Free-text for now.
  nativeLanguage: text("native_language"),
  countryOfResidence: text("country_of_residence"), // ISO 3166-1 alpha-2
  emergencyContact: jsonb("emergency_contact"),     // { name, relation, phone, email }
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* Generic access: one row per (user, patient) pair. Covers self-access,
   family-proxy access, and clinical access uniformly. The `kind` of the
   relationship is not tracked at the row level — `users.role` gates UX,
   but access itself is purely a list of patient_ids per user. */
export const patientAccess = pgTable(
  "patient_access",
  {
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    notes: text("notes"),
    // ── Scoped access (migration 0014) ──
    // scopes: string[] validated in the Worker against the canonical taxonomy
    // (profile_basic, imaging, labs, vitals, medications, clinical_history,
    // genetics, mental, journal). profile_basic is implied by any grant.
    scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
    // e.g. { "imaging_study_ids": ["uuid", ...] } — narrows imaging to studies.
    resourceFilter: jsonb("resource_filter"),
    // NULL = grant NEVER expires (first-class state). Past = expired = no
    // grant at read time; rows are never deleted on expiry (audit trail).
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reason: text("reason"),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.patientId] }),
    index("patient_access_patient_idx").on(t.patientId),
  ],
);

/* ───── AI dashboards (raw-SQL migrations 0005 + 0006; contract §3) ──
   Definition only — the table predates Drizzle here; no migration alters it.
   One row per (patient, section); section 'ai-insights' holds the whole-
   record payload in cards_json (inline_insights[] carry the persisted D1
   `rank`). `highlights` is written but never read (documented-unused). */
export const patientDashboards = pgTable(
  "patient_dashboards",
  {
    patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    summaryMd: text("summary_md"),
    highlights: jsonb("highlights"),
    model: text("model"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    generatedBy: uuid("generated_by").references(() => users.id),
    cardsJson: jsonb("cards_json"),
  },
  (t) => [primaryKey({ columns: [t.patientId, t.section] })],
);

/* ───── 2. Clinical structured data ───────────────── */

export const medications = pgTable("medications", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dose: text("dose"),                          // raw per-unit strength as written ("500 mg/tablet")
  frequency: text("frequency"),                // raw schedule ("2x/day", "1x/day", "weekly", "PRN")
  // Computed TOTAL taken per day (strength × units/dose × doses/day). Kept ALONGSIDE
  // the raw dose/frequency — additive, never a replacement, so the value stays auditable.
  // Null for PRN / weekly / non-daily / needs-review (no honest fixed daily total).
  dailyDoseAmount: real("daily_dose_amount"),  // numeric daily total
  dailyDoseUnit: text("daily_dose_unit"),      // its unit ('mg' | 'mcg' | 'g' | 'IU' | 'units' | 'puffs' | ...)
  drugClass: text("drug_class"),
  status: text("status"), // 'active' | 'discontinued' | 'paused' | 'needs-review' — free-text for ingest flexibility
  note: text("note"),
  startedAt: date("started_at"),
  endedAt: date("ended_at"),
  sourceBlobKey: text("source_blob_key"), // R2 key of CSV/PDF this row came from, if any
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("medications_patient_idx").on(t.patientId)]);

export const supplements = pgTable("supplements", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dose: text("dose"),
  startedAt: date("started_at"),
  endedAt: date("ended_at"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("supplements_patient_idx").on(t.patientId)]);

export const surgeries = pgTable("surgeries", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  performedOn: date("performed_on"),
  notes: text("notes"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("surgeries_patient_idx").on(t.patientId)]);

export const injuries = pgTable("injuries", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  occurredOn: date("occurred_on"),
  notes: text("notes"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("injuries_patient_idx").on(t.patientId)]);

// Unified injuries / surgeries / procedures history (migration 0011). Supersedes
// the legacy `surgeries` + `injuries` tables: one typed row per event, with a
// `date_raw` slot so partial/unknown dates survive for display.
export const patientProcedures = pgTable("patient_procedures", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  eventDate: date("event_date"),        // ISO date; null when unknown
  dateRaw: text("date_raw"),            // original string as provided
  type: text("type").notNull(),         // Injury | Surgery | Procedure | Diagnostic | Hospitalization | Other
  location: text("location"),
  description: text("description").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("patient_procedures_patient_date_idx").on(t.patientId, t.eventDate)]);

// Clinical ECG studies (migration 0012) — distinct from per-event `ecg_events`
// (Apple Watch single beats). One row per full study; blobs (original chart,
// report PDF, generated Lumen SVG) live in R2, referenced by *_key columns.
export const ecgStudies = pgTable("ecg_studies", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  studyDate: date("study_date").notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }),
  modality: text("modality").notNull().default("12-lead"),
  leadLayout: text("lead_layout"),
  sourceFormat: text("source_format").notNull(), // vector_pdf | dicom_waveform | raster_pdf | image
  fidelity: text("fidelity"),
  orderingDoctor: text("ordering_doctor"),      // requesting doctor (name + reg ID inline)
  validatingDoctor: text("validating_doctor"),  // performing/signing doctor (name + reg ID inline)
  clinic: text("clinic"),                        // facility name (= lab_name role)
  labCity: text("lab_city"),
  labCountry: text("lab_country"),
  heartRate: integer("heart_rate"),
  prMs: integer("pr_ms"),
  qrsMs: integer("qrs_ms"),
  qtMs: integer("qt_ms"),
  qtcMs: integer("qtc_ms"),
  axisP: integer("axis_p"),
  axisQrs: integer("axis_qrs"),
  axisT: integer("axis_t"),
  interpretation: text("interpretation"),
  reportText: text("report_text"),
  sourceSha: text("source_sha"),
  originalKey: text("original_key"),
  reportKey: text("report_key"),
  svgKey: text("svg_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("ecg_studies_patient_date_idx").on(t.patientId, t.studyDate)]);

/* Electrodiagnostic studies — NCS + needle EMG (ENMG). The four structured
   blocks (motor_ncs / f_wave / sensory_ncs / needle_emg) live verbatim in
   structuredData; the laudo lives verbatim in reportText/conclusion. Stored
   together so Ask Lumen + AI insights see the whole picture; displayMode gates
   only the future patient-facing surface, requiresReview the human-approval. */
export const electrodiagnosticStudies = pgTable("electrodiagnostic_studies", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  importId: uuid("import_id").references(() => imports.id),
  importFileId: uuid("import_file_id").references(() => importFiles.id),
  studyType: electrodiagnosticStudyType("study_type").notNull().default("ncs_emg"),
  studySubtype: text("study_subtype"),       // "Eletroneuromiografia de MMII (estudo completo)"
  bodyRegion: text("body_region"),           // "lower limbs / MMII"
  laterality: text("laterality"),            // "bilateral"
  examDate: date("exam_date"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
  requestingDoctor: text("requesting_doctor"),
  performingDoctor: text("performing_doctor"),
  lab: text("lab"),
  city: text("city"),
  country: text("country"),
  conclusion: text("conclusion"),            // CONCLUSAO block, verbatim
  reportText: text("report_text"),           // full laudo, verbatim, original language
  structuredData: jsonb("structured_data").notNull().default({}),
  sourceLanguage: text("source_language").default("pt-BR"),
  r2Key: text("r2_key"),
  sourceSha: text("source_sha"),
  displayMode: clinicalDisplayMode("display_mode").notNull().default("hidden"),
  deIdentified: boolean("de_identified").notNull().default(false),
  requiresReview: boolean("requires_review").notNull().default(true),
  severityFlags: text("severity_flags").array().default([]),
  confidence: text("confidence"),            // alta / media / baixa
  extractionFlags: jsonb("extraction_flags").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("electrodiagnostic_studies_dedup").on(t.patientId, t.examDate, t.studyType),
  index("electrodiagnostic_studies_patient_date_idx").on(t.patientId, t.examDate),
]);

export const clinicalHistory = pgTable("clinical_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // 'family', 'self', 'allergy', 'genetic', ...
  heading: text("heading").notNull(),
  detail: text("detail"),
  occurredOn: date("occurred_on"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("clinical_history_patient_idx").on(t.patientId)]);

export const riskAssessments = pgTable("risk_assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),     // 'AUDIT', 'PHQ-9', 'GAD-7', 'cardiac_risk', ...
  payload: jsonb("payload").notNull(), // typed-by-kind blob — schema TBD per instrument
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("risk_patient_kind_idx").on(t.patientId, t.kind),
]);

export const labResults = pgTable("lab_results", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  panel: text("panel"),                    // 'CBC', 'lipid', 'thyroid', ...
  marker: text("marker").notNull(),        // 'hemoglobin', 'ldl', 'tsh', ...
  value: real("value"),
  valueText: text("value_text"),           // for non-numeric results ('positive', 'normal')
  unit: text("unit"),
  refLow: real("ref_low"),
  refHigh: real("ref_high"),
  flag: text("flag"),                      // 'L' | 'H' | 'HH' | 'LL' | null
  takenAt: date("taken_at").notNull(),
  laboratory: text("laboratory"),            // facility name (= lab_name role), original spelling
  labCity: text("lab_city"),                 // city the panel was performed in
  labCountry: text("lab_country"),           // country the panel was performed in
  requestingDoctor: text("requesting_doctor"),  // "Dr. X" / "Dra. Y" who ordered the panel (name + reg ID inline)
  performingDoctor: text("performing_doctor"),  // who performed/signed/is responsible (name + reg ID inline)
  sourceBlobKey: text("source_blob_key"),  // R2 key of original PDF
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("lab_patient_taken_idx").on(t.patientId, t.takenAt),
  index("lab_patient_marker_idx").on(t.patientId, t.marker),
]);

/* Daily wearable aggregates. Raw timeseries lives as R2 blobs;
   this table is for "show me a chart of HRV over the last 90 days" queries. */
export const vitalsDaily = pgTable("vitals_daily", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  day: date("day").notNull(),
  source: text("source").notNull(), // device: 'oura' | 'apple_health' | 'withings_cuff' | 'withings_scale' | 'manual'; derived: 'aggregate' | 'resolved' (source-of-truth, see lib/vitals-resolve.js)
  steps: integer("steps"),
  caloriesActive: integer("calories_active"),
  caloriesPassive: integer("calories_passive"),
  hrvMs: real("hrv_ms"),
  restingHr: real("resting_hr"),
  sleepMinutes: integer("sleep_minutes"),
  deepSleepMinutes: integer("deep_sleep_minutes"),
  remSleepMinutes: integer("rem_sleep_minutes"),
  spo2Pct: real("spo2_pct"),
  weightKg: real("weight_kg"),
  bloodPressureSys: integer("blood_pressure_sys"),
  bloodPressureDia: integer("blood_pressure_dia"),
  extras: jsonb("extras"), // anything source-specific we don't break out yet
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("vitals_patient_day_source_uq").on(t.patientId, t.day, t.source),
  index("vitals_patient_day_idx").on(t.patientId, t.day),
]);

/* Continuous glucose monitor — kept as discrete points because we draw
   minute-resolution charts and the LLM may answer "what was your glucose
   yesterday at 3pm" style questions. */
export const glucosePoints = pgTable("glucose_points", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  mgDl: real("mg_dl").notNull(),
  source: text("source"), // 'libre', 'dexcom', 'manual', ...
}, (t) => [
  uniqueIndex("glucose_patient_ts_uq").on(t.patientId, t.ts),
  index("glucose_patient_ts_idx").on(t.patientId, t.ts),
]);

/* Bioimpedance / body composition (BIA). One row per exam — a point in the
   patient's body-composition time series. Device-agnostic: a Tanita TBF-410
   fills the whole-body block and leaves the InBody-only columns NULL, an
   InBody fills everything plus the segmental child rows below.
   ffmKg is FAT-FREE mass (muscle + bone + visceral/residual), which is NOT
   skeletalMuscleMassKg — never derive one from the other.
   Co-located spot vitals on the same print-out (BP, SpO2, capillary glucose)
   route to vitalsDaily / glucosePoints; only anthropometrics stay here. */
export const bioimpedanceExams = pgTable("bioimpedance_exams", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  examDate: date("exam_date").notNull(),
  deviceManufacturer: text("device_manufacturer"),   // 'Tanita'
  deviceModel: text("device_model"),                 // 'TBF-410'
  bodyType: text("body_type"),                       // device classification, e.g. 'ATHLETIC'
  sex: sex("sex"),
  ageYears: integer("age_years"),
  heightCm: real("height_cm"),
  weightKg: real("weight_kg"),
  bmi: real("bmi"),
  bmrKcal: integer("bmr_kcal"),
  bmrKj: integer("bmr_kj"),
  impedanceOhms: real("impedance_ohms"),
  fatPercent: real("fat_percent"),                   // FAT% / PBF
  fatMassKg: real("fat_mass_kg"),
  ffmKg: real("ffm_kg"),                             // fat-free mass (NOT muscle mass)
  tbwKg: real("tbw_kg"),                             // total body water
  skeletalMuscleMassKg: real("skeletal_muscle_mass_kg"), // InBody-only
  proteinKg: real("protein_kg"),                     // InBody-only
  mineralsKg: real("minerals_kg"),                   // InBody-only
  visceralFatLevel: real("visceral_fat_level"),      // InBody-only
  waistCircumferenceCm: real("waist_circumference_cm"),
  hipCircumferenceCm: real("hip_circumference_cm"),
  whr: real("whr"),
  requestingProfessional: text("requesting_professional"), // who ordered it; NULL when not stated
  performingProfessional: text("performing_professional"), // who signed (name + reg ID inline)
  facilityName: text("facility_name"),
  facilityCity: text("facility_city"),
  facilityCountry: text("facility_country"),
  sourceDocumentId: uuid("source_document_id").references(() => documents.id),
  rawExtract: jsonb("raw_extract"),                  // verbatim device print-out, PHI excluded
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("bioimpedance_exam_uq").on(t.patientId, t.examDate, t.deviceManufacturer, t.deviceModel),
  index("bioimpedance_patient_date_idx").on(t.patientId, t.examDate),
]);

/* Per-region lean/fat — InBody-class devices only. Populated ONLY when the
   device actually reports segmental values; a Tanita exam legitimately has
   ZERO rows here. The presence of rows is what the segmental render keys off,
   so empty = omit the section, never render an empty skeleton. Never derive
   these from whole-body values. */
export const bioimpedanceSegments = pgTable("bioimpedance_segments", {
  id: uuid("id").defaultRandom().primaryKey(),
  examId: uuid("exam_id").notNull().references(() => bioimpedanceExams.id, { onDelete: "cascade" }),
  segment: bioimpedanceSegment("segment").notNull(),
  leanMassKg: real("lean_mass_kg"),
  leanPctIdeal: real("lean_pct_ideal"),              // % vs. device ideal
  leanStatus: bioimpedanceSegmentStatus("lean_status"),
  fatMassKg: real("fat_mass_kg"),
  fatPctIdeal: real("fat_pct_ideal"),
  fatStatus: bioimpedanceSegmentStatus("fat_status"),
}, (t) => [
  uniqueIndex("bioimpedance_segment_uq").on(t.examId, t.segment),
]);

/* ───── 3. Patient artifacts (blob-backed) ────────── */

export const imagingStudies = pgTable("imaging_studies", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  modality: imagingModality("modality").notNull(),
  bodyPart: text("body_part"),                  // 'head', 'lumbar_spine', 'heart', ...
  studyDate: date("study_date").notNull(),
  sourceFormat: imagingSourceFormat("source_format").notNull(),
  blobPrefix: text("blob_prefix").notNull(),    // R2 prefix where files live
  manifestBlobKey: text("manifest_blob_key"),   // optional manifest.json key
  reportBlobKey: text("report_blob_key"),       // optional report PDF key
  jpegPreviewPrefix: text("jpeg_preview_prefix"), // generated previews (DICOM only)
  fileCount: integer("file_count"),
  notes: text("notes"),
  requestingDoctor: text("requesting_doctor"),  // who ordered the study (name + reg ID inline)
  performingDoctor: text("performing_doctor"),  // reporting/performing radiologist (name + reg ID inline)
  labName: text("lab_name"),                    // imaging center / clinic, original spelling
  labCity: text("lab_city"),
  labCountry: text("lab_country"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("imaging_patient_date_idx").on(t.patientId, t.studyDate)]);

export const writings = pgTable("writings", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  writtenAt: date("written_at"),
  language: text("language"), // 'en' | 'pt' | etc.
  blobKey: text("blob_key").notNull(),         // original DOCX/MD/TXT in R2
  extractedText: text("extracted_text"),       // plain-text body for FTS + LLM
  // Generated tsvector — see migration SQL for the trigger.
  // Drizzle declares it as text; the migration upgrades it to tsvector + GIN index.
  fts: text("fts"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("writings_patient_date_idx").on(t.patientId, t.writtenAt)]);

/* Catch-all for PDFs/files that don't map to a typed entity above
   (genetics report, physical assessment, raw wearable export bundles…). */
export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // 'genetics', 'physical_assessment', 'export_bundle', 'unclassified'
  title: text("title"),
  originalFilename: text("original_filename"),
  blobKey: text("blob_key").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  documentDate: date("document_date"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("documents_patient_kind_idx").on(t.patientId, t.kind),
  index("documents_patient_date_idx").on(t.patientId, t.documentDate),
]);

/* ───── 4. Self-assessment ────────────────────────── */

/* Each row is one wheel snapshot. 16 dimensions live in `scores` JSONB —
   keys match the dimension names in data/wheel_of_life.csv, values 0–10. */
export const wheelOfLifeAssessments = pgTable("wheel_of_life_assessments", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  takenOn: date("taken_on").notNull(),
  scores: jsonb("scores").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("wol_patient_date_uq").on(t.patientId, t.takenOn),
]);

/* ───── 5. Pipeline (imports) ─────────────────────── */

export const imports = pgTable("imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  initiatedBy: uuid("initiated_by").references(() => users.id, { onDelete: "set null" }),
  source: importSource("source").notNull(),
  status: importStatus("status").default("pending").notNull(),
  totalFiles: integer("total_files").default(0).notNull(),
  processedFiles: integer("processed_files").default(0).notNull(),
  failedFiles: integer("failed_files").default(0).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errors: jsonb("errors"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("imports_patient_idx").on(t.patientId)]);

export const importFiles = pgTable("import_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  importId: uuid("import_id").notNull().references(() => imports.id, { onDelete: "cascade" }),
  originalPath: text("original_path").notNull(), // path inside zip / original filename
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  blobKey: text("blob_key"),                     // where it landed in R2
  classifiedAs: text("classified_as"),           // 'medication_csv' | 'lab_pdf' | 'dicom_series' | ...
  targetTable: text("target_table"),             // which DB table got rows
  targetIds: jsonb("target_ids"),                // array of UUIDs created
  status: importFileStatus("status").default("received").notNull(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("import_files_import_idx").on(t.importId)]);

/* ───── 5b. Patient uploads (raw blobs + admin review queue) ───────────────
   Deliberately separate from imports/import_files. An `upload` is a single
   reviewable unit the patient pushed straight to R2 (a lone file OR a whole
   folder); it carries NO parse state and triggers NO ingestion. An admin
   downloads it, ingests manually on the terminal, then sets `status`. One
   `uploads` row → one or many `upload_objects` (one per physical R2 object).
   R2 key scheme: uploads/{patient_id}/{upload_id}/{relative_path}. */
export const uploads = pgTable("uploads", {
  id: uuid("id").defaultRandom().primaryKey(),
  docRef: text("doc_ref").notNull().unique(),       // short human-readable display ID (8-char base32)
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  uploaderUserId: uuid("uploader_user_id").references(() => users.id, { onDelete: "set null" }),
  originalName: text("original_name").notNull(),     // file name or top-level folder name
  kind: text("kind").notNull(),                      // 'file' | 'folder'
  r2Prefix: text("r2_prefix").notNull(),             // R2 key (single file) or key prefix (folder)
  fileCount: integer("file_count").default(0).notNull(),
  totalBytes: bigint("total_bytes", { mode: "number" }).default(0).notNull(),
  contentType: text("content_type"),                 // single files only
  status: uploadStatus("status").default("pending_review").notNull(),
  errorNote: text("error_note"),                     // admin's reason when status='data_error'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
}, (t) => [
  index("uploads_patient_created_idx").on(t.patientId, t.createdAt),
  index("uploads_status_idx").on(t.status),
]);

export const uploadObjects = pgTable("upload_objects", {
  id: uuid("id").defaultRandom().primaryKey(),
  uploadId: uuid("upload_id").notNull().references(() => uploads.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  relativePath: text("relative_path").notNull(),     // preserves folder structure
  bytes: bigint("bytes", { mode: "number" }),
  contentType: text("content_type"),
}, (t) => [index("upload_objects_upload_idx").on(t.uploadId)]);

/* ───── 6. Audit ──────────────────────────────────── */

export const auditLog = pgTable("audit_log", {
  id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),         // 'login', 'view_patient', 'create_medication', ...
  targetTable: text("target_table"),
  targetId: text("target_id"),
  patientContext: uuid("patient_context").references(() => users.id, { onDelete: "set null" }),
  ip: text("ip"),
  userAgent: text("user_agent"),
  metadata: jsonb("metadata"),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("audit_actor_at_idx").on(t.actorUserId, t.at),
  index("audit_patient_at_idx").on(t.patientContext, t.at),
]);

/* ───── 7. Mental health — psychological architecture ─ */

/* Reference table — the 13 AMPD-aligned dimensions are global, not patient-scoped.
   Seeded by db/migrations/0002_psych_dimensions_seed.sql. */
export const psychDimensions = pgTable("psych_dimensions", {
  id: text("id").primaryKey(),               // 'identity', 'self_direction', ...
  rank: integer("rank").notNull(),           // 1..13 display order
  framework: text("framework").default("AMPD").notNull(),
  nameEn: text("name_en").notNull(),
  namePt: text("name_pt"),
  blurb: text("blurb"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* One row per item in a patient's psych architecture (84 for Patient Zero).
   Re-derivable from the personal-writings corpus by an LLM pass; therefore
   stamped with `generatedBy` so we know which run produced it. */
export const psychItems = pgTable("psych_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  dimensionId: text("dimension_id").notNull().references(() => psychDimensions.id),
  legacyAnchor: text("legacy_anchor"),       // 'psych-1-3' — backward compat with HTML anchors
  title: text("title").notNull(),
  synthesis: text("synthesis").notNull(),
  rank: integer("rank"),                     // display order within dimension
  generatedAt: timestamp("generated_at", { withTimezone: true }),
  generatedBy: text("generated_by"),         // 'manual' | 'llm:opus-4-7' | ...
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("psych_items_patient_dim_idx").on(t.patientId, t.dimensionId),
  index("psych_items_legacy_anchor_idx").on(t.legacyAnchor),
]);

/* Quoted evidence drawn from a writing (or any patient document). The
   citation pair (sourceFilename, sourceParagraph) lets us round-trip
   to the on-disk corpus even if the writingId FK is later nulled out. */
export const psychEvidence = pgTable("psych_evidence", {
  id: uuid("id").defaultRandom().primaryKey(),
  psychItemId: uuid("psych_item_id").notNull().references(() => psychItems.id, { onDelete: "cascade" }),
  writingId: uuid("writing_id").references(() => writings.id, { onDelete: "set null" }),
  quote: text("quote").notNull(),
  sourceFilename: text("source_filename"),   // 'Forehead_EN.txt'
  sourceParagraph: text("source_paragraph"), // 'p0035'
  isTranslated: boolean("is_translated").default(false).notNull(),
  originalLanguage: text("original_language"), // 'pt' | 'fr' | ... when translated
  rank: integer("rank"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("psych_evidence_item_idx").on(t.psychItemId)]);

/* ───── 8. Mental health — subjective state & events ── */

export const moodEntries = pgTable("mood_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  valence: integer("valence"),               // -5..+5
  arousal: integer("arousal"),               // 0..10
  primaryEmotion: text("primary_emotion"),   // 'sadness' | 'anxiety' | 'anger' | ...
  note: text("note"),
  source: text("source").default("manual").notNull(), // 'manual' | 'app_import' | ...
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("mood_patient_ts_idx").on(t.patientId, t.ts),
  check("mood_valence_range", sql`valence is null or (valence between -5 and 5)`),
  check("mood_arousal_range", sql`arousal is null or (arousal between 0 and 10)`),
]);

export const panicEvents = pgTable("panic_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes"),
  severity: integer("severity"),             // 1..10
  triggers: text("triggers"),
  symptoms: jsonb("symptoms"),               // {tachycardia: true, sweating: true, ...}
  location: text("location"),
  preBpSys: integer("pre_bp_sys"),
  preBpDia: integer("pre_bp_dia"),
  intervention: text("intervention"),        // free-text — too long a tail for an enum
  notes: text("notes"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("panic_patient_ts_idx").on(t.patientId, t.occurredAt),
  check("panic_severity_range", sql`severity is null or (severity between 1 and 10)`),
]);

/* ───── 8b. Mental health — therapy sessions (migration 0020) ─

   Longitudinal psychotherapy ingestion. A session is the container; the child
   tables carry the analytical payload (themes, lens readings, strengths/growth,
   interventions, risk flags, quotes), each denormalising session_date for
   rolling-window queries. patient_id -> users.id per repo convention (the
   prompt's "-> patient_profiles" is overridden by the live schema).

   is_ai_inference separates interpretation (TRUE) from extracted fact (FALSE).
   therapy_risk_flags are clinician-gated at the Worker boundary — never the
   patient's own view, never the chatbot. Blobs live in EU R2; the DB stores
   the keys (source_r2_key / transcript_r2_key) only. */

export const therapyModality = pgEnum("therapy_modality", [
  "individual", "couples", "family", "group",
]);
export const therapySessionType = pgEnum("therapy_session_type", [
  "intake", "routine", "crisis", "termination", "follow_up", "assessment",
]);
export const therapySourceFormat = pgEnum("therapy_source_format", [
  "audio_recording", "video_recording", "transcript", "text_archive", "clinician_notes", "mixed",
]);
export const therapyParticipantRole = pgEnum("therapy_participant_role", [
  "therapist", "patient", "partner", "family_member", "co_therapist", "interpreter", "other",
]);
export const therapyLens = pgEnum("therapy_lens", [
  "freudian", "jungian", "lacanian", "attachment", "general_clinical",
]);
export const themeValence = pgEnum("theme_valence", [
  "positive", "negative", "neutral", "ambivalent",
]);
export const salienceLevel = pgEnum("salience_level", ["high", "medium", "low"]);
export const swPolarity = pgEnum("sw_polarity", ["strength", "growth_area"]);
export const riskType = pgEnum("risk_type", [
  "suicidality", "self_harm", "harm_to_others", "substance_use", "crisis", "safeguarding", "none",
]);
export const riskSeverity = pgEnum("risk_severity", [
  "none", "low", "moderate", "high", "imminent",
]);

export const therapySessions = pgTable("therapy_sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  sessionDate: date("session_date").notNull(),         // clinical x-axis
  sessionTime: text("session_time"),                   // 'time' column; read as text
  sessionSequence: integer("session_sequence"),
  modality: therapyModality("modality").default("individual").notNull(),
  sessionType: therapySessionType("session_type").default("routine").notNull(),
  therapistName: text("therapist_name"),
  therapistCredentials: text("therapist_credentials"),
  therapistApproach: text("therapist_approach"),
  durationMinutes: integer("duration_minutes"),
  language: text("language"),
  sourceFormat: therapySourceFormat("source_format").notNull(),
  sourceR2Key: text("source_r2_key"),
  transcriptR2Key: text("transcript_r2_key"),
  transcriptionMethod: text("transcription_method"),
  diarizationConfidence: real("diarization_confidence"),
  consentStatus: text("consent_status"),
  unDeidentified: boolean("un_deidentified").default(false).notNull(),
  sessionSummary: text("session_summary"),             // is_ai_inference TRUE
  summaryPt: text("summary_pt"),
  patientOverallAffect: text("patient_overall_affect"),
  contentHash: text("content_hash"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  sourceFileName: text("source_file_name"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("therapy_sessions_patient_date_idx").on(t.patientId, t.sessionDate),
  uniqueIndex("therapy_sessions_dedup").on(t.patientId, t.contentHash),
]);

export const therapyParticipants = pgTable("therapy_participants", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").references(() => users.id, { onDelete: "set null" }),
  role: therapyParticipantRole("role").notNull(),
  displayName: text("display_name"),
  speakerLabel: text("speaker_label"),
  attributionConfidence: real("attribution_confidence"),
  isTrackedPatient: boolean("is_tracked_patient").default(false).notNull(),
  consentOnFile: boolean("consent_on_file"),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("therapy_participants_session_idx").on(t.sessionId)]);

export const therapyThemes = pgTable("therapy_themes", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  canonicalLabel: text("canonical_label").notNull(),
  displayLabelEn: text("display_label_en"),
  displayLabelPt: text("display_label_pt"),
  category: text("category"),
  salience: salienceLevel("salience").default("medium").notNull(),
  valence: themeValence("valence").default("neutral").notNull(),
  description: text("description"),
  evidenceAnchor: text("evidence_anchor"),
  psychItemId: uuid("psych_item_id").references(() => psychItems.id, { onDelete: "set null" }),
  isAiInference: boolean("is_ai_inference").default(true).notNull(),
  sessionDate: date("session_date").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("therapy_themes_patient_date_idx").on(t.patientId, t.sessionDate),
  index("therapy_themes_patient_label_date_idx").on(t.patientId, t.canonicalLabel, t.sessionDate),
]);

export const therapyLensInterpretations = pgTable("therapy_lens_interpretations", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lens: therapyLens("lens").notNull(),
  construct: text("construct").notNull(),
  constructLabelEn: text("construct_label_en"),
  constructLabelPt: text("construct_label_pt"),
  observation: text("observation").notNull(),
  evidenceAnchor: text("evidence_anchor"),
  confidence: real("confidence"),
  isAiInference: boolean("is_ai_inference").default(true).notNull(),
  sessionDate: date("session_date").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("therapy_lens_patient_lens_date_idx").on(t.patientId, t.lens, t.sessionDate)]);

export const therapyStrengthsGrowth = pgTable("therapy_strengths_growth", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  polarity: swPolarity("polarity").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  evidenceAnchor: text("evidence_anchor"),
  confidence: real("confidence"),
  isAiInference: boolean("is_ai_inference").default(true).notNull(),
  sessionDate: date("session_date").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("therapy_strengths_patient_date_idx").on(t.patientId, t.sessionDate)]);

export const therapyInterventions = pgTable("therapy_interventions", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  interventionType: text("intervention_type").notNull(),
  description: text("description").notNull(),
  assignedToRole: therapyParticipantRole("assigned_to_role"),
  isAiInference: boolean("is_ai_inference").default(false).notNull(),
  sessionDate: date("session_date").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("therapy_interventions_patient_date_idx").on(t.patientId, t.sessionDate)]);

export const therapyRiskFlags = pgTable("therapy_risk_flags", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  riskType: riskType("risk_type").notNull(),
  severity: riskSeverity("severity").notNull(),
  description: text("description"),                    // factual; NO method/means detail
  requiresHumanReview: boolean("requires_human_review").default(true).notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  sessionDate: date("session_date").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("therapy_risk_patient_date_idx").on(t.patientId, t.sessionDate)]);

export const therapyQuotes = pgTable("therapy_quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  sessionId: uuid("session_id").notNull().references(() => therapySessions.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  speakerRole: therapyParticipantRole("speaker_role"),
  quoteText: text("quote_text").notNull(),             // SHORT, de-identified
  contextNote: text("context_note"),
  linkedThemeId: uuid("linked_theme_id").references(() => therapyThemes.id, { onDelete: "set null" }),
  isAiInference: boolean("is_ai_inference").default(false).notNull(),
  sessionDate: date("session_date").notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("therapy_quotes_patient_date_idx").on(t.patientId, t.sessionDate)]);

export const therapyPeriodDigests = pgTable("therapy_period_digests", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  topThemesJson: jsonb("top_themes_json"),
  trajectoryNote: text("trajectory_note"),             // is_ai_inference TRUE
  sessionsCount: integer("sessions_count"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
}, (t) => [index("therapy_digests_patient_period_idx").on(t.patientId, t.periodStart, t.periodEnd)]);

/* ───── 9. Clinical encounters & prescriptions ──────── */

export const encounters = pgTable("encounters", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  doctorUserId: uuid("doctor_user_id").references(() => users.id, { onDelete: "set null" }),
  doctorName: text("doctor_name"),           // for external doctors not in our users table
  doctorSpecialty: text("doctor_specialty"),
  encounterType: encounterType("encounter_type").notNull(),
  occurredOn: date("occurred_on").notNull(),
  durationMinutes: integer("duration_minutes"),
  reasonForVisit: text("reason_for_visit"),
  assessment: text("assessment"),
  plan: text("plan"),
  notes: text("notes"),
  followUpOn: date("follow_up_on"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("encounters_patient_date_idx").on(t.patientId, t.occurredOn),
  index("encounters_doctor_date_idx").on(t.doctorUserId, t.occurredOn),
]);

/* `medications` (table above) is the *current state* — what the patient is on
   right now and roughly when they started/stopped. `prescriptions` is the
   *audit trail* — every individual prescription event, who ordered it, and
   from which encounter. The two tables can coexist; one current `medications`
   row may be backed by many `prescriptions` rows over time. */
export const prescriptions = pgTable("prescriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  medicationId: uuid("medication_id").references(() => medications.id, { onDelete: "set null" }),
  drugName: text("drug_name").notNull(),     // denormalised — prescription stands alone
  prescriberUserId: uuid("prescriber_user_id").references(() => users.id, { onDelete: "set null" }),
  prescriberName: text("prescriber_name"),   // for external doctors
  encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "set null" }),
  prescribedOn: date("prescribed_on").notNull(),
  dose: text("dose").notNull(),              // '1 mg' (free-text — units vary by drug)
  route: text("route"),                      // 'oral' | 'sublingual' | 'IM' | ...
  frequency: text("frequency"),              // 'BID', 'PRN', '2x/day'
  durationDays: integer("duration_days"),
  refills: integer("refills"),
  reason: text("reason"),                    // indication
  notes: text("notes"),
  sourceBlobKey: text("source_blob_key"),    // R2 key of the prescription scan
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("prescriptions_patient_date_idx").on(t.patientId, t.prescribedOn),
  index("prescriptions_med_idx").on(t.medicationId),
  index("prescriptions_encounter_idx").on(t.encounterId),
]);

export const taperHistory = pgTable("taper_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  medicationId: uuid("medication_id").references(() => medications.id, { onDelete: "set null" }),
  drugName: text("drug_name").notNull(),     // denormalised so the row stands alone
  effectiveOn: date("effective_on").notNull(),
  doseMg: real("dose_mg"),                   // numeric — for plotting
  doseLabel: text("dose_label"),             // '35 mg/day diazepam'
  changeDirection: taperDirection("change_direction").notNull(),
  prescriberUserId: uuid("prescriber_user_id").references(() => users.id, { onDelete: "set null" }),
  encounterId: uuid("encounter_id").references(() => encounters.id, { onDelete: "set null" }),
  reason: text("reason"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("taper_patient_med_date_idx").on(t.patientId, t.medicationId, t.effectiveOn),
]);

/* ───── 10. ECG, PGx, life-event timeline ───────────── */

/* Apple Watch / Kardia / Withings ECGs are discrete events with a
   classification — fundamentally different from a multi-slice imaging study,
   so they live in their own table rather than cramming `imaging_studies`. */
export const ecgEvents = pgTable("ecg_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
  classification: ecgClassification("classification"),
  averageHr: integer("average_hr"),
  durationSeconds: integer("duration_seconds"),
  source: text("source"),                    // 'apple_watch' | 'kardia' | 'withings'
  blobKey: text("blob_key"),                 // R2 key of CSV/PDF
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("ecg_patient_ts_idx").on(t.patientId, t.recordedAt)]);

export const pgxFindings = pgTable("pgx_findings", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  gene: text("gene").notNull(),              // 'CYP2D6'
  variant: text("variant"),                  // '*1/*4'
  phenotype: text("phenotype"),              // 'Intermediate metabolizer'
  category: pgxCategory("category"),
  drugClassImpact: text("drug_class_impact"), // 'SSRIs', 'opioids', 'benzodiazepines' (long tail → text)
  recommendation: text("recommendation"),
  confidence: text("confidence"),            // 'high' | 'moderate' | 'low'
  assayName: text("assay_name"),             // 'TotalGene Panel', '23andMe', ...
  reportedOn: date("reported_on"),
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("pgx_patient_gene_idx").on(t.patientId, t.gene),
  index("pgx_patient_drug_idx").on(t.patientId, t.drugClassImpact),
]);

export const lifeEvents = pgTable("life_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  occurredOn: date("occurred_on").notNull(),
  category: lifeEventCategory("category").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  location: text("location"),
  significance: integer("significance"),     // 1..5 — for timeline weight/density
  sourceBlobKey: text("source_blob_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("life_events_patient_date_idx").on(t.patientId, t.occurredOn),
  index("life_events_patient_cat_idx").on(t.patientId, t.category),
  check("life_events_sig_range", sql`significance is null or (significance between 1 and 5)`),
]);

/* ── Reflective Portrait (migration 0017) ──────────────────────────────
   Patient-facing self-knowledge surface for patients with NO clinical
   mental-health history. NOT a clinical record: each row is a reflective
   item from the patient's own words (source='self'), a third-party account
   (source='other'), or a bounded AI synthesis (source='ai_synthesis',
   carrying confidence). Johari quadrant + bilingual content. distress_flag
   routes crisis content away from portrait render; status gates operator
   approval. See db/migrations/0017_reflective_portrait.sql. */
export const reflectiveItems = pgTable("reflective_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  itemKey: text("item_key").notNull(),                 // stable slug for idempotent re-seed
  source: text("source").notNull(),                    // self | other | ai_synthesis
  sourceMeta: jsonb("source_meta"),                    // {author_name, relationship, known_duration, entry_date, confidence}
  quadrant: text("quadrant").notNull(),                // open | blind | hidden | emerging
  category: text("category").notNull(),                // strength|growth_edge|theme|value|jungian|recommendation|question|texture
  contentEn: text("content_en").notNull(),
  contentPt: text("content_pt").notNull(),
  evidence: text("evidence"),                          // short attributed snippet
  distressFlag: boolean("distress_flag").notNull().default(false),
  sortRank: integer("sort_rank").notNull().default(0),
  status: text("status").notNull().default("approved"), // approved | held
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("reflective_items_key_uq").on(t.patientId, t.itemKey),
  index("reflective_items_patient_idx").on(t.patientId),
]);

export const reflectiveResponses = pgTable("reflective_responses", {
  id: uuid("id").defaultRandom().primaryKey(),
  itemId: uuid("item_id").notNull().references(() => reflectiveItems.id, { onDelete: "cascade" }),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  reaction: text("reaction"),                          // resonates | doesnt | note
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("reflective_responses_item_uq").on(t.itemId),
  index("reflective_responses_patient_idx").on(t.patientId),
]);
