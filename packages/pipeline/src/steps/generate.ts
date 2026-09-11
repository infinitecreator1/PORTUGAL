import type { GenerationRecord, Job, Listing } from "@imovel/core";
import { GateFailedError, NotFoundError, QUEUES, ValidationError, newId, sectionsToText, sha256 } from "@imovel/core";
import { preValidateFacts } from "@imovel/ptpt-qa";
import { recordLlmUsage } from "@imovel/observability";
import type { GeneratePayload, NextAction, PipelineDeps } from "../deps";
import { moveJob, recordStep } from "../stepRecorder";

const MAX_PREVALIDATE_RETRIES = 2;

/** Loads the job and its listing, enforcing the ownership gate. */
export async function loadJobAndListing(deps: PipelineDeps, jobId: string): Promise<{ job: Job; listing: Listing }> {
  const job = await deps.repos.jobs.get(jobId);
  if (!job) throw new NotFoundError(`Job ${jobId} not found`);
  const listing = await deps.repos.listings.getById(job.tenant_id, job.listing_id);
  if (!listing) throw new NotFoundError(`Listing ${job.listing_id} not found`);
  if (listing.ownership === "third_party") {
    const tenant = await deps.repos.tenants.get(job.tenant_id);
    const allowed = tenant?.allow_third_party_generation && tenant.legal_signoff_at;
    if (!allowed) {
      throw new ValidationError("Third-party listings are analytics only; generation is blocked by the ownership gate", {
        details: { listing_id: listing.id, ownership: listing.ownership },
      });
    }
  }
  return { job, listing };
}

/**
 * Step ①: Gemini writes the copy. Invented numbers are caught by the pre-validator and the
 * model is asked again with the offending facts as negative constraints.
 */
export async function generateStep(deps: PipelineDeps, payload: GeneratePayload): Promise<NextAction> {
  const { job: initial, listing } = await loadJobAndListing(deps, payload.job_id);
  const job = await moveJob(deps, initial, "generating", { current_step: "generate", attempt: initial.attempt + 1 });
  const profile = await deps.repos.profiles.getGeneration(job.tenant_id, job.generation_profile_id);

  const constraints = [...(payload.extraConstraints ?? [])];
  let record: GenerationRecord | null = null;
  let lastIssues: string[] = [];

  for (let tries = 0; tries <= MAX_PREVALIDATE_RETRIES && !record; tries++) {
    const attemptNo = job.attempt * 10 + tries;
    const output = await recordStep(deps, job, "generate", attemptNo, async () => {
      const out = await deps.generator.generate(listing, profile, constraints);
      const cost = await recordLlmUsage(deps.ledger, {
        tenant_id: job.tenant_id,
        job_id: job.id,
        step: "generate",
        provider: out.provider,
        model: out.model,
        usage: out.usage,
      });
      return { result: out, usage: { ...out.usage, model: out.model }, cost_usd: cost };
    });

    const pre = preValidateFacts(listing, output.result);
    if (pre.ok) {
      record = {
        id: newId(),
        job_id: job.id,
        listing_id: listing.id,
        attempt: job.attempt,
        loop: job.loop,
        model: output.model,
        provider: output.provider,
        result: output.result,
        usage: output.usage,
        latency_ms: output.latency_ms,
        text_hash: sha256(sectionsToText(output.result)),
        created_at: deps.now().toISOString(),
      };
    } else {
      lastIssues = pre.issues;
      deps.logger.warn({ job_id: job.id, issues: pre.issues }, "generation invented facts; regenerating");
      constraints.push(...pre.issues.map((i) => `Não inventes: ${i}`));
    }
  }

  if (!record) {
    throw new GateFailedError("Generation kept inventing facts", { details: { issues: lastIssues } });
  }

  await deps.repos.generations.save(record);
  await moveJob(deps, job, "generated");
  return { queue: QUEUES.gate, payload: { job_id: job.id, generation_id: record.id } };
}
