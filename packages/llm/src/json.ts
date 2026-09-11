import type { CallOptions, ChatRequest, ChatResponse, LLMClient } from "@imovel/core";
import { ValidationError, truncate } from "@imovel/core";
import { z } from "zod";

/**
 * Pulls the JSON document out of model output: strips ``` fences, then returns the first balanced
 * `{...}` or `[...]` (string-aware). Falls back to the trimmed input when nothing balanced is found
 * so that `JSON.parse` produces the error.
 */
export function extractJson(text: string): string {
  let s = text.trim();
  const fence = /```(?:[a-zA-Z0-9_-]+)?[ \t]*\r?\n?([\s\S]*?)```/.exec(s);
  if (fence) s = (fence[1] ?? "").trim();

  const start = firstIndexOf(s, ["{", "["]);
  if (start === -1) return s;
  const end = findBalancedEnd(s, start);
  return end === -1 ? s.slice(start) : s.slice(start, end + 1);
}

function firstIndexOf(s: string, chars: string[]): number {
  let best = -1;
  for (const c of chars) {
    const i = s.indexOf(c);
    if (i !== -1 && (best === -1 || i < best)) best = i;
  }
  return best;
}

function findBalancedEnd(s: string, start: number): number {
  const stack: string[] = [];
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (stack.length === 0) return i;
    }
  }
  return -1;
}

export type JsonParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ValidationError; issues: string[] };

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

/** Non-throwing variant of `parseJsonWith`; the issues feed the repair prompt. */
export function tryParseJsonWith<T>(
  text: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
): JsonParseResult<T> {
  const candidate = extractJson(text);
  const snippet = truncate(candidate, 300);
  let raw: unknown;
  try {
    raw = JSON.parse(candidate);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const issues = [`JSON inválido: ${message}`];
    return {
      ok: false,
      issues,
      error: new ValidationError("LLM output is not valid JSON", {
        cause,
        details: { issues, snippet },
      }),
    };
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issues = formatZodIssues(parsed.error);
  return {
    ok: false,
    issues,
    error: new ValidationError("LLM output does not match the schema", {
      details: { issues, snippet },
    }),
  };
}

/** Extracts, parses and validates JSON from model output. Throws `ValidationError`. */
export function parseJsonWith<T>(text: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): T {
  const result = tryParseJsonWith(text, schema);
  if (!result.ok) throw result.error;
  return result.data;
}

export const JSON_REPAIR_INSTRUCTION =
  "Corrige o JSON seguinte para obedecer exatamente ao esquema; responde apenas com JSON válido.";

const MAX_REPAIR_INPUT_CHARS = 16_000;

export function buildJsonRepairMessage(
  badOutput: string,
  schemaDescription: string,
  issues: string[],
): string {
  return [
    JSON_REPAIR_INSTRUCTION,
    "",
    "Esquema:",
    schemaDescription,
    "",
    "Problemas detetados:",
    ...issues.map((i) => `- ${i}`),
    "",
    "JSON a corrigir:",
    truncate(badOutput.trim(), MAX_REPAIR_INPUT_CHARS),
  ].join("\n");
}

export interface CompleteJsonOptions {
  /** Make one repair call when the first answer fails to parse or validate. Default true. */
  repairOnce?: boolean;
  opts?: CallOptions;
  /** Overrides the auto-generated schema description in the repair prompt. */
  schemaDescription?: string;
}

export interface CompleteJsonResult<T> {
  data: T;
  /** The last response; when repaired, `usage` and `latency_ms` are summed over both calls. */
  response: ChatResponse;
  repaired: boolean;
}

/**
 * Chat call whose answer must validate against `schema`. On failure it sends ONE repair request
 * (in Portuguese, with the schema description and the zod issues) and throws `ValidationError`
 * if the repaired answer still does not validate.
 */
export async function completeJson<T>(
  client: LLMClient,
  req: ChatRequest,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  options: CompleteJsonOptions = {},
): Promise<CompleteJsonResult<T>> {
  const { repairOnce = true, opts, schemaDescription } = options;

  const first = await client.chat(req, opts);
  const firstParse = tryParseJsonWith(first.content, schema);
  if (firstParse.ok) return { data: firstParse.data, response: first, repaired: false };
  if (!repairOnce) throw firstParse.error;

  const repairReq: ChatRequest = {
    ...req,
    temperature: 0,
    messages: [
      ...req.messages,
      {
        role: "user",
        content: buildJsonRepairMessage(
          first.content,
          schemaDescription ?? describeZodSchema(schema),
          firstParse.issues,
        ),
      },
    ],
  };
  const second = await client.chat(repairReq, opts);
  const response = mergeResponses(first, second);
  const secondParse = tryParseJsonWith(second.content, schema);
  if (secondParse.ok) return { data: secondParse.data, response, repaired: true };

  throw new ValidationError("LLM output did not match the schema after one repair attempt", {
    cause: secondParse.error,
    details: {
      issues: secondParse.issues,
      first_issues: firstParse.issues,
      snippet: truncate(extractJson(second.content), 300),
      usage: response.usage,
      model: response.model,
    },
  });
}

function mergeResponses(first: ChatResponse, second: ChatResponse): ChatResponse {
  const reasoning = (first.usage.reasoning_tokens ?? 0) + (second.usage.reasoning_tokens ?? 0);
  return {
    content: second.content,
    model: second.model,
    finish_reason: second.finish_reason,
    usage: {
      input_tokens: first.usage.input_tokens + second.usage.input_tokens,
      output_tokens: first.usage.output_tokens + second.usage.output_tokens,
      ...(first.usage.reasoning_tokens !== undefined || second.usage.reasoning_tokens !== undefined
        ? { reasoning_tokens: reasoning }
        : {}),
    },
    latency_ms: first.latency_ms + second.latency_ms,
  };
}

/**
 * Compact, human-readable rendering of a zod schema for prompts (pt-PT annotations). Covers the
 * first-party types used in core; anything else falls back to its zod type name.
 */
export function describeZodSchema(schema: z.ZodTypeAny, depth = 0): string {
  const pad = "  ".repeat(depth);
  const note = schema.description ? ` // ${schema.description}` : "";

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const lines = Object.entries(shape).map(([key, value]) => {
      const optional = value instanceof z.ZodOptional || value instanceof z.ZodDefault;
      return `${pad}  "${key}"${optional ? "?" : ""}: ${describeZodSchema(value, depth + 1)}`;
    });
    return `{\n${lines.join(",\n")}\n${pad}}${note}`;
  }
  if (schema instanceof z.ZodArray) {
    const def = schema._def;
    const bounds =
      def.exactLength !== null
        ? ` (exatamente ${def.exactLength.value} itens)`
        : rangeNote(def.minLength?.value, def.maxLength?.value, "itens");
    return `array de ${describeZodSchema(schema.element, depth)}${bounds}${note}`;
  }
  if (schema instanceof z.ZodString) {
    let min: number | undefined;
    let max: number | undefined;
    const extras: string[] = [];
    for (const check of schema._def.checks) {
      if (check.kind === "min") min = check.value;
      else if (check.kind === "max") max = check.value;
      else if (check.kind === "length") min = max = check.value;
      else if (check.kind === "regex") extras.push(`padrão ${check.regex.source}`);
      else if (
        check.kind === "email" ||
        check.kind === "url" ||
        check.kind === "uuid" ||
        check.kind === "datetime"
      )
        extras.push(check.kind);
    }
    const extra = extras.length ? ` (${extras.join(", ")})` : "";
    return `string${rangeNote(min, max, "caracteres")}${extra}${note}`;
  }
  if (schema instanceof z.ZodNumber) {
    let min: number | undefined;
    let max: number | undefined;
    let int = false;
    for (const check of schema._def.checks) {
      if (check.kind === "min") min = check.value;
      else if (check.kind === "max") max = check.value;
      else if (check.kind === "int") int = true;
    }
    return `${int ? "inteiro" : "number"}${rangeNote(min, max, "")}${note}`;
  }
  if (schema instanceof z.ZodBoolean) return `boolean${note}`;
  if (schema instanceof z.ZodLiteral) return `${JSON.stringify(schema.value)}${note}`;
  if (schema instanceof z.ZodEnum) {
    return `${(schema.options as string[]).map((o) => JSON.stringify(o)).join(" | ")}${note}`;
  }
  if (schema instanceof z.ZodNullable) return `${describeZodSchema(schema.unwrap(), depth)} | null${note}`;
  if (schema instanceof z.ZodOptional) return `${describeZodSchema(schema.unwrap(), depth)}${note}`;
  if (schema instanceof z.ZodDefault) {
    const inner = describeZodSchema(schema._def.innerType, depth);
    return `${inner} (por omissão: ${JSON.stringify(schema._def.defaultValue())})${note}`;
  }
  if (schema instanceof z.ZodUnion) {
    return `${(schema.options as z.ZodTypeAny[]).map((o) => describeZodSchema(o, depth)).join(" | ")}${note}`;
  }
  if (schema instanceof z.ZodRecord) {
    return `objeto com valores ${describeZodSchema(schema.valueSchema, depth)}${note}`;
  }
  if (schema instanceof z.ZodEffects) return describeZodSchema(schema.innerType(), depth);
  const typeName: unknown = (schema._def as { typeName?: unknown }).typeName;
  return `${typeof typeName === "string" ? typeName : "unknown"}${note}`;
}

function rangeNote(min: number | undefined, max: number | undefined, unit: string): string {
  const u = unit ? ` ${unit}` : "";
  if (min !== undefined && max !== undefined) return ` (${min}–${max}${u})`;
  if (min !== undefined) return ` (mínimo ${min}${u})`;
  if (max !== undefined) return ` (máximo ${max}${u})`;
  return "";
}
