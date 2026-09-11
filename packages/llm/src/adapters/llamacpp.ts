import { OpenAIWireClient } from "../openaiWireClient";

export interface LlamaCppClientOptions {
  /** llama-server OpenAI-compatible base URL. Default `http://localhost:8080/v1`. */
  baseUrl?: string;
  /** Model id sent on the wire; llama-server ignores it unless multiple models are loaded. */
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** Local llama.cpp server (`llama-server`), for offline runs of AMALIA GGUF builds. No API key. */
export function createLlamaCppClient(opts: LlamaCppClientOptions): OpenAIWireClient {
  return new OpenAIWireClient({
    provider: "llamacpp",
    baseUrl: opts.baseUrl ?? "http://localhost:8080/v1",
    defaultModel: opts.model,
    capabilities: { jsonSchema: true, seed: true, reasoningEffort: false },
    timeoutMs: opts.timeoutMs ?? 240_000,
    maxRetries: 1,
    extraPassthrough: ["repetition_penalty", "top_k", "min_p"],
    fetch: opts.fetch,
  });
}
