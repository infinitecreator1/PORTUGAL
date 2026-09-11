import { describe, expect, it } from "vitest";
import type { CallOptions, ChatRequest, ChatResponse, LLMClient } from "@imovel/core";
import { ValidationError } from "@imovel/core";
import { sampleGenerationResult } from "@imovel/core/fixtures";
import { extractJsonObject, judgePtPt, parseJudgeResponse, sectionsToLabelledText } from "../src/index";

class StubClient implements LLMClient {
  readonly provider = "stub";
  readonly defaultModel = "stub-judge";
  readonly capabilities = { jsonSchema: false, seed: false, reasoningEffort: false };
  requests: ChatRequest[] = [];
  options: Array<CallOptions | undefined> = [];
  constructor(private readonly reply: string) {}
  async chat(req: ChatRequest, opts?: CallOptions): Promise<ChatResponse> {
    this.requests.push(req);
    this.options.push(opts);
    return { content: this.reply, model: req.model ?? this.defaultModel, finish_reason: "stop", usage: { input_tokens: 120, output_tokens: 40 }, latency_ms: 5 };
  }
  async health(): Promise<{ ok: boolean; latency_ms: number }> {
    return { ok: true, latency_ms: 0 };
  }
}

const GOOD = JSON.stringify({
  pt_pt_score: 94,
  register_score: 90,
  flagged_spans: [{ text: "área total", category: "lexical", suggestion: "área bruta" }],
  summary: "Native pt-PT with one minor lexical slip.",
});

describe("judgePtPt", () => {
  it("builds the request as specified and parses the result", async () => {
    const client = new StubClient(GOOD);
    const out = await judgePtPt(client, sampleGenerationResult(), { model: "gemini-2.5-flash", timeoutMs: 1234 });
    expect(out.result.pt_pt_score).toBe(94);
    expect(out.result.flagged_spans[0]).toEqual({ text: "área total", category: "lexical", suggestion: "área bruta" });
    expect(out.usage).toEqual({ input_tokens: 120, output_tokens: 40 });
    expect(out.model).toBe("gemini-2.5-flash");

    const req = client.requests[0]!;
    expect(req.model).toBe("gemini-2.5-flash");
    expect(req.temperature).toBe(0);
    expect(req.response_format).toEqual({ type: "json_object" });
    expect(req.max_tokens).toBe(800);
    expect(req.extra).toEqual({ purpose: "judge" });
    expect(req.messages[0]?.role).toBe("system");
    expect(req.messages[0]?.content).toMatch(/European Portuguese/);
    expect(req.messages[0]?.content).toMatch(/Deduct|deduct/);
    expect(req.messages[1]?.content).toContain("[TÍTULO]");
    expect(req.messages[1]?.content).toContain(sampleGenerationResult().titulo);
    expect(client.options[0]).toEqual({ timeoutMs: 1234 });
  });

  it("defaults to the client's model", async () => {
    const client = new StubClient(GOOD);
    const out = await judgePtPt(client, sampleGenerationResult());
    expect(client.requests[0]?.model).toBe("stub-judge");
    expect(out.model).toBe("stub-judge");
  });

  it("parses leniently: code fences and surrounding prose", async () => {
    const client = new StubClient("Here you go:\n```json\n" + GOOD + "\n```\nDone.");
    const out = await judgePtPt(client, sampleGenerationResult());
    expect(out.result.pt_pt_score).toBe(94);
    expect(parseJudgeResponse('{"pt_pt_score": 88}')).toMatchObject({ pt_pt_score: 88, register_score: null, flagged_spans: [], summary: null });
    expect(extractJsonObject('x {"a": "}"} y')).toBe('{"a": "}"}');
  });

  it("throws ValidationError on malformed output", async () => {
    await expect(judgePtPt(new StubClient("not json at all"), sampleGenerationResult())).rejects.toBeInstanceOf(ValidationError);
    await expect(judgePtPt(new StubClient('{"pt_pt_score": "high"}'), sampleGenerationResult())).rejects.toBeInstanceOf(ValidationError);
    await expect(judgePtPt(new StubClient('{"pt_pt_score": 120}'), sampleGenerationResult())).rejects.toBeInstanceOf(ValidationError);
    await expect(judgePtPt(new StubClient('{"pt_pt_score": 90,'), sampleGenerationResult())).rejects.toBeInstanceOf(ValidationError);
  });

  it("labels every section in the user message", () => {
    const text = sectionsToLabelledText(sampleGenerationResult());
    for (const label of ["[TÍTULO]", "[RESUMO]", "[DESCRIÇÃO]", "[DESTAQUES]", "[LOCALIZAÇÃO]", "[CTA]", "[NARRAÇÃO]"]) expect(text).toContain(label);
  });
});
