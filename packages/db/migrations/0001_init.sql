-- 0001_init.sql — initial schema for Imóvel em Voz.
--
-- Keep in sync with packages/db/src/schema.ts (a test checks table names both ways).
-- Applied by `pnpm db:migrate` (packages/db/src/migrate.ts) inside one transaction and
-- recorded in public.schema_migrations. Idempotent where Postgres allows it.
--
-- Security model
-- --------------
-- * Every tenant-scoped table carries tenant_id and has row level security enabled.
-- * The `authenticated` role (Supabase dashboard users, JWT) is limited by policies built on
--   public.has_tenant_role(auth.uid(), tenant_id, <min role>): viewer to read, editor to
--   insert/update, admin to delete. tenant_members rows are readable by their own user.
-- * The `anon` role has no policies at all, so with RLS enabled it is denied by default.
-- * The service role (what apps/api and apps/worker use through DATABASE_URL) BYPASSES RLS.
--   That is why every repository method in packages/db/src/repos/postgres.ts filters by
--   tenant_id explicitly; RLS is defence in depth for the dashboard, not the worker's isolation.
-- * has_tenant_role() is SECURITY DEFINER with a pinned search_path so it can read
--   tenant_members regardless of the caller's own policies (same pattern as has_role() in the
--   pulse-robot-template migration 20251029012057).

-- ---------------------------------------------------------------------------
-- Compatibility shims for plain Postgres (no-ops on Supabase, where these exist)
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'uid'
  ) then
    create schema if not exists auth;
    -- Mirrors Supabase: the `sub` claim of the request JWT, or null.
    create function auth.uid() returns uuid
    language sql stable
    as $f$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $f$;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Roles and the tenant membership check used by every policy
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'tenant_role') then
    create type public.tenant_role as enum ('owner', 'admin', 'editor', 'viewer');
  end if;
end $$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  allow_third_party_generation boolean not null default false,
  legal_signoff_at timestamptz,
  terms_accepted_at timestamptz,
  budget_soft_usd double precision,
  budget_hard_usd double precision,
  created_at timestamptz not null default now()
);

create table if not exists public.tenant_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  role public.tenant_role not null default 'viewer',
  created_at timestamptz not null default now()
);
create unique index if not exists tenant_members_user_tenant_uq on public.tenant_members (user_id, tenant_id);
create index if not exists tenant_members_tenant_idx on public.tenant_members (tenant_id);

-- Role ordering: viewer < editor < admin < owner. The enum is declared owner-first for
-- readability, so ordering is explicit here rather than relying on enum comparison.
create or replace function public.has_tenant_role(_user_id uuid, _tenant_id uuid, _min_role public.tenant_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_members m
    where m.user_id = _user_id
      and m.tenant_id = _tenant_id
      and array_position(array['viewer', 'editor', 'admin', 'owner']::public.tenant_role[], m.role)
          >= array_position(array['viewer', 'editor', 'admin', 'owner']::public.tenant_role[], _min_role)
  )
$$;

revoke all on function public.has_tenant_role(uuid, uuid, public.tenant_role) from public;
grant execute on function public.has_tenant_role(uuid, uuid, public.tenant_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table if not exists public.tenant_agencies (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,
  agency_id text not null,
  agency_name text,
  created_at timestamptz not null default now(),
  constraint tenant_agencies_pkey primary key (tenant_id, source, agency_id)
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  prefix text not null,
  key_hash text not null unique,
  scopes jsonb not null default '["*"]'::jsonb,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists api_keys_tenant_idx on public.api_keys (tenant_id);

create table if not exists public.webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  url text not null,
  secret text not null,
  events jsonb not null default '[]'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists webhooks_tenant_idx on public.webhooks (tenant_id);

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  webhook_id uuid not null references public.webhooks(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists webhook_deliveries_webhook_idx on public.webhook_deliveries (webhook_id);
create index if not exists webhook_deliveries_status_next_idx on public.webhook_deliveries (status, next_attempt_at);

create table if not exists public.saved_searches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,
  query jsonb not null default '{}'::jsonb,
  cron text not null default '0 6 * * *',
  enabled boolean not null default true,
  max_pages integer not null default 10,
  max_credits_per_run integer not null default 500,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists saved_searches_tenant_idx on public.saved_searches (tenant_id);

create table if not exists public.ingest_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  saved_search_id uuid references public.saved_searches(id) on delete set null,
  source text not null,
  status text not null,
  page integer not null default 0,
  next_cursor text,
  items_seen integer not null default 0,
  items_new integer not null default 0,
  items_changed integer not null default 0,
  credits_used double precision not null default 0,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists ingest_runs_tenant_idx on public.ingest_runs (tenant_id);
create index if not exists ingest_runs_saved_search_idx on public.ingest_runs (saved_search_id);

-- ---------------------------------------------------------------------------
-- Listings
-- ---------------------------------------------------------------------------

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  source text not null,
  source_id text not null,
  source_url text,
  ownership text not null default 'third_party',
  consent_ref text,
  transaction text not null,
  property_type text not null,
  typology text,
  price double precision,
  currency text not null default 'EUR',
  price_period text,
  area jsonb not null default '{}'::jsonb,
  floor text,
  year_built integer,
  bathrooms integer,
  condition text,
  location jsonb not null,
  features jsonb not null default '[]'::jsonb,
  features_raw jsonb not null default '[]'::jsonb,
  energy_certificate text,
  photos jsonb not null default '[]'::jsonb,
  agent jsonb not null default '{}'::jsonb,
  description_original text,
  language_original text,
  raw_ref text,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  content_hash text not null,
  fingerprint text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists listings_tenant_source_uq on public.listings (tenant_id, source, source_id);
create index if not exists listings_tenant_idx on public.listings (tenant_id);
create index if not exists listings_fingerprint_idx on public.listings (fingerprint);
create index if not exists listings_content_hash_idx on public.listings (content_hash);
create index if not exists listings_tenant_created_idx on public.listings (tenant_id, created_at, id);

create table if not exists public.listing_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  content_hash text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists listing_versions_listing_idx on public.listing_versions (listing_id, created_at);

create table if not exists public.listing_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  group_id uuid not null,
  listing_id uuid not null references public.listings(id) on delete cascade,
  canonical boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists listing_groups_listing_uq on public.listing_groups (listing_id);
create index if not exists listing_groups_group_idx on public.listing_groups (group_id);

-- ---------------------------------------------------------------------------
-- Profiles
-- ---------------------------------------------------------------------------

create table if not exists public.generation_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  model text not null default 'gemini-2.5-pro',
  temperature double precision not null default 0.7,
  target_length text not null default 'media',
  tone text not null default 'profissional',
  audience text not null default 'compradores',
  brand_name text,
  brand_voice_notes text,
  cta_template text,
  use_photo_insights boolean not null default false,
  forbidden_claims jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists generation_profiles_tenant_idx on public.generation_profiles (tenant_id);

create table if not exists public.voice_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  name text not null,
  provider text not null,
  voice_ref text,
  reference_audio_key text,
  reference_transcript text,
  style_prompt text not null,
  language_code text not null default 'pt-PT',
  speaking_rate double precision not null default 1.0,
  seed integer not null default 42,
  cfg_value double precision not null default 2.0,
  inference_timesteps integer not null default 10,
  glossary jsonb not null default '{}'::jsonb,
  consent_doc_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists voice_profiles_tenant_idx on public.voice_profiles (tenant_id);

-- ---------------------------------------------------------------------------
-- Pipeline
-- ---------------------------------------------------------------------------

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  listing_version_id uuid references public.listing_versions(id) on delete set null,
  generation_profile_id uuid not null references public.generation_profiles(id),
  voice_profile_id uuid references public.voice_profiles(id),
  status text not null default 'queued',
  loop integer not null default 0,
  attempt integer not null default 0,
  current_step text,
  idempotency_key text not null unique,
  require_audio boolean not null default true,
  pipeline_version text,
  last_error jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists jobs_tenant_status_idx on public.jobs (tenant_id, status);
create index if not exists jobs_listing_idx on public.jobs (listing_id);

create table if not exists public.job_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  step text not null,
  attempt integer not null default 0,
  status text not null,
  input_hash text,
  output_ref text,
  error jsonb,
  usage jsonb not null default '{}'::jsonb,
  cost_usd double precision not null default 0,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists job_steps_job_idx on public.job_steps (job_id, started_at);

create table if not exists public.generations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  attempt integer not null default 0,
  loop integer not null default 0,
  model text not null,
  provider text not null,
  result jsonb not null,
  usage jsonb not null default '{}'::jsonb,
  latency_ms double precision not null default 0,
  text_hash text not null,
  created_at timestamptz not null default now()
);
create index if not exists generations_job_idx on public.generations (job_id, created_at);
create index if not exists generations_text_hash_idx on public.generations (text_hash);

create table if not exists public.gate_reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  generation_id uuid not null references public.generations(id) on delete cascade,
  loop integer not null default 0,
  attempt integer not null default 0,
  editor text not null,
  decision text not null,
  judge_score double precision,
  report jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists gate_reports_job_idx on public.gate_reports (job_id, created_at);
create index if not exists gate_reports_decision_idx on public.gate_reports (tenant_id, decision);

create table if not exists public.narrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  generation_id uuid not null references public.generations(id) on delete cascade,
  voice_profile_id uuid not null references public.voice_profiles(id),
  provider text not null,
  text_hash text not null,
  duration_s double precision not null default 0,
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists narrations_job_idx on public.narrations (job_id, created_at);

create table if not exists public.outputs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  generation_id uuid not null references public.generations(id),
  gate_report_id uuid not null references public.gate_reports(id),
  sections jsonb not null,
  narration jsonb,
  ai_generated boolean not null default true,
  warnings jsonb not null default '[]'::jsonb,
  published_at timestamptz not null default now()
);
create index if not exists outputs_listing_published_idx on public.outputs (tenant_id, listing_id, published_at);
create index if not exists outputs_job_idx on public.outputs (job_id);

create table if not exists public.review_queue (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  reason text not null,
  gate_report_id uuid references public.gate_reports(id) on delete set null,
  status text not null default 'open',
  edited_sections jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists review_queue_tenant_status_idx on public.review_queue (tenant_id, status, created_at);
create index if not exists review_queue_job_idx on public.review_queue (job_id);

-- ---------------------------------------------------------------------------
-- Cost
-- ---------------------------------------------------------------------------

create table if not exists public.cost_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  step text not null,
  provider text not null,
  model text,
  input_tokens integer,
  output_tokens integer,
  reasoning_tokens integer,
  chars integer,
  gpu_seconds double precision,
  credits double precision,
  cost_usd double precision not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists cost_events_tenant_created_idx on public.cost_events (tenant_id, created_at);
create index if not exists cost_events_job_idx on public.cost_events (job_id);

create table if not exists public.tenant_budgets (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  month text not null,
  soft_limit_usd double precision,
  hard_limit_usd double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_budgets_pkey primary key (tenant_id, month)
);

create table if not exists public.tts_cache (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  text_hash text not null,
  voice_profile_id uuid not null references public.voice_profiles(id) on delete cascade,
  narration_id uuid not null references public.narrations(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists tts_cache_text_voice_uq on public.tts_cache (text_hash, voice_profile_id);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
-- RLS is enabled on every table. Policies exist only for `authenticated`; `anon` gets nothing.
-- The service role bypasses RLS entirely (Postgres BYPASSRLS) — the worker and the API use it
-- and always filter by tenant_id explicitly in packages/db/src/repos/postgres.ts.

alter table public.tenants enable row level security;
alter table public.tenant_agencies enable row level security;
alter table public.tenant_members enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhooks enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.saved_searches enable row level security;
alter table public.ingest_runs enable row level security;
alter table public.listings enable row level security;
alter table public.listing_versions enable row level security;
alter table public.listing_groups enable row level security;
alter table public.generation_profiles enable row level security;
alter table public.voice_profiles enable row level security;
alter table public.jobs enable row level security;
alter table public.job_steps enable row level security;
alter table public.generations enable row level security;
alter table public.gate_reports enable row level security;
alter table public.narrations enable row level security;
alter table public.outputs enable row level security;
alter table public.review_queue enable row level security;
alter table public.cost_events enable row level security;
alter table public.tenant_budgets enable row level security;
alter table public.tts_cache enable row level security;

-- tenants: the tenant row itself is keyed by id, not tenant_id. Creation happens through the
-- service role (sign-up flow), so there is no insert policy for authenticated users.
drop policy if exists tenants_select on public.tenants;
create policy tenants_select on public.tenants for select to authenticated
  using (public.has_tenant_role(auth.uid(), id, 'viewer'));
drop policy if exists tenants_update on public.tenants;
create policy tenants_update on public.tenants for update to authenticated
  using (public.has_tenant_role(auth.uid(), id, 'admin'))
  with check (public.has_tenant_role(auth.uid(), id, 'admin'));
drop policy if exists tenants_delete on public.tenants;
create policy tenants_delete on public.tenants for delete to authenticated
  using (public.has_tenant_role(auth.uid(), id, 'owner'));

-- tenant_members: readable by the member themself (and tenant admins); managed by owners.
drop policy if exists tenant_members_select on public.tenant_members;
create policy tenant_members_select on public.tenant_members for select to authenticated
  using (user_id = auth.uid() or public.has_tenant_role(auth.uid(), tenant_id, 'admin'));
drop policy if exists tenant_members_insert on public.tenant_members;
create policy tenant_members_insert on public.tenant_members for insert to authenticated
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'owner'));
drop policy if exists tenant_members_update on public.tenant_members;
create policy tenant_members_update on public.tenant_members for update to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'owner'))
  with check (public.has_tenant_role(auth.uid(), tenant_id, 'owner'));
drop policy if exists tenant_members_delete on public.tenant_members;
create policy tenant_members_delete on public.tenant_members for delete to authenticated
  using (public.has_tenant_role(auth.uid(), tenant_id, 'owner'));

-- Every other tenant-scoped table: viewer reads, editor writes, admin deletes.
do $$
declare
  t text;
begin
  foreach t in array array[
    'tenant_agencies', 'api_keys', 'webhooks', 'webhook_deliveries', 'saved_searches', 'ingest_runs',
    'listings', 'listing_versions', 'listing_groups', 'generation_profiles', 'voice_profiles',
    'jobs', 'job_steps', 'generations', 'gate_reports', 'narrations', 'outputs', 'review_queue',
    'cost_events', 'tenant_budgets', 'tts_cache'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_tenant_role(auth.uid(), tenant_id, %L))',
      t || '_select', t, 'viewer');
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_tenant_role(auth.uid(), tenant_id, %L))',
      t || '_insert', t, 'editor');
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_tenant_role(auth.uid(), tenant_id, %L)) with check (public.has_tenant_role(auth.uid(), tenant_id, %L))',
      t || '_update', t, 'editor', 'editor');
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_tenant_role(auth.uid(), tenant_id, %L))',
      t || '_delete', t, 'admin');
  end loop;
end $$;

-- voice_profiles with tenant_id null are shared system voices: readable by any signed-in user.
drop policy if exists voice_profiles_shared_select on public.voice_profiles;
create policy voice_profiles_shared_select on public.voice_profiles for select to authenticated
  using (tenant_id is null);

-- Grants: RLS decides rows, grants decide tables. anon gets nothing.
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke all on all tables in schema public from anon;
