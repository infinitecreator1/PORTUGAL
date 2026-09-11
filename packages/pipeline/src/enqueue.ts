import type { Job, Listing } from "@imovel/core";
import { QUEUES } from "@imovel/core";
import { PIPELINE_VERSION, type PipelineDeps } from "./deps";

/**
 * Creates (idempotently) the job for a listing version and enqueues its first step.
 * The same listing content + profiles never produces two jobs.
 */
export async function enqueueJobForListing(
  deps: PipelineDeps,
  listing: Listing,
  opts: { generation_profile_id?: string | null; voice_profile_id?: string | null; require_audio?: boolean } = {},
): Promise<{ job: Job; created: boolean }> {
  const profile = await deps.repos.profiles.getGeneration(listing.tenant_id, opts.generation_profile_id ?? null);
  const voice = await deps.repos.profiles.getVoice(listing.tenant_id, opts.voice_profile_id ?? null);
  const { job, created } = await deps.repos.jobs.create({
    tenant_id: listing.tenant_id,
    listing_id: listing.id,
    generation_profile_id: profile.id,
    voice_profile_id: voice?.id ?? null,
    require_audio: opts.require_audio ?? Boolean(voice),
    pipeline_version: PIPELINE_VERSION,
  });
  if (created) {
    await deps.queue.send(QUEUES.generate, { job_id: job.id }, { singletonKey: job.idempotency_key, retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, deadLetter: QUEUES.dead });
  }
  return { job, created };
}
