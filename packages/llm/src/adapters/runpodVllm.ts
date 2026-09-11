import type { Config } from "@imovel/core";
import { ConfigError, runpodOpenAiBaseUrl } from "@imovel/core";
import { OpenAIWireClient } from "../openaiWireClient";

export interface RunpodVllmClientOptions {
  fetch?: typeof fetch;
  /** Defaults to `cfg.AMALIA_MODEL`. */
  model?: string;
}

/** AMALIA on RunPod serverless vLLM (OpenAI-compatible). Long timeout to absorb cold starts. */
export function createRunpodVllmClient(cfg: Config, opts: RunpodVllmClientOptions = {}): OpenAIWireClient {
  if (!cfg.RUNPOD_AMALIA_ENDPOINT_ID) {
    throw new ConfigError(["RUNPOD_AMALIA_ENDPOINT_ID is required for the RunPod vLLM client"]);
  }
  return new OpenAIWireClient({
    provider: "runpod-vllm",
    baseUrl: runpodOpenAiBaseUrl(cfg.RUNPOD_AMALIA_ENDPOINT_ID),
    apiKey: cfg.RUNPOD_API_KEY,
    defaultModel: opts.model ?? cfg.AMALIA_MODEL,
    capabilities: { jsonSchema: true, seed: true, reasoningEffort: false },
    timeoutMs: 240_000,
    extraPassthrough: ["repetition_penalty", "guided_json"],
    fetch: opts.fetch,
  });
}
