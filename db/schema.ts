/**
 * JC Advisory Health — Postgres schema (Drizzle).
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
export const linkRole = pgEnum("doctor_patient_role", [
  "primary", "specialist", "consulting",
]);
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

export const doctorPatientLinks = pgTable(
  "doctor_patient_links",
  {
    doctorId: uuid("doctor_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: linkRole("role").default("specialist").notNull(),
    since: date("since").defaultNow().notNull(),
    until: date("until"),
    active: boolean("active").default(true).notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.doctorId, t.patientId] }),
    index("dpl_patient_idx").on(t.patientId),
    index("dpl_active_idx").on(t.active),
  ],
);

/* ───── 2. Clinical structured data ───────────────── */

export const medications = pgTable("medications", {
  id: uuid("id").defaultRandom().primaryKey(),
  patientId: uuid("patient_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  dose: text("dose"),
  drugClass: text("drug_class"),
  status: text("status"), // 'active' | 'discontinued' | 'paused' — free-text for ingest flexibility
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
  laboratory: text("laboratory"),
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
  source: text("source").notNull(), // 'oura' | 'withings' | 'apple_health' | 'manual'
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
