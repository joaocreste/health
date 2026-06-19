-- 0017 — reflective_items + reflective_responses: the patient-facing
-- "Reflective Portrait" mental surface for patients with NO clinical
-- mental-health history.
--
-- This is NOT a clinical record. Each row is a reflective item drawn from a
-- patient's own writing (source='self'), a third-party account from someone
-- close to them (source='other', attributed in source_meta), or a bounded AI
-- synthesis over that text (source='ai_synthesis', always carrying a
-- confidence). The Johari quadrant (open|blind|hidden|emerging) falls out of
-- which sources name a thing. content is stored bilingually (en + pt). No
-- diagnosis, no ICD/CID codes — guarded at the application layer too.
--
-- distress_flag marks self-harm / suicidal / abuse / acute-crisis content,
-- which the renderer must route to a human/resource path and NEVER show as a
-- tidy portrait item. status gates operator approval: only 'approved' rows
-- render; 'held' rows are staged but invisible.
--
-- reflective_responses is the patient's right-to-respond: a patient (or admin)
-- may react to any item (resonates | doesnt | note) — one current response per
-- item (upsert on item_id). Reading others' views of you without recourse is
-- the failure mode this table prevents.
--
-- Hand-written idempotent SQL, self-applied by the ingest script / Worker,
-- matching the 0016 ergometric precedent. patient_id cascades for GDPR-clean
-- deletion.

CREATE TABLE IF NOT EXISTS "reflective_items" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "patient_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "item_key"      text NOT NULL,                       -- stable slug for idempotent re-seed
  "source"        text NOT NULL,                        -- self | other | ai_synthesis
  "source_meta"   jsonb,                                -- {author_name, relationship, known_duration, entry_date, confidence}
  "quadrant"      text NOT NULL,                        -- open | blind | hidden | emerging
  "category"      text NOT NULL,                        -- strength|growth_edge|theme|value|jungian|recommendation|question|texture
  "content_en"    text NOT NULL,
  "content_pt"    text NOT NULL,
  "evidence"      text,                                 -- short attributed snippet
  "distress_flag" boolean NOT NULL DEFAULT false,
  "sort_rank"     integer NOT NULL DEFAULT 0,
  "status"        text NOT NULL DEFAULT 'approved',     -- approved | held
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reflective_items_key_uq" UNIQUE ("patient_id", "item_key")
);

CREATE INDEX IF NOT EXISTS "reflective_items_patient_idx"
  ON "reflective_items" ("patient_id");

CREATE TABLE IF NOT EXISTS "reflective_responses" (
  "id"          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "item_id"     uuid NOT NULL REFERENCES "reflective_items"("id") ON DELETE CASCADE,
  "patient_id"  uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "reaction"    text,                                   -- resonates | doesnt | note
  "note"        text,
  "created_at"  timestamptz NOT NULL DEFAULT now(),
  "updated_at"  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reflective_responses_item_uq" UNIQUE ("item_id")
);

CREATE INDEX IF NOT EXISTS "reflective_responses_patient_idx"
  ON "reflective_responses" ("patient_id");
