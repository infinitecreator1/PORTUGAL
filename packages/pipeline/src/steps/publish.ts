import type { JobOutput } from "@imovel/core";
import { NotFoundError, newId } from "@imovel/core";
import { metrics } from "@imovel/observability";
import type { PipelineDeps, PublishPayload } from "../deps";
import { loadJobAndListing } from "./generate";
import { moveJob, recordStep } from "../stepRecorder";
import { emitWebhook } from "../webhooks";

/** Step ④: the output row is written, the tenant is notified, the job is done. */
export async function publishStep(deps: PipelineDeps, payload: PublishPayload): Promise<JobOutput> {
  const { job: initial } = await loadJobAndListing(deps, payload.job_id);
  const generation = await deps.repos.generations.get(payload.generation_id);
  if (!generation) throw new NotFoundError(`Generation ${payload.generation_id} not found`);
  const job = await moveJob(deps, initial, "publishing", { current_step: "publish" });

  const narration = payload.narration_id ? await deps.repos.narrations.get(payload.narration_id) : null;
  const reports = await deps.repos.gateReports.listForJob(job.id);
  const lastReport = reports.at(-1);
  if (!lastReport) throw new NotFoundError(`No gate report for job ${job.id}`);

  const output = await recordStep(deps, job, "publish", job.loop * 10 + 1, async () => {
    const out: JobOutput = {
      id: newId(),
      tenant_id: job.tenant_id,
      job_id: job.id,
      listing_id: job.listing_id,
      generation_id: generation.id,
      gate_report_id: lastReport.id,
      sections: generation.result,
      narration,
      ai_generated: true,
      warnings: payload.warnings ?? [],
      published_at: deps.now().toISOString(),
    };
    await deps.repos.outputs.save(out);
    return { result: out, output_ref: out.id };
  });

  const partial = job.require_audio && !narration;
  await moveJob(deps, job, partial ? "published_partial" : "published");
  metrics.counter("jobs_total", { status: partial ? "published_partial" : "published" }).inc();
  await emitWebhook(deps, job.tenant_id, "job.completed", {
    job_id: job.id,
    listing_id: job.listing_id,
    output_id: output.id,
    has_audio: Boolean(narration),
    warnings: output.warnings,
  });
  return output;
}
