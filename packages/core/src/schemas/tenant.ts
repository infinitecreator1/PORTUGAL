import { z } from "zod";
import { SourceId } from "./listing";

export const Tenant = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  allow_third_party_generation: z.boolean().default(false),
  legal_signoff_at: z.string().datetime().nullable().default(null),
  terms_accepted_at: z.string().datetime().nullable().default(null),
  budget_soft_usd: z.number().nonnegative().nullable().default(null),
  budget_hard_usd: z.number().nonnegative().nullable().default(null),
  created_at: z.string().datetime(),
});
export type Tenant = z.infer<typeof Tenant>;

/** Agency identifiers per source; a listing whose agency matches becomes `owned`. */
export const TenantAgency = z.object({
  tenant_id: z.string().uuid(),
  source: SourceId,
  agency_id: z.string().min(1),
  agency_name: z.string().nullable().default(null),
});
export type TenantAgency = z.infer<typeof TenantAgency>;

export const ApiKey = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  prefix: z.string().min(1),
  key_hash: z.string().length(64),
  scopes: z.array(z.string()).default(["*"]),
  last_used_at: z.string().datetime().nullable().default(null),
  revoked_at: z.string().datetime().nullable().default(null),
  created_at: z.string().datetime(),
});
export type ApiKey = z.infer<typeof ApiKey>;

export const WebhookEvent = z.enum([
  "job.completed",
  "job.failed",
  "job.needs_review",
  "listing.changed",
]);
export type WebhookEvent = z.infer<typeof WebhookEvent>;

export const Webhook = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(WebhookEvent).min(1),
  enabled: z.boolean().default(true),
  created_at: z.string().datetime(),
});
export type Webhook = z.infer<typeof Webhook>;

export const SavedSearch = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  source: SourceId,
  /** Source-specific query (a portal search URL for Piloterr, filter object for Parse.bot/Casafari). */
  query: z.record(z.unknown()),
  cron: z.string().min(1).default("0 6 * * *"),
  enabled: z.boolean().default(true),
  max_pages: z.number().int().positive().default(10),
  max_credits_per_run: z.number().int().positive().default(500),
  last_run_at: z.string().datetime().nullable().default(null),
});
export type SavedSearch = z.infer<typeof SavedSearch>;

export const IngestRun = z.object({
  id: z.string().uuid(),
  saved_search_id: z.string().uuid().nullable().default(null),
  tenant_id: z.string().uuid(),
  source: SourceId,
  status: z.enum(["running", "succeeded", "failed", "budget_stopped"]),
  page: z.number().int().nonnegative().default(0),
  next_cursor: z.string().nullable().default(null),
  items_seen: z.number().int().nonnegative().default(0),
  items_new: z.number().int().nonnegative().default(0),
  items_changed: z.number().int().nonnegative().default(0),
  credits_used: z.number().nonnegative().default(0),
  error: z.string().nullable().default(null),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable().default(null),
});
export type IngestRun = z.infer<typeof IngestRun>;
