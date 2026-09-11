import type { Config } from "@imovel/core";
import { OpenAIWireClient } from "../openaiWireClient";

export interface LovableGatewayClientOptions {
  fetch?: typeof fetch;
  /** Defaults to `cfg.GEN_MODEL`; the `google/` prefix is added on the wire. */
  model?: string;
}

/** The Lovable AI gateway used by the original chat function (`google/gemini-…` model ids). */
export function createLovableGatewayClient(
  cfg: Config,
  opts: LovableGatewayClientOptions = {},
): OpenAIWireClient {
  return new OpenAIWireClient({
    provider: "lovable-gateway",
    baseUrl: cfg.LOVABLE_BASE_URL,
    apiKey: cfg.LOVABLE_API_KEY,
    defaultModel: opts.model ?? cfg.GEN_MODEL,
    modelPrefix: "google/",
    capabilities: { jsonSchema: false, seed: false, reasoningEffort: false },
    timeoutMs: 90_000,
    fetch: opts.fetch,
  });
}
