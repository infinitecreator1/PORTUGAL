import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from "fastify-type-provider-zod";
import { PipelineError } from "@imovel/core";
import { renderPrometheus } from "@imovel/observability";
import type { PipelineDeps } from "@imovel/pipeline";
import { makeApiKeyAuth } from "./auth";
import { registerJobRoutes } from "./routes/jobs";
import { registerListingRoutes } from "./routes/listings";
import { registerProfileRoutes } from "./routes/profiles";
import { registerReviewRoutes } from "./routes/reviews";
import { registerWebhookRoutes } from "./routes/webhooks";

export type App = FastifyInstance;

export async function buildServer(deps: PipelineDeps, opts: { logger?: boolean } = {}): Promise<App> {
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: { info: { title: "Imóvel em Voz API", version: "0.1.0" } },
    transform: jsonSchemaTransform,
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PipelineError) {
      return reply.code(err.status ?? 500).send({ error: err.message, code: err.code, details: err.details });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) deps.logger.error({ err }, "unhandled error");
    return reply.code(status).send({ error: status >= 500 ? "Internal error" : err.message });
  });

  app.get("/health", async () => ({ ok: true, providers: { llm: deps.cfg.LLM_PROVIDER, editor: deps.cfg.GATE_EDITOR, tts: deps.cfg.TTS_PROVIDER, storage: deps.cfg.STORAGE_PROVIDER } }));
  app.get("/ready", async () => {
    const depth = await deps.queue.size("pipeline.generate").catch(() => -1);
    return { ok: depth >= 0, queue_generate: depth };
  });
  app.get("/metrics", async (_req, reply) => reply.type("text/plain").send(renderPrometheus()));
  app.get("/v1/openapi.json", async () => app.swagger());

  await app.register(
    async (v1) => {
      v1.addHook("preHandler", makeApiKeyAuth(deps.cfg));
      registerListingRoutes(v1.withTypeProvider<ZodTypeProvider>(), deps);
      registerJobRoutes(v1.withTypeProvider<ZodTypeProvider>(), deps);
      registerReviewRoutes(v1.withTypeProvider<ZodTypeProvider>(), deps);
      registerWebhookRoutes(v1.withTypeProvider<ZodTypeProvider>(), deps);
      registerProfileRoutes(v1.withTypeProvider<ZodTypeProvider>(), deps);
    },
    { prefix: "/v1" },
  );

  return app;
}
