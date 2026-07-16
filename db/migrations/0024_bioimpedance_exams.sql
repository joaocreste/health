-- 0024 — bioimpedance_exams + bioimpedance_segments: BIA / body-composition
-- exams (Tanita TBF-410, InBody, and similar vertical-BIA devices).
--
-- A bioimpedance exam is one point in a per-patient body-composition time
-- series: whole-body fat (relative + absolute), fat-free mass, total body
-- water, BMR, raw impedance, plus anthropometrics measured alongside it. The
-- structured columns below stay queryable rather than buried in free text; the
-- complete device print-out (every key/value as read, including the device's
-- own reference tables) is preserved verbatim in raw_extract.
--
-- DEVICE-AGNOSTIC BY DESIGN. Devices report different supersets:
--   Tanita TBF-410 — whole-body only. Reports FFM (fat-free mass = everything
--                    except fat: muscle + bone + visceral/residual). FFM is NOT
--                    skeletal muscle mass; skeletal_muscle_mass_kg stays NULL
--                    for these reports rather than being faked from FFM.
--   InBody         — the superset: adds SMM, protein, minerals, visceral fat
--                    level, and per-segment lean/fat (the child table below).
-- Every metric column is nullable so a thinner device never blocks ingestion.
--
-- Co-located spot vitals (BP, SpO2, capillary glucose) frequently share the
-- print-out but are NOT body composition — they route to vitals_daily /
-- glucose_points. Only anthropometrics (waist/hip/WHR) stay on the exam row.
--
-- Blobs (original report PDF) live in R2 and are referenced by
-- source_document_id -> documents(id); the DB never stores the binary.
--
-- FK target is users(id) — matching lab_results / imaging_studies /
-- vitals_daily / glucose_points / documents, NOT patient_profiles (whose PK is
-- user_id and which has no id column). ON DELETE CASCADE so the admin
-- hard-delete (/api/admin/patients/delete) wipes these rows with the user.
--
-- Dedupe on (patient_id, exam_date, device_manufacturer, device_model) so
-- re-ingesting the same exam is a no-op.
--
-- Hand-written idempotent SQL, matching the 0012/0016/0019 precedent (plain
-- SQL, self-applied by the ingestion path; drizzle-kit's journal lags at 0004
-- in this repo).

CREATE TABLE IF NOT EXISTS "bioimpedance_exams" (
  "id"                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"               uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "exam_date"                date NOT NULL,

  -- device
  "device_manufacturer"      text,          -- 'Tanita'
  "device_model"             text,          -- 'TBF-410'
  "body_type"                text,          -- device classification, e.g. 'ATHLETIC'

  -- subject state at measurement (as the device recorded it)
  "sex"                      sex,
  "age_years"                integer,
  "height_cm"                real,
  "weight_kg"                real,
  "bmi"                      real,
  "bmr_kcal"                 integer,
  "bmr_kj"                   integer,
  "impedance_ohms"           real,

  -- whole-body composition (every device)
  "fat_percent"              real,       -- FAT% / PBF
  "fat_mass_kg"              real,
  "ffm_kg"                   real,       -- fat-free mass (NOT muscle mass)
  "tbw_kg"                   real,       -- total body water

  -- InBody-class only (NULL for Tanita)
  "skeletal_muscle_mass_kg"  real,
  "protein_kg"               real,
  "minerals_kg"              real,
  "visceral_fat_level"       real,

  -- anthropometrics measured alongside the BIA
  "waist_circumference_cm"   real,
  "hip_circumference_cm"     real,
  "whr"                      real,

  -- provenance (clinician-ordered exam: mirrors the lab_results contract)
  "requesting_professional"  text,          -- who ordered it; NULL when not stated
  "performing_professional"  text,          -- who performed/signed (name + reg ID inline)
  "facility_name"            text,
  "facility_city"            text,
  "facility_country"         text,

  "source_document_id"       uuid REFERENCES "documents"("id"),
  "raw_extract"              jsonb,         -- verbatim device print-out, PHI excluded
  "notes"                    text,
  "created_at"               timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "bioimpedance_exam_uq"
    UNIQUE ("patient_id", "exam_date", "device_manufacturer", "device_model")
);

CREATE INDEX IF NOT EXISTS "bioimpedance_patient_date_idx"
  ON "bioimpedance_exams" ("patient_id", "exam_date");

-- Segment enums. Postgres has no CREATE TYPE IF NOT EXISTS, so guard on pg_type.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bioimpedance_segment') THEN
    CREATE TYPE "bioimpedance_segment" AS ENUM
      ('right_arm', 'left_arm', 'trunk', 'right_leg', 'left_leg');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'bioimpedance_segment_status') THEN
    CREATE TYPE "bioimpedance_segment_status" AS ENUM ('below', 'normal', 'above');
  END IF;
END $$;

-- Per-region lean/fat. Built now, populated ONLY when the device reports
-- segmental values (InBody RA/LA/TR/RL/LL). A Tanita exam legitimately has zero
-- rows here — and the presence of rows is exactly what the eventual segmental
-- render keys off, so an empty child table means "omit the section", never
-- "render an empty skeleton". Never populate this by deriving from whole-body
-- values: a device that did not measure a segment has no value for it.
CREATE TABLE IF NOT EXISTS "bioimpedance_segments" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "exam_id"         uuid NOT NULL REFERENCES "bioimpedance_exams"("id") ON DELETE CASCADE,
  "segment"         "bioimpedance_segment" NOT NULL,
  "lean_mass_kg"    real,
  "lean_pct_ideal"  real,                        -- % vs. device ideal
  "lean_status"     "bioimpedance_segment_status",  -- device-provided, else derived from lean_pct_ideal
  "fat_mass_kg"     real,
  "fat_pct_ideal"   real,
  "fat_status"      "bioimpedance_segment_status",  -- device-provided, else derived from fat_pct_ideal
  CONSTRAINT "bioimpedance_segment_uq" UNIQUE ("exam_id", "segment")
);
