# Database — Postgres on Neon (Frankfurt)

## Files

- `schema.ts` — Drizzle TypeScript schema (single source of truth, **31 tables** across 10 sections).
- `client.ts` — Drizzle client factories for Workers.
- `migrations/` — generated SQL migration files (drizzle-managed). Apply in order. **Do not** drop manual files in here; drizzle-kit owns the `0NNN_` numbering and will collide with hand-written ones.
- `migrations/meta/` — Drizzle's snapshot bookkeeping; do not edit by hand.
- `seeds/` — hand-written reference-data SQL. Idempotent (every seed uses `ON CONFLICT`), applied **after** schema migrations via `npm run db:seed`.

## Sections

| § | Section | Tables |
|---|---|---|
| 1 | Identity & access | users, doctor_profiles, patient_profiles, doctor_patient_links |
| 2 | Clinical structured | medications, supplements, surgeries, injuries, clinical_history, risk_assessments, lab_results, vitals_daily, glucose_points |
| 3 | Patient artifacts | imaging_studies, writings, documents |
| 4 | Self-assessment | wheel_of_life_assessments |
| 5 | Pipeline | imports, import_files |
| 6 | Audit | audit_log |
| 7 | Mental health — psych architecture | psych_dimensions, psych_items, psych_evidence |
| 8 | Mental health — subjective state & events | mood_entries, panic_events |
| 9 | Clinical encounters & prescriptions | encounters, prescriptions, taper_history |
| 10 | ECG / PGx / life-event timeline | ecg_events, pgx_findings, life_events |

## Workflow

```bash
# 1. Edit schema.ts.
# 2. Generate the next migration from the diff:
npm run db:generate

# 3. Apply pending schema migrations to the DB referenced by DATABASE_URL:
npm run db:migrate

# 4. (After migrations) apply reference-data seeds — idempotent, safe to re-run:
npm run db:seed

# Optional — open Drizzle Studio (browse the DB in a UI):
npm run db:studio
```

`db:push` is also available for fast iteration during MVP (skips the migration
file, just syncs schema to DB). Don't use it once production has data.

## Setup checklist (one-time, when Neon is ready)

1. Create the Neon project in **Frankfurt** (decided in `stack_decisions.md`).
2. Copy the **pooled** connection string from Neon's dashboard (the URL with
   `-pooler` in the host — gives you a per-Worker connection through pgbouncer).
3. Set it as a Cloudflare Pages secret:
   ```
   npx wrangler pages secret put DATABASE_URL --project-name=lumenhealth
   ```
4. Set it locally as well to run migrations from your laptop:
   ```
   echo 'DATABASE_URL="postgres://..."' >> .env
   ```
   (Add `.env` to `.gitignore` if it isn't already.)
5. Apply the initial migration:
   ```
   npm run db:migrate
   ```

The `audit_log`, `imports`, `import_files` tables are tagged for
PHI/audit handling — every PHI read/write should write a row to
`audit_log`. We're not enforcing that yet at MVP; flip it on at the
HIPAA upgrade transition.
