import { loadConfig, newId, type SourceId } from "@imovel/core";
import { createListingSource } from "@imovel/ingestion";
import { createLogger } from "@imovel/observability";
import { buildDeps } from "@imovel/pipeline";
import { evalAccent, evalEditor } from "./evals";

/**
 * Phase 0 spikes. Each one reuses an eval with the REAL providers from .env and prints
 * the numbers the go/no-go decisions in docs/adr need.
 */
export async function spike(kind: "tts" | "amalia" | "sources", opts: { query?: string } = {}): Promise<number> {
  const cfg = loadConfig();
  if (kind === "tts") {
    if (cfg.TTS_PROVIDER === "fake") console.warn("TTS_PROVIDER=fake: this spike only proves the plumbing. Set voxcpm2-runpod and a cloned voice profile.");
    return evalAccent({ out: "./out/spike-tts" });
  }
  if (kind === "amalia") {
    if (cfg.GATE_EDITOR !== "amalia") console.warn(`GATE_EDITOR=${cfg.GATE_EDITOR}: set amalia with RUNPOD_* to measure the real endpoint.`);
    const t0 = Date.now();
    const code = await evalEditor();
    console.log(JSON.stringify({ wall_clock_s: Math.round((Date.now() - t0) / 100) / 10, note: "first call includes the cold start" }, null, 2));
    return code;
  }
  const deps = await buildDeps(cfg, { logger: createLogger({ level: "info", pretty: true }) });
  try {
    const sources: SourceId[] = ["imovirtual-parsebot", "idealista-piloterr", "casafari"];
    for (const id of sources) {
      try {
        const source = createListingSource(id, cfg);
        const page = await source.search({ id: newId(), tenant_id: cfg.DEFAULT_TENANT_ID, source: id, query: opts.query ? { url: opts.query, location: opts.query } : {}, cron: "0 6 * * *", enabled: true, max_pages: 1, max_credits_per_run: 20, last_run_at: null });
        const first = page.items[0];
        const normalized = first ? source.normalize(first, { tenant_id: cfg.DEFAULT_TENANT_ID, ownership_default: "third_party", agency_ids: [] }) : null;
        console.log(JSON.stringify({ source: id, items: page.items.length, next: page.next, credits: page.credits_used ?? null, sample: normalized ? { typology: normalized.typology, price: normalized.price, area: normalized.area, energy: normalized.energy_certificate, location: normalized.location, features: normalized.features } : null }, null, 2));
      } catch (err) {
        console.log(JSON.stringify({ source: id, error: err instanceof Error ? err.message : String(err) }, null, 2));
      }
    }
    return 0;
  } finally {
    await deps.close();
  }
}
