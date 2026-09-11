import { z } from "zod";
import { SectionKey } from "./generation";

export const GateDecision = z.enum(["pass", "retry_amalia", "regenerate", "needs_review"]);
export type GateDecision = z.infer<typeof GateDecision>;

export const EditorId = z.enum(["amalia", "gemini", "fake", "none"]);
export type EditorId = z.infer<typeof EditorId>;

export const ValidatorSeverity = z.enum(["hard", "soft"]);
export type ValidatorSeverity = z.infer<typeof ValidatorSeverity>;

export const ValidatorReport = z.object({
  name: z.string(),
  ok: z.boolean(),
  severity: ValidatorSeverity,
  issues: z.array(z.string()).default([]),
  details: z.record(z.unknown()).default({}),
});
export type ValidatorReport = z.infer<typeof ValidatorReport>;

export const SectionChange = z.object({
  field: SectionKey,
  before: z.string(),
  after: z.string(),
});
export type SectionChange = z.infer<typeof SectionChange>;

export const LexiconHit = z.object({
  rule_id: z.string(),
  term: z.string(),
  field: SectionKey,
  index: z.number().int().nonnegative(),
  severity: z.enum(["block", "warn"]),
  suggestion: z.string(),
});
export type LexiconHit = z.infer<typeof LexiconHit>;

export const JudgeResult = z.object({
  pt_pt_score: z.number().min(0).max(100),
  register_score: z.number().min(0).max(100).nullable().default(null),
  flagged_spans: z
    .array(
      z.object({
        text: z.string(),
        category: z.enum(["lexical", "grammar", "spelling", "register", "other"]),
        suggestion: z.string().nullable().default(null),
      }),
    )
    .default([]),
  summary: z.string().nullable().default(null),
});
export type JudgeResult = z.infer<typeof JudgeResult>;

export const GateReport = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  generation_id: z.string().uuid(),
  loop: z.number().int().nonnegative(),
  attempt: z.number().int().nonnegative(),
  editor: EditorId,
  editor_model: z.string().nullable().default(null),
  strict: z.boolean().default(false),
  input_hash: z.string().length(64),
  output_hash: z.string().length(64),
  changes: z.array(SectionChange).default([]),
  validators: z.array(ValidatorReport).default([]),
  judge: JudgeResult.nullable().default(null),
  decision: GateDecision,
  reasons: z.array(z.string()).default([]),
  usage: z
    .object({
      editor_input_tokens: z.number().int().nonnegative().default(0),
      editor_output_tokens: z.number().int().nonnegative().default(0),
      judge_input_tokens: z.number().int().nonnegative().default(0),
      judge_output_tokens: z.number().int().nonnegative().default(0),
    })
    .default({}),
  latency_ms: z.number().nonnegative().default(0),
  created_at: z.string().datetime(),
});
export type GateReport = z.infer<typeof GateReport>;

/** Thresholds shared by the gate and the evals. Config can override per tenant later. */
export const GATE_THRESHOLDS = {
  judgePass: 90,
  judgeHardFail: 80,
  maxEditRatio: 0.4,
  maxSentenceDelta: 1,
  lengthRatio: { min: 0.85, max: 1.15 },
  maxLoops: 2,
  maxAmaliaAttemptsPerLoop: 2,
} as const;
