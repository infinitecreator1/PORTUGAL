import type { Job, JobStatus } from "@imovel/core";
import { ConflictError } from "@imovel/core";

/** Allowed transitions. Anything not listed is a bug and throws. */
const TRANSITIONS: Record<JobStatus, readonly JobStatus[]> = {
  queued: ["generating", "cancelled", "failed"],
  generating: ["generated", "retrying", "failed"],
  generated: ["gating", "failed"],
  gating: ["gated_pass", "gated_fail", "needs_review", "retrying", "failed"],
  gated_pass: ["narrating", "publishing", "failed"],
  gated_fail: ["generating", "gating", "needs_review", "failed"],
  narrating: ["narrated", "publishing", "retrying", "failed"],
  narrated: ["publishing", "failed"],
  publishing: ["published", "published_partial", "retrying", "failed"],
  published: [],
  published_partial: [],
  needs_review: ["narrating", "publishing", "cancelled", "failed"],
  retrying: ["generating", "gating", "narrating", "publishing", "dead_letter", "failed"],
  dead_letter: ["failed", "generating"],
  failed: ["generating"],
  cancelled: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(job: Pick<Job, "id" | "status">, to: JobStatus): void {
  if (!canTransition(job.status, to)) {
    throw new ConflictError(`Job ${job.id} cannot go from ${job.status} to ${to}`, {
      details: { from: job.status, to },
    });
  }
}

export const TERMINAL_STATUSES: readonly JobStatus[] = ["published", "published_partial", "cancelled", "failed"];

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
