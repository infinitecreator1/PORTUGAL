import type { CostEvent } from "./interfaces";

/** Unit prices in USD, verified September 2026. Update the `asOf` date when you change a row. */
export const PRICING = {
  asOf: "2026-09-11",
  /** Per 1M tokens. */
  llm: {
    "gemini-2.5-pro": { input: 1.25, output: 10.0 },
    "gemini-2.5-flash": { input: 0.3, output: 2.5 },
    "gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
    "gemini-3.1-pro-preview": { input: 2.0, output: 12.0 },
    "gemini-3.7-flash": { input: 0.75, output: 3.75 },
    "gemini-3.5-flash": { input: 1.5, output: 9.0 },
    "gemini-3.1-flash-lite": { input: 0.25, output: 1.5 },
  } as Record<string, { input: number; output: number }>,
  /** Per GPU hour on RunPod Serverless flex workers. */
  gpuHour: {
    "runpod-l4": 0.69,
    "runpod-a5000": 0.69,
    "runpod-4090": 1.1,
    "runpod-a40": 1.22,
    "runpod-a6000": 1.22,
    "runpod-l40s": 1.75,
    "runpod-a100": 2.72,
  } as Record<string, number>,
  /** Per 1,000 characters. */
  ttsPerKChar: {
    elevenlabs: 0.1,
    "elevenlabs-flash": 0.05,
    "gemini-cloud-tts": 0.02,
  } as Record<string, number>,
  /** Per credit. Parse.bot top tier is about $0.01/credit; low tiers cost more. */
  creditsUsd: {
    parsebot: 0.02,
    piloterr: 0.01,
    casafari: 0,
  } as Record<string, number>,
} as const;

export const PROVIDER_GPU: Record<string, keyof typeof PRICING.gpuHour> = {
  "runpod-vllm": "runpod-a40",
  "voxcpm2-runpod": "runpod-l4",
  "voxcpm2-http": "runpod-l4",
};

/** Best-effort cost estimate for a cost event with unit prices from the table above. */
export function estimateCostUsd(e: Omit<CostEvent, "cost_usd">): number {
  let usd = 0;
  const model = e.model ?? "";
  const llm = PRICING.llm[model];
  if (llm) {
    usd += ((e.input_tokens ?? 0) / 1e6) * llm.input;
    usd += (((e.output_tokens ?? 0) + (e.reasoning_tokens ?? 0)) / 1e6) * llm.output;
  }
  const gpu = PROVIDER_GPU[e.provider];
  if (gpu && e.gpu_seconds) usd += (e.gpu_seconds / 3600) * PRICING.gpuHour[gpu];
  const tts = PRICING.ttsPerKChar[e.provider];
  if (tts && e.chars) usd += (e.chars / 1000) * tts;
  const credit = PRICING.creditsUsd[e.provider];
  if (credit && e.credits) usd += e.credits * credit;
  return Math.round(usd * 1e6) / 1e6;
}
