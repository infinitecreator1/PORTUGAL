import { loadConfig } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { FakeLLMClient } from "../src/adapters/fake";
import { LlmPtPtEditor } from "../src/editor";
import { createEditor, createGenerator, createLLMClient } from "../src/factory";
import { GeminiDescriptionGenerator } from "../src/generator";
import { OpenAIWireClient } from "../src/openaiWireClient";

const gemini = loadConfig({
  LLM_PROVIDER: "gemini",
  GEMINI_API_KEY: "gk",
  GATE_EDITOR: "amalia",
  RUNPOD_API_KEY: "rk",
  RUNPOD_AMALIA_ENDPOINT_ID: "ep123",
  GEN_MODEL: "gemini-2.5-pro",
  JUDGE_MODEL: "gemini-2.5-flash",
});

describe("createLLMClient", () => {
  it("builds Gemini clients for generate/judge and a RunPod vLLM client for the AMALIA editor", () => {
    const gen = createLLMClient(gemini, "generate");
    expect(gen).toBeInstanceOf(OpenAIWireClient);
    expect(gen.provider).toBe("gemini");
    expect(gen.defaultModel).toBe("gemini-2.5-pro");
    expect((gen as OpenAIWireClient).baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(gen.capabilities).toEqual({ jsonSchema: false, seed: true, reasoningEffort: true });

    const judge = createLLMClient(gemini, "judge");
    expect(judge.provider).toBe("gemini");
    expect(judge.defaultModel).toBe("gemini-2.5-flash");

    const editor = createLLMClient(gemini, "editor") as OpenAIWireClient;
    expect(editor).toBeInstanceOf(OpenAIWireClient);
    expect(editor.provider).toBe("runpod-vllm");
    expect(editor.baseUrl).toBe("https://api.runpod.ai/v2/ep123/openai/v1");
    expect(editor.defaultModel).toBe("amalia-llm/AMALIA-9B-0626-DPO");
    expect(editor.capabilities).toEqual({ jsonSchema: true, seed: true, reasoningEffort: false });
    expect(editor.timeoutMs).toBe(240_000);
  });

  it("builds the Lovable gateway client with the google/ prefix", () => {
    const cfg = loadConfig({ LLM_PROVIDER: "lovable-gateway", LOVABLE_API_KEY: "lk" });
    const client = createLLMClient(cfg, "generate") as OpenAIWireClient;
    expect(client.provider).toBe("lovable-gateway");
    expect(client.baseUrl).toBe("https://ai.gateway.lovable.dev/v1");
    expect(client.resolveModel()).toBe("google/gemini-2.5-pro");
    expect(client.capabilities).toEqual({ jsonSchema: false, seed: false, reasoningEffort: false });
  });

  it("uses Gemini with the judge model when GATE_EDITOR=gemini", () => {
    const cfg = loadConfig({ LLM_PROVIDER: "fake", GATE_EDITOR: "gemini", GEMINI_API_KEY: "gk" });
    const editor = createLLMClient(cfg, "editor");
    expect(editor.provider).toBe("gemini");
    expect(editor.defaultModel).toBe("gemini-2.5-flash");
    expect(createLLMClient(cfg, "generate")).toBeInstanceOf(FakeLLMClient);
  });

  it("uses the fake client by default and passes fetch through", () => {
    const cfg = loadConfig({});
    expect(createLLMClient(cfg, "generate")).toBeInstanceOf(FakeLLMClient);
    expect(createLLMClient(cfg, "judge")).toBeInstanceOf(FakeLLMClient);
    expect(createLLMClient(cfg, "editor")).toBeInstanceOf(FakeLLMClient);

    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
    const client = createLLMClient(gemini, "generate", { fetch: fetchImpl });
    expect(client).toBeInstanceOf(OpenAIWireClient);
  });
});

describe("createGenerator / createEditor", () => {
  it("wires the generator and the editor with the configured ids", () => {
    const generator = createGenerator(gemini);
    expect(generator).toBeInstanceOf(GeminiDescriptionGenerator);
    expect(generator.id).toBe("gemini");

    expect(createEditor(gemini).id).toBe("amalia");
    const fakeEditor = createEditor(loadConfig({}));
    expect(fakeEditor).toBeInstanceOf(LlmPtPtEditor);
    expect(fakeEditor.id).toBe("fake");
  });
});
