import { QUEUES, loadConfig, toErrorRecord } from "@imovel/core";
import { initTelemetry, metrics, withSpan } from "@imovel/observability";
import { buildDeps, executeStep, ingestStep, type IngestPayload } from "@imovel/pipeline";

/**
 * pg-boss worker: one consumer per pipeline queue. Each step returns the next action, which is
 * enqueued here; failures propagate so pg-boss retries with backoff and dead-letters at the end.
 */
async function main(): Promise<void> {
  const cfg = loadConfig();
  const telemetry = initTelemetry(cfg);
  const deps = await buildDeps(cfg);
  const log = deps.logger.child({ service: "worker" });

  const stepQueues = [QUEUES.generate, QUEUES.gate, QUEUES.narrate, QUEUES.publish];
  for (const queue of stepQueues) {
    await deps.queue.work(queue, async (payload, meta) => {
      const started = Date.now();
      const step = queue.replace("pipeline.", "");
      try {
        const next = await withSpan(`pipeline.${step}`, { queue, job: String((payload as { job_id?: string }).job_id ?? "") }, () => executeStep(deps, queue, payload));
        if (next && !("done" in next)) {
          await deps.queue.send(next.queue, next.payload, { retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, deadLetter: QUEUES.dead });
        }
        metrics.histogram("pipeline_step_duration_seconds", { step, provider: "worker" }).observe((Date.now() - started) / 1000);
      } catch (err) {
        metrics.counter("provider_errors_total", { provider: "worker", code: step }).inc();
        log.error({ queue, id: meta.id, retryCount: meta.retryCount, err: toErrorRecord(err) }, "step failed");
        throw err;
      }
    });
  }

  await deps.queue.work(QUEUES.ingest, async (payload) => {
    const result = await ingestStep(deps, payload as IngestPayload);
    log.info({ result }, "ingestion run finished");
  });

  await deps.queue.work(QUEUES.dead, async (payload, meta) => {
    const jobId = (payload as { job_id?: string }).job_id;
    log.error({ jobId, id: meta.id }, "job dead-lettered");
    if (jobId) {
      const job = await deps.repos.jobs.get(jobId);
      if (job && job.status !== "failed") {
        await deps.repos.jobs.update(jobId, { status: "failed", updated_at: new Date().toISOString(), finished_at: new Date().toISOString() });
        await deps.repos.reviews.create({ tenant_id: job.tenant_id, job_id: job.id, listing_id: job.listing_id, reason: "dead_letter", gate_report_id: null, edited_sections: null });
      }
    }
  });

  log.info({ providers: { llm: cfg.LLM_PROVIDER, editor: cfg.GATE_EDITOR, tts: cfg.TTS_PROVIDER, storage: cfg.STORAGE_PROVIDER } }, "worker started");

  const shutdown = async (signal: string) => {
    log.info({ signal }, "worker stopping");
    await deps.queue.stop();
    await deps.close();
    await telemetry.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
