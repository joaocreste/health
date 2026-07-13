-- 0022: Brazilian Portuguese becomes the platform default language.
-- Front-end (jc_lang), worker fallbacks and creation endpoints now default
-- to 'pt'; this aligns the schema default and migrates the legacy 'en'
-- rows that were never a deliberate choice (the column default used to be
-- 'en', so every seeded/early account carried it silently).
--
-- Deliberately kept on 'en': Leo Keller and John Smith (the English-language
-- mirror of Patient Zero; John Smith Jr is the pt-BR mirror). Any user can
-- change their own language on /account.

ALTER TABLE users ALTER COLUMN locale SET DEFAULT 'pt';

UPDATE users
SET locale = 'pt', updated_at = now()
WHERE locale = 'en'
  AND clerk_user_id NOT IN ('pending:leo-keller-a3f1c2', 'pending:john-e8fae1');
