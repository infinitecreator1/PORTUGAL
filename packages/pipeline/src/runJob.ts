import type { Job, JobOutput } from "@imovel/core";
import { QUEUES, toErrorRecord } from "@imovel/core";
import type { GatePayload, GeneratePayload, NarratePayload, NextAction, PipelineDeps, PublishPayload } from "./deps";
import { gateStep } from "./steps/gate";
import { generateStep } from "./steps/generate";
import { narrateStep } from "./steps/narrate";
import { publishStep } from "./steps/publish";

/** Executes one queued step and returns the next action, if any. Shared by the worker and the synchronous runner. */
export async function executeStep(deps: PipelineDeps, queue: string, payload: unknown): Promise<NextAction | { done: JobOutput } | null> {
  switch (queue) {
    case QUEUES.generate:
      return generateStep(deps, payload as GeneratePayload);
    case QUEUES.gate:
      return gateStep(deps, payload as GatePayload);
    case QUEUES.narrate:
      return narrateStep(deps, payload as NarratePayload);
    case QUEUES.publish:
      return { done: await publishStep(deps, payload as PublishPayload) };
    default:
      throw new Error(`Unknown queue ${queue}`);
  }
}

/**
 * Runs a job to completion in-process without the queue: generate → gate → narrate → publish.
 * Used by the CLI and the evals. Returns the output, or null when the job stopped for review.
 */
export async function runJobSync(deps: PipelineDeps, jobId: string, opts: { extraConstraints?: string[] } = {}): Promise<{ job: Job; output: JobOutput | null }> {
  let action: NextAction | { done: JobOutput } | null = { queue: QUEUES.generate, payload: { job_id: jobId, extraConstraints: opts.extraConstraints } };
  let output: JobOutput | null = null;
  let guard = 0;
  try {
    while (action && !("done" in action) && guard++ < 12) {
      action = await executeStep(deps, action.queue, action.payload);
      if (action && "done" in action) output = action.done;
    }
  } catch (err) {
    const job = await deps.repos.jobs.get(jobId);
    if (job && !["published", "published_partial", "needs_review", "cancelled"].includes(job.status)) {
      await deps.repos.jobs.update(jobId, { status: "failed", last_error: toErrorRecord(err), updated_at: deps.now().toISOString(), finished_at: deps.now().toISOString() });
    }
    throw err;
  }
  const job = await deps.repos.jobs.get(jobId);
  if (!job) throw new Error(`Job ${jobId} vanished`);
  return { job, output };
}
