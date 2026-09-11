/**
 * In-memory implementation of every repository. Used by unit tests, the CLI smoke and CI, and
 * as the executable specification for `postgres.ts`. All returned objects are copies.
 */
import {
  GenerationProfile as GenerationProfileSchema,
  ListingInput as ListingInputSchema,
  NotFoundError,
  Tenant as TenantSchema,
  VoiceProfile as VoiceProfileSchema,
  computeContentHash,
  computeFingerprint,
  idempotencyKey,
  newId,
  systemClock,
  type ApiKey,
  type Clock,
  type CostEvent,
  type GateReport,
  type GenerationProfile,
  type GenerationRecord,
  type GenerationResult,
  type IngestRun,
  type Job,
  type JobOutput,
  type JobStepRecord,
  type Listing,
  type ListingInput,
  type ListingVersion,
  type NarrationResult,
  type ReviewItem,
  type SavedSearch,
  type SourceId,
  type Tenant,
  type TenantAgency,
  type VoiceProfile,
  type Webhook,
  type WebhookEvent,
} from "@imovel/core";
import { isNearDuplicate } from "./dedup";
import {
  decodeCursor,
  defaultGenerationProfileId,
  defaultVoiceProfileId,
  encodeCursor,
  monthOf,
  slugify,
} from "./ids";
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
  ListingGroupMember,
  ListingsRepo,
  NarrationsRepo,
  NearDuplicateTolerance,
  OutputsRepo,
  Page,
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

export const DEFAULT_GENERATION_PROFILE_NAME = "Perfil predefinido";
export const DEFAULT_VOICE_PROFILE_NAME = "Voz de teste (fake)";

const clone = <T>(v: T): T => structuredClone(v);
const byIso = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface MemoryReposOptions {
  clock?: Clock;
}

interface StoredListing {
  listing: Listing;
  last_seen_at: string;
  created_at: string;
  /** Insertion order, tie-breaker for stable pagination. */
  seq: number;
}

export function createMemoryRepos(opts: MemoryReposOptions = {}): Repos {
  const clock = opts.clock ?? systemClock;
  const nowIso = () => clock.now().toISOString();

  // --- state ---------------------------------------------------------------
  const tenants = new Map<string, Tenant>();
  const agencies: TenantAgency[] = [];
  const listings = new Map<string, StoredListing>();
  const listingIndex = new Map<string, string>();
  const versions = new Map<string, ListingVersion & { tenant_id: string }>();
  const groups = new Map<string, ListingGroupMember & { tenant_id: string }>();
  const jobs = new Map<string, Job>();
  const jobsByKey = new Map<string, string>();
  const steps = new Map<string, JobStepRecord>();
  const generations = new Map<string, GenerationRecord>();
  const gateReports = new Map<string, GateReport>();
  const narrations = new Map<string, NarrationResult>();
  const outputs = new Map<string, JobOutput>();
  const reviews = new Map<string, ReviewItem>();
  const generationProfiles = new Map<string, GenerationProfile>();
  const voiceProfiles = new Map<string, VoiceProfile>();
  const costEvents: Array<{ event: CostEvent; created_at: string; seq: number }> = [];
  const budgets = new Map<string, TenantBudget>();
  const webhooks = new Map<string, Webhook>();
  const deliveries = new Map<string, WebhookDelivery>();
  const ttsCache = new Map<string, string>();
  const savedSearches = new Map<string, SavedSearch>();
  const ingestRuns = new Map<string, IngestRun>();
  const apiKeys = new Map<string, ApiKey>();
  let seq = 0;

  const sourceKey = (tenantId: string, source: string, sourceId: string) => `${tenantId}|${source}|${sourceId}`;

  // --- tenants -------------------------------------------------------------
  const tenantsRepo: TenantsRepo = {
    async ensureDefault(id, name) {
      const existing = tenants.get(id);
      if (existing) return clone(existing);
      const label = name ?? "Default tenant";
      const tenant = TenantSchema.parse({
        id,
        name: label,
        slug: `${slugify(label)}-${id.slice(0, 8)}`,
        created_at: nowIso(),
      });
      tenants.set(id, tenant);
      return clone(tenant);
    },
    async get(id) {
      const t = tenants.get(id);
      return t ? clone(t) : null;
    },
    async save(tenant) {
      tenants.set(tenant.id, clone(tenant));
      return clone(tenant);
    },
    async agencyIds(tenantId, source) {
      return agencies.filter((a) => a.tenant_id === tenantId && a.source === source).map((a) => a.agency_id);
    },
    async addAgency(agency) {
      const idx = agencies.findIndex(
        (a) => a.tenant_id === agency.tenant_id && a.source === agency.source && a.agency_id === agency.agency_id,
      );
      if (idx >= 0) agencies[idx] = clone(agency);
      else agencies.push(clone(agency));
    },
  };

  // --- listings ------------------------------------------------------------
  const listingsRepo: ListingsRepo = {
    async upsertFromInput(tenantId, rawInput, now): Promise<UpsertResult> {
      const input = ListingInputSchema.parse(rawInput);
      const at = (now ?? clock.now()).toISOString();
      const content_hash = computeContentHash(input);
      const fingerprint = computeFingerprint(input);
      const key = sourceKey(tenantId, input.source, input.source_id);
      const existingId = listingIndex.get(key);

      const addVersion = (listingId: string): string => {
        const version: ListingVersion & { tenant_id: string } = {
          id: newId(),
          tenant_id: tenantId,
          listing_id: listingId,
          content_hash,
          snapshot: clone(input),
          created_at: at,
        };
        versions.set(version.id, version);
        return version.id;
      };

      if (!existingId) {
        const id = newId();
        const listing: Listing = { ...clone(input), id, tenant_id: tenantId, fetched_at: at, content_hash, fingerprint };
        listings.set(id, { listing, last_seen_at: at, created_at: at, seq: ++seq });
        listingIndex.set(key, id);
        return { listing: clone(listing), status: "new", version_id: addVersion(id) };
      }

      const stored = listings.get(existingId)!;
      const changed = stored.listing.content_hash !== content_hash;
      stored.listing = { ...clone(input), id: existingId, tenant_id: tenantId, fetched_at: at, content_hash, fingerprint };
      stored.last_seen_at = at;
      if (!changed) return { listing: clone(stored.listing), status: "unchanged", version_id: null };
      return { listing: clone(stored.listing), status: "changed", version_id: addVersion(existingId) };
    },

    async getById(tenantId, id) {
      const s = listings.get(id);
      return s && s.listing.tenant_id === tenantId ? clone(s.listing) : null;
    },

    async getBySource(tenantId, source, sourceId) {
      const id = listingIndex.get(sourceKey(tenantId, source, sourceId));
      return id ? clone(listings.get(id)!.listing) : null;
    },

    async list(tenantId, opts: ListOptions = {}): Promise<Page<Listing>> {
      const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
      const cursor = decodeCursor(opts.cursor);
      const rows = [...listings.values()]
        .filter((s) => s.listing.tenant_id === tenantId)
        .filter((s) => (opts.ownership ? s.listing.ownership === opts.ownership : true))
        .sort((a, b) => byIso(b.created_at, a.created_at) || b.seq - a.seq);
      const start = cursor ? rows.findIndex((s) => s.created_at === cursor.created_at && s.listing.id === cursor.id) + 1 : 0;
      const page = rows.slice(start, start + limit);
      const last = page[page.length - 1];
      const hasMore = start + limit < rows.length;
      return {
        items: page.map((s) => clone(s.listing)),
        next: hasMore && last ? encodeCursor({ created_at: last.created_at, id: last.listing.id }) : null,
      };
    },

    async findNearDuplicates(listing, tol?: Partial<NearDuplicateTolerance>) {
      return [...listings.values()]
        .filter((s) => isNearDuplicate(listing, s.listing, tol))
        .sort((a, b) => byIso(a.created_at, b.created_at) || a.seq - b.seq)
        .map((s) => clone(s.listing));
    },

    async versions(tenantId, listingId) {
      return [...versions.values()]
        .filter((v) => v.tenant_id === tenantId && v.listing_id === listingId)
        .sort((a, b) => byIso(a.created_at, b.created_at))
        .map(({ tenant_id: _t, ...v }) => clone(v));
    },

    async getVersion(tenantId, versionId) {
      const v = versions.get(versionId);
      if (!v || v.tenant_id !== tenantId) return null;
      const { tenant_id: _t, ...rest } = v;
      return clone(rest);
    },

    async setGroup(tenantId, member) {
      groups.set(member.listing_id, { ...clone(member), tenant_id: tenantId });
    },

    async groupOf(tenantId, listingId) {
      const g = groups.get(listingId);
      if (!g || g.tenant_id !== tenantId) return null;
      const { tenant_id: _t, ...rest } = g;
      return clone(rest);
    },

    async groupMembers(tenantId, groupId) {
      return [...groups.values()]
        .filter((g) => g.tenant_id === tenantId && g.group_id === groupId)
        .map(({ tenant_id: _t, ...g }) => clone(g));
    },
  };

  // --- jobs ----------------------------------------------------------------
  const jobsRepo: JobsRepo = {
    async create(input: CreateJobInput) {
      const stored = listings.get(input.listing_id);
      if (!stored || stored.listing.tenant_id !== input.tenant_id) {
        throw new NotFoundError(`Listing ${input.listing_id} not found for tenant ${input.tenant_id}`);
      }
      let content_hash = stored.listing.content_hash;
      if (input.listing_version_id) {
        const v = versions.get(input.listing_version_id);
        if (v) content_hash = v.content_hash;
      }
      const key = idempotencyKey([
        input.listing_id,
        content_hash,
        input.generation_profile_id,
        input.voice_profile_id ?? null,
        input.pipeline_version ?? null,
      ]);
      const existingId = jobsByKey.get(key);
      if (existingId) return { job: clone(jobs.get(existingId)!), created: false };
      const at = nowIso();
      const job: Job = {
        id: newId(),
        tenant_id: input.tenant_id,
        listing_id: input.listing_id,
        listing_version_id: input.listing_version_id ?? null,
        generation_profile_id: input.generation_profile_id,
        voice_profile_id: input.voice_profile_id ?? null,
        status: "queued",
        loop: 0,
        attempt: 0,
        current_step: null,
        idempotency_key: key,
        require_audio: input.require_audio ?? true,
        last_error: null,
        created_at: at,
        updated_at: at,
        finished_at: null,
      };
      jobs.set(job.id, job);
      jobsByKey.set(key, job.id);
      return { job: clone(job), created: true };
    },

    async get(id) {
      const j = jobs.get(id);
      return j ? clone(j) : null;
    },

    async getByIdempotencyKey(key) {
      const id = jobsByKey.get(key);
      return id ? clone(jobs.get(id)!) : null;
    },

    async list(tenantId, opts: JobListOptions = {}) {
      const statuses = opts.status ? (Array.isArray(opts.status) ? opts.status : [opts.status]) : null;
      const limit = Math.max(1, Math.min(opts.limit ?? 100, 1000));
      return [...jobs.values()]
        .filter((j) => j.tenant_id === tenantId)
        .filter((j) => (statuses ? statuses.includes(j.status) : true))
        .filter((j) => (opts.listing_id ? j.listing_id === opts.listing_id : true))
        .sort((a, b) => byIso(b.created_at, a.created_at))
        .slice(0, limit)
        .map(clone);
    },

    async update(id, patch) {
      const j = jobs.get(id);
      if (!j) throw new NotFoundError(`Job ${id} not found`);
      const { id: _id, created_at: _c, ...rest } = patch;
      const next: Job = { ...j, ...clone(rest), updated_at: nowIso() };
      jobs.set(id, next);
      return clone(next);
    },

    async addStep(step) {
      const rec: JobStepRecord = { ...clone(step), id: newId() };
      steps.set(rec.id, rec);
      return clone(rec);
    },

    async steps(jobId) {
      return [...steps.values()]
        .filter((s) => s.job_id === jobId)
        .sort((a, b) => byIso(a.started_at, b.started_at))
        .map(clone);
    },
  };

  // --- generations / gate reports / narrations / outputs ---------------------
  const generationsRepo: GenerationsRepo = {
    async save(rec) {
      generations.set(rec.id, clone(rec));
    },
    async get(id) {
      const g = generations.get(id);
      return g ? clone(g) : null;
    },
    async listForJob(jobId) {
      return [...generations.values()]
        .filter((g) => g.job_id === jobId)
        .sort((a, b) => byIso(a.created_at, b.created_at))
        .map(clone);
    },
    async latestForJob(jobId) {
      const all = await generationsRepo.listForJob(jobId);
      return all.length ? all[all.length - 1]! : null;
    },
  };

  const gateReportsRepo: GateReportsRepo = {
    async save(report) {
      gateReports.set(report.id, clone(report));
    },
    async get(id) {
      const r = gateReports.get(id);
      return r ? clone(r) : null;
    },
    async listForJob(jobId) {
      return [...gateReports.values()]
        .filter((r) => r.job_id === jobId)
        .sort((a, b) => byIso(a.created_at, b.created_at))
        .map(clone);
    },
    async latestForJob(jobId) {
      const all = await gateReportsRepo.listForJob(jobId);
      return all.length ? all[all.length - 1]! : null;
    },
  };

  const narrationsRepo: NarrationsRepo = {
    async save(n) {
      narrations.set(n.id, clone(n));
    },
    async get(id) {
      const n = narrations.get(id);
      return n ? clone(n) : null;
    },
    async latestForJob(jobId) {
      const all = [...narrations.values()]
        .filter((n) => n.job_id === jobId)
        .sort((a, b) => byIso(a.created_at, b.created_at));
      return all.length ? clone(all[all.length - 1]!) : null;
    },
  };

  const outputsRepo: OutputsRepo = {
    async save(o) {
      outputs.set(o.id, clone(o));
    },
    async get(id) {
      const o = outputs.get(id);
      return o ? clone(o) : null;
    },
    async latestForListing(tenantId, listingId) {
      const all = [...outputs.values()]
        .filter((o) => o.tenant_id === tenantId && o.listing_id === listingId)
        .sort((a, b) => byIso(a.published_at, b.published_at));
      return all.length ? clone(all[all.length - 1]!) : null;
    },
    async getForJob(jobId) {
      const all = [...outputs.values()]
        .filter((o) => o.job_id === jobId)
        .sort((a, b) => byIso(a.published_at, b.published_at));
      return all.length ? clone(all[all.length - 1]!) : null;
    },
  };

  // --- reviews -------------------------------------------------------------
  const reviewsRepo: ReviewsRepo = {
    async create(item) {
      const rec: ReviewItem = {
        ...clone(item),
        id: newId(),
        status: "open",
        created_at: nowIso(),
        resolved_at: null,
      };
      reviews.set(rec.id, rec);
      return clone(rec);
    },
    async get(id) {
      const r = reviews.get(id);
      return r ? clone(r) : null;
    },
    async list(tenantId, status?: ReviewStatus) {
      return [...reviews.values()]
        .filter((r) => r.tenant_id === tenantId)
        .filter((r) => (status ? r.status === status : true))
        .sort((a, b) => byIso(a.created_at, b.created_at))
        .map(clone);
    },
    async resolve(id, status, edited: GenerationResult | null = null) {
      const r = reviews.get(id);
      if (!r) throw new NotFoundError(`Review item ${id} not found`);
      const next: ReviewItem = {
        ...r,
        status,
        edited_sections: edited ? clone(edited) : r.edited_sections,
        resolved_at: nowIso(),
      };
      reviews.set(id, next);
      return clone(next);
    },
  };

  // --- profiles ------------------------------------------------------------
  const profilesRepo: ProfilesRepo = {
    async getGeneration(tenantId, id) {
      if (id) {
        const p = generationProfiles.get(id);
        if (!p || p.tenant_id !== tenantId) throw new NotFoundError(`Generation profile ${id} not found`);
        return clone(p);
      }
      const defId = defaultGenerationProfileId(tenantId);
      let p = generationProfiles.get(defId);
      if (!p) {
        p = GenerationProfileSchema.parse({ id: defId, tenant_id: tenantId, name: DEFAULT_GENERATION_PROFILE_NAME });
        generationProfiles.set(defId, p);
      }
      return clone(p);
    },
    async getVoice(tenantId, id) {
      if (id) {
        const p = voiceProfiles.get(id);
        return p && (p.tenant_id === tenantId || p.tenant_id === null) ? clone(p) : null;
      }
      const defId = defaultVoiceProfileId(tenantId);
      let p = voiceProfiles.get(defId);
      if (!p) {
        p = VoiceProfileSchema.parse({ id: defId, tenant_id: tenantId, name: DEFAULT_VOICE_PROFILE_NAME, provider: "fake" });
        voiceProfiles.set(defId, p);
      }
      return clone(p);
    },
    async listGeneration(tenantId) {
      return [...generationProfiles.values()].filter((p) => p.tenant_id === tenantId).map(clone);
    },
    async listVoice(tenantId) {
      return [...voiceProfiles.values()].filter((p) => p.tenant_id === tenantId || p.tenant_id === null).map(clone);
    },
    async saveGeneration(p) {
      generationProfiles.set(p.id, clone(p));
      return clone(p);
    },
    async saveVoice(p) {
      voiceProfiles.set(p.id, clone(p));
      return clone(p);
    },
  };

  // --- costs ---------------------------------------------------------------
  const costsRepo: CostEventsRepo = {
    async record(event) {
      costEvents.push({ event: clone(event), created_at: nowIso(), seq: ++seq });
    },
    async totalForTenantMonth(tenantId, month) {
      const total = costEvents
        .filter((c) => c.event.tenant_id === tenantId && monthOf(new Date(c.created_at)) === month)
        .reduce((sum, c) => sum + c.event.cost_usd, 0);
      return Math.round(total * 1e6) / 1e6;
    },
    async listForJob(jobId) {
      return costEvents
        .filter((c) => c.event.job_id === jobId)
        .sort((a, b) => a.seq - b.seq)
        .map((c) => clone(c.event));
    },
    async getBudget(tenantId, month) {
      const b = budgets.get(`${tenantId}|${month}`);
      return b ? clone(b) : null;
    },
    async setBudget(budget) {
      budgets.set(`${budget.tenant_id}|${budget.month}`, clone(budget));
      return clone(budget);
    },
  };

  // --- webhooks ------------------------------------------------------------
  const webhooksRepo: WebhooksRepo = {
    async listForTenant(tenantId, event?: WebhookEvent) {
      return [...webhooks.values()]
        .filter((w) => w.tenant_id === tenantId && w.enabled)
        .filter((w) => (event ? w.events.includes(event) : true))
        .sort((a, b) => byIso(a.created_at, b.created_at))
        .map(clone);
    },
    async get(tenantId, id) {
      const w = webhooks.get(id);
      return w && w.tenant_id === tenantId ? clone(w) : null;
    },
    async save(w) {
      webhooks.set(w.id, clone(w));
      return clone(w);
    },
    async delete(tenantId, id) {
      const w = webhooks.get(id);
      if (!w || w.tenant_id !== tenantId) return false;
      webhooks.delete(id);
      return true;
    },
    async recordDelivery(d) {
      deliveries.set(d.id, clone(d));
      return clone(d);
    },
    async deliveries(webhookId, limit = 50) {
      return [...deliveries.values()]
        .filter((d) => d.webhook_id === webhookId)
        .sort((a, b) => byIso(b.created_at, a.created_at))
        .slice(0, limit)
        .map(clone);
    },
  };

  // --- tts cache -----------------------------------------------------------
  const ttsCacheRepo: TtsCacheRepo = {
    async get(textHash, voiceProfileId) {
      return ttsCache.get(`${textHash}|${voiceProfileId}`) ?? null;
    },
    async set(textHash, voiceProfileId, narrationId) {
      ttsCache.set(`${textHash}|${voiceProfileId}`, narrationId);
    },
  };

  // --- saved searches / ingest runs ------------------------------------------
  const savedSearchesRepo: SavedSearchesRepo = {
    async listEnabled(tenantId?: string) {
      return [...savedSearches.values()]
        .filter((s) => s.enabled && (tenantId ? s.tenant_id === tenantId : true))
        .map(clone);
    },
    async list(tenantId) {
      return [...savedSearches.values()].filter((s) => s.tenant_id === tenantId).map(clone);
    },
    async get(tenantId, id) {
      const s = savedSearches.get(id);
      return s && s.tenant_id === tenantId ? clone(s) : null;
    },
    async save(s) {
      savedSearches.set(s.id, clone(s));
      return clone(s);
    },
    async delete(tenantId, id) {
      const s = savedSearches.get(id);
      if (!s || s.tenant_id !== tenantId) return false;
      savedSearches.delete(id);
      return true;
    },
    async markRun(id, at) {
      const s = savedSearches.get(id);
      if (s) s.last_run_at = at.toISOString();
    },
  };

  const ingestRunsRepo: IngestRunsRepo = {
    async save(run) {
      ingestRuns.set(run.id, clone(run));
      return clone(run);
    },
    async get(id) {
      const r = ingestRuns.get(id);
      return r ? clone(r) : null;
    },
    async list(tenantId, opts = {}) {
      const limit = Math.max(1, Math.min(opts.limit ?? 50, 500));
      return [...ingestRuns.values()]
        .filter((r) => r.tenant_id === tenantId)
        .filter((r) => (opts.saved_search_id ? r.saved_search_id === opts.saved_search_id : true))
        .sort((a, b) => byIso(b.started_at, a.started_at))
        .slice(0, limit)
        .map(clone);
    },
    async latestForSearch(savedSearchId) {
      const all = [...ingestRuns.values()]
        .filter((r) => r.saved_search_id === savedSearchId)
        .sort((a, b) => byIso(b.started_at, a.started_at));
      return all.length ? clone(all[0]!) : null;
    },
  };

  // --- api keys ------------------------------------------------------------
  const apiKeysRepo: ApiKeysRepo = {
    async findByHash(keyHash) {
      const k = [...apiKeys.values()].find((k) => k.key_hash === keyHash);
      return k ? clone(k) : null;
    },
    async create(key) {
      apiKeys.set(key.id, clone(key));
      return clone(key);
    },
    async list(tenantId) {
      return [...apiKeys.values()].filter((k) => k.tenant_id === tenantId).map(clone);
    },
    async touch(id, at) {
      const k = apiKeys.get(id);
      if (k) k.last_used_at = at.toISOString();
    },
    async revoke(tenantId, id, at) {
      const k = apiKeys.get(id);
      if (!k || k.tenant_id !== tenantId) return false;
      k.revoked_at = at.toISOString();
      return true;
    },
  };

  return {
    tenants: tenantsRepo,
    listings: listingsRepo,
    jobs: jobsRepo,
    generations: generationsRepo,
    gateReports: gateReportsRepo,
    narrations: narrationsRepo,
    outputs: outputsRepo,
    reviews: reviewsRepo,
    profiles: profilesRepo,
    costs: costsRepo,
    webhooks: webhooksRepo,
    ttsCache: ttsCacheRepo,
    savedSearches: savedSearchesRepo,
    ingestRuns: ingestRunsRepo,
    apiKeys: apiKeysRepo,
  };
}

export type { SourceId, ListingInput };
