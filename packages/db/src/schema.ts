/**
 * Drizzle schema for the `public` schema. Kept in sync by hand with `migrations/0001_init.sql`
 * (a test checks that every `pgTable` here has a `create table` there and vice versa).
 *
 * Conventions:
 * - Column keys are the same snake_case names as the `@imovel/core` zod schemas so rows map
 *   to core types with a spread plus date conversion.
 * - `uuid` primary keys default to `gen_random_uuid()`, timestamps are `timestamptz`.
 * - Every tenant-scoped table carries `tenant_id uuid not null`; RLS policies in the migration
 *   key off that column through `has_tenant_role()`.
 * - Domain enums (source, status, ...) are `text` columns typed via `$type<>()`; the zod schemas
 *   in core are the source of truth. Only `tenant_role` is a Postgres enum because RLS uses it.
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  AgentInfo,
  Area,
  Audience,
  Condition,
  EnergyClass,
  GateDecision,
  GateReport,
  GenerationResult,
  IngestRun,
  JobStatus,
  JobStep,
  JobStepRecord,
  LanguageTag,
  ListingInput,
  Location,
  NarrationResult,
  Ownership,
  Photo,
  PricePeriod,
  PropertyType,
  ReviewItem,
  SourceId,
  TargetLength,
  Tone,
  Transaction,
  TTSProviderId,
  Typology,
  WebhookEvent,
  CostEvent,
  EditorId,
} from "@imovel/core";

export const tenantRoleEnum = pgEnum("tenant_role", ["owner", "admin", "editor", "viewer"]);
export type TenantRole = (typeof tenantRoleEnum.enumValues)[number];

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

// ---------------------------------------------------------------------------
// Tenancy
// ---------------------------------------------------------------------------

export const tenants = pgTable("tenants", {
  id: id(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  allow_third_party_generation: boolean("allow_third_party_generation").notNull().default(false),
  legal_signoff_at: ts("legal_signoff_at"),
  terms_accepted_at: ts("terms_accepted_at"),
  budget_soft_usd: doublePrecision("budget_soft_usd"),
  budget_hard_usd: doublePrecision("budget_hard_usd"),
  created_at: createdAt(),
});

export const tenantAgencies = pgTable(
  "tenant_agencies",
  {
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source: text("source").$type<SourceId>().notNull(),
    agency_id: text("agency_id").notNull(),
    agency_name: text("agency_name"),
    created_at: createdAt(),
  },
  (t) => [primaryKey({ name: "tenant_agencies_pkey", columns: [t.tenant_id, t.source, t.agency_id] })],
);

/** Supabase auth users → tenant with a role. Read by `has_tenant_role()` for RLS. */
export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: id(),
    user_id: uuid("user_id").notNull(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: tenantRoleEnum("role").notNull().default("viewer"),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("tenant_members_user_tenant_uq").on(t.user_id, t.tenant_id),
    index("tenant_members_tenant_idx").on(t.tenant_id),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    prefix: text("prefix").notNull(),
    key_hash: text("key_hash").notNull().unique(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(sql`'["*"]'::jsonb`),
    last_used_at: ts("last_used_at"),
    revoked_at: ts("revoked_at"),
    created_at: createdAt(),
  },
  (t) => [index("api_keys_tenant_idx").on(t.tenant_id)],
);

export const webhooks = pgTable(
  "webhooks",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    secret: text("secret").notNull(),
    events: jsonb("events").$type<WebhookEvent[]>().notNull().default(sql`'[]'::jsonb`),
    enabled: boolean("enabled").notNull().default(true),
    created_at: createdAt(),
  },
  (t) => [index("webhooks_tenant_idx").on(t.tenant_id)],
);

export type WebhookDeliveryStatus = "pending" | "delivered" | "failed";

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    webhook_id: uuid("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").$type<WebhookEvent>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<WebhookDeliveryStatus>().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    next_attempt_at: ts("next_attempt_at"),
    created_at: createdAt(),
  },
  (t) => [
    index("webhook_deliveries_webhook_idx").on(t.webhook_id),
    index("webhook_deliveries_status_next_idx").on(t.status, t.next_attempt_at),
  ],
);

export const savedSearches = pgTable(
  "saved_searches",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source: text("source").$type<SourceId>().notNull(),
    query: jsonb("query").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    cron: text("cron").notNull().default("0 6 * * *"),
    enabled: boolean("enabled").notNull().default(true),
    max_pages: integer("max_pages").notNull().default(10),
    max_credits_per_run: integer("max_credits_per_run").notNull().default(500),
    last_run_at: ts("last_run_at"),
    created_at: createdAt(),
  },
  (t) => [index("saved_searches_tenant_idx").on(t.tenant_id)],
);

export const ingestRuns = pgTable(
  "ingest_runs",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    saved_search_id: uuid("saved_search_id").references(() => savedSearches.id, { onDelete: "set null" }),
    source: text("source").$type<SourceId>().notNull(),
    status: text("status").$type<IngestRun["status"]>().notNull(),
    page: integer("page").notNull().default(0),
    next_cursor: text("next_cursor"),
    items_seen: integer("items_seen").notNull().default(0),
    items_new: integer("items_new").notNull().default(0),
    items_changed: integer("items_changed").notNull().default(0),
    credits_used: doublePrecision("credits_used").notNull().default(0),
    error: text("error"),
    started_at: ts("started_at").notNull().defaultNow(),
    finished_at: ts("finished_at"),
  },
  (t) => [
    index("ingest_runs_tenant_idx").on(t.tenant_id),
    index("ingest_runs_saved_search_idx").on(t.saved_search_id),
  ],
);

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

export const listings = pgTable(
  "listings",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    source: text("source").$type<SourceId>().notNull(),
    source_id: text("source_id").notNull(),
    source_url: text("source_url"),
    ownership: text("ownership").$type<Ownership>().notNull().default("third_party"),
    consent_ref: text("consent_ref"),
    transaction: text("transaction").$type<Transaction>().notNull(),
    property_type: text("property_type").$type<PropertyType>().notNull(),
    typology: text("typology").$type<Typology>(),
    price: doublePrecision("price"),
    currency: text("currency").$type<"EUR">().notNull().default("EUR"),
    price_period: text("price_period").$type<PricePeriod>(),
    area: jsonb("area").$type<Area>().notNull().default(sql`'{}'::jsonb`),
    floor: text("floor"),
    year_built: integer("year_built"),
    bathrooms: integer("bathrooms"),
    condition: text("condition").$type<Condition>(),
    location: jsonb("location").$type<Location>().notNull(),
    features: jsonb("features").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    features_raw: jsonb("features_raw").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    energy_certificate: text("energy_certificate").$type<EnergyClass>(),
    photos: jsonb("photos").$type<Photo[]>().notNull().default(sql`'[]'::jsonb`),
    agent: jsonb("agent").$type<AgentInfo>().notNull().default(sql`'{}'::jsonb`),
    description_original: text("description_original"),
    language_original: text("language_original").$type<LanguageTag>(),
    raw_ref: text("raw_ref"),
    fetched_at: ts("fetched_at").notNull().defaultNow(),
    last_seen_at: ts("last_seen_at").notNull().defaultNow(),
    content_hash: text("content_hash").notNull(),
    fingerprint: text("fingerprint"),
    created_at: createdAt(),
    updated_at: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("listings_tenant_source_uq").on(t.tenant_id, t.source, t.source_id),
    index("listings_tenant_idx").on(t.tenant_id),
    index("listings_fingerprint_idx").on(t.fingerprint),
    index("listings_content_hash_idx").on(t.content_hash),
    index("listings_tenant_created_idx").on(t.tenant_id, t.created_at, t.id),
  ],
);

export const listingVersions = pgTable(
  "listing_versions",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    listing_id: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    content_hash: text("content_hash").notNull(),
    snapshot: jsonb("snapshot").$type<ListingInput>().notNull(),
    created_at: createdAt(),
  },
  (t) => [index("listing_versions_listing_idx").on(t.listing_id, t.created_at)],
);

/** Cross-source near-duplicate groups; one canonical listing per group gets generation. */
export const listingGroups = pgTable(
  "listing_groups",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    group_id: uuid("group_id").notNull(),
    listing_id: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    canonical: boolean("canonical").notNull().default(false),
    created_at: createdAt(),
  },
  (t) => [
    uniqueIndex("listing_groups_listing_uq").on(t.listing_id),
    index("listing_groups_group_idx").on(t.group_id),
  ],
);

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

export const generationProfiles = pgTable(
  "generation_profiles",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    model: text("model").notNull().default("gemini-2.5-pro"),
    temperature: doublePrecision("temperature").notNull().default(0.7),
    target_length: text("target_length").$type<TargetLength>().notNull().default("media"),
    tone: text("tone").$type<Tone>().notNull().default("profissional"),
    audience: text("audience").$type<Audience>().notNull().default("compradores"),
    brand_name: text("brand_name"),
    brand_voice_notes: text("brand_voice_notes"),
    cta_template: text("cta_template"),
    use_photo_insights: boolean("use_photo_insights").notNull().default(false),
    forbidden_claims: jsonb("forbidden_claims").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    created_at: createdAt(),
    updated_at: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("generation_profiles_tenant_idx").on(t.tenant_id)],
);

export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    id: id(),
    /** Null for shared/system voices. */
    tenant_id: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider").$type<TTSProviderId>().notNull(),
    voice_ref: text("voice_ref"),
    reference_audio_key: text("reference_audio_key"),
    reference_transcript: text("reference_transcript"),
    style_prompt: text("style_prompt").notNull(),
    language_code: text("language_code").$type<"pt-PT">().notNull().default("pt-PT"),
    speaking_rate: doublePrecision("speaking_rate").notNull().default(1.0),
    seed: integer("seed").notNull().default(42),
    cfg_value: doublePrecision("cfg_value").notNull().default(2.0),
    inference_timesteps: integer("inference_timesteps").notNull().default(10),
    glossary: jsonb("glossary").$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    consent_doc_ref: text("consent_doc_ref"),
    created_at: createdAt(),
    updated_at: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("voice_profiles_tenant_idx").on(t.tenant_id)],
);

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    listing_id: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    listing_version_id: uuid("listing_version_id").references(() => listingVersions.id, { onDelete: "set null" }),
    generation_profile_id: uuid("generation_profile_id")
      .notNull()
      .references(() => generationProfiles.id),
    voice_profile_id: uuid("voice_profile_id").references(() => voiceProfiles.id),
    status: text("status").$type<JobStatus>().notNull().default("queued"),
    loop: integer("loop").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    current_step: text("current_step").$type<JobStep>(),
    idempotency_key: text("idempotency_key").notNull().unique(),
    require_audio: boolean("require_audio").notNull().default(true),
    pipeline_version: text("pipeline_version"),
    last_error: jsonb("last_error").$type<Record<string, unknown>>(),
    created_at: createdAt(),
    updated_at: ts("updated_at").notNull().defaultNow(),
    finished_at: ts("finished_at"),
  },
  (t) => [
    index("jobs_tenant_status_idx").on(t.tenant_id, t.status),
    index("jobs_listing_idx").on(t.listing_id),
  ],
);

export const jobSteps = pgTable(
  "job_steps",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    step: text("step").$type<JobStep>().notNull(),
    attempt: integer("attempt").notNull().default(0),
    status: text("status").$type<JobStepRecord["status"]>().notNull(),
    input_hash: text("input_hash"),
    output_ref: text("output_ref"),
    error: jsonb("error").$type<Record<string, unknown>>(),
    usage: jsonb("usage").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    cost_usd: doublePrecision("cost_usd").notNull().default(0),
    started_at: ts("started_at").notNull().defaultNow(),
    finished_at: ts("finished_at"),
  },
  (t) => [index("job_steps_job_idx").on(t.job_id, t.started_at)],
);

export const generations = pgTable(
  "generations",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    listing_id: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    attempt: integer("attempt").notNull().default(0),
    loop: integer("loop").notNull().default(0),
    model: text("model").notNull(),
    provider: text("provider").notNull(),
    result: jsonb("result").$type<GenerationResult>().notNull(),
    usage: jsonb("usage").$type<Record<string, number | undefined>>().notNull().default(sql`'{}'::jsonb`),
    latency_ms: doublePrecision("latency_ms").notNull().default(0),
    text_hash: text("text_hash").notNull(),
    created_at: createdAt(),
  },
  (t) => [index("generations_job_idx").on(t.job_id, t.created_at), index("generations_text_hash_idx").on(t.text_hash)],
);

export const gateReports = pgTable(
  "gate_reports",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    generation_id: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    loop: integer("loop").notNull().default(0),
    attempt: integer("attempt").notNull().default(0),
    editor: text("editor").$type<EditorId>().notNull(),
    decision: text("decision").$type<GateDecision>().notNull(),
    judge_score: doublePrecision("judge_score"),
    /** The full `GateReport` (changes, validators, judge, usage). */
    report: jsonb("report").$type<GateReport>().notNull(),
    created_at: createdAt(),
  },
  (t) => [index("gate_reports_job_idx").on(t.job_id, t.created_at), index("gate_reports_decision_idx").on(t.tenant_id, t.decision)],
);

export const narrations = pgTable(
  "narrations",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    generation_id: uuid("generation_id")
      .notNull()
      .references(() => generations.id, { onDelete: "cascade" }),
    voice_profile_id: uuid("voice_profile_id")
      .notNull()
      .references(() => voiceProfiles.id),
    provider: text("provider").$type<TTSProviderId>().notNull(),
    text_hash: text("text_hash").notNull(),
    duration_s: doublePrecision("duration_s").notNull().default(0),
    /** The full `NarrationResult`. */
    result: jsonb("result").$type<NarrationResult>().notNull(),
    created_at: createdAt(),
  },
  (t) => [index("narrations_job_idx").on(t.job_id, t.created_at)],
);

export const outputs = pgTable(
  "outputs",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    listing_id: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    generation_id: uuid("generation_id")
      .notNull()
      .references(() => generations.id),
    gate_report_id: uuid("gate_report_id")
      .notNull()
      .references(() => gateReports.id),
    sections: jsonb("sections").$type<GenerationResult>().notNull(),
    narration: jsonb("narration").$type<NarrationResult>(),
    ai_generated: boolean("ai_generated").notNull().default(true),
    warnings: jsonb("warnings").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    published_at: ts("published_at").notNull().defaultNow(),
  },
  (t) => [
    index("outputs_listing_published_idx").on(t.tenant_id, t.listing_id, t.published_at),
    index("outputs_job_idx").on(t.job_id),
  ],
);

export const reviewQueue = pgTable(
  "review_queue",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    listing_id: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    gate_report_id: uuid("gate_report_id").references(() => gateReports.id, { onDelete: "set null" }),
    status: text("status").$type<ReviewItem["status"]>().notNull().default("open"),
    edited_sections: jsonb("edited_sections").$type<GenerationResult>(),
    created_at: createdAt(),
    resolved_at: ts("resolved_at"),
  },
  (t) => [index("review_queue_tenant_status_idx").on(t.tenant_id, t.status, t.created_at), index("review_queue_job_idx").on(t.job_id)],
);

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export const costEvents = pgTable(
  "cost_events",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    job_id: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    step: text("step").$type<CostEvent["step"]>().notNull(),
    provider: text("provider").notNull(),
    model: text("model"),
    input_tokens: integer("input_tokens"),
    output_tokens: integer("output_tokens"),
    reasoning_tokens: integer("reasoning_tokens"),
    chars: integer("chars"),
    gpu_seconds: doublePrecision("gpu_seconds"),
    credits: doublePrecision("credits"),
    cost_usd: doublePrecision("cost_usd").notNull().default(0),
    created_at: createdAt(),
  },
  (t) => [
    index("cost_events_tenant_created_idx").on(t.tenant_id, t.created_at),
    index("cost_events_job_idx").on(t.job_id),
  ],
);

export const tenantBudgets = pgTable(
  "tenant_budgets",
  {
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Calendar month `YYYY-MM` in UTC. */
    month: text("month").notNull(),
    soft_limit_usd: doublePrecision("soft_limit_usd"),
    hard_limit_usd: doublePrecision("hard_limit_usd"),
    created_at: createdAt(),
    updated_at: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: "tenant_budgets_pkey", columns: [t.tenant_id, t.month] })],
);

export const ttsCache = pgTable(
  "tts_cache",
  {
    id: id(),
    tenant_id: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    text_hash: text("text_hash").notNull(),
    voice_profile_id: uuid("voice_profile_id")
      .notNull()
      .references(() => voiceProfiles.id, { onDelete: "cascade" }),
    narration_id: uuid("narration_id")
      .notNull()
      .references(() => narrations.id, { onDelete: "cascade" }),
    created_at: createdAt(),
  },
  (t) => [uniqueIndex("tts_cache_text_voice_uq").on(t.text_hash, t.voice_profile_id)],
);

/** Names of every table in this schema, in dependency order (parents first). */
export const TABLE_NAMES = [
  "tenants",
  "tenant_agencies",
  "tenant_members",
  "api_keys",
  "webhooks",
  "webhook_deliveries",
  "saved_searches",
  "ingest_runs",
  "listings",
  "listing_versions",
  "listing_groups",
  "generation_profiles",
  "voice_profiles",
  "jobs",
  "job_steps",
  "generations",
  "gate_reports",
  "narrations",
  "outputs",
  "review_queue",
  "cost_events",
  "tenant_budgets",
  "tts_cache",
] as const;
