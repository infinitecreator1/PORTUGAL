import { z } from "zod";
import { GenerationResult } from "./generation";
import { NarrationResult } from "./voice";

export const JobStatus = z.enum([
  "queued",
  "generating",
  "generated",
  "gating",
  "gated_pass",
  "gated_fail",
  "narrating",
  "narrated",
  "publishing",
  "published",
  "published_partial",
  "needs_review",
  "retrying",
  "dead_letter",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatus>;

export const JobStep = z.enum(["ingest", "generate", "gate", "narrate", "publish"]);
export type JobStep = z.infer<typeof JobStep>;

/** pg-boss queue names, one per step. */
export const QUEUES = {
  ingest: "pipeline.ingest",
  generate: "pipeline.generate",
  gate: "pipeline.gate",
  narrate: "pipeline.narrate",
  publish: "pipeline.publish",
  dead: "pipeline.dead",
} as const;

export const Job = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  listing_id: z.string().uuid(),
  listing_version_id: z.string().uuid().nullable().default(null),
  generation_profile_id: z.string().uuid(),
  voice_profile_id: z.string().uuid().nullable().default(null),
  status: JobStatus,
  loop: z.number().int().nonnegative().default(0),
  attempt: z.number().int().nonnegative().default(0),
  current_step: JobStep.nullable().default(null),
  idempotency_key: z.string().min(1),
  require_audio: z.boolean().default(true),
  last_error: z.record(z.unknown()).nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable().default(null),
});
export type Job = z.infer<typeof Job>;

export const JobStepRecord = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  step: JobStep,
  attempt: z.number().int().nonnegative(),
  status: z.enum(["started", "succeeded", "failed"]),
  input_hash: z.string().nullable().default(null),
  output_ref: z.string().nullable().default(null),
  error: z.record(z.unknown()).nullable().default(null),
  usage: z.record(z.unknown()).default({}),
  cost_usd: z.number().nonnegative().default(0),
  started_at: z.string().datetime(),
  finished_at: z.string().datetime().nullable().default(null),
});
export type JobStepRecord = z.infer<typeof JobStepRecord>;

export const JobOutput = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  job_id: z.string().uuid(),
  listing_id: z.string().uuid(),
  generation_id: z.string().uuid(),
  gate_report_id: z.string().uuid(),
  sections: GenerationResult,
  narration: NarrationResult.nullable().default(null),
  ai_generated: z.literal(true).default(true),
  warnings: z.array(z.string()).default([]),
  published_at: z.string().datetime(),
});
export type JobOutput = z.infer<typeof JobOutput>;

export const ReviewItem = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  job_id: z.string().uuid(),
  listing_id: z.string().uuid(),
  reason: z.string(),
  gate_report_id: z.string().uuid().nullable().default(null),
  status: z.enum(["open", "approved", "rejected"]).default("open"),
  edited_sections: GenerationResult.nullable().default(null),
  created_at: z.string().datetime(),
  resolved_at: z.string().datetime().nullable().default(null),
});
export type ReviewItem = z.infer<typeof ReviewItem>;
