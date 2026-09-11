import { UpstreamError } from "@imovel/core";

export type BreakerState = "closed" | "open" | "half_open";

export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. Default 5. */
  failureThreshold?: number;
  /** How long the circuit stays open before allowing one trial call. Default 600 000 ms (10 min). */
  resetMs?: number;
  /** Injectable clock for tests. Default `Date.now`. */
  now?: () => number;
}

/**
 * Per-source circuit breaker. Closed lets calls through; after `failureThreshold` consecutive
 * failures it opens and rejects every call with a retryable `UpstreamError` until `resetMs` has
 * elapsed, at which point it goes half-open and allows exactly one trial call through `exec`:
 * success closes it, failure reopens it with a fresh timer.
 */
export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetMs: number;
  private readonly now: () => number;
  private failures = 0;
  private openedAt = 0;
  private internalState: BreakerState = "closed";

  constructor(opts: CircuitBreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.resetMs = opts.resetMs ?? 600_000;
    this.now = opts.now ?? (() => Date.now());
  }

  /** Current state, deriving `half_open` from elapsed time without mutating internal state. */
  state(): BreakerState {
    if (this.internalState === "open" && this.now() - this.openedAt >= this.resetMs) return "half_open";
    return this.internalState;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state() === "open") {
      throw new UpstreamError("circuit open", { retryable: true, details: { failures: this.failures } });
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.internalState = "closed";
  }

  private onFailure(): void {
    this.failures += 1;
    if (this.internalState === "half_open" || this.failures >= this.failureThreshold) {
      this.internalState = "open";
      this.openedAt = this.now();
    }
  }
}
