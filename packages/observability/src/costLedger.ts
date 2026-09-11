import { estimateCostUsd, type CostEvent, type CostLedger } from "@imovel/core";
import type { Logger } from "./logger";
import { metrics, type Registry } from "./metrics";

/** Logs each event at info (`cost_usd`, tokens, provider) and bumps `cost_usd_total{provider,step}`. */
export class LoggingCostLedger implements CostLedger {
  constructor(
    private readonly log: Logger,
    private readonly registry: Registry = metrics,
  ) {}

  async record(event: CostEvent): Promise<void> {
    this.registry.counter("cost_usd_total", { provider: event.provider, step: event.step }).inc(event.cost_usd);
    this.log.info(
      {
        event: "cost",
        tenant_id: event.tenant_id,
        job_id: event.job_id ?? null,
        step: event.step,
        provider: event.provider,
        model: event.model ?? null,
        input_tokens: event.input_tokens,
        output_tokens: event.output_tokens,
        reasoning_tokens: event.reasoning_tokens,
        chars: event.chars,
        gpu_seconds: event.gpu_seconds,
        credits: event.credits,
        cost_usd: event.cost_usd,
      },
      "cost event",
    );
  }
}

/** Fans one event out to several ledgers (e.g. logging + database). */
export class CompositeCostLedger implements CostLedger {
  constructor(private readonly ledgers: CostLedger[]) {}

  async record(event: CostEvent): Promise<void> {
    await Promise.all(this.ledgers.map((l) => l.record(event)));
  }
}

/** Collects events in memory; for tests and dry runs. */
export class MemoryCostLedger implements CostLedger {
  readonly events: CostEvent[] = [];

  async record(event: CostEvent): Promise<void> {
    this.events.push({ ...event });
  }

  total(): number {
    return Math.round(this.events.reduce((s, e) => s + e.cost_usd, 0) * 1e6) / 1e6;
  }
}

export interface LlmUsageInput {
  tenant_id: string;
  job_id?: string | null;
  step: CostEvent["step"];
  provider: string;
  model: string;
  usage: { input_tokens: number; output_tokens: number; reasoning_tokens?: number };
}

/** Builds a `CostEvent` for an LLM call, priced with `estimateCostUsd`, and records it. */
export async function recordLlmUsage(ledger: CostLedger, e: LlmUsageInput): Promise<CostEvent> {
  const base: Omit<CostEvent, "cost_usd"> = {
    tenant_id: e.tenant_id,
    job_id: e.job_id ?? null,
    step: e.step,
    provider: e.provider,
    model: e.model,
    input_tokens: e.usage.input_tokens,
    output_tokens: e.usage.output_tokens,
    ...(e.usage.reasoning_tokens !== undefined ? { reasoning_tokens: e.usage.reasoning_tokens } : {}),
  };
  const event: CostEvent = { ...base, cost_usd: estimateCostUsd(base) };
  await ledger.record(event);
  return event;
}

export interface TtsUsageInput {
  tenant_id: string;
  job_id?: string | null;
  step?: CostEvent["step"];
  provider: string;
  model?: string | null;
  usage: { chars: number; gpu_seconds?: number | null; audio_seconds?: number | null };
}

/** TTS call: characters (per-kchar providers) and/or GPU seconds (RunPod). Also bumps TTS metrics. */
export async function recordTtsUsage(ledger: CostLedger, e: TtsUsageInput, registry: Registry = metrics): Promise<CostEvent> {
  const base: Omit<CostEvent, "cost_usd"> = {
    tenant_id: e.tenant_id,
    job_id: e.job_id ?? null,
    step: e.step ?? "narrate",
    provider: e.provider,
    model: e.model ?? null,
    chars: e.usage.chars,
    ...(e.usage.gpu_seconds != null ? { gpu_seconds: e.usage.gpu_seconds } : {}),
  };
  const event: CostEvent = { ...base, cost_usd: estimateCostUsd(base) };
  registry.counter("tts_chars_total", { provider: e.provider }).inc(e.usage.chars);
  if (e.usage.audio_seconds != null) registry.counter("tts_audio_seconds_total", { provider: e.provider }).inc(e.usage.audio_seconds);
  await ledger.record(event);
  return event;
}

export interface GpuUsageInput {
  tenant_id: string;
  job_id?: string | null;
  step: CostEvent["step"];
  provider: string;
  model?: string | null;
  gpu_seconds: number;
}

/** GPU time on a RunPod endpoint (AMALIA gate, Whisper accent QA, ...). */
export async function recordGpuUsage(ledger: CostLedger, e: GpuUsageInput): Promise<CostEvent> {
  const base: Omit<CostEvent, "cost_usd"> = {
    tenant_id: e.tenant_id,
    job_id: e.job_id ?? null,
    step: e.step,
    provider: e.provider,
    model: e.model ?? null,
    gpu_seconds: e.gpu_seconds,
  };
  const event: CostEvent = { ...base, cost_usd: estimateCostUsd(base) };
  await ledger.record(event);
  return event;
}

export interface CreditsUsageInput {
  tenant_id: string;
  job_id?: string | null;
  provider: string;
  credits: number;
}

/** Ingestion credits (Parse.bot, Piloterr). */
export async function recordCreditsUsage(ledger: CostLedger, e: CreditsUsageInput): Promise<CostEvent> {
  const base: Omit<CostEvent, "cost_usd"> = {
    tenant_id: e.tenant_id,
    job_id: e.job_id ?? null,
    step: "ingest",
    provider: e.provider,
    credits: e.credits,
  };
  const event: CostEvent = { ...base, cost_usd: estimateCostUsd(base) };
  await ledger.record(event);
  return event;
}
