import type { GateReport, GenerationRecord, Job } from "@imovel/core";
import { GATE_THRESHOLDS, NotFoundError, QUEUES, newId, sectionsToText, sha256 } from "@imovel/core";
import { runGate } from "@imovel/ptpt-qa";
import { metrics, recordLlmUsage } from "@imovel/observability";
import type { GatePayload, NextAction, PipelineDeps } from "../deps";
import { loadJobAndListing } from "./generate";
import { moveJob, recordStep } from "../stepRecorder";
import { emitWebhook } from "../webhooks";

/**
 * Step ②: AMALIA edits, validators check, judge scores. The retry ladder runs here:
 * attempt 1 → strict attempt 2 → regenerate with constraints → human review.
 */
export async function gateStep(deps: PipelineDeps, payload: GatePayload): Promise<NextAction | null> {
  const { job: initial, listing } = await loadJobAndListing(deps, payload.job_id);
  const generation = await deps.repos.generations.get(payload.generation_id);
  if (!generation) throw new NotFoundError(`Generation ${payload.generation_id} not found`);

  let job = await moveJob(deps, initial, "gating", { current_step: "gate" });
  let hints: string[] = [];
  let report: GateReport | null = null;
  let after = generation.result;

  for (let attempt = 1; attempt <= GATE_THRESHOLDS.maxAmaliaAttemptsPerLoop; attempt++) {
    const strict = attempt > 1;
    const outcome = await recordStep(deps, job, "gate", job.loop * 10 + attempt, async () => {
      const res = await runGate({
        listing,
        before: generation.result,
        editor: deps.editor,
        judge: deps.judge,
        judgeModel: deps.cfg.JUDGE_MODEL,
        loop: job.loop,
        attempt,
        strict,
        hints,
        ids: { job_id: job.id, generation_id: generation.id },
        now: deps.now,
      });
      const editorCost = await recordLlmUsage(deps.ledger, {
        tenant_id: job.tenant_id,
        job_id: job.id,
        step: "gate",
        provider: deps.editor.id,
        model: res.report.editor_model ?? deps.cfg.AMALIA_MODEL,
        usage: { input_tokens: res.report.usage.editor_input_tokens, output_tokens: res.report.usage.editor_output_tokens },
      });
      const judgeCost = deps.judge
        ? await recordLlmUsage(deps.ledger, {
            tenant_id: job.tenant_id,
            job_id: job.id,
            step: "judge",
            provider: deps.judge.provider,
            model: deps.cfg.JUDGE_MODEL,
            usage: { input_tokens: res.report.usage.judge_input_tokens, output_tokens: res.report.usage.judge_output_tokens },
          })
        : 0;
      return {
        result: res,
        output_ref: res.report.id,
        usage: { decision: res.report.decision, judge: res.report.judge?.pt_pt_score ?? null, changes: res.report.changes.length },
        cost_usd: editorCost + judgeCost,
        input_hash: res.report.input_hash,
      };
    });

    report = outcome.report;
    after = outcome.after;
    hints = outcome.hints;
    await deps.repos.gateReports.save(report);
    metrics.counter("gate_decisions_total", { decision: report.decision }).inc();
    if (report.judge) metrics.histogram("judge_score").observe(report.judge.pt_pt_score);

    if (report.decision !== "retry_amalia") break;
    deps.logger.info({ job_id: job.id, attempt, reasons: report.reasons }, "gate retrying editor in strict mode");
  }

  if (!report) throw new NotFoundError("gate produced no report");

  if (report.decision === "pass") {
    const gated: GenerationRecord = {
      ...generation,
      id: newId(),
      provider: `gated:${deps.editor.id}`,
      result: after,
      text_hash: sha256(sectionsToText(after)),
      created_at: deps.now().toISOString(),
    };
    await deps.repos.generations.save(gated);
    job = await moveJob(deps, job, "gated_pass");
    const voice = job.voice_profile_id ? await deps.repos.profiles.getVoice(job.tenant_id, job.voice_profile_id) : await deps.repos.profiles.getVoice(job.tenant_id, null);
    if (job.require_audio && voice) {
      return { queue: QUEUES.narrate, payload: { job_id: job.id, generation_id: gated.id } };
    }
    return { queue: QUEUES.publish, payload: { job_id: job.id, generation_id: gated.id, narration_id: null, warnings: voice ? [] : ["no voice profile: audio skipped"] } };
  }

  if (report.decision === "regenerate" && job.loop < GATE_THRESHOLDS.maxLoops) {
    job = await moveJob(deps, job, "gated_fail", { loop: job.loop + 1, last_error: { reasons: report.reasons, hints } });
    // Transition gated_fail → generating happens inside the generate step.
    return { queue: QUEUES.generate, payload: { job_id: job.id, extraConstraints: hints } };
  }

  // needs_review (or regenerate budget exhausted)
  job = await moveJob(deps, job, "needs_review", { last_error: { reasons: report.reasons, hints } });
  const review = await deps.repos.reviews.create({
    tenant_id: job.tenant_id,
    job_id: job.id,
    listing_id: job.listing_id,
    reason: report.reasons.join("; ") || report.decision,
    gate_report_id: report.id,
    edited_sections: after,
  });
  await emitWebhook(deps, job.tenant_id, "job.needs_review", { job_id: job.id, listing_id: job.listing_id, review_id: review.id, reasons: report.reasons });
  return null;
}

export async function latestGatedGeneration(deps: PipelineDeps, jobId: string): Promise<GenerationRecord> {
  const gen = await deps.repos.generations.latestForJob(jobId);
  if (!gen) throw new NotFoundError(`No generation for job ${jobId}`);
  return gen;
}

export type { Job };
