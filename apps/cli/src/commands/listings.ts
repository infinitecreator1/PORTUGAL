import { loadConfig, type Listing } from "@imovel/core";
import { CsvFeedSource } from "@imovel/ingestion";
import { createLogger } from "@imovel/observability";
import { buildDeps, enqueueJobForListing, ingestStep, runJobSync } from "@imovel/pipeline";
import { table } from "../util";

/** Imports a CSV feed (owned listings) and optionally runs every pending job synchronously. */
export async function importCsv(path: string, opts: { run: boolean }): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: cfg.LOG_LEVEL, pretty: true }) });
  try {
    const result = await ingestStep(deps, { tenant_id: cfg.DEFAULT_TENANT_ID, source: "csv-feed", query: { path } }, { source: new CsvFeedSource(), autoRun: false });
    console.log(table([{ status: result.status, seen: result.items_seen, new: result.items_new, changed: result.items_changed, skipped: result.items_skipped, error: result.error ?? "" }]));
    if (!opts.run) return result.status === "succeeded" ? 0 : 1;

    const { items } = await deps.repos.listings.list(cfg.DEFAULT_TENANT_ID, { limit: 200 });
    const rows: Array<Record<string, string | number | null>> = [];
    for (const listing of items) {
      if (listing.ownership === "third_party") continue;
      const existing = await deps.repos.outputs.latestForListing(listing.tenant_id, listing.id);
      if (existing) continue;
      const { job, created } = await enqueueJobForListing(deps, listing);
      if (!created && job.status !== "queued") continue;
      const { job: done, output } = await runJobSync(deps, job.id);
      rows.push({ listing: listing.source_id, job: job.id.slice(0, 8), status: done.status, titulo: output?.sections.titulo ?? null });
    }
    console.log(table(rows));
    return rows.every((r) => String(r.status).startsWith("published")) ? 0 : 1;
  } finally {
    await deps.close();
  }
}

/** Runs the full pipeline for one stored listing. */
export async function runListing(listingId: string): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: cfg.LOG_LEVEL, pretty: true }) });
  try {
    const listing = (await deps.repos.listings.getById(cfg.DEFAULT_TENANT_ID, listingId)) as Listing | null;
    if (!listing) {
      console.error(`Listing ${listingId} not found for tenant ${cfg.DEFAULT_TENANT_ID}`);
      return 1;
    }
    const { job } = await enqueueJobForListing(deps, listing);
    const { job: done, output } = await runJobSync(deps, job.id);
    console.log(JSON.stringify({ job_id: job.id, status: done.status, titulo: output?.sections.titulo ?? null, audio: output?.narration?.wav_key ?? null, warnings: output?.warnings ?? [] }, null, 2));
    return done.status.startsWith("published") ? 0 : 1;
  } finally {
    await deps.close();
  }
}

export async function reviewCommand(action: "list" | "approve" | "reject", id?: string, sectionsPath?: string): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: cfg.LOG_LEVEL, pretty: true }) });
  try {
    if (action === "list") {
      const items = await deps.repos.reviews.list(cfg.DEFAULT_TENANT_ID, "open");
      console.log(table(items.map((i) => ({ id: i.id, job: i.job_id.slice(0, 8), listing: i.listing_id.slice(0, 8), reason: i.reason.slice(0, 80), created: i.created_at }))));
      return 0;
    }
    if (!id) {
      console.error("review id required");
      return 1;
    }
    if (action === "reject") {
      await deps.repos.reviews.resolve(id, "rejected", null);
      console.log(`review ${id} rejected`);
      return 0;
    }
    const { readJson } = await import("../util");
    const edited = sectionsPath ? readJson<Parameters<typeof deps.repos.reviews.resolve>[2]>(sectionsPath) : null;
    const item = await deps.repos.reviews.resolve(id, "approved", edited ?? null);
    const { job } = await import("@imovel/pipeline").then(async (p) => {
      const j = await deps.repos.jobs.get(item.job_id);
      if (!j) throw new Error("job not found");
      const base = await deps.repos.generations.latestForJob(j.id);
      if (!base) throw new Error("no generation");
      const sections = edited ?? item.edited_sections ?? base.result;
      const { newId, sectionsToText, sha256 } = await import("@imovel/core");
      await deps.repos.generations.save({ ...base, id: newId(), provider: "review", result: sections, text_hash: sha256(sectionsToText(sections)), created_at: deps.now().toISOString() });
      await deps.repos.jobs.update(j.id, { status: "gated_pass", updated_at: deps.now().toISOString() });
      const gen = await deps.repos.generations.latestForJob(j.id);
      const next = j.require_audio ? await p.narrateStep(deps, { job_id: j.id, generation_id: gen!.id }) : { queue: "pipeline.publish", payload: { job_id: j.id, generation_id: gen!.id, narration_id: null } };
      await p.executeStep(deps, next.queue, next.payload);
      return { job: await deps.repos.jobs.get(j.id) };
    });
    console.log(`review ${id} approved; job ${item.job_id} is now ${job?.status}`);
    return 0;
  } finally {
    await deps.close();
  }
}
