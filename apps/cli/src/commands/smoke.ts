import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadConfig } from "@imovel/core";
import { sampleListingInput } from "@imovel/core/fixtures";
import { createLogger } from "@imovel/observability";
import { buildDeps, enqueueJobForListing, runJobSync } from "@imovel/pipeline";
import { writeJson } from "../util";

/** Runs the canonical fixture listing end to end with whatever providers .env selects. */
export async function smoke(opts: { out?: string; quiet?: boolean } = {}): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: opts.quiet ? "silent" : cfg.LOG_LEVEL, pretty: !opts.quiet }) });
  const outDir = opts.out ?? "./out/smoke";
  try {
    const tenant = await deps.repos.tenants.ensureDefault(cfg.DEFAULT_TENANT_ID);
    const { listing } = await deps.repos.listings.upsertFromInput(tenant.id, sampleListingInput(), deps.now());
    const { job } = await enqueueJobForListing(deps, listing);
    const started = Date.now();
    const { job: finished, output } = await runJobSync(deps, job.id);
    const reports = await deps.repos.gateReports.listForJob(job.id);
    const costs = await deps.repos.costs.listForJob(job.id);
    const summary = {
      job_id: job.id,
      status: finished.status,
      providers: { llm: cfg.LLM_PROVIDER, editor: cfg.GATE_EDITOR, tts: cfg.TTS_PROVIDER, storage: cfg.STORAGE_PROVIDER },
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
      gate: reports.map((r) => ({ attempt: r.attempt, decision: r.decision, judge: r.judge?.pt_pt_score ?? null, changes: r.changes.length, reasons: r.reasons })),
      cost_usd: Math.round(costs.reduce((s, c) => s + c.cost_usd, 0) * 1e6) / 1e6,
      titulo: output?.sections.titulo ?? null,
      audio: output?.narration ? { wav_key: output.narration.wav_key, mp3_key: output.narration.mp3_key, duration_s: output.narration.duration_s, chunks: output.narration.chunks } : null,
      warnings: output?.warnings ?? [],
    };
    mkdirSync(outDir, { recursive: true });
    writeJson(join(outDir, "summary.json"), summary);
    if (output) writeJson(join(outDir, "output.json"), output);
    if (output?.narration && cfg.STORAGE_PROVIDER === "fs") {
      copyFileSync(join(cfg.FS_STORAGE_DIR, output.narration.wav_key), join(outDir, "narration.wav"));
      if (output.narration.mp3_key) copyFileSync(join(cfg.FS_STORAGE_DIR, output.narration.mp3_key), join(outDir, "narration.mp3"));
    }
    console.log(JSON.stringify(summary, null, 2));
    return finished.status === "published" || finished.status === "published_partial" ? 0 : 1;
  } finally {
    await deps.close();
  }
}
