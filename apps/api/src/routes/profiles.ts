import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { GenerationProfile, VoiceProfile, newId } from "@imovel/core";
import type { PipelineDeps } from "@imovel/pipeline";

export function registerProfileRoutes(app: FastifyInstance, deps: PipelineDeps): void {
  const r = app.withTypeProvider<ZodTypeProvider>() as FastifyInstance;

  r.get("/profiles/generation", async (req) => deps.repos.profiles.getGeneration(req.tenantId, null));

  r.put("/profiles/generation", { schema: { body: GenerationProfile.omit({ id: true, tenant_id: true }).partial().extend({ id: z.string().uuid().optional(), name: z.string().min(1) }) } }, async (req) => {
    const body = req.body as Partial<z.infer<typeof GenerationProfile>> & { name: string };
    const current = body.id ? await deps.repos.profiles.getGeneration(req.tenantId, body.id) : null;
    const profile = GenerationProfile.parse({ ...(current ?? {}), ...body, id: body.id ?? current?.id ?? newId(), tenant_id: req.tenantId });
    await deps.repos.profiles.saveGeneration(profile);
    return profile;
  });

  r.get("/profiles/voice", async (req) => (await deps.repos.profiles.getVoice(req.tenantId, null)) ?? { error: "no voice profile" });

  r.put("/profiles/voice", { schema: { body: VoiceProfile.omit({ id: true, tenant_id: true }).partial().extend({ id: z.string().uuid().optional(), name: z.string().min(1), provider: VoiceProfile.shape.provider }) } }, async (req) => {
    const body = req.body as Partial<z.infer<typeof VoiceProfile>> & { name: string; provider: z.infer<typeof VoiceProfile>["provider"] };
    const current = body.id ? await deps.repos.profiles.getVoice(req.tenantId, body.id) : null;
    const profile = VoiceProfile.parse({ ...(current ?? {}), ...body, id: body.id ?? current?.id ?? newId(), tenant_id: req.tenantId });
    await deps.repos.profiles.saveVoice(profile);
    return profile;
  });
}
