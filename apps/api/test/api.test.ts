import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "@imovel/core";
import { sampleListingInput } from "@imovel/core/fixtures";
import { createLogger } from "@imovel/observability";
import { buildDeps, runJobSync, type BuiltDeps } from "@imovel/pipeline";
import { buildServer, type App } from "../src/server";

/**
 * End-to-end through the HTTP surface with fake providers: import → job → outputs.
 * The job itself is run synchronously because no worker is consuming the memory queue.
 */
describe("api", () => {
  let deps: BuiltDeps;
  let app: App;

  beforeAll(async () => {
    const cfg = loadConfig({ NODE_ENV: "test", LLM_PROVIDER: "fake", GATE_EDITOR: "fake", TTS_PROVIDER: "fake", STORAGE_PROVIDER: "fs", FS_STORAGE_DIR: "./out/test-storage", API_KEY: "test-key-1234567890" });
    deps = await buildDeps(cfg, { logger: createLogger({ level: "silent" }) });
    app = await buildServer(deps);
  });

  afterAll(async () => {
    await app.close();
    await deps.close();
  });

  it("rejects requests without the API key", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/listings" });
    expect(res.statusCode).toBe(401);
  });

  it("imports a listing, runs the job and serves the output with signed audio", async () => {
    const auth = { authorization: "Bearer test-key-1234567890" };
    const imp = await app.inject({ method: "POST", url: "/v1/listings/import", headers: auth, payload: { listings: [sampleListingInput()], run: true } });
    expect(imp.statusCode).toBe(202);
    const body = imp.json() as { imported: number; listing_ids: string[]; job_ids: string[] };
    expect(body.imported).toBe(1);
    expect(body.job_ids).toHaveLength(1);

    const { job, output } = await runJobSync(deps, body.job_ids[0]!);
    expect(job.status).toBe("published");
    expect(output?.narration?.wav_key).toBeTruthy();

    const out = await app.inject({ method: "GET", url: `/v1/listings/${body.listing_ids[0]}/outputs`, headers: auth });
    expect(out.statusCode).toBe(200);
    const o = out.json() as { sections: { titulo: string }; narration: { wav_url: string } | null; gate: { decision: string } };
    expect(o.sections.titulo.length).toBeGreaterThan(10);
    expect(o.narration?.wav_url).toMatch(/^file:/);
    expect(o.gate.decision).toBe("pass");

    const j = await app.inject({ method: "GET", url: `/v1/jobs/${body.job_ids[0]}`, headers: auth });
    expect(j.statusCode).toBe(200);
    expect((j.json() as { steps: unknown[] }).steps.length).toBeGreaterThanOrEqual(4);

    const again = await app.inject({ method: "POST", url: "/v1/listings/import", headers: auth, payload: { listings: [sampleListingInput()], run: true } });
    expect((again.json() as { unchanged: number; job_ids: string[] }).unchanged).toBe(1);
    expect((again.json() as { job_ids: string[] }).job_ids).toHaveLength(0);
  });

  it("exposes health, metrics and openapi", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/metrics" })).body).toContain("gate_decisions_total");
    expect((await app.inject({ method: "GET", url: "/v1/openapi.json" })).statusCode).toBe(200);
  });
});
