import { PipelineError, isRetryable } from "@imovel/core";

export interface RetryOptions {
  /** Retries after the first attempt; total calls = maxRetries + 1. */
  maxRetries: number;
  /** Attempt n (0-based) waits a random value in [0, min(maxMs, baseMs * 2^n)] (full jitter). */
  baseMs: number;
  /** Cap for the jittered delay. A `retryAfterMs` floor is honoured even above this cap. */
  maxMs?: number;
  /** Defaults to `isRetryable` from core. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Minimum delay demanded by the failure (e.g. a `Retry-After` header). Defaults to `PipelineError.retryAfterMs`. */
  retryAfterMs?: (error: unknown) => number | undefined;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  /** Random source in [0, 1); injectable for deterministic tests. */
  random?: () => number;
}

export const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

function defaultRetryAfter(error: unknown): number | undefined {
  return error instanceof PipelineError ? error.retryAfterMs : undefined;
}

/**
 * Runs `fn` until it resolves or the retry budget is spent. Only errors for which `shouldRetry`
 * returns true are retried; the delay is exponential with full jitter and never shorter than the
 * error's `retryAfterMs`.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions,
): Promise<T> {
  const {
    maxRetries,
    baseMs,
    maxMs = 30_000,
    shouldRetry = isRetryable,
    retryAfterMs = defaultRetryAfter,
    sleep = defaultSleep,
    onRetry,
    random = Math.random,
  } = opts;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= maxRetries || !shouldRetry(error, attempt)) throw error;
      const floor = retryAfterMs(error) ?? 0;
      const delayMs = Math.max(backoffDelayMs(attempt, baseMs, maxMs, random), floor);
      onRetry?.({ attempt: attempt + 1, delayMs, error });
      await sleep(delayMs);
    }
  }
}
