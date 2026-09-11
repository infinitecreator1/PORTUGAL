import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ConflictError, JobStatus, NotFoundError, QUEUES } from "@imovel/core";
import { enqueueJobForListing, type PipelineDeps } from "@imovel/pipeline";

const CreateJobBody = z.object({
  listing_id: z.string().uuid(),
  generation_profile_id: z.string().uuid().nullable().optional(),
  voice_profile_id: z.string().uuid().nullable().optional(),
  require_audio: z.boolean().optional(),
});

export function registerJobRoutes(app: FastifyInstance & { withTypeProvider<T>(): unknown }, deps: PipelineDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>() as FastifyInstance;

  r.post("/jobs", { schema: { body: CreateJobBody } }, async (req, reply) => {
    const body = req.body as z.infer<typeof CreateJobBody>;
    const listing = await deps.repos.listings.getById(req.tenantId, body.listing_id);
    if (!listing) throw new NotFoundError(`Listing ${body.listing_id} not found`);
    const { job, created } = await enqueueJobForListing(deps, listing, { generation_profile_id: body.generation_profile_id ?? null, voice_profile_id: body.voice_profile_id ?? null, require_audio: body.require_audio });
    return reply.code(created ? 202 : 200).send({ job_id: job.id, status: job.status, created });
  });

  r.post("/jobs/:id/run", { schema: { params: z.object({ id: z.string().uuid() }), body: z.object({ force: z.boolean().default(false) }).default({}) } }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { force } = (req.body ?? { force: false }) as { force: boolean };
    const job = await deps.repos.jobs.get(id);
    if (!job || job.tenant_id !== req.tenantId) throw new NotFoundError(`Job ${id} not found`);
    const rerunnable: string[] = ["failed", "dead_letter", "needs_review", "cancelled"];
    if (!rerunnable.includes(job.status) && !force) {
      throw new ConflictError(`Job is ${job.status}; pass force=true to re-run`);
    }
    const hints = (job.last_error?.hints as string[] | undefined) ?? [];
    await deps.repos.jobs.update(job.id, { status: "failed", updated_at: deps.now().toISOString() });
    await deps.queue.send(QUEUES.generate, { job_id: job.id, extraConstraints: hints }, { retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, deadLetter: QUEUES.dead });
    return reply.code(202).send({ job_id: job.id, status: "queued" });
  });

  r.get("/jobs/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const { id } = req.params as { id: string };
    const job = await deps.repos.jobs.get(id);
    if (!job || job.tenant_id !== req.tenantId) throw new NotFoundError(`Job ${id} not found`);
    const [steps, reports, costs] = await Promise.all([deps.repos.jobs.steps(job.id), deps.repos.gateReports.listForJob(job.id), deps.repos.costs.listForJob(job.id)]);
    return {
      ...job,
      steps,
      gate_reports: reports.map((g) => ({ id: g.id, loop: g.loop, attempt: g.attempt, editor: g.editor, decision: g.decision, judge_score: g.judge?.pt_pt_score ?? null, reasons: g.reasons, changes: g.changes.length })),
      cost_usd: costs.reduce((s, c) => s + c.cost_usd, 0),
    };
  });

  r.get("/jobs", { schema: { querystring: z.object({ status: JobStatus.optional(), listing_id: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }) } }, async (req) => {
    const q = req.query as { status?: z.infer<typeof JobStatus>; listing_id?: string; limit: number };
    return { items: await deps.repos.jobs.list(req.tenantId, q) };
  });
}
