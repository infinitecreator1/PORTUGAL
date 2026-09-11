import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { GenerationResult, NotFoundError, QUEUES, newId, sectionsToText, sha256 } from "@imovel/core";
import type { PipelineDeps } from "@imovel/pipeline";

export function registerReviewRoutes(app: FastifyInstance & { withTypeProvider<T>(): unknown }, deps: PipelineDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>() as FastifyInstance;

  r.get("/reviews", { schema: { querystring: z.object({ status: z.enum(["open", "approved", "rejected"]).default("open") }) } }, async (req) => {
    const { status } = req.query as { status: "open" | "approved" | "rejected" };
    return { items: await deps.repos.reviews.list(req.tenantId, status) };
  });

  r.post("/reviews/:id/approve", { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ sections: GenerationResult.optional() }).default({}) } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { sections?: z.infer<typeof GenerationResult> };
    const item = await deps.repos.reviews.get(id);
    if (!item || item.tenant_id !== req.tenantId) throw new NotFoundError(`Review ${id} not found`);
    const job = await deps.repos.jobs.get(item.job_id);
    if (!job) throw new NotFoundError(`Job ${item.job_id} not found`);
    const base = await deps.repos.generations.latestForJob(job.id);
    if (!base) throw new NotFoundError(`No generation for job ${job.id}`);
    const sections = body.sections ?? item.edited_sections ?? base.result;
    const approved = { ...base, id: newId(), provider: "review", result: sections, text_hash: sha256(sectionsToText(sections)), created_at: deps.now().toISOString() };
    await deps.repos.generations.save(approved);
    await deps.repos.reviews.resolve(id, "approved", sections);
    const voice = await deps.repos.profiles.getVoice(job.tenant_id, job.voice_profile_id);
    const queue = job.require_audio && voice ? QUEUES.narrate : QUEUES.publish;
    await deps.queue.send(queue, { job_id: job.id, generation_id: approved.id, narration_id: null, warnings: ["approved by human review"] }, { retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, deadLetter: QUEUES.dead });
    return reply.code(202).send({ review_id: id, job_id: job.id, next: queue });
  });

  r.post("/reviews/:id/reject", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const { id } = req.params as { id: string };
    const item = await deps.repos.reviews.get(id);
    if (!item || item.tenant_id !== req.tenantId) throw new NotFoundError(`Review ${id} not found`);
    await deps.repos.reviews.resolve(id, "rejected", null);
    await deps.repos.jobs.update(item.job_id, { status: "cancelled", updated_at: deps.now().toISOString(), finished_at: deps.now().toISOString() });
    return { review_id: id, job_id: item.job_id, status: "cancelled" };
  });
}
