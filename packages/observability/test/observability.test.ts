import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { sampleListing } from "@imovel/core/fixtures";
import {
  CompositeCostLedger,
  LoggingCostLedger,
  MemoryCostLedger,
  createLogger,
  createRegistry,
  initTelemetry,
  recordGpuUsage,
  recordLlmUsage,
  recordTtsUsage,
  timeStep,
  tracesUrl,
  withSpan,
} from "../src";

function captureLogger(level = "info") {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      for (const line of chunk.toString().split("\n").filter(Boolean)) lines.push(JSON.parse(line) as Record<string, unknown>);
      cb();
    },
  });
  const log = createLogger({ level, destination, name: "test" });
  return { log, lines };
}

describe("logger", () => {
  it("redacts agent contacts, authorization headers and keys at every depth", () => {
    const { log, lines } = captureLogger();
    const listing = sampleListing();
    log.info({ listing, agent: listing.agent, req: { headers: { authorization: "Bearer x" } } }, "hello");
    log.info({ headers: { authorization: "Bearer y" }, env: { GEMINI_API_KEY: "g", RUNPOD_API_KEY: "r" }, cfg: { api_key: "k", apiKey: "k2", secret: "s", password: "p", token: "t" } }, "cfg");
    log.info({ phone: "+351 900 000 000", email: "x@example.org" }, "top");

    const [first, second, third] = lines as [Record<string, unknown>, Record<string, unknown>, Record<string, unknown>];
    const flat = JSON.stringify(lines);
    expect(flat).not.toContain("+351 912 345 678");
    expect(flat).not.toContain("marta.silva@example.org");
    expect(flat).not.toContain("Bearer");
    expect(flat).not.toContain("+351 900 000 000");
    expect(flat).not.toContain("x@example.org");
    expect((first.listing as { agent: { phone: string } }).agent.phone).toBe("[redacted]");
    expect((first.listing as { agent: { email: string } }).agent.email).toBe("[redacted]");
    expect((first.agent as { phone: string }).phone).toBe("[redacted]");
    expect((first.req as { headers: { authorization: string } }).headers.authorization).toBe("[redacted]");
    expect((first.listing as { agent: { name: string } }).agent.name).toBe("Marta Silva");
    expect(second.headers).toEqual({ authorization: "[redacted]" });
    expect(second.env).toEqual({ GEMINI_API_KEY: "[redacted]", RUNPOD_API_KEY: "[redacted]" });
    expect(second.cfg).toEqual({ api_key: "[redacted]", apiKey: "[redacted]", secret: "[redacted]", password: "[redacted]", token: "[redacted]" });
    expect(third.phone).toBe("[redacted]");
    expect(third.email).toBe("[redacted]");
    expect(first.level).toBe("info");
    expect(first.name).toBe("test");
    expect(typeof first.time).toBe("string");
  });

  it("honours level", () => {
    const { log, lines } = captureLogger("warn");
    log.info("hidden");
    log.warn("shown");
    expect(lines.map((l) => l.msg)).toEqual(["shown"]);
  });
});

describe("otel", () => {
  it("is a no-op without an endpoint and withSpan still runs the function", async () => {
    const t = initTelemetry({ OTEL_EXPORTER_OTLP_ENDPOINT: undefined, OTEL_SERVICE_NAME: "imovel-test" });
    expect(t.enabled).toBe(false);
    const r = await withSpan("step.generate", { step: "generate", provider: "fake" }, async (span) => {
      span.setAttribute("tokens", 12);
      return 42;
    });
    expect(r).toBe(42);
    await expect(withSpan("fails", {}, async () => {
      throw new Error("boom");
    })).rejects.toThrow("boom");
    await t.shutdown();
  });

  it("derives the traces URL from the OTLP endpoint", () => {
    expect(tracesUrl("https://otlp.example.org")).toBe("https://otlp.example.org/v1/traces");
    expect(tracesUrl("https://otlp.example.org/")).toBe("https://otlp.example.org/v1/traces");
    expect(tracesUrl("https://otlp.example.org/v1/traces")).toBe("https://otlp.example.org/v1/traces");
  });
});

describe("metrics", () => {
  it("counts, gauges, observes and renders Prometheus text", async () => {
    const reg = createRegistry();
    reg.counter("gate_decisions_total", { decision: "pass" }).inc();
    reg.counter("gate_decisions_total", { decision: "pass" }).inc(2);
    reg.counter("gate_decisions_total", { decision: "needs_review" }).inc();
    reg.gauge("queue_depth", { queue: "pipeline.gate" }).set(4);
    reg.gauge("queue_depth", { queue: "pipeline.gate" }).dec();
    reg.histogram("judge_score").observe(93);
    reg.histogram("judge_score").observe(78);
    reg.histogram("pipeline_step_duration_seconds", { step: "generate", provider: "gemini" }).observe(9.5);
    await timeStep("gate", "amalia", async () => "ok", reg);
    reg.counter("custom_total", { label: 'quo"te' }).inc(1);

    const snap = reg.snapshot();
    expect(snap.counters).toContainEqual({ name: "gate_decisions_total", labels: { decision: "pass" }, value: 3 });
    expect(snap.gauges).toContainEqual({ name: "queue_depth", labels: { queue: "pipeline.gate" }, value: 3 });
    const judge = snap.histograms.find((h) => h.name === "judge_score")!;
    expect(judge.count).toBe(2);
    expect(judge.sum).toBe(171);
    expect(judge.buckets.find((b) => b.le === 80)!.count).toBe(1);
    expect(judge.buckets.find((b) => b.le === 95)!.count).toBe(2);

    const text = reg.renderPrometheus();
    expect(text).toContain("# TYPE gate_decisions_total counter");
    expect(text).toContain('gate_decisions_total{decision="pass"} 3');
    expect(text).toContain("# TYPE queue_depth gauge");
    expect(text).toContain('queue_depth{queue="pipeline.gate"} 3');
    expect(text).toContain("# TYPE judge_score histogram");
    expect(text).toContain('judge_score_bucket{le="80"} 1');
    expect(text).toContain('judge_score_bucket{le="+Inf"} 2');
    expect(text).toContain("judge_score_sum 171");
    expect(text).toContain("judge_score_count 2");
    expect(text).toContain('pipeline_step_duration_seconds_bucket{provider="gemini",step="generate",le="10"} 1');
    expect(text).toContain('pipeline_step_duration_seconds_count{provider="amalia",step="gate"} 1');
    expect(text).toContain('custom_total{label="quo\\"te"} 1');
    expect(text.endsWith("\n")).toBe(true);

    expect(() => reg.counter("gate_decisions_total").inc(-1)).toThrow();
    expect(() => reg.gauge("gate_decisions_total")).toThrow(/counter/);
    reg.reset();
    expect(reg.snapshot().counters).toEqual([]);
  });
});

describe("cost ledger", () => {
  it("composes ledgers and prices gemini usage above zero", async () => {
    const { log, lines } = captureLogger();
    const reg = createRegistry();
    const memory = new MemoryCostLedger();
    const ledger = new CompositeCostLedger([new LoggingCostLedger(log, reg), memory]);

    const event = await recordLlmUsage(ledger, {
      tenant_id: "00000000-0000-4000-8000-000000000001",
      job_id: "11111111-1111-4111-8111-111111111111",
      step: "generate",
      provider: "gemini",
      model: "gemini-2.5-pro",
      usage: { input_tokens: 1500, output_tokens: 800, reasoning_tokens: 400 },
    });
    expect(event.cost_usd).toBeGreaterThan(0);
    expect(event.cost_usd).toBeCloseTo(1500 / 1e6 * 1.25 + 1200 / 1e6 * 10, 6);
    expect(memory.events).toEqual([event]);
    expect(memory.total()).toBe(event.cost_usd);

    const line = lines.find((l) => l.event === "cost")!;
    expect(line.cost_usd).toBe(event.cost_usd);
    expect(line.provider).toBe("gemini");
    expect(line.input_tokens).toBe(1500);

    expect(reg.snapshot().counters).toContainEqual({ name: "cost_usd_total", labels: { provider: "gemini", step: "generate" }, value: event.cost_usd });

    const tts = await recordTtsUsage(ledger, { tenant_id: event.tenant_id, provider: "voxcpm2-runpod", usage: { chars: 900, gpu_seconds: 21, audio_seconds: 70 } }, reg);
    expect(tts.step).toBe("narrate");
    expect(tts.cost_usd).toBeCloseTo((21 / 3600) * 0.69, 6);
    expect(reg.counter("tts_chars_total", { provider: "voxcpm2-runpod" }).get()).toBe(900);
    expect(reg.counter("tts_audio_seconds_total", { provider: "voxcpm2-runpod" }).get()).toBe(70);

    const eleven = await recordTtsUsage(ledger, { tenant_id: event.tenant_id, provider: "elevenlabs", usage: { chars: 1000 } }, reg);
    expect(eleven.cost_usd).toBeCloseTo(0.1, 6);

    const gpu = await recordGpuUsage(ledger, { tenant_id: event.tenant_id, step: "gate", provider: "runpod-vllm", model: "amalia", gpu_seconds: 6 });
    expect(gpu.cost_usd).toBeCloseTo((6 / 3600) * 1.22, 6);

    const unknown = await recordLlmUsage(ledger, { tenant_id: event.tenant_id, step: "judge", provider: "fake", model: "fake", usage: { input_tokens: 10, output_tokens: 10 } });
    expect(unknown.cost_usd).toBe(0);
    expect(memory.events).toHaveLength(5);
  });
});
