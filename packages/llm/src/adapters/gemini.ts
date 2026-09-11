import type { Config } from "@imovel/core";
import { OpenAIWireClient } from "../openaiWireClient";

export interface GeminiClientOptions {
  fetch?: typeof fetch;
  /** Defaults to `cfg.GEN_MODEL`. */
  model?: string;
}

/** Gemini through its OpenAI-compatible endpoint. No `json_schema`; `seed` and `reasoning_effort` supported. */
export function createGeminiClient(cfg: Config, opts: GeminiClientOptions = {}): OpenAIWireClient {
  return new OpenAIWireClient({
    provider: "gemini",
    baseUrl: cfg.GEMINI_BASE_URL,
    apiKey: cfg.GEMINI_API_KEY,
    defaultModel: opts.model ?? cfg.GEN_MODEL,
    capabilities: { jsonSchema: false, seed: true, reasoningEffort: true },
    timeoutMs: 90_000,
    fetch: opts.fetch,
  });
}
