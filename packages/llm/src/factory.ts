import type { Config, DescriptionGenerator, LLMClient, PtPtEditor } from "@imovel/core";
import { FakeLLMClient } from "./adapters/fake";
import { createGeminiClient } from "./adapters/gemini";
import { createLovableGatewayClient } from "./adapters/lovableGateway";
import { createRunpodVllmClient } from "./adapters/runpodVllm";
import { LlmPtPtEditor } from "./editor";
import { GeminiDescriptionGenerator } from "./generator";

export type LLMRole = "generate" | "judge" | "editor";

export interface LLMFactoryDeps {
  fetch?: typeof fetch;
}

/**
 * Picks the client for a role from config: `generate`/`judge` follow `LLM_PROVIDER` (with
 * `GEN_MODEL` / `JUDGE_MODEL`), `editor` follows `GATE_EDITOR`.
 */
export function createLLMClient(cfg: Config, role: LLMRole, deps: LLMFactoryDeps = {}): LLMClient {
  if (role === "editor") {
    switch (cfg.GATE_EDITOR) {
      case "amalia":
        return createRunpodVllmClient(cfg, { fetch: deps.fetch });
      case "gemini":
        return createGeminiClient(cfg, { fetch: deps.fetch, model: cfg.JUDGE_MODEL });
      case "fake":
        return new FakeLLMClient();
    }
  }
  const model = role === "generate" ? cfg.GEN_MODEL : cfg.JUDGE_MODEL;
  switch (cfg.LLM_PROVIDER) {
    case "gemini":
      return createGeminiClient(cfg, { fetch: deps.fetch, model });
    case "lovable-gateway":
      return createLovableGatewayClient(cfg, { fetch: deps.fetch, model });
    case "fake":
      return new FakeLLMClient();
  }
}

export function createGenerator(cfg: Config, deps: LLMFactoryDeps = {}): DescriptionGenerator {
  return new GeminiDescriptionGenerator({ client: createLLMClient(cfg, "generate", deps) });
}

export function createEditor(cfg: Config, deps: LLMFactoryDeps = {}): PtPtEditor {
  return new LlmPtPtEditor({ id: cfg.GATE_EDITOR, client: createLLMClient(cfg, "editor", deps) });
}
