-- 0023 — patient_access.view_mode (doctor consultation view)
--
-- A grant now carries HOW the granted viewer experiences the patient's record,
-- not just WHAT they can see:
--   'navigation' (default) — the normal multi-page app (topnav pillars).
--   'scroll'               — the /consult page: one continuous scrolling view
--                            containing only the granted sections/exams, no
--                            site navigation. The static gate 302s a
--                            scroll-granted viewer off every nav page, so the
--                            two modes are mutually exclusive per grant.
-- Value validation lives in the Worker (/api/admin/access), matching how
-- `scopes` is validated — the DB stores text.
--
-- Applied by scripts/apply-0023-view-mode.mjs (drizzle-kit journal lags at
-- 0004 in this repo; hand-written migrations are self-applied). Idempotent.

ALTER TABLE patient_access
  ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'navigation';
