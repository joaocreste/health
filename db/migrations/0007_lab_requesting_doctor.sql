ALTER TABLE "lab_results"
  ADD COLUMN IF NOT EXISTS "requesting_doctor" text;
