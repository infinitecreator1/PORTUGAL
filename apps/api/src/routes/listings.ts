import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { ListingInput, NotFoundError, Ownership, type Listing } from "@imovel/core";
import { enqueueJobForListing, type PipelineDeps } from "@imovel/pipeline";

const ImportBody = z.object({
  listings: z.array(ListingInput).min(1).max(500),
  ownership: Ownership.optional(),
  consent_ref: z.string().nullable().optional(),
  generation_profile_id: z.string().uuid().nullable().optional(),
  voice_profile_id: z.string().uuid().nullable().optional(),
  run: z.boolean().default(true),
});

export function registerListingRoutes(app: FastifyInstance, deps: PipelineDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>() as FastifyInstance;

  r.post("/listings/import", { schema: { body: ImportBody } }, async (req, reply) => {
    const body = req.body as z.infer<typeof ImportBody>;
    await deps.repos.tenants.ensureDefault(req.tenantId);
    let imported = 0;
    let updated = 0;
    const job_ids: string[] = [];
    const listing_ids: string[] = [];
    for (const raw of body.listings) {
      const input = { ...raw, ownership: body.ownership ?? raw.ownership ?? "owned", consent_ref: body.consent_ref ?? raw.consent_ref ?? null };
      const { listing, status } = await deps.repos.listings.upsertFromInput(req.tenantId, input, deps.now());
      listing_ids.push(listing.id);
      if (status === "new") imported++;
      if (status === "changed") updated++;
      if (body.run && status !== "unchanged" && listing.ownership !== "third_party") {
        const { job } = await enqueueJobForListing(deps, listing as Listing, { generation_profile_id: body.generation_profile_id ?? null, voice_profile_id: body.voice_profile_id ?? null });
        job_ids.push(job.id);
      }
    }
    return reply.code(202).send({ imported, updated, unchanged: body.listings.length - imported - updated, listing_ids, job_ids });
  });

  r.get("/listings/:id", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const { id } = req.params as { id: string };
    const listing = await deps.repos.listings.getById(req.tenantId, id);
    if (!listing) throw new NotFoundError(`Listing ${id} not found`);
    return listing;
  });

  r.get("/listings", { schema: { querystring: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), cursor: z.string().optional() }) } }, async (req) => {
    const q = req.query as { limit: number; cursor?: string };
    return deps.repos.listings.list(req.tenantId, { limit: q.limit, cursor: q.cursor ?? null });
  });

  r.get("/listings/:id/outputs", { schema: { params: z.object({ id: z.string().uuid() }) } }, async (req) => {
    const { id } = req.params as { id: string };
    const output = await deps.repos.outputs.latestForListing(req.tenantId, id);
    if (!output) throw new NotFoundError(`No published output for listing ${id}`);
    const narration = output.narration
      ? {
          ...output.narration,
          wav_url: await deps.store.signedUrl(output.narration.wav_key, 3600),
          mp3_url: output.narration.mp3_key ? await deps.store.signedUrl(output.narration.mp3_key, 3600) : null,
        }
      : null;
    const report = await deps.repos.gateReports.get(output.gate_report_id);
    return {
      ...output,
      narration,
      gate: report ? { decision: report.decision, judge_score: report.judge?.pt_pt_score ?? null, changes: report.changes.length, editor: report.editor } : null,
    };
  });
}
