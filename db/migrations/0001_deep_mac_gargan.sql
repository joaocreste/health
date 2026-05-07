CREATE TYPE "public"."ecg_classification" AS ENUM('sinus_rhythm', 'high_heart_rate', 'low_heart_rate', 'atrial_fibrillation', 'poor_recording', 'inconclusive', 'other');--> statement-breakpoint
CREATE TYPE "public"."encounter_type" AS ENUM('in_person', 'remote', 'phone', 'er', 'admission', 'lab_followup', 'other');--> statement-breakpoint
CREATE TYPE "public"."life_event_category" AS ENUM('birth', 'move', 'marriage', 'divorce', 'job', 'education', 'hospitalization', 'diagnosis', 'loss', 'crisis', 'other');--> statement-breakpoint
CREATE TYPE "public"."pgx_category" AS ENUM('pharmacokinetic', 'pharmacodynamic', 'condition_risk', 'other');--> statement-breakpoint
CREATE TYPE "public"."taper_direction" AS ENUM('increase', 'decrease', 'hold', 'stop', 'restart');--> statement-breakpoint
CREATE TABLE "ecg_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"classification" "ecg_classification",
	"average_hr" integer,
	"duration_seconds" integer,
	"source" text,
	"blob_key" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_user_id" uuid,
	"doctor_name" text,
	"doctor_specialty" text,
	"encounter_type" "encounter_type" NOT NULL,
	"occurred_on" date NOT NULL,
	"duration_minutes" integer,
	"reason_for_visit" text,
	"assessment" text,
	"plan" text,
	"notes" text,
	"follow_up_on" date,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "life_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"category" "life_event_category" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"location" text,
	"significance" integer,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "life_events_sig_range" CHECK (significance is null or (significance between 1 and 5))
);
--> statement-breakpoint
CREATE TABLE "mood_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"valence" integer,
	"arousal" integer,
	"primary_emotion" text,
	"note" text,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mood_valence_range" CHECK (valence is null or (valence between -5 and 5)),
	CONSTRAINT "mood_arousal_range" CHECK (arousal is null or (arousal between 0 and 10))
);
--> statement-breakpoint
CREATE TABLE "panic_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer,
	"severity" integer,
	"triggers" text,
	"symptoms" jsonb,
	"location" text,
	"pre_bp_sys" integer,
	"pre_bp_dia" integer,
	"intervention" text,
	"notes" text,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "panic_severity_range" CHECK (severity is null or (severity between 1 and 10))
);
--> statement-breakpoint
CREATE TABLE "pgx_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"gene" text NOT NULL,
	"variant" text,
	"phenotype" text,
	"category" "pgx_category",
	"drug_class_impact" text,
	"recommendation" text,
	"confidence" text,
	"assay_name" text,
	"reported_on" date,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_id" uuid,
	"drug_name" text NOT NULL,
	"prescriber_user_id" uuid,
	"prescriber_name" text,
	"encounter_id" uuid,
	"prescribed_on" date NOT NULL,
	"dose" text NOT NULL,
	"route" text,
	"frequency" text,
	"duration_days" integer,
	"refills" integer,
	"reason" text,
	"notes" text,
	"source_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "psych_dimensions" (
	"id" text PRIMARY KEY NOT NULL,
	"rank" integer NOT NULL,
	"framework" text DEFAULT 'AMPD' NOT NULL,
	"name_en" text NOT NULL,
	"name_pt" text,
	"blurb" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "psych_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"psych_item_id" uuid NOT NULL,
	"writing_id" uuid,
	"quote" text NOT NULL,
	"source_filename" text,
	"source_paragraph" text,
	"is_translated" boolean DEFAULT false NOT NULL,
	"original_language" text,
	"rank" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "psych_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"dimension_id" text NOT NULL,
	"legacy_anchor" text,
	"title" text NOT NULL,
	"synthesis" text NOT NULL,
	"rank" integer,
	"generated_at" timestamp with time zone,
	"generated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "taper_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"medication_id" uuid,
	"drug_name" text NOT NULL,
	"effective_on" date NOT NULL,
	"dose_mg" real,
	"dose_label" text,
	"change_direction" "taper_direction" NOT NULL,
	"prescriber_user_id" uuid,
	"encounter_id" uuid,
	"reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ecg_events" ADD CONSTRAINT "ecg_events_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_user_id_users_id_fk" FOREIGN KEY ("doctor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "life_events" ADD CONSTRAINT "life_events_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mood_entries" ADD CONSTRAINT "mood_entries_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panic_events" ADD CONSTRAINT "panic_events_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pgx_findings" ADD CONSTRAINT "pgx_findings_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_prescriber_user_id_users_id_fk" FOREIGN KEY ("prescriber_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psych_evidence" ADD CONSTRAINT "psych_evidence_psych_item_id_psych_items_id_fk" FOREIGN KEY ("psych_item_id") REFERENCES "public"."psych_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psych_evidence" ADD CONSTRAINT "psych_evidence_writing_id_writings_id_fk" FOREIGN KEY ("writing_id") REFERENCES "public"."writings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psych_items" ADD CONSTRAINT "psych_items_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "psych_items" ADD CONSTRAINT "psych_items_dimension_id_psych_dimensions_id_fk" FOREIGN KEY ("dimension_id") REFERENCES "public"."psych_dimensions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taper_history" ADD CONSTRAINT "taper_history_patient_id_users_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taper_history" ADD CONSTRAINT "taper_history_medication_id_medications_id_fk" FOREIGN KEY ("medication_id") REFERENCES "public"."medications"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taper_history" ADD CONSTRAINT "taper_history_prescriber_user_id_users_id_fk" FOREIGN KEY ("prescriber_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taper_history" ADD CONSTRAINT "taper_history_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ecg_patient_ts_idx" ON "ecg_events" USING btree ("patient_id","recorded_at");--> statement-breakpoint
CREATE INDEX "encounters_patient_date_idx" ON "encounters" USING btree ("patient_id","occurred_on");--> statement-breakpoint
CREATE INDEX "encounters_doctor_date_idx" ON "encounters" USING btree ("doctor_user_id","occurred_on");--> statement-breakpoint
CREATE INDEX "life_events_patient_date_idx" ON "life_events" USING btree ("patient_id","occurred_on");--> statement-breakpoint
CREATE INDEX "life_events_patient_cat_idx" ON "life_events" USING btree ("patient_id","category");--> statement-breakpoint
CREATE INDEX "mood_patient_ts_idx" ON "mood_entries" USING btree ("patient_id","ts");--> statement-breakpoint
CREATE INDEX "panic_patient_ts_idx" ON "panic_events" USING btree ("patient_id","occurred_at");--> statement-breakpoint
CREATE INDEX "pgx_patient_gene_idx" ON "pgx_findings" USING btree ("patient_id","gene");--> statement-breakpoint
CREATE INDEX "pgx_patient_drug_idx" ON "pgx_findings" USING btree ("patient_id","drug_class_impact");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_date_idx" ON "prescriptions" USING btree ("patient_id","prescribed_on");--> statement-breakpoint
CREATE INDEX "prescriptions_med_idx" ON "prescriptions" USING btree ("medication_id");--> statement-breakpoint
CREATE INDEX "prescriptions_encounter_idx" ON "prescriptions" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "psych_evidence_item_idx" ON "psych_evidence" USING btree ("psych_item_id");--> statement-breakpoint
CREATE INDEX "psych_items_patient_dim_idx" ON "psych_items" USING btree ("patient_id","dimension_id");--> statement-breakpoint
CREATE INDEX "psych_items_legacy_anchor_idx" ON "psych_items" USING btree ("legacy_anchor");--> statement-breakpoint
CREATE INDEX "taper_patient_med_date_idx" ON "taper_history" USING btree ("patient_id","medication_id","effective_on");