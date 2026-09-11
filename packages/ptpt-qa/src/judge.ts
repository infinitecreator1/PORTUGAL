/**
 * LLM judge for European Portuguese authenticity. Deterministic parsing, lenient JSON extraction;
 * the model comes from the injected client so this package does not depend on `@imovel/llm`.
 */
import type { CallOptions, ChatRequest, ChatUsage, GenerationResult, LLMClient } from "@imovel/core";
import { JudgeResult, SECTION_KEYS, ValidationError } from "@imovel/core";

export const JUDGE_SYSTEM_PROMPT = `You are a senior European Portuguese (pt-PT) copy reviewer for the real-estate market in Portugal.
Rate the text from 0 to 100 for European Portuguese authenticity, as it would be written by a native pt-PT real-estate professional following the 1990 orthographic agreement (AO90).

Scoring: start at 100 and deduct
- 8 points per Brazilian lexical item (e.g. banheiro, sacada, vaga, dormitório, reformado meaning renovated, alto padrão, aluguel, ônibus, celular, geladeira, cadastro, usuário);
- 6 points per Brazilian construction (progressive gerund such as "está fazendo", sentence-initial proclisis such as "Me contacte", default "você" instead of the impersonal register or "o senhor/a senhora", missing article before a possessive such as "agende sua visita");
- 4 points per Brazilian spelling (econômico, gênero, contato, registro, recepção, aspecto, seção, de fato, eletrônico, quatorze, dezesseis);
- 5 points for a register mismatch (colloquial, slang, exclamations, marketing hype that a Portuguese estate agent would not use).
Never deduct for facts, numbers, typology, prices, place names or content choices; judge the language only.

Also rate register_score from 0 to 100 for professional, sober Portuguese estate-agency register.

Respond with a single JSON object and nothing else:
{"pt_pt_score": <0-100>, "register_score": <0-100>, "flagged_spans": [{"text": "<exact span>", "category": "lexical"|"grammar"|"spelling"|"register"|"other", "suggestion": "<pt-PT replacement or null>"}], "summary": "<one sentence in English>"}`;

const SECTION_LABELS: Record<(typeof SECTION_KEYS)[number], string> = {
  titulo: "TÍTULO",
  resumo: "RESUMO",
  descricao: "DESCRIÇÃO",
  destaques: "DESTAQUES",
  localizacao: "LOCALIZAÇÃO",
  cta: "CTA",
  narracao: "NARRAÇÃO",
};

/** The sections as labelled plain text for the judge's user message. */
export function sectionsToLabelledText(sections: GenerationResult): string {
  return SECTION_KEYS.map((key) => {
    const body = key === "destaques" ? sections.destaques.map((d) => `- ${d}`).join("\n") : sections[key];
    return `[${SECTION_LABELS[key]}]\n${body}`;
  }).join("\n\n");
}

/** Strips code fences and returns the first balanced `{…}` object in the string, or null. */
export function extractJsonObject(raw: string): string | null {
  const stripped = raw.replace(/```(?:json)?/gi, "").trim();
  const start = stripped.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return null;
}

/** Parses a judge reply leniently; throws `ValidationError` when no valid JudgeResult can be read. */
export function parseJudgeResponse(raw: string): JudgeResult {
  const json = extractJsonObject(raw);
  if (json === null) {
    throw new ValidationError("judge returned no JSON object", { details: { snippet: raw.slice(0, 300) } });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new ValidationError("judge returned invalid JSON", { cause: err, details: { snippet: json.slice(0, 300) } });
  }
  const result = JudgeResult.safeParse(parsed);
  if (!result.success) {
    throw new ValidationError("judge JSON does not match JudgeResult", {
      details: { issues: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`), snippet: json.slice(0, 300) },
    });
  }
  return result.data;
}

export interface JudgeOptions extends CallOptions {
  model?: string;
}

export interface JudgeOutput {
  result: JudgeResult;
  usage: ChatUsage;
  model: string;
}

export function buildJudgeRequest(sections: GenerationResult, model?: string): ChatRequest {
  return {
    ...(model ? { model } : {}),
    messages: [
      { role: "system", content: JUDGE_SYSTEM_PROMPT },
      { role: "user", content: sectionsToLabelledText(sections) },
    ],
    temperature: 0,
    response_format: { type: "json_object" },
    max_tokens: 800,
    extra: { purpose: "judge" },
  };
}

/** Asks the judge model to score the sections. Upstream errors propagate; unparsable replies throw `ValidationError`. */
export async function judgePtPt(client: LLMClient, sections: GenerationResult, opts: JudgeOptions = {}): Promise<JudgeOutput> {
  const { model, ...callOptions } = opts;
  const response = await client.chat(buildJudgeRequest(sections, model ?? client.defaultModel), callOptions);
  const result = parseJudgeResponse(response.content);
  return { result, usage: response.usage, model: response.model || model || client.defaultModel };
}
