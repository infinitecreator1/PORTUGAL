import { PipelineError, TimeoutError, UpstreamError, errorFromStatus, isRetryable } from "@imovel/core";

export interface FetchJsonOptions {
  /** Injectable for tests; defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Per-attempt timeout. Default 30 000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt; total calls = retries + 1. Default 3. */
  retries?: number;
  /** Provider id used in error messages and details (e.g. `imovirtual-parsebot`). */
  provider: string;
  /** Injectable sleep for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Random source in [0, 1) for the jittered backoff; injectable for deterministic tests. */
  random?: () => number;
  /** Backoff base. Default 500 ms. */
  retryBaseMs?: number;
  /** Backoff cap; a `Retry-After` floor is honoured even above this cap. Default 30 000 ms. */
  retryMaxMs?: number;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Full-jitter exponential backoff (AWS style): random in [0, min(maxMs, baseMs * 2^attempt)]. */
export function backoffDelayMs(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number {
  const cap = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(random() * cap);
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

function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    ((err as { name?: unknown }).name === "AbortError" || (err as { name?: unknown }).name === "TimeoutError")
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * GET/POST JSON with a per-attempt timeout (`AbortSignal.timeout`), status-code error mapping via
 * core's `errorFromStatus` (429 honours `Retry-After`), and exponential backoff with full jitter on
 * retryable errors only. Transport failures (network, timeout) map to a retryable `TimeoutError`.
 */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  opts: FetchJsonOptions,
): Promise<T> {
  const fetchImpl = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  const retryBaseMs = opts.retryBaseMs ?? 500;
  const retryMaxMs = opts.retryMaxMs ?? 30_000;

  for (let attempt = 0; ; attempt++) {
    try {
      return await attemptOnce<T>(url, init, { ...opts, fetchImpl, timeoutMs });
    } catch (error) {
      if (attempt >= retries || !isRetryable(error)) throw error;
      const floor = error instanceof PipelineError ? error.retryAfterMs ?? 0 : 0;
      const delayMs = Math.max(backoffDelayMs(attempt, retryBaseMs, retryMaxMs, random), floor);
      opts.onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
}

async function attemptOnce<T>(
  url: string,
  init: RequestInit,
  opts: FetchJsonOptions & { fetchImpl: typeof fetch; timeoutMs: number },
): Promise<T> {
  const { fetchImpl, timeoutMs, provider } = opts;
  let res: Response;
  try {
    res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (cause) {
    const reason = isAbortError(cause) ? "timeout" : "network";
    const message =
      reason === "timeout"
        ? `${provider} request timed out after ${timeoutMs} ms`
        : `${provider} request failed: ${cause instanceof Error ? cause.message : String(cause)}`;
    throw new TimeoutError(message, { cause, retryable: true, details: { provider, reason, timeoutMs, url } });
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw errorFromStatus(res.status, text, {
      provider,
      retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
    });
  }

  const text = await res.text();
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new UpstreamError(`${provider} returned a non-JSON body`, {
      cause,
      status: res.status,
      details: { provider, snippet: safeStringify(text).slice(0, 300) },
    });
  }
}
