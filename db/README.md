# Database — Postgres on Neon (Frankfurt)

## Files

- `schema.ts` — Drizzle TypeScript schema (single source of truth, 20 tables).
- `client.ts` — Drizzle client factories for Workers.
- `migrations/` — generated SQL migration files. Apply in order.
- `migrations/meta/` — Drizzle's snapshot bookkeeping; do not edit by hand.

## Workflow

```bash
# 1. Edit schema.ts.
# 2. Generate the next migration from the diff:
npm run db:generate

# 3. Apply pending migrations to the DB referenced by DATABASE_URL:
npm run db:migrate

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
   npx wrangler pages secret put DATABASE_URL --project-name=jc-advisory-health
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
