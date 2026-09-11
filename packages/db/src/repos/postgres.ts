/**
 * Drizzle-backed repositories. The connection uses the service role (bypasses RLS), so every
 * query filters by `tenant_id` explicitly. Behaviour mirrors `memory.ts`, which the shared repo
 * test-suite runs against both implementations (Postgres only when `DATABASE_URL` is set).
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import {
  GenerationProfile as GenerationProfileSchema,
  ListingInput as ListingInputSchema,
  NotFoundError,
  VoiceProfile as VoiceProfileSchema,
  computeContentHash,
  computeFingerprint,
  idempotencyKey,
  systemClock,
  type ApiKey,
  type Clock,
  type CostEvent,
  type GenerationProfile,
  type GenerationRecord,
  type GenerationResult,
  type IngestRun,
  type Job,
  type JobOutput,
  type JobStepRecord,
  type Listing,
  type ListingVersion,
  type ReviewItem,
  type SavedSearch,
  type Tenant,
  type VoiceProfile,
  type Webhook,
  type WebhookEvent,
} from "@imovel/core";
import type { Db } from "../client";
import * as s from "../schema";
import { resolveTolerance } from "./dedup";
import {
  decodeCursor,
  defaultGenerationProfileId,
  defaultVoiceProfileId,
  encodeCursor,
  monthBounds,
  slugify,
} from "./ids";
import { DEFAULT_GENERATION_PROFILE_NAME, DEFAULT_VOICE_PROFILE_NAME } from "./memory";
import type {
  ApiKeysRepo,
  CostEventsRepo,
  CreateJobInput,
  GateReportsRepo,
  GenerationsRepo,
  IngestRunsRepo,
  JobListOptions,
  JobsRepo,
  ListOptions,
  ListingsRepo,
  NarrationsRepo,
  NearDuplicateTolerance,
  OutputsRepo,
  ProfilesRepo,
  Repos,
  ReviewStatus,
  ReviewsRepo,
  SavedSearchesRepo,
  TenantBudget,
  TenantsRepo,
  TtsCacheRepo,
  UpsertResult,
  WebhookDelivery,
  WebhooksRepo,
} from "./types";

export interface PostgresReposOptions {
  clock?: Clock;
}

// ---------------------------------------------------------------------------
// Row ↔ core mappers
// ---------------------------------------------------------------------------

const iso = (d: Date): string => d.toISOString();
const isoN = (d: Date | null): string | null => (d ? d.toISOString() : null);
const dateN = (v: string | null | undefined): Date | null => (v ? new Date(v) : null);

type TenantRow = typeof s.tenants.$inferSelect;
type ListingRow = typeof s.listings.$inferSelect;
type VersionRow = typeof s.listingVersions.$inferSelect;
type JobRow = typeof s.jobs.$inferSelect;
type StepRow = typeof s.jobSteps.$inferSelect;
type GenerationRow = typeof s.generations.$inferSelect;
type OutputRow = typeof s.outputs.$inferSelect;
type ReviewRow = typeof s.reviewQueue.$inferSelect;
type GenProfileRow = typeof s.generationProfiles.$inferSelect;
type VoiceProfileRow = typeof s.voiceProfiles.$inferSelect;
type CostRow = typeof s.costEvents.$inferSelect;
type WebhookRow = typeof s.webhooks.$inferSelect;
type DeliveryRow = typeof s.webhookDeliveries.$inferSelect;
type SavedSearchRow = typeof s.savedSearches.$inferSelect;
type IngestRunRow = typeof s.ingestRuns.$inferSelect;
type ApiKeyRow = typeof s.apiKeys.$inferSelect;

function toTenant(r: TenantRow): Tenant {
  return {
    id: r.id,
    name: r.name,
    slug: r.slug,
    allow_third_party_generation: r.allow_third_party_generation,
    legal_signoff_at: isoN(r.legal_signoff_at),
    terms_accepted_at: isoN(r.terms_accepted_at),
    budget_soft_usd: r.budget_soft_usd,
    budget_hard_usd: r.budget_hard_usd,
    created_at: iso(r.created_at),
  };
}

function toListing(r: ListingRow): Listing {
  const { last_seen_at: _l, created_at: _c, updated_at: _u, fetched_at, ...rest } = r;
  return { ...rest, fetched_at: iso(fetched_at) };
}

function toVersion(r: VersionRow): ListingVersion {
  return { id: r.id, listing_id: r.listing_id, content_hash: r.content_hash, snapshot: r.snapshot, created_at: iso(r.created_at) };
}

function toJob(r: JobRow): Job {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    listing_id: r.listing_id,
    listing_version_id: r.listing_version_id,
    generation_profile_id: r.generation_profile_id,
    voice_profile_id: r.voice_profile_id,
    status: r.status,
    loop: r.loop,
    attempt: r.attempt,
    current_step: r.current_step,
    idempotency_key: r.idempotency_key,
    require_audio: r.require_audio,
    last_error: r.last_error,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    finished_at: isoN(r.finished_at),
  };
}

function toStep(r: StepRow): JobStepRecord {
  return {
    id: r.id,
    job_id: r.job_id,
    step: r.step,
    attempt: r.attempt,
    status: r.status,
    input_hash: r.input_hash,
    output_ref: r.output_ref,
    error: r.error,
    usage: r.usage,
    cost_usd: r.cost_usd,
    started_at: iso(r.started_at),
    finished_at: isoN(r.finished_at),
  };
}

function toGeneration(r: GenerationRow): GenerationRecord {
  const usage: GenerationRecord["usage"] = {
    input_tokens: r.usage.input_tokens ?? 0,
    output_tokens: r.usage.output_tokens ?? 0,
  };
  if (r.usage.reasoning_tokens !== undefined && r.usage.reasoning_tokens !== null) {
    usage.reasoning_tokens = r.usage.reasoning_tokens;
  }
  return {
    id: r.id,
    job_id: r.job_id,
    listing_id: r.listing_id,
    attempt: r.attempt,
    loop: r.loop,
    model: r.model,
    provider: r.provider,
    result: r.result,
    usage,
    latency_ms: r.latency_ms,
    text_hash: r.text_hash,
    created_at: iso(r.created_at),
  };
}

function toOutput(r: OutputRow): JobOutput {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    job_id: r.job_id,
    listing_id: r.listing_id,
    generation_id: r.generation_id,
    gate_report_id: r.gate_report_id,
    sections: r.sections,
    narration: r.narration,
    ai_generated: true,
    warnings: r.warnings,
    published_at: iso(r.published_at),
  };
}

function toReview(r: ReviewRow): ReviewItem {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    job_id: r.job_id,
    listing_id: r.listing_id,
    reason: r.reason,
    gate_report_id: r.gate_report_id,
    status: r.status,
    edited_sections: r.edited_sections,
    created_at: iso(r.created_at),
    resolved_at: isoN(r.resolved_at),
  };
}

function toGenProfile(r: GenProfileRow): GenerationProfile {
  const { created_at: _c, updated_at: _u, ...p } = r;
  return p;
}

function toVoiceProfile(r: VoiceProfileRow): VoiceProfile {
  const { created_at: _c, updated_at: _u, ...p } = r;
  return p;
}

function toCostEvent(r: CostRow): CostEvent {
  const e: CostEvent = {
    tenant_id: r.tenant_id,
    job_id: r.job_id,
    step: r.step,
    provider: r.provider,
    model: r.model,
    cost_usd: r.cost_usd,
  };
  if (r.input_tokens !== null) e.input_tokens = r.input_tokens;
  if (r.output_tokens !== null) e.output_tokens = r.output_tokens;
  if (r.reasoning_tokens !== null) e.reasoning_tokens = r.reasoning_tokens;
  if (r.chars !== null) e.chars = r.chars;
  if (r.gpu_seconds !== null) e.gpu_seconds = r.gpu_seconds;
  if (r.credits !== null) e.credits = r.credits;
  return e;
}

function toWebhook(r: WebhookRow): Webhook {
  return { id: r.id, tenant_id: r.tenant_id, url: r.url, secret: r.secret, events: r.events, enabled: r.enabled, created_at: iso(r.created_at) };
}

function toDelivery(r: DeliveryRow): WebhookDelivery {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    webhook_id: r.webhook_id,
    event: r.event,
    payload: r.payload,
    status: r.status,
    attempts: r.attempts,
    last_error: r.last_error,
    next_attempt_at: isoN(r.next_attempt_at),
    created_at: iso(r.created_at),
  };
}

function toSavedSearch(r: SavedSearchRow): SavedSearch {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    source: r.source,
    query: r.query,
    cron: r.cron,
    enabled: r.enabled,
    max_pages: r.max_pages,
    max_credits_per_run: r.max_credits_per_run,
    last_run_at: isoN(r.last_run_at),
  };
}

function toIngestRun(r: IngestRunRow): IngestRun {
  return {
    id: r.id,
    saved_search_id: r.saved_search_id,
    tenant_id: r.tenant_id,
    source: r.source,
    status: r.status,
    page: r.page,
    next_cursor: r.next_cursor,
    items_seen: r.items_seen,
    items_new: r.items_new,
    items_changed: r.items_changed,
    credits_used: r.credits_used,
    error: r.error,
    started_at: iso(r.started_at),
    finished_at: isoN(r.finished_at),
  };
}

function toApiKey(r: ApiKeyRow): ApiKey {
  return {
    id: r.id,
    tenant_id: r.tenant_id,
    prefix: r.prefix,
    key_hash: r.key_hash,
    scopes: r.scopes,
    last_used_at: isoN(r.last_used_at),
    revoked_at: isoN(r.revoked_at),
    created_at: iso(r.created_at),
  };
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export function createPostgresRepos(db: Db, opts: PostgresReposOptions = {}): Repos {
  const clock = opts.clock ?? systemClock;
  const now = () => clock.now();

  async function tenantOfJob(jobId: string): Promise<string> {
    const [row] = await db.select({ tenant_id: s.jobs.tenant_id }).from(s.jobs).where(eq(s.jobs.id, jobId)).limit(1);
    if (!row) throw new NotFoundError(`Job ${jobId} not found`);
    return row.tenant_id;
  }

  // --- tenants -------------------------------------------------------------
  const tenants: TenantsRepo = {
    async ensureDefault(id, name) {
      const label = name ?? "Default tenant";
      await db
        .insert(s.tenants)
        .values({ id, name: label, slug: `${slugify(label)}-${id.slice(0, 8)}`, created_at: now() })
        .onConflictDoNothing({ target: s.tenants.id });
      const [row] = await db.select().from(s.tenants).where(eq(s.tenants.id, id)).limit(1);
      if (!row) throw new NotFoundError(`Tenant ${id} could not be created`);
      return toTenant(row);
    },
    async get(id) {
      const [row] = await db.select().from(s.tenants).where(eq(s.tenants.id, id)).limit(1);
      return row ? toTenant(row) : null;
    },
    async save(t) {
      const values = {
        id: t.id,
        name: t.name,
        slug: t.slug,
        allow_third_party_generation: t.allow_third_party_generation,
        legal_signoff_at: dateN(t.legal_signoff_at),
        terms_accepted_at: dateN(t.terms_accepted_at),
        budget_soft_usd: t.budget_soft_usd,
        budget_hard_usd: t.budget_hard_usd,
        created_at: new Date(t.created_at),
      };
      const { id: _id, created_at: _c, ...set } = values;
      const [row] = await db.insert(s.tenants).values(values).onConflictDoUpdate({ target: s.tenants.id, set }).returning();
      return toTenant(row!);
    },
    async agencyIds(tenantId, source) {
      const rows = await db
        .select({ agency_id: s.tenantAgencies.agency_id })
        .from(s.tenantAgencies)
        .where(and(eq(s.tenantAgencies.tenant_id, tenantId), eq(s.tenantAgencies.source, source)));
      return rows.map((r) => r.agency_id);
    },
    async addAgency(a) {
      await db
        .insert(s.tenantAgencies)
        .values({ tenant_id: a.tenant_id, source: a.source, agency_id: a.agency_id, agency_name: a.agency_name })
        .onConflictDoUpdate({
          target: [s.tenantAgencies.tenant_id, s.tenantAgencies.source, s.tenantAgencies.agency_id],
          set: { agency_name: a.agency_name },
        });
    },
  };

  // --- listings ------------------------------------------------------------
  const listings: ListingsRepo = {
    async upsertFromInput(tenantId, rawInput, nowAt): Promise<UpsertResult> {
      const input = ListingInputSchema.parse(rawInput);
      const at = nowAt ?? now();
      const content_hash = computeContentHash(input);
      const fingerprint = computeFingerprint(input);

      return db.transaction(async (tx) => {
        const [existing] = await tx
          .select({ id: s.listings.id, content_hash: s.listings.content_hash })
          .from(s.listings)
          .where(and(eq(s.listings.tenant_id, tenantId), eq(s.listings.source, input.source), eq(s.listings.source_id, input.source_id)))
          .limit(1);

        const addVersion = async (listingId: string): Promise<string> => {
          const [v] = await tx
            .insert(s.listingVersions)
            .values({ tenant_id: tenantId, listing_id: listingId, content_hash, snapshot: input, created_at: at })
            .returning({ id: s.listingVersions.id });
          return v!.id;
        };

        if (!existing) {
          const [row] = await tx
            .insert(s.listings)
            .values({
              ...input,
              tenant_id: tenantId,
              fetched_at: at,
              last_seen_at: at,
              content_hash,
              fingerprint,
              created_at: at,
              updated_at: at,
            })
            .returning();
          return { listing: toListing(row!), status: "new", version_id: await addVersion(row!.id) };
        }

        const changed = existing.content_hash !== content_hash;
        const [row] = await tx
          .update(s.listings)
          .set({ ...input, fetched_at: at, last_seen_at: at, updated_at: at, content_hash, fingerprint })
          .where(eq(s.listings.id, existing.id))
          .returning();
        if (!changed) return { listing: toListing(row!), status: "unchanged", version_id: null };
        return { listing: toListing(row!), status: "changed", version_id: await addVersion(existing.id) };
      });
    },

    async getById(tenantId, id) {
      const [row] = await db
        .select()
        .from(s.listings)
        .where(and(eq(s.listings.tenant_id, tenantId), eq(s.listings.id, id)))
        .limit(1);
      return row ? toListing(row) : null;
    },

    async getBySource(tenantId, source, sourceId) {
      const [row] = await db
        .select()
        .from(s.listings)
        .where(and(eq(s.listings.tenant_id, tenantId), eq(s.listings.source, source), eq(s.listings.source_id, sourceId)))
        .limit(1);
      return row ? toListing(row) : null;
    },

    async list(tenantId, opts: ListOptions = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
      const cursor = decodeCursor(opts.cursor);
      const conditions: SQL[] = [eq(s.listings.tenant_id, tenantId)];
      if (opts.ownership) conditions.push(eq(s.listings.ownership, opts.ownership));
      if (cursor) {
        const c = new Date(cursor.created_at);
        conditions.push(
          or(lt(s.listings.created_at, c), and(eq(s.listings.created_at, c), lt(s.listings.id, cursor.id)))!,
        );
      }
      const rows = await db
        .select()
        .from(s.listings)
        .where(and(...conditions))
        .orderBy(desc(s.listings.created_at), desc(s.listings.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return {
        items: page.map(toListing),
        next: rows.length > limit && last ? encodeCursor({ created_at: iso(last.created_at), id: last.id }) : null,
      };
    },

    async findNearDuplicates(listing, tolIn?: Partial<NearDuplicateTolerance>) {
      const tol = resolveTolerance(tolIn);
      const useful = listing.area.useful_m2 ?? null;
      const gross = listing.area.gross_m2 ?? null;
      const cu = sql`nullif(${s.listings.area}->>'useful_m2', '')::double precision`;
      const cg = sql`nullif(${s.listings.area}->>'gross_m2', '')::double precision`;

      // Same rules as areaMatches() in dedup.ts.
      let areaClause: SQL;
      if (useful !== null && gross !== null) {
        areaClause = sql`(case
          when ${cu} is not null then abs(${cu} - ${useful}) <= ${tol.area * useful}
          when ${cg} is not null then abs(${cg} - ${gross}) <= ${tol.area * gross}
          else false end)`;
      } else if (useful !== null) {
        areaClause = sql`(${cu} is not null and abs(${cu} - ${useful}) <= ${tol.area * useful})`;
      } else if (gross !== null) {
        areaClause = sql`(${cg} is not null and abs(${cg} - ${gross}) <= ${tol.area * gross})`;
      } else {
        areaClause = sql`(${cu} is null and ${cg} is null)`;
      }

      const priceClause: SQL =
        listing.price === null
          ? isNull(s.listings.price)
          : sql`(${s.listings.price} is not null and abs(${s.listings.price} - ${listing.price}) <= ${tol.price * listing.price})`;

      const rows = await db
        .select()
        .from(s.listings)
        .where(
          and(
            eq(s.listings.tenant_id, listing.tenant_id),
            sql`${s.listings.id} <> ${listing.id}`,
            eq(s.listings.transaction, listing.transaction),
            listing.typology === null ? isNull(s.listings.typology) : eq(s.listings.typology, listing.typology),
            sql`lower(trim(${s.listings.location}->>'municipality')) = ${listing.location.municipality.trim().toLowerCase()}`,
            sql`coalesce(lower(trim(${s.listings.location}->>'parish')), '') = ${(listing.location.parish ?? "").trim().toLowerCase()}`,
            areaClause,
            priceClause,
          ),
        )
        .orderBy(asc(s.listings.created_at), asc(s.listings.id));
      return rows.map(toListing);
    },

    async versions(tenantId, listingId) {
      const rows = await db
        .select()
        .from(s.listingVersions)
        .where(and(eq(s.listingVersions.tenant_id, tenantId), eq(s.listingVersions.listing_id, listingId)))
        .orderBy(asc(s.listingVersions.created_at), asc(s.listingVersions.id));
      return rows.map(toVersion);
    },

    async getVersion(tenantId, versionId) {
      const [row] = await db
        .select()
        .from(s.listingVersions)
        .where(and(eq(s.listingVersions.tenant_id, tenantId), eq(s.listingVersions.id, versionId)))
        .limit(1);
      return row ? toVersion(row) : null;
    },

    async setGroup(tenantId, m) {
      await db
        .insert(s.listingGroups)
        .values({ tenant_id: tenantId, group_id: m.group_id, listing_id: m.listing_id, canonical: m.canonical, created_at: now() })
        .onConflictDoUpdate({ target: s.listingGroups.listing_id, set: { group_id: m.group_id, canonical: m.canonical } });
    },

    async groupOf(tenantId, listingId) {
      const [row] = await db
        .select()
        .from(s.listingGroups)
        .where(and(eq(s.listingGroups.tenant_id, tenantId), eq(s.listingGroups.listing_id, listingId)))
        .limit(1);
      return row ? { group_id: row.group_id, listing_id: row.listing_id, canonical: row.canonical } : null;
    },

    async groupMembers(tenantId, groupId) {
      const rows = await db
        .select()
        .from(s.listingGroups)
        .where(and(eq(s.listingGroups.tenant_id, tenantId), eq(s.listingGroups.group_id, groupId)))
        .orderBy(asc(s.listingGroups.created_at));
      return rows.map((r) => ({ group_id: r.group_id, listing_id: r.listing_id, canonical: r.canonical }));
    },
  };

  // --- jobs ----------------------------------------------------------------
  const jobs: JobsRepo = {
    async create(input: CreateJobInput) {
      const [listing] = await db
        .select({ content_hash: s.listings.content_hash })
        .from(s.listings)
        .where(and(eq(s.listings.id, input.listing_id), eq(s.listings.tenant_id, input.tenant_id)))
        .limit(1);
      if (!listing) throw new NotFoundError(`Listing ${input.listing_id} not found for tenant ${input.tenant_id}`);
      let content_hash = listing.content_hash;
      if (input.listing_version_id) {
        const [v] = await db
          .select({ content_hash: s.listingVersions.content_hash })
          .from(s.listingVersions)
          .where(eq(s.listingVersions.id, input.listing_version_id))
          .limit(1);
        if (v) content_hash = v.content_hash;
      }
      const key = idempotencyKey([
        input.listing_id,
        content_hash,
        input.generation_profile_id,
        input.voice_profile_id ?? null,
        input.pipeline_version ?? null,
      ]);
      const at = now();
      const inserted = await db
        .insert(s.jobs)
        .values({
          tenant_id: input.tenant_id,
          listing_id: input.listing_id,
          listing_version_id: input.listing_version_id ?? null,
          generation_profile_id: input.generation_profile_id,
          voice_profile_id: input.voice_profile_id ?? null,
          status: "queued",
          idempotency_key: key,
          require_audio: input.require_audio ?? true,
          pipeline_version: input.pipeline_version ?? null,
          created_at: at,
          updated_at: at,
        })
        .onConflictDoNothing({ target: s.jobs.idempotency_key })
        .returning();
      if (inserted[0]) return { job: toJob(inserted[0]), created: true };
      const [existing] = await db.select().from(s.jobs).where(eq(s.jobs.idempotency_key, key)).limit(1);
      if (!existing) throw new NotFoundError(`Job with key ${key} vanished`);
      return { job: toJob(existing), created: false };
    },

    async get(id) {
      const [row] = await db.select().from(s.jobs).where(eq(s.jobs.id, id)).limit(1);
      return row ? toJob(row) : null;
    },

    async getByIdempotencyKey(key) {
      const [row] = await db.select().from(s.jobs).where(eq(s.jobs.idempotency_key, key)).limit(1);
      return row ? toJob(row) : null;
    },

    async list(tenantId, opts: JobListOptions = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
      const conditions: SQL[] = [eq(s.jobs.tenant_id, tenantId)];
      if (opts.status) {
        const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
        conditions.push(inArray(s.jobs.status, statuses));
      }
      if (opts.listing_id) conditions.push(eq(s.jobs.listing_id, opts.listing_id));
      const rows = await db
        .select()
        .from(s.jobs)
        .where(and(...conditions))
        .orderBy(desc(s.jobs.created_at), desc(s.jobs.id))
        .limit(limit);
      return rows.map(toJob);
    },

    async update(id, patch) {
      const set: Partial<typeof s.jobs.$inferInsert> = { updated_at: now() };
      if (patch.listing_version_id !== undefined) set.listing_version_id = patch.listing_version_id;
      if (patch.generation_profile_id !== undefined) set.generation_profile_id = patch.generation_profile_id;
      if (patch.voice_profile_id !== undefined) set.voice_profile_id = patch.voice_profile_id;
      if (patch.status !== undefined) set.status = patch.status;
      if (patch.loop !== undefined) set.loop = patch.loop;
      if (patch.attempt !== undefined) set.attempt = patch.attempt;
      if (patch.current_step !== undefined) set.current_step = patch.current_step;
      if (patch.require_audio !== undefined) set.require_audio = patch.require_audio;
      if (patch.last_error !== undefined) set.last_error = patch.last_error;
      if (patch.finished_at !== undefined) set.finished_at = dateN(patch.finished_at);
      const [row] = await db.update(s.jobs).set(set).where(eq(s.jobs.id, id)).returning();
      if (!row) throw new NotFoundError(`Job ${id} not found`);
      return toJob(row);
    },

    async addStep(step) {
      const tenant_id = await tenantOfJob(step.job_id);
      const [row] = await db
        .insert(s.jobSteps)
        .values({
          tenant_id,
          job_id: step.job_id,
          step: step.step,
          attempt: step.attempt,
          status: step.status,
          input_hash: step.input_hash,
          output_ref: step.output_ref,
          error: step.error,
          usage: step.usage,
          cost_usd: step.cost_usd,
          started_at: new Date(step.started_at),
          finished_at: dateN(step.finished_at),
        })
        .returning();
      return toStep(row!);
    },

    async steps(jobId) {
      const rows = await db
        .select()
        .from(s.jobSteps)
        .where(eq(s.jobSteps.job_id, jobId))
        .orderBy(asc(s.jobSteps.started_at), asc(s.jobSteps.id));
      return rows.map(toStep);
    },
  };

  // --- generations ---------------------------------------------------------
  const generations: GenerationsRepo = {
    async save(rec) {
      const tenant_id = await tenantOfJob(rec.job_id);
      const values = {
        id: rec.id,
        tenant_id,
        job_id: rec.job_id,
        listing_id: rec.listing_id,
        attempt: rec.attempt,
        loop: rec.loop,
        model: rec.model,
        provider: rec.provider,
        result: rec.result,
        usage: rec.usage as Record<string, number | undefined>,
        latency_ms: rec.latency_ms,
        text_hash: rec.text_hash,
        created_at: new Date(rec.created_at),
      };
      const { id: _id, ...set } = values;
      await db.insert(s.generations).values(values).onConflictDoUpdate({ target: s.generations.id, set });
    },
    async get(id) {
      const [row] = await db.select().from(s.generations).where(eq(s.generations.id, id)).limit(1);
      return row ? toGeneration(row) : null;
    },
    async listForJob(jobId) {
      const rows = await db
        .select()
        .from(s.generations)
        .where(eq(s.generations.job_id, jobId))
        .orderBy(asc(s.generations.created_at), asc(s.generations.id));
      return rows.map(toGeneration);
    },
    async latestForJob(jobId) {
      const [row] = await db
        .select()
        .from(s.generations)
        .where(eq(s.generations.job_id, jobId))
        .orderBy(desc(s.generations.created_at), desc(s.generations.id))
        .limit(1);
      return row ? toGeneration(row) : null;
    },
  };

  // --- gate reports --------------------------------------------------------
  const gateReports: GateReportsRepo = {
    async save(report) {
      const tenant_id = await tenantOfJob(report.job_id);
      const values = {
        id: report.id,
        tenant_id,
        job_id: report.job_id,
        generation_id: report.generation_id,
        loop: report.loop,
        attempt: report.attempt,
        editor: report.editor,
        decision: report.decision,
        judge_score: report.judge?.pt_pt_score ?? null,
        report,
        created_at: new Date(report.created_at),
      };
      const { id: _id, ...set } = values;
      await db.insert(s.gateReports).values(values).onConflictDoUpdate({ target: s.gateReports.id, set });
    },
    async get(id) {
      const [row] = await db.select({ report: s.gateReports.report }).from(s.gateReports).where(eq(s.gateReports.id, id)).limit(1);
      return row ? row.report : null;
    },
    async listForJob(jobId) {
      const rows = await db
        .select({ report: s.gateReports.report })
        .from(s.gateReports)
        .where(eq(s.gateReports.job_id, jobId))
        .orderBy(asc(s.gateReports.created_at), asc(s.gateReports.id));
      return rows.map((r) => r.report);
    },
    async latestForJob(jobId) {
      const [row] = await db
        .select({ report: s.gateReports.report })
        .from(s.gateReports)
        .where(eq(s.gateReports.job_id, jobId))
        .orderBy(desc(s.gateReports.created_at), desc(s.gateReports.id))
        .limit(1);
      return row ? row.report : null;
    },
  };

  // --- narrations ----------------------------------------------------------
  const narrations: NarrationsRepo = {
    async save(n) {
      const tenant_id = await tenantOfJob(n.job_id);
      const values = {
        id: n.id,
        tenant_id,
        job_id: n.job_id,
        generation_id: n.generation_id,
        voice_profile_id: n.voice_profile_id,
        provider: n.provider,
        text_hash: n.text_hash,
        duration_s: n.duration_s,
        result: n,
        created_at: new Date(n.created_at),
      };
      const { id: _id, ...set } = values;
      await db.insert(s.narrations).values(values).onConflictDoUpdate({ target: s.narrations.id, set });
    },
    async get(id) {
      const [row] = await db.select({ result: s.narrations.result }).from(s.narrations).where(eq(s.narrations.id, id)).limit(1);
      return row ? row.result : null;
    },
    async latestForJob(jobId) {
      const [row] = await db
        .select({ result: s.narrations.result })
        .from(s.narrations)
        .where(eq(s.narrations.job_id, jobId))
        .orderBy(desc(s.narrations.created_at), desc(s.narrations.id))
        .limit(1);
      return row ? row.result : null;
    },
  };

  // --- outputs -------------------------------------------------------------
  const outputs: OutputsRepo = {
    async save(o) {
      const values = {
        id: o.id,
        tenant_id: o.tenant_id,
        job_id: o.job_id,
        listing_id: o.listing_id,
        generation_id: o.generation_id,
        gate_report_id: o.gate_report_id,
        sections: o.sections,
        narration: o.narration,
        ai_generated: true,
        warnings: o.warnings,
        published_at: new Date(o.published_at),
      };
      const { id: _id, ...set } = values;
      await db.insert(s.outputs).values(values).onConflictDoUpdate({ target: s.outputs.id, set });
    },
    async get(id) {
      const [row] = await db.select().from(s.outputs).where(eq(s.outputs.id, id)).limit(1);
      return row ? toOutput(row) : null;
    },
    async latestForListing(tenantId, listingId) {
      const [row] = await db
        .select()
        .from(s.outputs)
        .where(and(eq(s.outputs.tenant_id, tenantId), eq(s.outputs.listing_id, listingId)))
        .orderBy(desc(s.outputs.published_at), desc(s.outputs.id))
        .limit(1);
      return row ? toOutput(row) : null;
    },
    async getForJob(jobId) {
      const [row] = await db
        .select()
        .from(s.outputs)
        .where(eq(s.outputs.job_id, jobId))
        .orderBy(desc(s.outputs.published_at), desc(s.outputs.id))
        .limit(1);
      return row ? toOutput(row) : null;
    },
  };

  // --- reviews -------------------------------------------------------------
  const reviews: ReviewsRepo = {
    async create(item) {
      const [row] = await db
        .insert(s.reviewQueue)
        .values({
          tenant_id: item.tenant_id,
          job_id: item.job_id,
          listing_id: item.listing_id,
          reason: item.reason,
          gate_report_id: item.gate_report_id ?? null,
          status: "open",
          edited_sections: item.edited_sections ?? null,
          created_at: now(),
        })
        .returning();
      return toReview(row!);
    },
    async get(id) {
      const [row] = await db.select().from(s.reviewQueue).where(eq(s.reviewQueue.id, id)).limit(1);
      return row ? toReview(row) : null;
    },
    async list(tenantId, status?: ReviewStatus) {
      const conditions: SQL[] = [eq(s.reviewQueue.tenant_id, tenantId)];
      if (status) conditions.push(eq(s.reviewQueue.status, status));
      const rows = await db
        .select()
        .from(s.reviewQueue)
        .where(and(...conditions))
        .orderBy(asc(s.reviewQueue.created_at), asc(s.reviewQueue.id));
      return rows.map(toReview);
    },
    async resolve(id, status, edited: GenerationResult | null = null) {
      const set: Partial<typeof s.reviewQueue.$inferInsert> = { status, resolved_at: now() };
      if (edited) set.edited_sections = edited;
      const [row] = await db.update(s.reviewQueue).set(set).where(eq(s.reviewQueue.id, id)).returning();
      if (!row) throw new NotFoundError(`Review item ${id} not found`);
      return toReview(row);
    },
  };

  // --- profiles ------------------------------------------------------------
  const profiles: ProfilesRepo = {
    async getGeneration(tenantId, id) {
      if (id) {
        const [row] = await db
          .select()
          .from(s.generationProfiles)
          .where(and(eq(s.generationProfiles.id, id), eq(s.generationProfiles.tenant_id, tenantId)))
          .limit(1);
        if (!row) throw new NotFoundError(`Generation profile ${id} not found`);
        return toGenProfile(row);
      }
      const defId = defaultGenerationProfileId(tenantId);
      const [row] = await db.select().from(s.generationProfiles).where(eq(s.generationProfiles.id, defId)).limit(1);
      if (row) return toGenProfile(row);
      const def = GenerationProfileSchema.parse({ id: defId, tenant_id: tenantId, name: DEFAULT_GENERATION_PROFILE_NAME });
      const at = now();
      await db
        .insert(s.generationProfiles)
        .values({ ...def, created_at: at, updated_at: at })
        .onConflictDoNothing({ target: s.generationProfiles.id });
      const [created] = await db.select().from(s.generationProfiles).where(eq(s.generationProfiles.id, defId)).limit(1);
      return toGenProfile(created!);
    },

    async getVoice(tenantId, id) {
      if (id) {
        const [row] = await db
          .select()
          .from(s.voiceProfiles)
          .where(and(eq(s.voiceProfiles.id, id), or(eq(s.voiceProfiles.tenant_id, tenantId), isNull(s.voiceProfiles.tenant_id))))
          .limit(1);
        return row ? toVoiceProfile(row) : null;
      }
      const defId = defaultVoiceProfileId(tenantId);
      const [row] = await db.select().from(s.voiceProfiles).where(eq(s.voiceProfiles.id, defId)).limit(1);
      if (row) return toVoiceProfile(row);
      const def = VoiceProfileSchema.parse({ id: defId, tenant_id: tenantId, name: DEFAULT_VOICE_PROFILE_NAME, provider: "fake" });
      const at = now();
      await db
        .insert(s.voiceProfiles)
        .values({ ...def, created_at: at, updated_at: at })
        .onConflictDoNothing({ target: s.voiceProfiles.id });
      const [created] = await db.select().from(s.voiceProfiles).where(eq(s.voiceProfiles.id, defId)).limit(1);
      return created ? toVoiceProfile(created) : null;
    },

    async listGeneration(tenantId) {
      const rows = await db
        .select()
        .from(s.generationProfiles)
        .where(eq(s.generationProfiles.tenant_id, tenantId))
        .orderBy(asc(s.generationProfiles.created_at));
      return rows.map(toGenProfile);
    },

    async listVoice(tenantId) {
      const rows = await db
        .select()
        .from(s.voiceProfiles)
        .where(or(eq(s.voiceProfiles.tenant_id, tenantId), isNull(s.voiceProfiles.tenant_id)))
        .orderBy(asc(s.voiceProfiles.created_at));
      return rows.map(toVoiceProfile);
    },

    async saveGeneration(p) {
      const at = now();
      const { id: _id, tenant_id: _t, ...set } = p;
      const [row] = await db
        .insert(s.generationProfiles)
        .values({ ...p, created_at: at, updated_at: at })
        .onConflictDoUpdate({ target: s.generationProfiles.id, set: { ...set, updated_at: at } })
        .returning();
      return toGenProfile(row!);
    },

    async saveVoice(p) {
      const at = now();
      const { id: _id, tenant_id: _t, ...set } = p;
      const [row] = await db
        .insert(s.voiceProfiles)
        .values({ ...p, created_at: at, updated_at: at })
        .onConflictDoUpdate({ target: s.voiceProfiles.id, set: { ...set, updated_at: at } })
        .returning();
      return toVoiceProfile(row!);
    },
  };

  // --- costs ---------------------------------------------------------------
  const costs: CostEventsRepo = {
    async record(e) {
      await db.insert(s.costEvents).values({
        tenant_id: e.tenant_id,
        job_id: e.job_id ?? null,
        step: e.step,
        provider: e.provider,
        model: e.model ?? null,
        input_tokens: e.input_tokens ?? null,
        output_tokens: e.output_tokens ?? null,
        reasoning_tokens: e.reasoning_tokens ?? null,
        chars: e.chars ?? null,
        gpu_seconds: e.gpu_seconds ?? null,
        credits: e.credits ?? null,
        cost_usd: e.cost_usd,
        created_at: now(),
      });
    },
    async totalForTenantMonth(tenantId, month) {
      const { start, end } = monthBounds(month);
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(${s.costEvents.cost_usd}), 0)::double precision` })
        .from(s.costEvents)
        .where(
          and(
            eq(s.costEvents.tenant_id, tenantId),
            sql`${s.costEvents.created_at} >= ${start}`,
            sql`${s.costEvents.created_at} < ${end}`,
          ),
        );
      return Math.round(Number(row?.total ?? 0) * 1e6) / 1e6;
    },
    async listForJob(jobId) {
      const rows = await db
        .select()
        .from(s.costEvents)
        .where(eq(s.costEvents.job_id, jobId))
        .orderBy(asc(s.costEvents.created_at), asc(s.costEvents.id));
      return rows.map(toCostEvent);
    },
    async getBudget(tenantId, month) {
      const [row] = await db
        .select()
        .from(s.tenantBudgets)
        .where(and(eq(s.tenantBudgets.tenant_id, tenantId), eq(s.tenantBudgets.month, month)))
        .limit(1);
      return row
        ? { tenant_id: row.tenant_id, month: row.month, soft_limit_usd: row.soft_limit_usd, hard_limit_usd: row.hard_limit_usd }
        : null;
    },
    async setBudget(b: TenantBudget) {
      const at = now();
      const [row] = await db
        .insert(s.tenantBudgets)
        .values({ ...b, created_at: at, updated_at: at })
        .onConflictDoUpdate({
          target: [s.tenantBudgets.tenant_id, s.tenantBudgets.month],
          set: { soft_limit_usd: b.soft_limit_usd, hard_limit_usd: b.hard_limit_usd, updated_at: at },
        })
        .returning();
      return { tenant_id: row!.tenant_id, month: row!.month, soft_limit_usd: row!.soft_limit_usd, hard_limit_usd: row!.hard_limit_usd };
    },
  };

  // --- webhooks ------------------------------------------------------------
  const webhooks: WebhooksRepo = {
    async listForTenant(tenantId, event?: WebhookEvent) {
      const conditions: SQL[] = [eq(s.webhooks.tenant_id, tenantId), eq(s.webhooks.enabled, true)];
      if (event) conditions.push(sql`${s.webhooks.events} @> ${JSON.stringify([event])}::jsonb`);
      const rows = await db
        .select()
        .from(s.webhooks)
        .where(and(...conditions))
        .orderBy(asc(s.webhooks.created_at), asc(s.webhooks.id));
      return rows.map(toWebhook);
    },
    async get(tenantId, id) {
      const [row] = await db
        .select()
        .from(s.webhooks)
        .where(and(eq(s.webhooks.tenant_id, tenantId), eq(s.webhooks.id, id)))
        .limit(1);
      return row ? toWebhook(row) : null;
    },
    async save(w) {
      const values = {
        id: w.id,
        tenant_id: w.tenant_id,
        url: w.url,
        secret: w.secret,
        events: w.events,
        enabled: w.enabled,
        created_at: new Date(w.created_at),
      };
      const [row] = await db
        .insert(s.webhooks)
        .values(values)
        .onConflictDoUpdate({ target: s.webhooks.id, set: { url: w.url, secret: w.secret, events: w.events, enabled: w.enabled } })
        .returning();
      return toWebhook(row!);
    },
    async delete(tenantId, id) {
      const rows = await db
        .delete(s.webhooks)
        .where(and(eq(s.webhooks.tenant_id, tenantId), eq(s.webhooks.id, id)))
        .returning({ id: s.webhooks.id });
      return rows.length > 0;
    },
    async recordDelivery(d) {
      const values = {
        id: d.id,
        tenant_id: d.tenant_id,
        webhook_id: d.webhook_id,
        event: d.event,
        payload: d.payload,
        status: d.status,
        attempts: d.attempts,
        last_error: d.last_error,
        next_attempt_at: dateN(d.next_attempt_at),
        created_at: new Date(d.created_at),
      };
      const { id: _id, created_at: _c, ...set } = values;
      const [row] = await db
        .insert(s.webhookDeliveries)
        .values(values)
        .onConflictDoUpdate({ target: s.webhookDeliveries.id, set })
        .returning();
      return toDelivery(row!);
    },
    async deliveries(webhookId, limit = 50) {
      const rows = await db
        .select()
        .from(s.webhookDeliveries)
        .where(eq(s.webhookDeliveries.webhook_id, webhookId))
        .orderBy(desc(s.webhookDeliveries.created_at), desc(s.webhookDeliveries.id))
        .limit(Math.max(1, Math.min(limit, 500)));
      return rows.map(toDelivery);
    },
  };

  // --- tts cache -----------------------------------------------------------
  const ttsCache: TtsCacheRepo = {
    async get(textHash, voiceProfileId) {
      const [row] = await db
        .select({ narration_id: s.ttsCache.narration_id })
        .from(s.ttsCache)
        .where(and(eq(s.ttsCache.text_hash, textHash), eq(s.ttsCache.voice_profile_id, voiceProfileId)))
        .limit(1);
      return row ? row.narration_id : null;
    },
    async set(textHash, voiceProfileId, narrationId) {
      const [n] = await db
        .select({ tenant_id: s.narrations.tenant_id })
        .from(s.narrations)
        .where(eq(s.narrations.id, narrationId))
        .limit(1);
      if (!n) throw new NotFoundError(`Narration ${narrationId} not found`);
      await db
        .insert(s.ttsCache)
        .values({ tenant_id: n.tenant_id, text_hash: textHash, voice_profile_id: voiceProfileId, narration_id: narrationId, created_at: now() })
        .onConflictDoUpdate({
          target: [s.ttsCache.text_hash, s.ttsCache.voice_profile_id],
          set: { narration_id: narrationId, tenant_id: n.tenant_id },
        });
    },
  };

  // --- saved searches ------------------------------------------------------
  const savedSearches: SavedSearchesRepo = {
    async listEnabled(tenantId?: string) {
      const conditions: SQL[] = [eq(s.savedSearches.enabled, true)];
      if (tenantId) conditions.push(eq(s.savedSearches.tenant_id, tenantId));
      const rows = await db
        .select()
        .from(s.savedSearches)
        .where(and(...conditions))
        .orderBy(asc(s.savedSearches.created_at), asc(s.savedSearches.id));
      return rows.map(toSavedSearch);
    },
    async list(tenantId) {
      const rows = await db
        .select()
        .from(s.savedSearches)
        .where(eq(s.savedSearches.tenant_id, tenantId))
        .orderBy(asc(s.savedSearches.created_at), asc(s.savedSearches.id));
      return rows.map(toSavedSearch);
    },
    async get(tenantId, id) {
      const [row] = await db
        .select()
        .from(s.savedSearches)
        .where(and(eq(s.savedSearches.tenant_id, tenantId), eq(s.savedSearches.id, id)))
        .limit(1);
      return row ? toSavedSearch(row) : null;
    },
    async save(search) {
      const values = {
        id: search.id,
        tenant_id: search.tenant_id,
        source: search.source,
        query: search.query,
        cron: search.cron,
        enabled: search.enabled,
        max_pages: search.max_pages,
        max_credits_per_run: search.max_credits_per_run,
        last_run_at: dateN(search.last_run_at),
        created_at: now(),
      };
      const { id: _id, tenant_id: _t, created_at: _c, ...set } = values;
      const [row] = await db
        .insert(s.savedSearches)
        .values(values)
        .onConflictDoUpdate({ target: s.savedSearches.id, set })
        .returning();
      return toSavedSearch(row!);
    },
    async delete(tenantId, id) {
      const rows = await db
        .delete(s.savedSearches)
        .where(and(eq(s.savedSearches.tenant_id, tenantId), eq(s.savedSearches.id, id)))
        .returning({ id: s.savedSearches.id });
      return rows.length > 0;
    },
    async markRun(id, at) {
      await db.update(s.savedSearches).set({ last_run_at: at }).where(eq(s.savedSearches.id, id));
    },
  };

  // --- ingest runs ---------------------------------------------------------
  const ingestRuns: IngestRunsRepo = {
    async save(run) {
      const values = {
        id: run.id,
        tenant_id: run.tenant_id,
        saved_search_id: run.saved_search_id,
        source: run.source,
        status: run.status,
        page: run.page,
        next_cursor: run.next_cursor,
        items_seen: run.items_seen,
        items_new: run.items_new,
        items_changed: run.items_changed,
        credits_used: run.credits_used,
        error: run.error,
        started_at: new Date(run.started_at),
        finished_at: dateN(run.finished_at),
      };
      const { id: _id, tenant_id: _t, ...set } = values;
      const [row] = await db
        .insert(s.ingestRuns)
        .values(values)
        .onConflictDoUpdate({ target: s.ingestRuns.id, set })
        .returning();
      return toIngestRun(row!);
    },
    async get(id) {
      const [row] = await db.select().from(s.ingestRuns).where(eq(s.ingestRuns.id, id)).limit(1);
      return row ? toIngestRun(row) : null;
    },
    async list(tenantId, opts = {}) {
      const conditions: SQL[] = [eq(s.ingestRuns.tenant_id, tenantId)];
      if (opts.saved_search_id) conditions.push(eq(s.ingestRuns.saved_search_id, opts.saved_search_id));
      const rows = await db
        .select()
        .from(s.ingestRuns)
        .where(and(...conditions))
        .orderBy(desc(s.ingestRuns.started_at), desc(s.ingestRuns.id))
        .limit(Math.max(1, Math.min(opts.limit ?? 50, 500)));
      return rows.map(toIngestRun);
    },
    async latestForSearch(savedSearchId) {
      const [row] = await db
        .select()
        .from(s.ingestRuns)
        .where(eq(s.ingestRuns.saved_search_id, savedSearchId))
        .orderBy(desc(s.ingestRuns.started_at), desc(s.ingestRuns.id))
        .limit(1);
      return row ? toIngestRun(row) : null;
    },
  };

  // --- api keys ------------------------------------------------------------
  const apiKeys: ApiKeysRepo = {
    async findByHash(keyHash) {
      const [row] = await db.select().from(s.apiKeys).where(eq(s.apiKeys.key_hash, keyHash)).limit(1);
      return row ? toApiKey(row) : null;
    },
    async create(k) {
      const [row] = await db
        .insert(s.apiKeys)
        .values({
          id: k.id,
          tenant_id: k.tenant_id,
          prefix: k.prefix,
          key_hash: k.key_hash,
          scopes: k.scopes,
          last_used_at: dateN(k.last_used_at),
          revoked_at: dateN(k.revoked_at),
          created_at: new Date(k.created_at),
        })
        .returning();
      return toApiKey(row!);
    },
    async list(tenantId) {
      const rows = await db
        .select()
        .from(s.apiKeys)
        .where(eq(s.apiKeys.tenant_id, tenantId))
        .orderBy(asc(s.apiKeys.created_at), asc(s.apiKeys.id));
      return rows.map(toApiKey);
    },
    async touch(id, at) {
      await db.update(s.apiKeys).set({ last_used_at: at }).where(eq(s.apiKeys.id, id));
    },
    async revoke(tenantId, id, at) {
      const rows = await db
        .update(s.apiKeys)
        .set({ revoked_at: at })
        .where(and(eq(s.apiKeys.tenant_id, tenantId), eq(s.apiKeys.id, id)))
        .returning({ id: s.apiKeys.id });
      return rows.length > 0;
    },
  };

  return {
    tenants,
    listings,
    jobs,
    generations,
    gateReports,
    narrations,
    outputs,
    reviews,
    profiles,
    costs,
    webhooks,
    ttsCache,
    savedSearches,
    ingestRuns,
    apiKeys,
  };
}
