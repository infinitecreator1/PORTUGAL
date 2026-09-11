# Database migrations

Plain SQL files applied in filename order by `packages/db/src/migrate.ts`.

```sh
pnpm db:migrate                 # uses DATABASE_URL from the environment / .env
DATABASE_URL=postgres://... pnpm --filter @imovel/db run migrate
```

Each file runs inside one transaction and is recorded in `public.schema_migrations(name, applied_at)`;
files already recorded are skipped, so the command is safe to run on every deploy.

## Writing a migration

1. Change `src/schema.ts` (the Drizzle definitions the repositories query through).
2. Add `migrations/NNNN_<slug>.sql` with the matching DDL. Prefer `create table if not exists`,
   `create index if not exists`, `drop policy if exists` + `create policy` so a partially applied
   file can be re-run by hand.
3. `pnpm test packages/db` — `migrations.test.ts` checks that every `pgTable` in `schema.ts` has a
   `create table` statement across the migrations and vice versa, that every table has
   `enable row level security`, and that `has_tenant_role()` is defined.

`pnpm db:generate` runs `drizzle-kit generate`, which diffs `schema.ts` against the database
configured in `drizzle.config.ts` and writes a proposal into this folder. Treat that output as a
review aid: fold the statements you want into a hand-numbered migration and delete the generated
file, because drizzle-kit cannot express the RLS policies, the `tenant_role` enum ordering or the
`has_tenant_role()` function that `0001_init.sql` sets up.

## Supabase

The same files apply to a Supabase project:

- `supabase db push` after copying (or symlinking) them into `infra/supabase/migrations/`, or
- `pnpm db:migrate` with `DATABASE_URL` pointing at the project's direct connection string
  (port 5432, not the transaction pooler; the migration runner uses multi-statement queries).

`0001_init.sql` assumes Supabase's `auth.uid()` function and the `authenticated` / `anon` roles.
On a plain Postgres (docker-compose, CI) it creates minimal shims for them so the policies compile.

Role model:

- `service_role` (the `DATABASE_URL` the API and worker use) bypasses RLS. Repositories always
  filter by `tenant_id` explicitly.
- `authenticated` (dashboard users with a Supabase JWT) is constrained by `has_tenant_role(auth.uid(),
  tenant_id, <role>)`: `viewer` to select, `editor` to insert/update, `admin` to delete, `owner` to
  manage `tenant_members`.
- `anon` has no policies: denied by default.

pg-boss keeps its own tables in the `pgboss` schema and migrates itself on `start()`.
