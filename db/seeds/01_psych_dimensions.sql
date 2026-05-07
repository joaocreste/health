-- Seed the 13 AMPD-aligned psychological dimensions.
-- These are reference values, identical for every patient — see psych_items
-- for the patient-scoped synthesis derived from each one.
--
-- Source: psych-dimensions.txt (committed at the project root).
-- Idempotent via ON CONFLICT — safe to re-run during dev, no-op once seeded.

INSERT INTO "psych_dimensions" ("id", "rank", "framework", "name_en", "name_pt", "blurb") VALUES
  ('identity',     1,  'AMPD', 'Identity',                    'Identidade',
   'Continuity of self, ego-ideals, reference selves, and identity ruptures.'),
  ('self_direction', 2, 'AMPD', 'Self-direction',             'Autodireção',
   'Goals, longings, what the patient wants to build or recover, and the agency carried in language.'),
  ('empathy',      3,  'AMPD', 'Empathy',                     'Empatia',
   'Capacity to take the perspective of others and respond to their emotional states.'),
  ('intimacy',     4,  'AMPD', 'Intimacy',                    'Intimidade',
   'Capacity for vulnerable disclosure, structural loneliness, and the framing of sexuality.'),
  ('emotional_regulation', 5, 'AMPD', 'Emotional regulation', 'Regulação emocional',
   'Triggers, body-state escalation pathways, anger destinations, and grandiosity-collapse cycles.'),
  ('attachment_style', 6, 'AMPD', 'Attachment style',         'Estilo de apego',
   'Father, mother, and partner imagos; the marital narrative and pattern of partner choice.'),
  ('core_beliefs', 7,  'AMPD', 'Core beliefs',                'Crenças centrais',
   'Fears named and unnamed; image of God, sin/failure/illness language, recurring spiritual anchors.'),
  ('defense_mechanisms', 8, 'AMPD', 'Defense mechanisms',     'Mecanismos de defesa',
   'Anesthesia engine, intellectualization, rationalization, splitting, sublimation, avoidance, magical thinking.'),
  ('trait_profile', 9, 'AMPD', 'Trait profile',               'Perfil de traços',
   'Linguistic and cognitive signatures: tense, voice, pronoun shifts, code-switching, fragmentation, metaphor.'),
  ('interpersonal_patterns', 10, 'AMPD', 'Interpersonal patterns', 'Padrões interpessoais',
   'Envy and competition, manipulation patterns, recruiting helpers into protective rather than challenging roles.'),
  ('developmental_trauma', 11, 'AMPD', 'Developmental trauma', 'Trauma de desenvolvimento',
   'Family-of-origin environment, migration arc, inherited scripts, sibling dynamics, national identity.'),
  ('current_functioning', 12, 'AMPD', 'Current functioning',  'Funcionamento atual',
   'Somatic baseline: how the body is described, pain language, weight/hair/posture, body-decline ↔ self-worth.'),
  ('risk_protective', 13, 'AMPD', 'Risk / protective factors', 'Fatores de risco / proteção',
   'Hopelessness register, self-harm patterns, what stops the patient, help-seeking; balanced against precision of self-awareness, articulacy, discipline, honest disclosure, spiritual depth, capacity for love, aesthetic sensitivity.')
ON CONFLICT ("id") DO UPDATE SET
  "rank"      = EXCLUDED."rank",
  "framework" = EXCLUDED."framework",
  "name_en"   = EXCLUDED."name_en",
  "name_pt"   = EXCLUDED."name_pt",
  "blurb"     = EXCLUDED."blurb";
