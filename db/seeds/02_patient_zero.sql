-- Patient Zero + initial cohort.
-- Idempotent — keyed by clerk_user_id; re-running updates names/emails but
-- never duplicates rows. The 'pending:<slug>' clerk IDs are placeholders to be
-- replaced with real Clerk IDs once the Clerk integration is wired.

------------------------------------------------------------
-- Admin (system operator). Same email as the patient Joao because
-- they're the same human; once Clerk lands, this will likely become a
-- separate Clerk account or a role flag on one account.
------------------------------------------------------------
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:admin', 'joaocreste@gmail.com', 'admin', 'Admin', 'en')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  role       = EXCLUDED.role,
  updated_at = now();

------------------------------------------------------------
-- Patient: João Victor Creste
------------------------------------------------------------
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:joao', 'joaocreste@gmail.com', 'patient', 'João Victor Creste', 'en')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email      = EXCLUDED.email,
  full_name  = EXCLUDED.full_name,
  updated_at = now();

INSERT INTO patient_profiles (user_id, date_of_birth, sex, native_language, country_of_residence)
SELECT id, '1992-10-17'::date, 'male', 'pt', 'GB' FROM users WHERE clerk_user_id = 'pending:joao'
ON CONFLICT (user_id) DO UPDATE SET
  date_of_birth = EXCLUDED.date_of_birth,
  sex = EXCLUDED.sex,
  country_of_residence = EXCLUDED.country_of_residence,
  updated_at = now();

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

------------------------------------------------------------
-- Additional clinicians and family with access to João.
-- Role / relation assignments are first-pass; edit and re-seed to update.
------------------------------------------------------------

-- Eduardo Tisher (prescribing psychiatrist, São Paulo)
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:tisher', 'tisher@placeholder.local', 'doctor', 'Eduardo Tisher', 'pt')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now();
INSERT INTO doctor_profiles (user_id, specialty, license_country)
SELECT id, 'psychiatry', 'BR' FROM users WHERE clerk_user_id = 'pending:tisher'
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:tisher'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'psychiatrist'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

-- The Body Formulae (body-composition / fitness service)
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:bodyformulae', 'bodyformulae@placeholder.local', 'doctor', 'The Body Formulae', 'en')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now();
INSERT INTO doctor_profiles (user_id, specialty)
SELECT id, 'body_composition' FROM users WHERE clerk_user_id = 'pending:bodyformulae'
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:bodyformulae'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'body composition'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

-- Laercio Galvan (practitioner — role and relation provisional)
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:laercio', 'laercio@placeholder.local', 'doctor', 'Laercio Galvan', 'pt')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now();
INSERT INTO doctor_profiles (user_id, license_country)
SELECT id, 'BR' FROM users WHERE clerk_user_id = 'pending:laercio'
ON CONFLICT (user_id) DO NOTHING;
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:laercio'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'practitioner'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

-- Andre Creste (family — relation provisional)
INSERT INTO users (clerk_user_id, email, role, full_name, locale)
VALUES ('pending:andrecreste', 'andrecreste@placeholder.local', 'patient', 'Andre Creste', 'pt')
ON CONFLICT (clerk_user_id) DO UPDATE SET
  email = EXCLUDED.email, full_name = EXCLUDED.full_name, updated_at = now();
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:andrecreste'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'family'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

-- Milenne (existing user) — grant access to João (relation provisional)
INSERT INTO patient_access (user_id, patient_id, notes)
VALUES (
  (SELECT id FROM users WHERE clerk_user_id = 'pending:milenne'),
  (SELECT id FROM users WHERE clerk_user_id = 'pending:joao'),
  'family'
) ON CONFLICT (user_id, patient_id) DO NOTHING;

------------------------------------------------------------
-- Demo credentials (plaintext, temporary). Mirrors what used to live in
-- the hardcoded USERS array in web/index.html. Replaced wholesale once
-- Clerk + Google SSO are wired.
------------------------------------------------------------
UPDATE users SET demo_username = 'admin',        demo_password = '#admin3989'        WHERE clerk_user_id = 'pending:admin';
UPDATE users SET demo_username = 'joao',         demo_password = 'jcj171092'         WHERE clerk_user_id = 'pending:joao';
UPDATE users SET demo_username = 'milenne',      demo_password = 'milenne1978'       WHERE clerk_user_id = 'pending:milenne';
UPDATE users SET demo_username = 'drdimas',      demo_password = 'drdimas123'        WHERE clerk_user_id = 'pending:drdimas';
UPDATE users SET demo_username = 'ageu',         demo_password = 'ageu9203'          WHERE clerk_user_id = 'pending:ageu';
UPDATE users SET demo_username = 'tisher',       demo_password = 'tisher123'         WHERE clerk_user_id = 'pending:tisher';
UPDATE users SET demo_username = 'bodyformulae', demo_password = 'bodyformulae123'   WHERE clerk_user_id = 'pending:bodyformulae';
UPDATE users SET demo_username = 'laercio',      demo_password = 'laercio123'        WHERE clerk_user_id = 'pending:laercio';
UPDATE users SET demo_username = 'andrecreste',  demo_password = 'andrecreste6480'   WHERE clerk_user_id = 'pending:andrecreste';
