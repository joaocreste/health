-- 0010 — medications: normalized daily-dose columns.
--
-- The medications table stored only a free-text `dose` (per-unit strength). The
-- medication-ingestion pipeline computes the TOTAL amount taken per day
-- (strength × units/dose × doses/day) so the Summary table and the AI-insights
-- engine can reason over it. We keep the raw per-unit `dose` and add the raw
-- `frequency` plus the computed daily total (amount + unit) ALONGSIDE it — the
-- daily dose is additive, never a replacement, so the value stays auditable.
--
-- daily_dose_amount is NULL for PRN / weekly / non-daily / needs-review meds
-- (no honest fixed daily total). Non-mass units stay in their clinical unit via
-- daily_dose_unit ('mg' | 'mcg' | 'g' | 'IU' | 'units' | 'puffs' | ...).
--
-- Hand-written idempotent SQL, matching the 0005-0009 precedent (plain SQL,
-- applied against the live DB by the ingestion script / Worker). ADD COLUMN IF
-- NOT EXISTS so re-application is a no-op.

ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "frequency"         text;
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "daily_dose_amount" real;
ALTER TABLE "medications" ADD COLUMN IF NOT EXISTS "daily_dose_unit"   text;
