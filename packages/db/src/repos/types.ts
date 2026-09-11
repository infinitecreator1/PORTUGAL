/**
 * Repository contracts. Two implementations: `createMemoryRepos()` (tests, CLI smoke, CI) and
 * `createPostgresRepos(db)` (production). Every method is async and takes `tenantId` wherever the
 * row is tenant-scoped, because the Postgres connection uses the service role which bypasses RLS.
 */
import { z } from "zod";
import type {
  ApiKey,
  CostEvent,
  CostLedger,
  GateReport,
  GenerationProfile,
  GenerationRecord,
  GenerationResult,
  IngestRun,
  Job,
  JobOutput,
  JobStatus,
  JobStepRecord,
  Listing,
  ListingInput,
  ListingVersion,
  NarrationResult,
  Ownership,
  ReviewItem,
  SavedSearch,
  SourceId,
  Tenant,
  TenantAgency,
  VoiceProfile,
  Webhook,
  WebhookEvent,
} from "@imovel/core";
import { WebhookEvent as WebhookEventSchema } from "@imovel/core";

// ---------------------------------------------------------------------------
// db-owned row types (not part of @imovel/core)
// ---------------------------------------------------------------------------

export const WebhookDelivery = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  webhook_id: z.string().uuid(),
  event: WebhookEventSchema,
  payload: z.record(z.unknown()),
  status: z.enum(["pending", "delivered", "failed"]).default("pending"),
  attempts: z.number().int().nonnegative().default(0),
  last_error: z.string().nullable().default(null),
  next_attempt_at: z.string().datetime().nullable().default(null),
  created_at: z.string().datetime(),
});
export type WebhookDelivery = z.infer<typeof WebhookDelivery>;

export const TenantBudget = z.object({
  tenant_id: z.string().uuid(),
  /** Calendar month `YYYY-MM` (UTC). */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  soft_limit_usd: z.number().nonnegative().nullable().default(null),
  hard_limit_usd: z.number().nonnegative().nullable().default(null),
});
export type TenantBudget = z.infer<typeof TenantBudget>;

export interface ListingGroupMember {
  group_id: string;
  listing_id: string;
  canonical: boolean;
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface TenantsRepo {
  /** Creates the tenant when missing (idempotent); used for `DEFAULT_TENANT_ID` at start-up. */
  ensureDefault(id: string, name?: string): Promise<Tenant>;
  get(id: string): Promise<Tenant | null>;
  save(tenant: Tenant): Promise<Tenant>;
  /** Agency identifiers registered by the tenant for a source (ownership auto-detection). */
  agencyIds(tenantId: string, source: SourceId): Promise<string[]>;
  addAgency(agency: TenantAgency): Promise<void>;
}

export type UpsertStatus = "new" | "changed" | "unchanged";

export interface UpsertResult {
  listing: Listing;
  status: UpsertStatus;
  /** Id of the `listing_versions` row created for `new` and `changed`; null for `unchanged`. */
  version_id: string | null;
}

export interface ListOptions {
  limit?: number;
  cursor?: string | null;
  ownership?: Ownership;
}

export interface Page<T> {
  items: T[];
  next: string | null;
}

export interface NearDuplicateTolerance {
  /** Relative tolerance on useful_m2 or gross_m2. Default 0.03. */
  area: number;
  /** Relative tolerance on price. Default 0.02. */
  price: number;
}

export const DEFAULT_NEAR_DUPLICATE_TOLERANCE: NearDuplicateTolerance = { area: 0.03, price: 0.02 };

export interface ListingsRepo {
  /**
   * Insert or update by `(tenant_id, source, source_id)`. Computes `content_hash` and
   * `fingerprint` with `@imovel/core`; a material change inserts a `listing_versions` row.
   * `fetched_at`/`last_seen_at` churn never creates a version.
   */
  upsertFromInput(tenantId: string, input: ListingInput, now?: Date): Promise<UpsertResult>;
  getById(tenantId: string, id: string): Promise<Listing | null>;
  getBySource(tenantId: string, source: SourceId, sourceId: string): Promise<Listing | null>;
  list(tenantId: string, opts?: ListOptions): Promise<Page<Listing>>;
  /**
   * Same tenant, transaction, typology, municipality and parish; area within `tol.area` on
   * useful_m2 or gross_m2; price within `tol.price` (or both null). Excludes the listing itself.
   */
  findNearDuplicates(listing: Listing, tol?: Partial<NearDuplicateTolerance>): Promise<Listing[]>;
  versions(tenantId: string, listingId: string): Promise<ListingVersion[]>;
  getVersion(tenantId: string, versionId: string): Promise<ListingVersion | null>;
  setGroup(tenantId: string, member: ListingGroupMember): Promise<void>;
  groupOf(tenantId: string, listingId: string): Promise<ListingGroupMember | null>;
  groupMembers(tenantId: string, groupId: string): Promise<ListingGroupMember[]>;
}

export interface CreateJobInput {
  tenant_id: string;
  listing_id: string;
  listing_version_id?: string | null;
  generation_profile_id: string;
  voice_profile_id?: string | null;
  require_audio?: boolean;
  /** Bumping this re-runs listings whose content did not change. */
  pipeline_version?: string;
}

export interface JobListOptions {
  status?: JobStatus | JobStatus[];
  listing_id?: string;
  limit?: number;
}

export interface JobsRepo {
  /**
   * Idempotent on `idempotencyKey([listing_id, content_hash, generation_profile_id,
   * voice_profile_id, pipeline_version])`; returns the existing job with `created: false`.
   */
  create(input: CreateJobInput): Promise<{ job: Job; created: boolean }>;
  get(id: string): Promise<Job | null>;
  getByIdempotencyKey(key: string): Promise<Job | null>;
  list(tenantId: string, opts?: JobListOptions): Promise<Job[]>;
  update(id: string, patch: Partial<Job>): Promise<Job>;
  addStep(step: Omit<JobStepRecord, "id">): Promise<JobStepRecord>;
  steps(jobId: string): Promise<JobStepRecord[]>;
}

export interface GenerationsRepo {
  save(rec: GenerationRecord): Promise<void>;
  get(id: string): Promise<GenerationRecord | null>;
  latestForJob(jobId: string): Promise<GenerationRecord | null>;
  listForJob(jobId: string): Promise<GenerationRecord[]>;
}

export interface GateReportsRepo {
  save(report: GateReport): Promise<void>;
  get(id: string): Promise<GateReport | null>;
  listForJob(jobId: string): Promise<GateReport[]>;
  latestForJob(jobId: string): Promise<GateReport | null>;
}

export interface NarrationsRepo {
  save(narration: NarrationResult): Promise<void>;
  get(id: string): Promise<NarrationResult | null>;
  latestForJob(jobId: string): Promise<NarrationResult | null>;
}

export interface OutputsRepo {
  save(output: JobOutput): Promise<void>;
  get(id: string): Promise<JobOutput | null>;
  latestForListing(tenantId: string, listingId: string): Promise<JobOutput | null>;
  getForJob(jobId: string): Promise<JobOutput | null>;
}

export type ReviewStatus = ReviewItem["status"];

export interface ReviewsRepo {
  create(item: Omit<ReviewItem, "id" | "created_at" | "status" | "resolved_at">): Promise<ReviewItem>;
  get(id: string): Promise<ReviewItem | null>;
  list(tenantId: string, status?: ReviewStatus): Promise<ReviewItem[]>;
  resolve(id: string, status: "approved" | "rejected", edited?: GenerationResult | null): Promise<ReviewItem>;
}

export interface ProfilesRepo {
  /**
   * Stored profile by id, or the tenant's default profile (deterministic id per tenant,
   * created on first use) when `id` is null/undefined. Throws `NotFoundError` for an unknown id.
   */
  getGeneration(tenantId: string, id?: string | null): Promise<GenerationProfile>;
  /**
   * Stored voice profile by id (null when unknown), or the tenant's deterministic default
   * `provider: 'fake'` profile when `id` is null/undefined. Choosing a real provider's default
   * is the caller's concern.
   */
  getVoice(tenantId: string, id?: string | null): Promise<VoiceProfile | null>;
  listGeneration(tenantId: string): Promise<GenerationProfile[]>;
  listVoice(tenantId: string): Promise<VoiceProfile[]>;
  saveGeneration(profile: GenerationProfile): Promise<GenerationProfile>;
  saveVoice(profile: VoiceProfile): Promise<VoiceProfile>;
}

export interface CostEventsRepo extends CostLedger {
  record(event: CostEvent): Promise<void>;
  /** Sum of `cost_usd` for events created in the UTC calendar month `YYYY-MM`. */
  totalForTenantMonth(tenantId: string, month: string): Promise<number>;
  listForJob(jobId: string): Promise<CostEvent[]>;
  getBudget(tenantId: string, month: string): Promise<TenantBudget | null>;
  setBudget(budget: TenantBudget): Promise<TenantBudget>;
}

export interface WebhooksRepo {
  /** Enabled webhooks of the tenant, optionally only those subscribed to `event`. */
  listForTenant(tenantId: string, event?: WebhookEvent): Promise<Webhook[]>;
  get(tenantId: string, id: string): Promise<Webhook | null>;
  save(webhook: Webhook): Promise<Webhook>;
  delete(tenantId: string, id: string): Promise<boolean>;
  recordDelivery(delivery: WebhookDelivery): Promise<WebhookDelivery>;
  deliveries(webhookId: string, limit?: number): Promise<WebhookDelivery[]>;
}

export interface TtsCacheRepo {
  /** Narration id previously synthesised for this text hash and voice profile. */
  get(textHash: string, voiceProfileId: string): Promise<string | null>;
  set(textHash: string, voiceProfileId: string, narrationId: string): Promise<void>;
}

export interface SavedSearchesRepo {
  /** Enabled searches, for every tenant when `tenantId` is omitted (the scheduler's view). */
  listEnabled(tenantId?: string): Promise<SavedSearch[]>;
  list(tenantId: string): Promise<SavedSearch[]>;
  get(tenantId: string, id: string): Promise<SavedSearch | null>;
  save(search: SavedSearch): Promise<SavedSearch>;
  delete(tenantId: string, id: string): Promise<boolean>;
  markRun(id: string, at: Date): Promise<void>;
}

export interface IngestRunsRepo {
  /** Insert or update the whole run (progress is saved page by page so a killed run resumes). */
  save(run: IngestRun): Promise<IngestRun>;
  get(id: string): Promise<IngestRun | null>;
  list(tenantId: string, opts?: { saved_search_id?: string; limit?: number }): Promise<IngestRun[]>;
  /** Most recent run for a saved search, used to resume from its cursor. */
  latestForSearch(savedSearchId: string): Promise<IngestRun | null>;
}

export interface ApiKeysRepo {
  findByHash(keyHash: string): Promise<ApiKey | null>;
  create(key: ApiKey): Promise<ApiKey>;
  list(tenantId: string): Promise<ApiKey[]>;
  touch(id: string, at: Date): Promise<void>;
  revoke(tenantId: string, id: string, at: Date): Promise<boolean>;
}

export interface Repos {
  tenants: TenantsRepo;
  listings: ListingsRepo;
  jobs: JobsRepo;
  generations: GenerationsRepo;
  gateReports: GateReportsRepo;
  narrations: NarrationsRepo;
  outputs: OutputsRepo;
  reviews: ReviewsRepo;
  profiles: ProfilesRepo;
  costs: CostEventsRepo;
  webhooks: WebhooksRepo;
  ttsCache: TtsCacheRepo;
  savedSearches: SavedSearchesRepo;
  ingestRuns: IngestRunsRepo;
  apiKeys: ApiKeysRepo;
}
