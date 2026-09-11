export type ErrorCode =
  | "rate_limit"
  | "billing"
  | "upstream"
  | "request"
  | "timeout"
  | "validation"
  | "not_found"
  | "conflict"
  | "config"
  | "gate_failed"
  | "internal";

export interface PipelineErrorOptions {
  retryable?: boolean;
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class PipelineError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, opts: PipelineErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "PipelineError";
    this.code = code;
    this.retryable = opts.retryable ?? false;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.details = opts.details ?? {};
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      retryAfterMs: this.retryAfterMs,
      details: this.details,
    };
  }
}

export class RateLimitError extends PipelineError {
  constructor(message = "Rate limit exceeded", opts: PipelineErrorOptions = {}) {
    super("rate_limit", message, { retryable: true, status: 429, ...opts });
    this.name = "RateLimitError";
  }
}

export class BillingError extends PipelineError {
  constructor(message = "Payment required on upstream provider", opts: PipelineErrorOptions = {}) {
    super("billing", message, { retryable: false, status: 402, ...opts });
    this.name = "BillingError";
  }
}

export class UpstreamError extends PipelineError {
  constructor(message = "Upstream provider error", opts: PipelineErrorOptions = {}) {
    super("upstream", message, { retryable: true, ...opts });
    this.name = "UpstreamError";
  }
}

export class RequestError extends PipelineError {
  constructor(message = "Upstream rejected the request", opts: PipelineErrorOptions = {}) {
    super("request", message, { retryable: false, ...opts });
    this.name = "RequestError";
  }
}

export class TimeoutError extends PipelineError {
  constructor(message = "Request timed out", opts: PipelineErrorOptions = {}) {
    super("timeout", message, { retryable: true, ...opts });
    this.name = "TimeoutError";
  }
}

export class ValidationError extends PipelineError {
  constructor(message = "Validation failed", opts: PipelineErrorOptions = {}) {
    super("validation", message, { retryable: false, status: 400, ...opts });
    this.name = "ValidationError";
  }
}

export class NotFoundError extends PipelineError {
  constructor(message = "Not found", opts: PipelineErrorOptions = {}) {
    super("not_found", message, { retryable: false, status: 404, ...opts });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends PipelineError {
  constructor(message = "Conflict", opts: PipelineErrorOptions = {}) {
    super("conflict", message, { retryable: false, status: 409, ...opts });
    this.name = "ConflictError";
  }
}

export class GateFailedError extends PipelineError {
  constructor(message = "Gate failed", opts: PipelineErrorOptions = {}) {
    super("gate_failed", message, { retryable: false, ...opts });
    this.name = "GateFailedError";
  }
}

/** Maps an HTTP status from a provider to the matching error class. */
export function errorFromStatus(
  status: number,
  body: string,
  opts: { retryAfterMs?: number; provider?: string } = {},
): PipelineError {
  const snippet = body.length > 300 ? `${body.slice(0, 300)}…` : body;
  const details = { provider: opts.provider, body: snippet };
  if (status === 429) return new RateLimitError(`${opts.provider ?? "upstream"} rate limited`, { retryAfterMs: opts.retryAfterMs, details });
  if (status === 402) return new BillingError(`${opts.provider ?? "upstream"} payment required`, { details });
  if (status === 408 || status === 504) return new TimeoutError(`${opts.provider ?? "upstream"} timed out`, { status, details });
  if (status >= 500) return new UpstreamError(`${opts.provider ?? "upstream"} returned ${status}`, { status, details });
  return new RequestError(`${opts.provider ?? "upstream"} returned ${status}`, { status, details });
}

export function isRetryable(err: unknown): boolean {
  return err instanceof PipelineError ? err.retryable : false;
}

export function toErrorRecord(err: unknown): Record<string, unknown> {
  if (err instanceof PipelineError) return err.toJSON();
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { message: String(err) };
}
