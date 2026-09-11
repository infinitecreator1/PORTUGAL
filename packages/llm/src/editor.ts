import type { CallOptions, ChatRequest, EditOptions, EditOutput, LLMClient, PtPtEditor } from "@imovel/core";
import { ValidationError } from "@imovel/core";
import { EDIT_MESSAGE_SEPARATOR, EDIT_SYSTEM_PROMPT, buildEditUserMessage } from "./prompts/edit";

export interface LlmPtPtEditorOptions {
  id: PtPtEditor["id"];
  client: LLMClient;
  /** Overrides the client's default model. */
  model?: string;
}

export const EDIT_LENGTH_RATIO = { min: 0.5, max: 2.0 } as const;

/** Rough pt token estimate (≈3.5 chars per token) with 50% headroom plus a small constant. */
export function editMaxTokens(text: string): number {
  return Math.ceil((text.length / 3.5) * 1.5) + 64;
}

/** Step ② editor: one plain-text-in, plain-text-out request per field (AMALIA, Gemini or fake). */
export class LlmPtPtEditor implements PtPtEditor {
  readonly id: PtPtEditor["id"];
  private readonly client: LLMClient;
  private readonly model: string | undefined;

  constructor(opts: LlmPtPtEditorOptions) {
    this.id = opts.id;
    this.client = opts.client;
    this.model = opts.model;
  }

  async edit(text: string, opts: EditOptions & CallOptions = {}): Promise<EditOutput> {
    if (text.trim() === "") {
      return {
        text,
        usage: { input_tokens: 0, output_tokens: 0 },
        model: this.model ?? this.client.defaultModel,
        latency_ms: 0,
      };
    }

    const req: ChatRequest = {
      ...(this.model ? { model: this.model } : {}),
      messages: [
        { role: "system", content: EDIT_SYSTEM_PROMPT },
        { role: "user", content: buildEditUserMessage(text, { strict: opts.strict, hints: opts.hints }) },
      ],
      temperature: 0.2,
      top_p: 0.9,
      seed: 42,
      max_tokens: editMaxTokens(text),
      extra: { repetition_penalty: 1.05, purpose: "edit" },
    };
    const callOpts: CallOptions = {
      timeoutMs: opts.timeoutMs,
      signal: opts.signal,
      idempotencyKey: opts.idempotencyKey,
    };
    const res = await this.client.chat(req, callOpts);

    const output = cleanEditorOutput(res.content);
    if (!output) {
      throw new ValidationError("editor returned an empty text", {
        details: { editor: this.id, model: res.model, input_chars: text.length },
      });
    }
    const ratio = output.length / text.length;
    if (ratio < EDIT_LENGTH_RATIO.min || ratio > EDIT_LENGTH_RATIO.max) {
      throw new ValidationError(
        `editor output length ratio ${ratio.toFixed(2)} is outside ${EDIT_LENGTH_RATIO.min}–${EDIT_LENGTH_RATIO.max}`,
        {
          details: {
            editor: this.id,
            model: res.model,
            ratio,
            input_chars: text.length,
            output_chars: output.length,
          },
        },
      );
    }
    return { text: output, usage: res.usage, model: res.model, latency_ms: res.latency_ms };
  }
}

/** Trim, drop an echoed instruction block, strip code fences, a leading label and wrapping quotes. */
export function cleanEditorOutput(raw: string): string {
  let s = raw.trim();
  const echoed = s.indexOf(EDIT_MESSAGE_SEPARATOR);
  if (echoed !== -1) s = s.slice(0, echoed).trim();

  const fence = /^```[a-zA-Z0-9_-]*[ \t]*\r?\n?([\s\S]*?)\r?\n?```$/.exec(s);
  if (fence) s = (fence[1] ?? "").trim();

  s = s.replace(/^(?:texto\s+(?:revisto|corrigido|revisado)|revis[ãa]o)\s*:\s*/i, "").trim();

  const quotePairs: Array<[string, string]> = [
    ['"', '"'],
    ["“", "”"],
    ["«", "»"],
    ["'", "'"],
  ];
  for (const [open, close] of quotePairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, s.length - close.length).trim();
      break;
    }
  }
  return s;
}
