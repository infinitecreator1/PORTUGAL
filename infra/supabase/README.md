# Supabase

The pipeline uses a Supabase project for Postgres (with row-level security) and Storage (over the S3 protocol).

## Database

Migrations live in `packages/db/migrations/*.sql` and are applied by `pnpm db:migrate` against `DATABASE_URL`. To use the Supabase CLI instead, copy them into `supabase/migrations/` of a linked project and run `supabase db push`. The SQL creates every table, the `tenant_role` enum, `has_tenant_role()` and the RLS policies. The service role key (used by the API and worker) bypasses RLS; both always filter by `tenant_id` explicitly.

Connection string: Project Settings → Database → Connection string (use the session pooler on port 5432 for pg-boss, which needs `LISTEN`/long transactions).

## Storage

Create a private bucket `pipeline-artifacts`. Enable S3 access under Project Settings → Storage → S3 connection and create an access key. Set in `.env`:

```
STORAGE_PROVIDER=supabase-s3
SUPABASE_S3_ENDPOINT=https://<project-ref>.supabase.co/storage/v1/s3
SUPABASE_S3_REGION=<project region, e.g. eu-west-1>
SUPABASE_S3_ACCESS_KEY_ID=...
SUPABASE_S3_SECRET_ACCESS_KEY=...
SUPABASE_S3_BUCKET=pipeline-artifacts
```

Audio and JSON artefacts are stored at `{tenant}/listings/{listing}/jobs/{job}/…` and served through one-hour signed URLs.
