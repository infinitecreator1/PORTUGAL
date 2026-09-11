/**
 * The gate: edit every section through the pt-PT editor, run the validators and the judge,
 * decide, and hand back hints for the next attempt.
 */
import type {
  GateContext,
  GateDecision,
  GateReport as GateReportType,
  GenerationResult,
  JudgeResult,
  LLMClient,
  LexiconHit,
  Listing,
  PtPtEditor,
  SectionChange,
  Validator,
  ValidatorReport,
} from "@imovel/core";
import { GATE_THRESHOLDS, GateReport, SECTION_KEYS, ValidationError, newId, sectionsToText, sha256 } from "@imovel/core";
import { scanGrammar } from "./grammarPatterns";
import { judgePtPt } from "./judge";
import { hitsToHints, scanSections, sectionText } from "./lexicon/scan";
import { defaultValidators, type GateThresholds } from "./validators";

/** Validators whose failure the editor can plausibly fix on a strict retry. */
export const RETRYABLE_VALIDATORS: ReadonlySet<string> = new Set(["facts", "lexicon", "grammar", "edit_ratio", "shape", "claims"]);

export interface DecideInput {
  validators: ValidatorReport[];
  judge: JudgeResult | null;
  /** 1-based generation loop (Gemini call number). */
  loop: number;
  /** 1-based editor attempt within the loop. */
  attempt: number;
  thresholds?: GateThresholds;
}

export interface Decision {
  decision: GateDecision;
  reasons: string[];
}

/**
 * pass: every validator ok and judge (when present) ≥ judgePass.
 * retry_amalia: a retryable validator failed, judge not below judgeHardFail, attempts remain in this loop.
 * regenerate: otherwise, while loops remain. needs_review: nothing left to try.
 */
export function decide(input: DecideInput): Decision {
  const t = input.thresholds ?? GATE_THRESHOLDS;
  const failed = input.validators.filter((v) => !v.ok);
  const reasons: string[] = failed.map((v) => `${v.name}: ${v.issues.slice(0, 3).join("; ") || "failed"}`);

  const score = input.judge?.pt_pt_score ?? null;
  const judgeHard = score !== null && score < t.judgeHardFail;
  const judgeSoft = score !== null && !judgeHard && score < t.judgePass;
  if (judgeHard) reasons.push(`judge: ${score} < ${t.judgeHardFail} (hard fail)`);
  else if (judgeSoft) reasons.push(`judge: ${score} < ${t.judgePass}`);

  if (failed.length === 0 && !judgeHard && !judgeSoft) {
    return { decision: "pass", reasons: [score === null ? "all validators ok; no judge" : `all validators ok; judge ${score} ≥ ${t.judgePass}`] };
  }

  const retryable = failed.length > 0 && failed.every((v) => RETRYABLE_VALIDATORS.has(v.name));
  if (retryable && !judgeHard && input.attempt < t.maxAmaliaAttemptsPerLoop) {
    return { decision: "retry_amalia", reasons };
  }
  if (input.loop < t.maxLoops) {
    return { decision: "regenerate", reasons };
  }
  return { decision: "needs_review", reasons };
}

export interface RunGateInput {
  listing: Listing;
  before: GenerationResult;
  editor: PtPtEditor;
  /** Judge client; omit or pass null to skip the judge. */
  judge?: LLMClient | null;
  judgeModel?: string;
  validators?: Validator[];
  loop: number;
  attempt: number;
  strict?: boolean;
  /** Extra hints (e.g. judge spans from the previous attempt), merged with the pre-scan. */
  hints?: string[];
  ids: { job_id: string; generation_id: string };
  now?: () => Date;
  thresholds?: GateThresholds;
}

export interface RunGateOutput {
  report: GateReportType;
  after: GenerationResult;
  /** Hints for the next attempt: post-edit lexicon/grammar hits plus judge spans. */
  hints: string[];
}

function dedupe(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

/** Keeps the hints whose term occurs in `text`; hints without "→" are kept as they are. */
function hintsForField(hints: readonly string[], text: string): string[] {
  const lower = text.toLowerCase();
  return hints.filter((h) => {
    const arrow = h.indexOf("→");
    if (arrow < 0) return true;
    const term = h.slice(0, arrow).trim().toLowerCase();
    return term.length > 0 && lower.includes(term);
  });
}

function allHits(result: GenerationResult): LexiconHit[] {
  const hits = scanSections(result);
  for (const field of SECTION_KEYS) hits.push(...scanGrammar(sectionText(result, field), field));
  return hits;
}

function judgeHints(judge: JudgeResult | null): string[] {
  if (!judge) return [];
  return judge.flagged_spans
    .filter((s) => s.text.trim().length > 0)
    .map((s) => (s.suggestion ? `${s.text.trim()} → ${s.suggestion.trim()}` : s.text.trim()));
}

export async function runGate(input: RunGateInput): Promise<RunGateOutput> {
  const now = input.now ?? (() => new Date());
  const started = now();
  const strict = input.strict ?? false;
  const thresholds = input.thresholds ?? GATE_THRESHOLDS;

  const hints = dedupe([...hitsToHints(allHits(input.before)), ...(input.hints ?? [])]);

  const usage = { editor_input_tokens: 0, editor_output_tokens: 0, judge_input_tokens: 0, judge_output_tokens: 0 };
  const editorIssues: string[] = [];
  let editorModel: string | null = null;

  const edited = await Promise.all(
    SECTION_KEYS.map(async (field) => {
      const text = sectionText(input.before, field);
      const out = await input.editor.edit(text, { strict, hints: hintsForField(hints, text) });
      usage.editor_input_tokens += out.usage.input_tokens;
      usage.editor_output_tokens += out.usage.output_tokens;
      if (out.model) editorModel = out.model;
      return [field, out.text] as const;
    }),
  );

  const after: GenerationResult = { ...input.before, destaques: [...input.before.destaques] };
  for (const [field, text] of edited) {
    if (field === "destaques") {
      const items = text
        .split("\n")
        .map((s) => s.replace(/^\s*[-•*]\s+/u, "").trim())
        .filter(Boolean);
      if (items.length === input.before.destaques.length) after.destaques = items;
      else editorIssues.push(`destaques count changed by the editor (${input.before.destaques.length} → ${items.length}); kept the original`);
    } else {
      after[field] = text;
    }
  }

  const ctx: GateContext = { listing: input.listing, before: input.before, after, loop: input.loop, attempt: input.attempt };
  const validators = input.validators ?? defaultValidators({ thresholds });
  const reports = await Promise.all(validators.map((v) => v.run(ctx)));
  if (editorIssues.length > 0) reports.push({ name: "editor", ok: true, severity: "soft", issues: editorIssues, details: {} });

  let judge: JudgeResult | null = null;
  if (input.judge) {
    try {
      const out = await judgePtPt(input.judge, after, input.judgeModel ? { model: input.judgeModel } : {});
      judge = out.result;
      usage.judge_input_tokens += out.usage.input_tokens;
      usage.judge_output_tokens += out.usage.output_tokens;
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      reports.push({ name: "judge", ok: false, severity: "soft", issues: [`unparsable judge response: ${err.message}`], details: err.details });
    }
  }

  const changes: SectionChange[] = [];
  for (const field of SECTION_KEYS) {
    const b = sectionText(input.before, field);
    const a = sectionText(after, field);
    if (a !== b) changes.push({ field, before: b, after: a });
  }

  const { decision, reasons } = decide({ validators: reports, judge, loop: input.loop, attempt: input.attempt, thresholds });
  const finished = now();

  const report = GateReport.parse({
    id: newId(),
    job_id: input.ids.job_id,
    generation_id: input.ids.generation_id,
    loop: input.loop,
    attempt: input.attempt,
    editor: input.editor.id,
    editor_model: editorModel,
    strict,
    input_hash: sha256(sectionsToText(input.before)),
    output_hash: sha256(sectionsToText(after)),
    changes,
    validators: reports,
    judge,
    decision,
    reasons,
    usage,
    latency_ms: Math.max(0, finished.getTime() - started.getTime()),
    created_at: finished.toISOString(),
  });
  return { report, after, hints: dedupe([...hitsToHints(allHits(after)), ...judgeHints(judge)]) };
}
