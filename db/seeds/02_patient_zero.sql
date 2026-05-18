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
-- Doctor ↔ patient links (both currently anchored to Joao)
------------------------------------------------------------
INSERT INTO doctor_patient_links (doctor_id, patient_id, role, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:drdimas'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'primary'::doctor_patient_role,
  'Primary care physician'
)
ON CONFLICT (doctor_id, patient_id) DO UPDATE SET
  role   = EXCLUDED.role,
  active = true;

INSERT INTO doctor_patient_links (doctor_id, patient_id, role, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:ageu'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'specialist'::doctor_patient_role,
  'Psychotherapist'
)
ON CONFLICT (doctor_id, patient_id) DO UPDATE SET
  role   = EXCLUDED.role,
  active = true;
