import { SpanStatusCode, context, trace, type Attributes, type Exception, type Span } from "@opentelemetry/api";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import type { Config } from "@imovel/core";

export const TRACER_NAME = "imovel";

export interface Telemetry {
  /** True when an SDK with an exporter was started. */
  enabled: boolean;
  shutdown(): Promise<void>;
}

export type TelemetryConfig = Pick<Config, "OTEL_EXPORTER_OTLP_ENDPOINT" | "OTEL_SERVICE_NAME">;

/** `OTEL_EXPORTER_OTLP_ENDPOINT` is the base URL; the HTTP trace exporter posts to `/v1/traces`. */
export function tracesUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, "");
  return trimmed.endsWith("/v1/traces") ? trimmed : `${trimmed}/v1/traces`;
}

/**
 * Starts a NodeSDK exporting traces over OTLP/HTTP when the endpoint is configured; otherwise a
 * no-op so `withSpan` still works through the API's default (no-op) tracer.
 */
export function initTelemetry(cfg: TelemetryConfig): Telemetry {
  if (!cfg.OTEL_EXPORTER_OTLP_ENDPOINT) {
    return { enabled: false, shutdown: async () => {} };
  }
  const exporter = new OTLPTraceExporter({ url: tracesUrl(cfg.OTEL_EXPORTER_OTLP_ENDPOINT) });
  const sdk = new NodeSDK({
    resource: new Resource({ [ATTR_SERVICE_NAME]: cfg.OTEL_SERVICE_NAME }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  });
  sdk.start();
  return {
    enabled: true,
    shutdown: () => sdk.shutdown(),
  };
}

export type SpanAttributes = Record<string, string | number | boolean>;

/**
 * Runs `fn` inside an active span named `name`. Exceptions are recorded, the status set to
 * ERROR and the error re-thrown. Works without any SDK (spans are then no-ops).
 */
export async function withSpan<T>(name: string, attrs: SpanAttributes, fn: (span: Span) => Promise<T>): Promise<T> {
  const tracer = trace.getTracer(TRACER_NAME);
  return tracer.startActiveSpan(name, { attributes: attrs as Attributes }, context.active(), async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Exception);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Adds attributes to the current active span, if any. */
export function setSpanAttributes(attrs: SpanAttributes): void {
  trace.getActiveSpan()?.setAttributes(attrs as Attributes);
}

/** Trace and span ids of the active span, for log correlation. */
export function currentTraceIds(): { trace_id: string; span_id: string } | null {
  const ctx = trace.getActiveSpan()?.spanContext();
  return ctx && ctx.traceId !== "00000000000000000000000000000000" ? { trace_id: ctx.traceId, span_id: ctx.spanId } : null;
}
