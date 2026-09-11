import { describe, expect, it } from "vitest";
import type { CallOptions, ChatRequest, ChatResponse, EditOptions, EditOutput, LLMClient, PtPtEditor } from "@imovel/core";
import { GateReport, sectionsToText, sha256 } from "@imovel/core";
import { sampleGenerationResultPtBr, sampleListing } from "@imovel/core/fixtures";
import { runGate } from "../src/index";

const IDS = { job_id: "44444444-4444-4444-8444-444444444444", generation_id: "55555555-5555-4555-8555-555555555555" };

/** Ordered so multi-word replacements run before the single words they contain. */
const REPLACEMENTS: Array<[string, string]> = [
  ["transporte público próximo ao imóvel", "transportes a curta distância"],
  ["Você vai adorar: está", "Está"],
  ["a gente recomenda", "recomendamos"],
  ["dois banheiros", "duas casas de banho"],
  ["vaga de garagem", "lugar de garagem"],
  ["está oferecendo", "oferece"],
  ["vem mantendo", "mantém"],
  ["vem conservando", "conserva"],
  ["pronto para morar", "pronto a habitar"],
  ["Agende sua", "Agende a sua"],
  ["armários embutidos", "roupeiros embutidos"],
  ["alto padrão", "qualidade superior"],
  ["cozinha americana", "cozinha em open space"],
  ["próximo ao", "próximo do"],
  ["bairro nobre", "bairro consolidado"],
  ["ótimo investimento", "investimento sólido"],
  ["quanto para", "como para"],
  ["acabamentos de", "materiais de"],
  ["itens raros", "bens raros"],
  ["sol da tarde", "exposição solar poente"],
  ["venha conhecer", "conheça"],
  ["banheiro", "casa de banho"],
  ["sacada", "varanda"],
  ["dormitórios", "quartos"],
  ["reformado", "remodelado"],
  ["esquadrias", "caixilharia"],
  ["planejada", "por medida"],
  ["depósito", "arrecadação"],
  ["Esse", "Este"],
  ["caminhando", "a pé"],
  ["ensolarada", "luminosa"],
  ["3º", "3.º"],
  ["busca", "procura"],
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyReplacements(text: string): string {
  let out = text;
  for (const [from, to] of REPLACEMENTS) {
    const re = new RegExp(`(?<![\\p{L}])${escapeRegex(from)}(?![\\p{L}])`, "giu");
    out = out.replace(re, (m) => {
      const first = m[0] ?? "";
      const matchUpper = first !== first.toLowerCase() && first === first.toUpperCase();
      const fromUpper = from[0] !== from[0]!.toLowerCase();
      if (matchUpper) return to[0]!.toUpperCase() + to.slice(1);
      return fromUpper ? to[0]!.toLowerCase() + to.slice(1) : to;
    });
  }
  return out;
}

class StubEditor implements PtPtEditor {
  readonly id = "fake" as const;
  calls: Array<{ text: string; opts: EditOptions | undefined }> = [];
  constructor(private readonly transform: (text: string) => string) {}
  async edit(text: string, opts?: EditOptions & CallOptions): Promise<EditOutput> {
    this.calls.push({ text, opts });
    return { text: this.transform(text), usage: { input_tokens: 100, output_tokens: 90 }, model: "stub-editor", latency_ms: 3 };
  }
}

class StubJudge implements LLMClient {
  readonly provider = "stub";
  readonly defaultModel = "stub-judge";
  readonly capabilities = { jsonSchema: false, seed: false, reasoningEffort: false };
  requests: ChatRequest[] = [];
  constructor(private readonly reply: string) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(req);
    return { content: this.reply, model: this.defaultModel, finish_reason: "stop", usage: { input_tokens: 300, output_tokens: 60 }, latency_ms: 4 };
  }
  async health(): Promise<{ ok: boolean; latency_ms: number }> {
    return { ok: true, latency_ms: 0 };
  }
}

const judge96 = (): StubJudge =>
  new StubJudge(
    JSON.stringify({
      pt_pt_score: 96,
      register_score: 95,
      flagged_spans: [{ text: "área total", category: "lexical", suggestion: "área bruta" }],
      summary: "Native pt-PT.",
    }),
  );

describe("runGate", () => {
  it("passes when the editor fixes the pt-BR fixture and the judge scores 96", async () => {
    const listing = sampleListing();
    const before = sampleGenerationResultPtBr();
    const editor = new StubEditor(applyReplacements);
    const judge = judge96();
    let tick = 0;
    const now = (): Date => new Date(Date.UTC(2026, 8, 11, 10, 0, 0, tick++ * 250));

    const { report, after, hints } = await runGate({ listing, before, editor, judge, loop: 1, attempt: 1, ids: IDS, now });

    expect(report.decision, JSON.stringify(report.validators.filter((v) => !v.ok), null, 2)).toBe("pass");
    expect(report.changes.length).toBeGreaterThanOrEqual(5);
    expect(report.validators.find((v) => v.name === "facts")?.ok).toBe(true);
    expect(report.validators.map((v) => v.name)).toEqual(["facts", "lexicon", "grammar", "edit_ratio", "shape", "claims"]);
    expect(report.validators.every((v) => v.ok)).toBe(true);
    expect(report.judge?.pt_pt_score).toBe(96);
    expect(report.editor).toBe("fake");
    expect(report.editor_model).toBe("stub-editor");
    expect(report.strict).toBe(false);
    expect(report.loop).toBe(1);
    expect(report.attempt).toBe(1);
    expect(report.input_hash).toBe(sha256(sectionsToText(before)));
    expect(report.output_hash).toBe(sha256(sectionsToText(after)));
    expect(report.output_hash).not.toBe(report.input_hash);
    expect(report.usage).toEqual({ editor_input_tokens: 700, editor_output_tokens: 630, judge_input_tokens: 300, judge_output_tokens: 60 });
    expect(report.latency_ms).toBe(250);
    expect(report.created_at).toBe("2026-09-11T10:00:00.250Z");
    expect(GateReport.parse(report)).toEqual(report);

    expect(after.descricao).toContain("pronto a habitar");
    expect(after.destaques).toHaveLength(5);
    expect(after.destaques[0]).toBe("Remodelado em 2021 com materiais de qualidade superior");
    expect(after.factos_usados).toEqual(before.factos_usados);
    expect(after.narracao).toContain("745 000 €");

    // Every section was edited once; the editor got hints relevant to its field.
    expect(editor.calls).toHaveLength(7);
    const descricaoCall = editor.calls.find((c) => c.text === before.descricao);
    expect(descricaoCall?.opts?.strict).toBe(false);
    expect(descricaoCall?.opts?.hints).toEqual(expect.arrayContaining(["banheiros → casa de banho", "está oferecendo → estar a + infinitivo (está a oferecer, mantém, continua a crescer)"]));
    expect(descricaoCall?.opts?.hints?.some((h) => h.startsWith("caminhando"))).toBe(false);

    // Hints for the next attempt: only warnings remain, plus the judge span.
    expect(hints).toContain("área total → área bruta");
    expect(hints.some((h) => h.startsWith("banheiro"))).toBe(false);
    expect(judge.requests).toHaveLength(1);
  });

  it("asks for a strict retry, then a regenerate, when the editor changes nothing", async () => {
    const listing = sampleListing();
    const before = sampleGenerationResultPtBr();
    const identity = new StubEditor((t) => t);

    const first = await runGate({ listing, before, editor: identity, judge: null, loop: 1, attempt: 1, ids: IDS });
    expect(first.report.decision).toBe("retry_amalia");
    expect(first.report.changes).toEqual([]);
    expect(first.report.judge).toBeNull();
    expect(first.report.output_hash).toBe(first.report.input_hash);
    expect(first.report.validators.find((v) => v.name === "lexicon")?.ok).toBe(false);
    expect(first.report.validators.find((v) => v.name === "grammar")?.ok).toBe(false);
    expect(first.report.reasons.join("\n")).toMatch(/lexicon/);
    expect(first.hints).toEqual(expect.arrayContaining(["banheiros → casa de banho", "sacada → varanda"]));

    const second = await runGate({ listing, before, editor: identity, judge: null, loop: 1, attempt: 2, strict: true, hints: first.hints, ids: IDS });
    expect(second.report.decision).toBe("regenerate");
    expect(second.report.strict).toBe(true);
    expect(identity.calls.slice(7).every((c) => c.opts?.strict === true)).toBe(true);

    const third = await runGate({ listing, before, editor: identity, judge: null, loop: 2, attempt: 2, ids: IDS });
    expect(third.report.decision).toBe("needs_review");
  });

  it("fails the facts validator when the editor changes the price", async () => {
    const listing = sampleListing();
    const before = sampleGenerationResultPtBr();
    const editor = new StubEditor((t) => applyReplacements(t).replace("745 000 €", "750 000 €"));
    const { report } = await runGate({ listing, before, editor, judge: judge96(), loop: 1, attempt: 1, ids: IDS });
    const facts = report.validators.find((v) => v.name === "facts");
    expect(facts?.ok).toBe(false);
    expect(facts?.issues.join("\n")).toMatch(/745000/);
    expect(report.decision).toBe("retry_amalia");
  });

  it("keeps the original destaques when the editor changes their count", async () => {
    const listing = sampleListing();
    const before = sampleGenerationResultPtBr();
    const editor = new StubEditor((t) => (t.includes("\n") ? applyReplacements(t).split("\n").slice(0, 3).join("\n") : applyReplacements(t)));
    const { report, after } = await runGate({ listing, before, editor, judge: null, loop: 1, attempt: 1, ids: IDS });
    expect(after.destaques).toEqual(before.destaques);
    const note = report.validators.find((v) => v.name === "editor");
    expect(note?.ok).toBe(true);
    expect(note?.issues.join("\n")).toMatch(/destaques count changed/);
    expect(report.validators.find((v) => v.name === "lexicon")?.ok).toBe(false);
  });

  it("records an unparsable judge reply as a soft failure instead of throwing", async () => {
    const listing = sampleListing();
    const before = sampleGenerationResultPtBr();
    const { report } = await runGate({ listing, before, editor: new StubEditor(applyReplacements), judge: new StubJudge("garbage"), loop: 1, attempt: 1, ids: IDS });
    expect(report.judge).toBeNull();
    const j = report.validators.find((v) => v.name === "judge");
    expect(j?.ok).toBe(false);
    expect(j?.severity).toBe("soft");
    expect(report.decision).toBe("regenerate");
  });
});
