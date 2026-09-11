import { JudgeResult, UpstreamError, sectionsToText } from "@imovel/core";
import { sampleGenerationResult, sampleGenerationResultPtBr } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { FAKE_PTBR_MAP, FakeLLMClient, applyFakePtPtFixes, fakeJudge, fixFakePtPt } from "../src/adapters/fake";

const ptPt = sampleGenerationResult();
const ptBr = sampleGenerationResultPtBr();

async function judge(text: string): Promise<JudgeResult> {
  const client = new FakeLLMClient();
  const res = await client.chat({
    messages: [
      { role: "system", content: "Avalia o português europeu do texto e responde em JSON." },
      { role: "user", content: text },
    ],
    extra: { purpose: "judge" },
  });
  return JudgeResult.parse(JSON.parse(res.content));
}

describe("fake judge", () => {
  it("scores the pt-BR fixture below 90 with lexical spans and the pt-PT fixture at 100", async () => {
    const bad = await judge(ptBr.descricao);
    expect(bad.pt_pt_score).toBeLessThan(90);
    expect(bad.register_score).toBe(90);
    expect(bad.flagged_spans.length).toBeGreaterThan(2);
    expect(bad.flagged_spans.every((s) => s.category === "lexical" && s.suggestion)).toBe(true);
    expect(bad.flagged_spans.map((s) => s.text.toLowerCase())).toEqual(
      expect.arrayContaining(["banheiros", "sacada", "esse", "reformado"]),
    );
    expect(bad.summary).toContain("marcador");

    const good = await judge(ptPt.descricao);
    expect(good.pt_pt_score).toBe(100);
    expect(good.flagged_spans).toEqual([]);

    expect((await judge(sectionsToText(ptPt))).pt_pt_score).toBe(100);
    expect((await judge(sectionsToText(ptBr))).pt_pt_score).toBe(0);
  });

  it("deducts 8 per marker", () => {
    expect(fakeJudge("Um texto correto.").pt_pt_score).toBe(100);
    expect(fakeJudge("Tem um banheiro.").pt_pt_score).toBe(92);
    expect(fakeJudge("Tem um banheiro e uma sacada.").pt_pt_score).toBe(84);
  });
});

describe("applyFakePtPtFixes", () => {
  it("replaces every marker in the pt-BR fixture, preserving case, and is idempotent", () => {
    const fixed = applyFakePtPtFixes(sectionsToText(ptBr));
    for (const [from] of FAKE_PTBR_MAP) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu");
      expect(fixed, from).not.toMatch(re);
    }
    expect(fixed).toContain("Este apartamento");
    expect(fixed).toContain("Remodelado em 2021");
    expect(fixed).toContain("3.º andar");
    expect(fixed).toContain("Agende a sua visita");
    expect(fixed).toContain("materiais de qualidade superior");
    expect(fixed).toContain("transportes a curta distância");
    expect(fixed).not.toContain("3.º.º");
    expect(applyFakePtPtFixes(fixed)).toBe(fixed);
    expect(applyFakePtPtFixes(sectionsToText(ptPt))).toBe(sectionsToText(ptPt));
  });

  it("matches whole words only and prefers longer phrases", () => {
    expect(applyFakePtPtFixes("A vaga de garagem e a vaga.")).toBe("A lugar de garagem e a lugar de garagem.");
    expect(applyFakePtPtFixes("buscar")).toBe("buscar");
    expect(applyFakePtPtFixes("busca-se")).toBe("procura-se");
    expect(applyFakePtPtFixes("essência")).toBe("essência");
    expect(fixFakePtPt("SACADA grande").text).toBe("VARANDA grande");
    expect(fixFakePtPt("Depósito e depósito").markers.map((m) => m.suggestion)).toEqual(["Arrecadação", "arrecadação"]);
  });
});

describe("FakeLLMClient", () => {
  it("routes on purpose, logs calls and answers 'ok' otherwise", async () => {
    const client = new FakeLLMClient();
    const gen = await client.chat({ messages: [{ role: "user", content: "x" }], extra: { purpose: "generate" } });
    expect(JSON.parse(gen.content)).toEqual(sampleGenerationResult());
    const other = await client.chat({ messages: [{ role: "user", content: "x" }] });
    expect(other.content).toBe("ok");
    expect(client.calls).toHaveLength(2);
    expect(await client.health()).toEqual({ ok: true, latency_ms: 0 });
  });

  it("fails the configured number of times before succeeding", async () => {
    const client = new FakeLLMClient({ failuresBeforeSuccess: 2 });
    await expect(client.chat({ messages: [] })).rejects.toBeInstanceOf(UpstreamError);
    await expect(client.chat({ messages: [] })).rejects.toBeInstanceOf(UpstreamError);
    await expect(client.chat({ messages: [] })).resolves.toMatchObject({ content: "ok", finish_reason: "stop" });

    const custom = new FakeLLMClient({ failuresBeforeSuccess: 1, failure: () => new Error("boom") });
    await expect(custom.chat({ messages: [] })).rejects.toThrow("boom");
  });

  it("supports async responders and simulated latency", async () => {
    const client = new FakeLLMClient({ responder: async () => "tarde", latencyMs: 5 });
    const res = await client.chat({ messages: [{ role: "user", content: "x" }], model: "custom" });
    expect(res).toMatchObject({ content: "tarde", model: "custom", latency_ms: 5 });
  });
});
