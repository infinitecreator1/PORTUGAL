import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { NotFoundError, WebhookEvent, newId, type Webhook } from "@imovel/core";
import { emitWebhook, type PipelineDeps } from "@imovel/pipeline";

const CreateWebhookBody = z.object({
  url: z.string().url(),
  events: z.array(WebhookEvent).min(1).default(["job.completed", "job.failed", "job.needs_review"]),
  secret: z.string().min(16).optional(),
});

export function registerWebhookRoutes(app: FastifyInstance, deps: PipelineDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>() as FastifyInstance;

  r.post("/webhooks", { schema: { body: CreateWebhookBody } }, async (req, reply) => {
    const body = req.body as z.infer<typeof CreateWebhookBody>;
    const hook: Webhook = { id: newId(), tenant_id: req.tenantId, url: body.url, secret: body.secret ?? randomBytes(24).toString("hex"), events: body.events, enabled: true, created_at: deps.now().toISOString() };
    await deps.repos.webhooks.save(hook);
    return reply.code(201).send(hook);
  });

  r.get("/webhooks", async (req) => ({ items: (await deps.repos.webhooks.listForTenant(req.tenantId)).map((h) => ({ ...h, secret: "***" })) }));

  r.delete("/webhooks/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const hook = (await deps.repos.webhooks.listForTenant(req.tenantId)).find((h) => h.id === id);
    if (!hook) throw new NotFoundError(`Webhook ${id} not found`);
    await deps.repos.webhooks.save({ ...hook, enabled: false });
    return reply.code(204).send();
  });

  r.post("/webhooks/:id/test", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const { id } = req.params as { id: string };
    const hook = (await deps.repos.webhooks.listForTenant(req.tenantId)).find((h) => h.id === id);
    if (!hook) throw new NotFoundError(`Webhook ${id} not found`);
    await emitWebhook(deps, req.tenantId, "job.completed", { test: true, job_id: "00000000-0000-4000-8000-000000000000" });
    return { sent: true };
  });
}
