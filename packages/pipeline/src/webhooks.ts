import type { WebhookEvent } from "@imovel/core";
import { hmacSha256, newId, safeEqualHex } from "@imovel/core";
import type { PipelineDeps } from "./deps";

export interface WebhookEnvelope {
  event: WebhookEvent;
  tenant_id: string;
  occurred_at: string;
  data: Record<string, unknown>;
}

/** Signs `timestamp.body` with the webhook secret; receivers verify with `verifyWebhookSignature`. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${hmacSha256(secret, `${timestamp}.${body}`)}`;
}

export function verifyWebhookSignature(secret: string, timestamp: string, body: string, signature: string): boolean {
  const expected = signWebhook(secret, timestamp, body);
  const a = expected.replace(/^sha256=/, "");
  const b = signature.replace(/^sha256=/, "");
  return a.length === b.length && safeEqualHex(a, b);
}

/** Delivers an event to every enabled webhook of the tenant. Failures are recorded, never thrown. */
export async function emitWebhook(deps: PipelineDeps, tenantId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  const hooks = await deps.repos.webhooks.listForTenant(tenantId, event);
  if (!hooks.length) return;
  const envelope: WebhookEnvelope = { event, tenant_id: tenantId, occurred_at: deps.now().toISOString(), data };
  const body = JSON.stringify(envelope);
  const timestamp = String(Math.floor(deps.now().getTime() / 1000));
  const idempotencyKey = `${String(data.job_id ?? "")}:${event}`;

  for (const hook of hooks) {
    if (!hook.enabled) continue;
    const signature = signWebhook(hook.secret, timestamp, body);
    let status: "delivered" | "failed" = "failed";
    let lastError: string | null = null;
    try {
      const res = await deps.fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Signature": signature,
          "X-Timestamp": timestamp,
          "X-Idempotency-Key": idempotencyKey,
          "User-Agent": "imovel-em-voz/1",
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      status = res.ok ? "delivered" : "failed";
      if (!res.ok) lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await deps.repos.webhooks.recordDelivery({
      id: newId(),
      tenant_id: tenantId,
      webhook_id: hook.id,
      event,
      payload: { ...envelope },
      status,
      attempts: 1,
      last_error: lastError,
      next_attempt_at: null,
      created_at: deps.now().toISOString(),
    });
    if (status === "failed") deps.logger.warn({ webhook_id: hook.id, event, error: lastError }, "webhook delivery failed");
  }
}
