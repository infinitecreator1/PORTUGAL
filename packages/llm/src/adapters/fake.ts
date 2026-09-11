import type {
  CallOptions,
  ChatRequest,
  ChatResponse,
  JudgeResult,
  LLMCapabilities,
  LLMClient,
} from "@imovel/core";
import { TimeoutError, UpstreamError } from "@imovel/core";
import { sampleGenerationResult } from "@imovel/core/fixtures";
import { splitEditUserMessage } from "../prompts/edit";

/**
 * Deterministic pt-BR → pt-PT replacements used by the fake editor and judge. Ordered so that
 * longer phrases win over the words they contain ("vaga de garagem" before "vaga"). Matching is
 * whole-word, accent-aware and case-insensitive; the replacement keeps the matched capitalisation.
 */
export const FAKE_PTBR_MAP: ReadonlyArray<readonly [string, string]> = [
  ["transporte público próximo ao imóvel", "transportes a curta distância"],
  ["Você vai adorar: está", "Está"],
  ["a gente recomenda", "recomendamos"],
  ["vaga de garagem", "lugar de garagem"],
  ["pronto para morar", "pronto a habitar"],
  ["ótimo investimento", "investimento sólido"],
  ["cozinha americana", "cozinha em open space"],
  ["armários embutidos", "roupeiros embutidos"],
  ["está oferecendo", "oferece"],
  ["vem conservando", "conserva"],
  ["acabamentos de", "materiais de"],
  ["vem mantendo", "mantém"],
  ["sol da tarde", "exposição solar poente"],
  ["bairro nobre", "bairro consolidado"],
  ["venha conhecer", "conheça"],
  ["alto padrão", "qualidade superior"],
  ["próximo ao", "próximo do"],
  ["Agende sua", "Agende a sua"],
  ["quanto para", "como para"],
  ["itens raros", "bens raros"],
  ["dormitórios", "quartos"],
  ["dormitório", "quarto"],
  ["banheiros", "casas de banho"],
  ["banheiro", "casa de banho"],
  ["geladeira", "frigorífico"],
  ["esquadrias", "caixilharia"],
  ["ensolarada", "luminosa"],
  ["caminhando", "a pé"],
  ["reformado", "remodelado"],
  ["planejada", "por medida"],
  ["depósito", "arrecadação"],
  ["sacada", "varanda"],
  ["busca", "procura"],
  ["nessa", "nesta"],
  ["Esse", "Este"],
  ["esse", "este"],
  ["vaga", "lugar de garagem"],
  ["3º", "3.º"],
];

const FAKE_RULES: ReadonlyArray<{ regex: RegExp; to: string }> = FAKE_PTBR_MAP.map(([from, to]) => ({
  regex: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(from)}(?![\\p{L}\\p{N}])`, "giu"),
  to,
}));

export interface FakePtBrMarker {
  text: string;
  suggestion: string;
}

/** Applies the map and reports every replacement made (one per remaining pt-BR marker). */
export function fixFakePtPt(text: string): { text: string; markers: FakePtBrMarker[] } {
  const markers: FakePtBrMarker[] = [];
  let out = text;
  for (const rule of FAKE_RULES) {
    out = out.replace(rule.regex, (matched: string) => {
      const suggestion = preserveCase(matched, rule.to);
      markers.push({ text: matched, suggestion });
      return suggestion;
    });
  }
  return { text: out, markers };
}

/** Deterministic pt-BR → pt-PT fix used by the fake editor. Idempotent. */
export function applyFakePtPtFixes(text: string): string {
  return fixFakePtPt(text).text;
}

/** Judge verdict as the fake computes it: 100 minus 8 per remaining marker, floored at 0. */
export function fakeJudge(text: string): JudgeResult {
  const { markers } = fixFakePtPt(text);
  const pt_pt_score = Math.max(0, 100 - 8 * markers.length);
  return {
    pt_pt_score,
    register_score: 90,
    flagged_spans: markers.map((m) => ({ text: m.text, category: "lexical" as const, suggestion: m.suggestion })),
    summary:
      markers.length === 0
        ? "Sem marcadores de português do Brasil."
        : `${markers.length} marcador(es) de português do Brasil: ${markers.map((m) => m.text).join(", ")}.`,
  };
}

/** Routes on `req.extra.purpose`: generate → fixture JSON; edit → fixed text; judge → verdict; else "ok". */
export function defaultFakeResponder(req: ChatRequest): string {
  const purpose = req.extra?.purpose;
  const lastUser = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  switch (purpose) {
    case "generate":
      return JSON.stringify(sampleGenerationResult());
    case "edit":
      return applyFakePtPtFixes(splitEditUserMessage(lastUser).text);
    case "judge":
      return JSON.stringify(fakeJudge(lastUser));
    default:
      return "ok";
  }
}

export interface FakeLLMClientOptions {
  responder?: (req: ChatRequest) => string | Promise<string>;
  /** Simulated latency, awaited for real. Default 0. */
  latencyMs?: number;
  /** Number of calls that throw before the first success. Default 0. */
  failuresBeforeSuccess?: number;
  /** Error factory for the simulated failures. Default: retryable `UpstreamError`. */
  failure?: () => Error;
  model?: string;
}

/** Offline `LLMClient` for tests and `pnpm smoke`. Logs every request in `calls`. */
export class FakeLLMClient implements LLMClient {
  readonly provider = "fake";
  readonly defaultModel: string;
  readonly capabilities: LLMCapabilities = { jsonSchema: true, seed: true, reasoningEffort: true };
  readonly calls: ChatRequest[] = [];

  private readonly responder: (req: ChatRequest) => string | Promise<string>;
  private readonly latencyMs: number;
  private readonly failure: () => Error;
  private failuresLeft: number;

  constructor(opts: FakeLLMClientOptions = {}) {
    this.responder = opts.responder ?? defaultFakeResponder;
    this.latencyMs = opts.latencyMs ?? 0;
    this.failuresLeft = opts.failuresBeforeSuccess ?? 0;
    this.failure = opts.failure ?? (() => new UpstreamError("fake upstream failure", { details: { provider: "fake" } }));
    this.defaultModel = opts.model ?? "fake-1";
  }

  async chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResponse> {
    this.calls.push(req);
    if (opts.signal?.aborted) {
      throw new TimeoutError("fake request aborted by caller", { retryable: false, details: { provider: "fake" } });
    }
    if (this.latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw this.failure();
    }
    const content = await this.responder(req);
    const inputChars = req.messages.reduce((n, m) => n + m.content.length, 0);
    return {
      content,
      model: req.model ?? this.defaultModel,
      finish_reason: "stop",
      usage: { input_tokens: estimateTokens(inputChars), output_tokens: estimateTokens(content.length), reasoning_tokens: 0 },
      latency_ms: this.latencyMs,
    };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number }> {
    return { ok: true, latency_ms: 0 };
  }
}

function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function preserveCase(matched: string, replacement: string): string {
  const letters = matched.replace(/[^\p{L}]/gu, "");
  if (letters.length > 1 && letters === letters.toUpperCase()) return replacement.toUpperCase();
  const first = matched.charAt(0);
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return replacement;
}
