ALTER TABLE "patient_dashboards"
  ADD COLUMN IF NOT EXISTS "cards_json" jsonb;
