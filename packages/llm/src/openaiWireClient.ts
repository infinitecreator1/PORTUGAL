import type {
  CallOptions,
  ChatRequest,
  ChatResponse,
  ChatUsage,
  LLMCapabilities,
  LLMClient,
} from "@imovel/core";
import { TimeoutError, UpstreamError, errorFromStatus, isRetryable, truncate } from "@imovel/core";
import { z } from "zod";
import type { RetryOptions } from "./retry";
import { defaultSleep, withRetry } from "./retry";
import { parseSseDeltas } from "./sse";

export interface OpenAIWireClientOptions {
  /** Provider id used in errors and cost events (e.g. `gemini`, `runpod-vllm`). */
  provider: string;
  /** Base URL up to and including `/v1` (or the provider's equivalent); `/chat/completions` is appended. */
  baseUrl: string;
  /** When absent no `Authorization` header is sent (local llama.cpp, for example). */
  apiKey?: string;
  defaultModel: string;
  capabilities: LLMCapabilities;
  fetch?: typeof fetch;
  /** Per-request timeout. Default 60 s. */
  timeoutMs?: number;
  /** Retries on retryable errors. Default 3. */
  maxRetries?: number;
  /** Backoff base. Default 500 ms. */
  retryBaseMs?: number;
  /** Backoff cap. Default 30 s. */
  retryMaxMs?: number;
  /** Extra headers sent on every request. */
  headers?: Record<string, string>;
  /** Prepended to every model id (`google/` for the Lovable gateway). */
  modelPrefix?: string;
  /** Additional `req.extra` keys forwarded to the provider besides the built-in allow-list. */
  extraPassthrough?: string[];
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: RetryOptions["onRetry"];
}

/** `req.extra` keys forwarded by default. `reasoning_effort` is added when the capability is on. */
export const DEFAULT_EXTRA_PASSTHROUGH: readonly string[] = [
  "repetition_penalty",
  "top_k",
  "presence_penalty",
  "frequency_penalty",
];

/** Internal routing hint for the fake client; never sent over the wire. */
const INTERNAL_EXTRA_KEYS: ReadonlySet<string> = new Set(["purpose"]);

const HEALTH_TIMEOUT_MS = 5_000;

const ContentPart = z.object({ type: z.string().optional(), text: z.string().optional() }).passthrough();

const ChatCompletion = z
  .object({
    model: z.string().optional(),
    choices: z
      .array(
        z
          .object({
            message: z
              .object({ content: z.union([z.string(), z.array(ContentPart), z.null()]).optional() })
              .passthrough(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().nullable().optional(),
        completion_tokens: z.number().nullable().optional(),
        completion_tokens_details: z
          .object({ reasoning_tokens: z.number().nullable().optional() })
          .passthrough()
          .nullable()
          .optional(),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();

/**
 * Chat-completions client over the OpenAI wire format, ported from the chat edge function:
 * bearer auth, JSON body, 429/402/5xx/4xx mapping, plus timeouts, retries and usage parsing.
 */
export class OpenAIWireClient implements LLMClient {
  readonly provider: string;
  readonly baseUrl: string;
  readonly defaultModel: string;
  readonly capabilities: LLMCapabilities;
  readonly modelPrefix: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;

  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly retryBaseMs: number;
  private readonly retryMaxMs: number;
  private readonly headers: Record<string, string>;
  private readonly passthrough: ReadonlySet<string>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onRetry: RetryOptions["onRetry"];

  constructor(opts: OpenAIWireClientOptions) {
    this.provider = opts.provider;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.defaultModel = opts.defaultModel;
    this.capabilities = opts.capabilities;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.maxRetries = opts.maxRetries ?? 3;
    this.retryBaseMs = opts.retryBaseMs ?? 500;
    this.retryMaxMs = opts.retryMaxMs ?? 30_000;
    this.headers = opts.headers ?? {};
    this.modelPrefix = opts.modelPrefix ?? "";
    this.passthrough = new Set([...DEFAULT_EXTRA_PASSTHROUGH, ...(opts.extraPassthrough ?? [])]);
    this.sleep = opts.sleep ?? defaultSleep;
    this.onRetry = opts.onRetry;
  }

  /** Fully qualified model id as sent on the wire. */
  resolveModel(model?: string): string {
    const id = model ?? this.defaultModel;
    return this.modelPrefix && !id.startsWith(this.modelPrefix) ? `${this.modelPrefix}${id}` : id;
  }

  /** Builds the wire body. Exposed for tests and debugging. */
  buildBody(req: ChatRequest, stream: boolean): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(req.model),
      messages: req.messages,
      stream,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (req.max_tokens !== undefined) body.max_tokens = req.max_tokens;
    if (req.stop !== undefined && req.stop.length > 0) body.stop = req.stop;
    if (req.seed !== undefined && this.capabilities.seed) body.seed = req.seed;

    if (req.response_format) {
      if (req.response_format.type === "json_object") body.response_format = req.response_format;
      else if (this.capabilities.jsonSchema) body.response_format = req.response_format;
      else body.response_format = { type: "json_object" };
    }

    for (const [key, value] of Object.entries(req.extra ?? {})) {
      if (value === undefined || INTERNAL_EXTRA_KEYS.has(key)) continue;
      if (key === "reasoning_effort") {
        if (this.capabilities.reasoningEffort) body.reasoning_effort = value;
        continue;
      }
      if (this.passthrough.has(key)) body[key] = value;
    }
    return body;
  }

  async chat(req: ChatRequest, opts: CallOptions = {}): Promise<ChatResponse> {
    const body = this.buildBody(req, false);
    const model = body.model as string;
    return this.withRetries(opts, async () => {
      const started = performance.now();
      const res = await this.send("/chat/completions", body, opts);
      let json: unknown;
      try {
        json = await res.json();
      } catch (cause) {
        throw new UpstreamError(`${this.provider} returned a non-JSON body`, {
          cause,
          status: res.status,
          details: { provider: this.provider },
        });
      }
      return parseChatCompletion(json, { provider: this.provider, model, startedAt: started });
    });
  }

  /** Streams content deltas (`stream: true`). Retries only apply before the first byte. */
  async *stream(req: ChatRequest, opts: CallOptions = {}): AsyncIterable<string> {
    const body = this.buildBody(req, true);
    const res = await this.withRetries(opts, () => this.send("/chat/completions", body, opts));
    if (!res.body) {
      throw new UpstreamError(`${this.provider} returned an empty stream body`, {
        details: { provider: this.provider },
      });
    }
    yield* parseSseDeltas(res.body);
  }

  /** GET `/models` with a 5 s timeout. Never throws. */
  async health(): Promise<{ ok: boolean; latency_ms: number }> {
    const started = performance.now();
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/models`, {
        method: "GET",
        headers: this.requestHeaders(),
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      await res.text().catch(() => "");
      return { ok: res.ok, latency_ms: elapsedMs(started) };
    } catch {
      return { ok: false, latency_ms: elapsedMs(started) };
    }
  }

  private withRetries<T>(opts: CallOptions, fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, {
      maxRetries: this.maxRetries,
      baseMs: this.retryBaseMs,
      maxMs: this.retryMaxMs,
      shouldRetry: (error) => isRetryable(error) && opts.signal?.aborted !== true,
      sleep: this.sleep,
      onRetry: this.onRetry,
    });
  }

  private requestHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const headers: Record<string, string> = { ...this.headers, ...extra };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    return headers;
  }

  /** One POST. Maps HTTP failures via `errorFromStatus` and transport failures to `TimeoutError`. */
  private async send(path: string, body: Record<string, unknown>, opts: CallOptions): Promise<Response> {
    const timeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const signal = combineSignals([AbortSignal.timeout(timeoutMs), opts.signal]);
    const headers = this.requestHeaders({
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    });

    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      throw this.transportError(cause, opts, timeoutMs);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw errorFromStatus(res.status, text, {
        provider: this.provider,
        retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
      });
    }
    return res;
  }

  private transportError(cause: unknown, opts: CallOptions, timeoutMs: number): TimeoutError {
    const callerAborted = opts.signal?.aborted === true;
    const reason = callerAborted ? "aborted" : isAbortError(cause) ? "timeout" : "network";
    const message =
      reason === "timeout"
        ? `${this.provider} request timed out after ${timeoutMs} ms`
        : reason === "aborted"
          ? `${this.provider} request aborted by caller`
          : `${this.provider} request failed: ${cause instanceof Error ? cause.message : String(cause)}`;
    return new TimeoutError(message, {
      cause,
      // A caller abort must not be retried; timeouts and network failures may.
      retryable: !callerAborted,
      details: { provider: this.provider, reason, timeoutMs },
    });
  }
}

/** Parses a chat-completion body. Throws `UpstreamError` when the shape is not usable. */
export function parseChatCompletion(
  json: unknown,
  ctx: { provider: string; model: string; startedAt: number },
): ChatResponse {
  const parsed = ChatCompletion.safeParse(json);
  if (!parsed.success) {
    throw new UpstreamError(`${ctx.provider} returned a malformed chat completion`, {
      details: {
        provider: ctx.provider,
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
        body: truncate(safeStringify(json), 300),
      },
    });
  }
  const choice = parsed.data.choices[0];
  const raw = choice.message.content;
  const content =
    typeof raw === "string"
      ? raw
      : Array.isArray(raw)
        ? raw.map((part) => (typeof part.text === "string" ? part.text : "")).join("")
        : "";
  const u = parsed.data.usage;
  const usage: ChatUsage = {
    input_tokens: u?.prompt_tokens ?? 0,
    output_tokens: u?.completion_tokens ?? 0,
    reasoning_tokens: u?.completion_tokens_details?.reasoning_tokens ?? 0,
  };
  return {
    content,
    model: parsed.data.model ?? ctx.model,
    finish_reason: choice.finish_reason ?? null,
    usage,
    latency_ms: elapsedMs(ctx.startedAt),
  };
}

/** `Retry-After` as milliseconds: delta-seconds or an HTTP date. Undefined when absent or invalid. */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (!header) return undefined;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1000);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}

/** Combines abort signals; uses `AbortSignal.any` when the runtime has it. */
export function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const list = signals.filter((s): s is AbortSignal => s !== undefined);
  if (list.length === 1) return list[0];
  if (typeof AbortSignal.any === "function") return AbortSignal.any(list);
  const controller = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    ((err as { name?: unknown }).name === "AbortError" ||
      (err as { name?: unknown }).name === "TimeoutError")
  );
}

function elapsedMs(startedAt: number): number {
  return Math.max(0, Math.round(performance.now() - startedAt));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
