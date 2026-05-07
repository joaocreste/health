CREATE TYPE "public"."imaging_modality" AS ENUM('MRI', 'CT', 'PET', 'US', 'XR', 'EEG', 'ECG', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."imaging_source_format" AS ENUM('DICOM', 'JPEG', 'PNG', 'MIXED');--> statement-breakpoint
CREATE TYPE "public"."import_file_status" AS ENUM('received', 'classified', 'parsed', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."import_source" AS ENUM('self_zip', 'self_files', 'admin_upload', 'migration');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('pending', 'uploading', 'processing', 'completed', 'failed', 'partial');--> statement-breakpoint
CREATE TYPE "public"."doctor_patient_role" AS ENUM('primary', 'specialist', 'consulting');--> statement-breakpoint
CREATE TYPE "public"."sex" AS ENUM('male', 'female', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'doctor', 'patient');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "audit_log_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"target_table" text,
	"target_id" text,
	"patient_context" uuid,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clinical_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"category" text NOT NULL,
	"heading" text NOT NULL,
	"detail" text,
	"occurred_on" date,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_patient_links" (
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"role" "doctor_patient_role" DEFAULT 'specialist' NOT NULL,
	"since" date DEFAULT now() NOT NULL,
	"until" date,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctor_patient_links_doctor_id_patient_id_pk" PRIMARY KEY("doctor_id","patient_id")
);
--> statement-breakpoint
CREATE TABLE "doctor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"specialty" text,
	"license_no" text,
	"license_country" text,
	"bio" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text,
	"original_filename" text,
	"blob_key" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"document_date" date,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glucose_points" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "glucose_points_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"patient_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"mg_dl" real NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "imaging_studies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"modality" "imaging_modality" NOT NULL,
	"body_part" text,
	"study_date" date NOT NULL,
	"source_format" "imaging_source_format" NOT NULL,
	"blob_prefix" text NOT NULL,
	"manifest_blob_key" text,
	"report_blob_key" text,
	"jpeg_preview_prefix" text,
	"file_count" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"import_id" uuid NOT NULL,
	"original_path" text NOT NULL,
	"mime_type" text,
	"size_bytes" bigint,
	"blob_key" text,
	"classified_as" text,
	"target_table" text,
	"target_ids" jsonb,
	"status" "import_file_status" DEFAULT 'received' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"initiated_by" uuid,
	"source" "import_source" NOT NULL,
	"status" "import_status" DEFAULT 'pending' NOT NULL,
	"total_files" integer DEFAULT 0 NOT NULL,
	"processed_files" integer DEFAULT 0 NOT NULL,
	"failed_files" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"errors" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "injuries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"occurred_on" date,
	"notes" text,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"panel" text,
	"marker" text NOT NULL,
	"value" real,
	"value_text" text,
	"unit" text,
	"ref_low" real,
	"ref_high" real,
	"flag" text,
	"taken_at" date NOT NULL,
	"laboratory" text,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"drug_class" text,
	"status" text,
	"note" text,
	"started_at" date,
	"ended_at" date,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"date_of_birth" date,
	"sex" "sex",
	"height_cm" real,
	"weight_kg" real,
	"blood_type" text,
	"native_language" text,
	"country_of_residence" text,
	"emergency_contact" jsonb,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"dose" text,
	"started_at" date,
	"ended_at" date,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "surgeries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"name" text NOT NULL,
	"performed_on" date,
	"notes" text,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text NOT NULL,
	"email" text NOT NULL,
	"role" "user_role" NOT NULL,
	"locale" text DEFAULT 'en' NOT NULL,
	"full_name" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "vitals_daily" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"day" date NOT NULL,
	"source" text NOT NULL,
	"steps" integer,
	"calories_active" integer,
	"calories_passive" integer,
	"hrv_ms" real,
	"resting_hr" real,
	"sleep_minutes" integer,
	"deep_sleep_minutes" integer,
	"rem_sleep_minutes" integer,
	"spo2_pct" real,
	"weight_kg" real,
	"blood_pressure_sys" integer,
	"blood_pressure_dia" integer,
	"extras" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wheel_of_life_assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"taken_on" date NOT NULL,
	"scores" jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "writings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"title" text NOT NULL,
	"written_at" date,
	"language" text,
	"blob_key" text NOT NULL,
	"extracted_text" text,
	"fts" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_patient_context_users_id_fk" FOREIGN KEY ("patient_context") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clinical_history" ADD CONSTRAINT "clinical_history_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_patient_links" ADD CONSTRAINT "doctor_patient_links_doctor_id_users_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_patient_links" ADD CONSTRAINT "doctor_patient_links_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glucose_points" ADD CONSTRAINT "glucose_points_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imaging_studies" ADD CONSTRAINT "imaging_studies_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_import_id_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imports" ADD CONSTRAINT "imports_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "injuries" ADD CONSTRAINT "injuries_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medications" ADD CONSTRAINT "medications_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_profiles" ADD CONSTRAINT "patient_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplements" ADD CONSTRAINT "supplements_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "surgeries" ADD CONSTRAINT "surgeries_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals_daily" ADD CONSTRAINT "vitals_daily_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wheel_of_life_assessments" ADD CONSTRAINT "wheel_of_life_assessments_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writings" ADD CONSTRAINT "writings_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_actor_at_idx" ON "audit_log" USING btree ("actor_user_id","at");--> statement-breakpoint
CREATE INDEX "audit_patient_at_idx" ON "audit_log" USING btree ("patient_context","at");--> statement-breakpoint
CREATE INDEX "clinical_history_patient_idx" ON "clinical_history" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "dpl_patient_idx" ON "doctor_patient_links" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "dpl_active_idx" ON "doctor_patient_links" USING btree ("active");--> statement-breakpoint
CREATE INDEX "documents_patient_kind_idx" ON "documents" USING btree ("patient_id","kind");--> statement-breakpoint
CREATE INDEX "documents_patient_date_idx" ON "documents" USING btree ("patient_id","document_date");--> statement-breakpoint
CREATE UNIQUE INDEX "glucose_patient_ts_uq" ON "glucose_points" USING btree ("patient_id","ts");--> statement-breakpoint
CREATE INDEX "glucose_patient_ts_idx" ON "glucose_points" USING btree ("patient_id","ts");--> statement-breakpoint
CREATE INDEX "imaging_patient_date_idx" ON "imaging_studies" USING btree ("patient_id","study_date");--> statement-breakpoint
CREATE INDEX "import_files_import_idx" ON "import_files" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "imports_patient_idx" ON "imports" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "injuries_patient_idx" ON "injuries" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "lab_patient_taken_idx" ON "lab_results" USING btree ("patient_id","taken_at");--> statement-breakpoint
CREATE INDEX "lab_patient_marker_idx" ON "lab_results" USING btree ("patient_id","marker");--> statement-breakpoint
CREATE INDEX "medications_patient_idx" ON "medications" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "risk_patient_kind_idx" ON "risk_assessments" USING btree ("patient_id","kind");--> statement-breakpoint
CREATE INDEX "supplements_patient_idx" ON "supplements" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "surgeries_patient_idx" ON "surgeries" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE UNIQUE INDEX "vitals_patient_day_source_uq" ON "vitals_daily" USING btree ("patient_id","day","source");--> statement-breakpoint
CREATE INDEX "vitals_patient_day_idx" ON "vitals_daily" USING btree ("patient_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "wol_patient_date_uq" ON "wheel_of_life_assessments" USING btree ("patient_id","taken_on");--> statement-breakpoint
CREATE INDEX "writings_patient_date_idx" ON "writings" USING btree ("patient_id","written_at");