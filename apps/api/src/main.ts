import { loadConfig } from "@imovel/core";
import { initTelemetry } from "@imovel/observability";
import { buildDeps } from "@imovel/pipeline";
import { buildServer } from "./server";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const telemetry = initTelemetry(cfg);
  const deps = await buildDeps(cfg);
  const app = await buildServer(deps, { logger: false });
  await app.listen({ port: cfg.API_PORT, host: "0.0.0.0" });
  deps.logger.info({ port: cfg.API_PORT, auth: cfg.API_KEY ? "api-key" : "open (development)" }, "api listening");

  const shutdown = async () => {
    await app.close();
    await deps.close();
    await telemetry.shutdown();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
