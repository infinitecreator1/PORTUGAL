import type { Listing, ListingInput, SavedSearch, SourceId } from "@imovel/core";
import { SavedSearch as SavedSearchSchema, newId } from "@imovel/core";
import { createListingSource, runIngestion } from "@imovel/ingestion";
import type { ListingSource } from "@imovel/core";
import type { IngestPayload, PipelineDeps } from "../deps";
import { enqueueJobForListing } from "../enqueue";

export interface IngestResult {
  status: "succeeded" | "failed" | "budget_stopped";
  items_seen: number;
  items_new: number;
  items_changed: number;
  items_skipped: number;
  jobs_enqueued: number;
  next_cursor: string | null;
  error: string | null;
}

/**
 * Pulls one saved search (or an ad-hoc query) through a ListingSource, upserts listings and
 * enqueues jobs for owned/represented listings that are new or materially changed.
 */
export async function ingestStep(
  deps: PipelineDeps,
  payload: IngestPayload,
  opts: { source?: ListingSource; autoRun?: boolean; generation_profile_id?: string | null; voice_profile_id?: string | null } = {},
): Promise<IngestResult> {
  const sourceId = payload.source as SourceId;
  const source = opts.source ?? createListingSource(sourceId, deps.cfg, { fetch: deps.fetch });
  const tenant = await deps.repos.tenants.ensureDefault(payload.tenant_id);
  const agencyIds = await deps.repos.tenants.agencyIds(tenant.id, sourceId);

  const query: SavedSearch = SavedSearchSchema.parse({
    id: payload.saved_search_id ?? newId(),
    tenant_id: tenant.id,
    source: sourceId,
    query: payload.query,
  });

  let jobs_enqueued = 0;
  const run = await runIngestion({
    source,
    query,
    ctx: { tenant_id: tenant.id, ownership_default: sourceId === "csv-feed" || sourceId === "xml-feed" || sourceId === "api" ? "owned" : "third_party", agency_ids: agencyIds },
    cursor: payload.cursor ?? null,
    maxPages: query.max_pages,
    maxCredits: query.max_credits_per_run,
    onItem: async (input: ListingInput) => {
      const { listing, status } = await deps.repos.listings.upsertFromInput(tenant.id, input, deps.now());
      if (opts.autoRun !== false && status !== "unchanged" && listing.ownership !== "third_party") {
        const { created } = await enqueueJobForListing(deps, listing as Listing, {
          generation_profile_id: opts.generation_profile_id ?? null,
          voice_profile_id: opts.voice_profile_id ?? null,
        });
        if (created) jobs_enqueued++;
      }
      return status;
    },
  });

  return {
    status: run.status,
    items_seen: run.items_seen,
    items_new: run.items_new,
    items_changed: run.items_changed,
    items_skipped: run.items_skipped ?? 0,
    jobs_enqueued,
    next_cursor: run.next_cursor,
    error: run.error,
  };
}
