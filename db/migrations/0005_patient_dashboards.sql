CREATE TABLE "patient_dashboards" (
  "patient_id"   uuid        NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "section"      text        NOT NULL,
  "summary_md"   text,
  "highlights"   jsonb,
  "model"        text,
  "input_tokens"  integer,
  "output_tokens" integer,
  "generated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "generated_by" uuid        REFERENCES "users"("id"),
  PRIMARY KEY ("patient_id", "section")
);

CREATE INDEX "patient_dashboards_patient_idx" ON "patient_dashboards" ("patient_id");
