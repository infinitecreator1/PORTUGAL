import type { Job, JobStatus, JobStep } from "@imovel/core";
import { newId, toErrorRecord } from "@imovel/core";
import type { PipelineDeps } from "./deps";
import { assertTransition } from "./stateMachine";

/** Moves a job to a new status, validating the transition, and returns the fresh row. */
export async function moveJob(deps: PipelineDeps, job: Job, status: JobStatus, patch: Partial<Job> = {}): Promise<Job> {
  assertTransition(job, status);
  const finished = ["published", "published_partial", "failed", "cancelled"].includes(status);
  return deps.repos.jobs.update(job.id, {
    ...patch,
    status,
    updated_at: deps.now().toISOString(),
    finished_at: finished ? deps.now().toISOString() : job.finished_at,
  });
}

/**
 * Runs a step body, recording a job_steps row with timing, usage and cost, and rethrowing
 * the original error after marking the step failed.
 */
export async function recordStep<T>(
  deps: PipelineDeps,
  job: Job,
  step: JobStep,
  attempt: number,
  body: () => Promise<{ result: T; output_ref?: string | null; usage?: Record<string, unknown>; cost_usd?: number; input_hash?: string | null }>,
): Promise<T> {
  const started_at = deps.now().toISOString();
  const id = newId();
  try {
    const out = await body();
    await deps.repos.jobs.addStep({
      id,
      job_id: job.id,
      step,
      attempt,
      status: "succeeded",
      input_hash: out.input_hash ?? null,
      output_ref: out.output_ref ?? null,
      error: null,
      usage: out.usage ?? {},
      cost_usd: out.cost_usd ?? 0,
      started_at,
      finished_at: deps.now().toISOString(),
    });
    return out.result;
  } catch (err) {
    await deps.repos.jobs.addStep({
      id,
      job_id: job.id,
      step,
      attempt,
      status: "failed",
      input_hash: null,
      output_ref: null,
      error: toErrorRecord(err),
      usage: {},
      cost_usd: 0,
      started_at,
      finished_at: deps.now().toISOString(),
    });
    await deps.repos.jobs.update(job.id, { last_error: toErrorRecord(err), updated_at: deps.now().toISOString() });
    throw err;
  }
}
