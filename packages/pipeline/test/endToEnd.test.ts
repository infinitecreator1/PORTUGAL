import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GATE_THRESHOLDS, loadConfig, type Listing } from "@imovel/core";
import { sampleGenerationResultPtBr, sampleListingInput } from "@imovel/core/fixtures";
import { FakeLLMClient, GeminiDescriptionGenerator } from "@imovel/llm";
import { createLogger } from "@imovel/observability";
import { buildDeps, enqueueJobForListing, runJobSync, type BuiltDeps } from "../src";

/** The whole pipeline with fake providers: no keys, no network, no ffmpeg. */
describe("pipeline end to end (fake providers)", () => {
  let deps: BuiltDeps;

  beforeAll(async () => {
    const cfg = loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "fake", GATE_EDITOR: "fake", TTS_PROVIDER: "fake", STORAGE_PROVIDER: "fs", FS_STORAGE_DIR: "./out/test-storage-pipeline" });
    deps = await buildDeps(cfg, { logger: createLogger({ level: "silent" }) });
    await deps.repos.tenants.ensureDefault(cfg.DEFAULT_TENANT_ID);
  });

  afterAll(async () => {
    await deps.close();
  });

  async function storeListing(overrides: Parameters<typeof sampleListingInput>[0] = {}): Promise<Listing> {
    const { listing } = await deps.repos.listings.upsertFromInput(deps.cfg.DEFAULT_TENANT_ID, sampleListingInput(overrides), deps.now());
    return listing;
  }

  it("publishes a clean pt-PT listing with audio and records steps, reports and costs", async () => {
    const listing = await storeListing();
    const { job, created } = await enqueueJobForListing(deps, listing);
    expect(created).toBe(true);
    const { job: done, output } = await runJobSync(deps, job.id);
    expect(done.status).toBe("published");
    expect(output?.sections.titulo).toContain("T3");
    expect(output?.narration?.duration_s).toBeGreaterThan(0);
    expect(output?.ai_generated).toBe(true);

    const steps = await deps.repos.jobs.steps(job.id);
    expect(steps.map((s) => s.step)).toEqual(expect.arrayContaining(["generate", "gate", "narrate", "publish"]));
    const reports = await deps.repos.gateReports.listForJob(job.id);
    expect(reports.at(-1)?.decision).toBe("pass");
    const costs = await deps.repos.costs.listForJob(job.id);
    expect(costs.length).toBeGreaterThan(0);
  });

  it("is idempotent: the same listing content does not create a second job", async () => {
    const listing = await storeListing();
    const first = await enqueueJobForListing(deps, listing);
    const second = await enqueueJobForListing(deps, listing);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
  });

  it("blocks third-party listings at the ownership gate", async () => {
    const listing = await storeListing({ source_id: "THIRD-1", ownership: "third_party" });
    const { job } = await enqueueJobForListing(deps, listing);
    await expect(runJobSync(deps, job.id)).rejects.toThrow(/ownership gate/);
    expect((await deps.repos.jobs.get(job.id))?.status).toBe("failed");
  });

  it("runs the retry ladder into human review when the copy stays Brazilian", async () => {
    // A generator that always returns pt-BR copy and an editor that never fixes anything.
    const stubborn = new FakeLLMClient({
      responder: (req) => {
        const purpose = req.extra?.purpose;
        if (purpose === "generate") return JSON.stringify(sampleGenerationResultPtBr());
        if (purpose === "edit") return req.messages.at(-1)?.content.split("\n\n---\n")[0] ?? "";
        return JSON.stringify({ pt_pt_score: 40, register_score: 50, flagged_spans: [{ text: "banheiro", category: "lexical", suggestion: "casa de banho" }], summary: "pt-BR" });
      },
    });
    const stubbornDeps: BuiltDeps = {
      ...deps,
      generator: new GeminiDescriptionGenerator({ client: stubborn }),
      editor: { id: "fake", edit: async (text) => ({ text, usage: { input_tokens: 1, output_tokens: 1 }, model: "identity", latency_ms: 1 }) },
      judge: stubborn,
    };
    const listing = await storeListing({ source_id: "STUBBORN-1" });
    const { job } = await enqueueJobForListing(stubbornDeps, listing);
    const { job: done, output } = await runJobSync(stubbornDeps, job.id);
    expect(output).toBeNull();
    expect(done.status).toBe("needs_review");
    expect(done.loop).toBe(GATE_THRESHOLDS.maxLoops);
    const reviews = await deps.repos.reviews.list(deps.cfg.DEFAULT_TENANT_ID, "open");
    expect(reviews.some((r) => r.job_id === job.id)).toBe(true);
  });
});
