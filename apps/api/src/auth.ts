import type { Config } from "@imovel/core";
import { safeEqualHex, sha256 } from "@imovel/core";
import type { FastifyReply, FastifyRequest } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    tenantId: string;
  }
}

/**
 * Bearer API-key authentication for the single-tenant MVP. With `API_KEY` set, every /v1 request
 * must present it; without it (development only) requests are attributed to DEFAULT_TENANT_ID.
 */
export function makeApiKeyAuth(cfg: Config) {
  const expectedHash = cfg.API_KEY ? sha256(cfg.API_KEY) : null;
  const enforce = Boolean(expectedHash) || cfg.NODE_ENV === "production";
  return async function apiKeyAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    req.tenantId = cfg.DEFAULT_TENANT_ID;
    if (!enforce) return;
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!expectedHash || !token || !safeEqualHex(sha256(token), expectedHash)) {
      await reply.code(401).send({ error: "Unauthorized" });
    }
  };
}
