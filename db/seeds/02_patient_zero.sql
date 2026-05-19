-- Patient Zero + initial cohort.
-- Idempotent — keyed by clerk_user_id; re-running updates names/emails but
-- never duplicates rows. The 'pending:<slug>' clerk IDs are placeholders to be
-- replaced with real Clerk IDs once the Clerk integration is wired.

------------------------------------------------------------
-- Patient: João Victor Creste
------------------------------------------------------------
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:joao', 'joaocreste@gmail.com', 'patient', 'João Victor Creste', 'en')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  updated_at = now();

INSERT INTO patient_profiles (user_id, native_language, country_of_residence)
SELECT id, 'pt', 'BR' FROM users WHERE clerk_user_id = 'pending:joao'
ON CONFLICT (user_id) DO NOTHING;

------------------------------------------------------------
-- Patient: Milenne
------------------------------------------------------------
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:milenne', 'milenne@placeholder.local', 'patient', 'Milenne', 'pt')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  updated_at = now();

INSERT INTO patient_profiles (user_id, native_language)
SELECT id, 'pt' FROM users WHERE clerk_user_id = 'pending:milenne'
ON CONFLICT (user_id) DO NOTHING;

------------------------------------------------------------
-- Doctor: Dr. Dimas (primary care)
------------------------------------------------------------
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:drdimas', 'drdimas@placeholder.local', 'doctor', 'Dr. Dimas', 'pt')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  updated_at = now();

INSERT INTO doctor_profiles (user_id, specialty, license_country)
SELECT id, 'general_practice', 'BR' FROM users WHERE clerk_user_id = 'pending:drdimas'
ON CONFLICT (user_id) DO NOTHING;

------------------------------------------------------------
-- Therapist: Ageu (psychotherapy specialty under 'doctor' role)
------------------------------------------------------------
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:ageu', 'ageu@placeholder.local', 'doctor', 'Ageu', 'pt')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  updated_at = now();

INSERT INTO doctor_profiles (user_id, specialty, license_country)
SELECT id, 'psychotherapy', 'BR' FROM users WHERE clerk_user_id = 'pending:ageu'
ON CONFLICT (user_id) DO NOTHING;

------------------------------------------------------------
-- Access rows: one row per (user, patient) pair.
-- Self-access is just (user_id = patient_id). No relationship kind tracked
-- at the row level — users.role gates UX; this table is purely "who can
-- see whose data".
------------------------------------------------------------

-- Self-access: every patient sees themselves
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'self'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:milenne'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:milenne'),
  'self'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

-- Clinical access to Joao
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:drdimas'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'primary care physician'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:ageu'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'psychotherapist'
) ON CONFLICT (user_id, patient_id) DO NOTHING;
