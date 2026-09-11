/**
 * Behavioural suite shared by the memory and Postgres repositories. Each `describe` gets a
 * fresh tenant so the Postgres run is re-entrant against a persistent database.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  NotFoundError,
  newId,
  sha256,
  type GateReport,
  type GenerationRecord,
  type Job,
  type JobOutput,
  type Listing,
  type NarrationResult,
  type Tenant,
} from "@imovel/core";
import { sampleGenerationResult, sampleListingInput } from "@imovel/core/fixtures";
import type { Repos } from "../src";
import { defaultGenerationProfileId, defaultVoiceProfileId, monthOf } from "../src";

export interface SuiteHandle {
  repos: Repos;
  close?: () => Promise<void>;
}

const H = (s: string) => sha256(s);

function generationFor(job: Job, listing: Listing, overrides: Partial<GenerationRecord> = {}): GenerationRecord {
  return {
    id: newId(),
    job_id: job.id,
    listing_id: listing.id,
    attempt: 0,
    loop: 0,
    model: "fake",
    provider: "fake",
    result: sampleGenerationResult(),
    usage: { input_tokens: 1500, output_tokens: 800 },
    latency_ms: 12,
    text_hash: H("text"),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function gateReportFor(job: Job, gen: GenerationRecord, overrides: Partial<GateReport> = {}): GateReport {
  return {
    id: newId(),
    job_id: job.id,
    generation_id: gen.id,
    loop: 0,
    attempt: 0,
    editor: "fake",
    editor_model: null,
    strict: false,
    input_hash: H("in"),
    output_hash: H("out"),
    changes: [],
    validators: [{ name: "lexiconScan", ok: true, severity: "hard", issues: [], details: {} }],
    judge: { pt_pt_score: 95, register_score: null, flagged_spans: [], summary: null },
    decision: "pass",
    reasons: [],
    usage: { editor_input_tokens: 0, editor_output_tokens: 0, judge_input_tokens: 0, judge_output_tokens: 0 },
    latency_ms: 5,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function narrationFor(job: Job, gen: GenerationRecord, voiceProfileId: string): NarrationResult {
  return {
    id: newId(),
    job_id: job.id,
    generation_id: gen.id,
    provider: "fake",
    voice_profile_id: voiceProfileId,
    text_normalized: "Apresentamos um apartamento T três.",
    text_hash: H("narracao"),
    chunks: 1,
    wav_key: "t/l/j/narration.wav",
    mp3_key: "t/l/j/narration.mp3",
    duration_s: 42,
    loudness_lufs: -16,
    sample_rate: 48000,
    sha256: H("wav"),
    accent_qa: null,
    ai_generated: true,
    usage: { chars: 34, gpu_seconds: null },
    created_at: new Date().toISOString(),
  };
}

function outputFor(job: Job, gen: GenerationRecord, report: GateReport, publishedAt: string): JobOutput {
  return {
    id: newId(),
    tenant_id: job.tenant_id,
    job_id: job.id,
    listing_id: job.listing_id,
    generation_id: gen.id,
    gate_report_id: report.id,
    sections: sampleGenerationResult(),
    narration: null,
    ai_generated: true,
    warnings: [],
    published_at: publishedAt,
  };
}

export function runRepoSuite(name: string, make: () => Promise<SuiteHandle>): void {
  describe(`${name} repos`, () => {
    let repos: Repos;
    let handle: SuiteHandle;
    let tenant: Tenant;

    beforeAll(async () => {
      handle = await make();
      repos = handle.repos;
      tenant = await repos.tenants.ensureDefault(newId(), "Suite Tenant");
    });

    afterAll(async () => {
      await handle.close?.();
    });

    describe("tenants", () => {
      it("ensureDefault is idempotent and agencies are per source", async () => {
        const again = await repos.tenants.ensureDefault(tenant.id, "Other name");
        expect(again.id).toBe(tenant.id);
        expect(again.name).toBe("Suite Tenant");
        expect(await repos.tenants.get(tenant.id)).toEqual(tenant);
        expect(await repos.tenants.get(newId())).toBeNull();

        await repos.tenants.addAgency({ tenant_id: tenant.id, source: "casafari", agency_id: "lisboa-prime", agency_name: null });
        await repos.tenants.addAgency({ tenant_id: tenant.id, source: "casafari", agency_id: "lisboa-prime", agency_name: "Lisboa Prime" });
        await repos.tenants.addAgency({ tenant_id: tenant.id, source: "csv-feed", agency_id: "csv-1", agency_name: null });
        expect(await repos.tenants.agencyIds(tenant.id, "casafari")).toEqual(["lisboa-prime"]);
        expect(await repos.tenants.agencyIds(tenant.id, "imovirtual-parsebot")).toEqual([]);
      });
    });

    describe("listings", () => {
      it("upsert reports new / unchanged / changed and records versions", async () => {
        const input = sampleListingInput({ source_id: `up-${newId()}` });
        const first = await repos.listings.upsertFromInput(tenant.id, input);
        expect(first.status).toBe("new");
        expect(first.version_id).not.toBeNull();
        expect(first.listing.tenant_id).toBe(tenant.id);
        expect(first.listing.content_hash).toHaveLength(64);
        expect(first.listing.fingerprint).toHaveLength(32);

        const same = await repos.listings.upsertFromInput(tenant.id, { ...input, photos: [] });
        expect(same.status).toBe("unchanged");
        expect(same.version_id).toBeNull();
        expect(same.listing.id).toBe(first.listing.id);
        expect(same.listing.content_hash).toBe(first.listing.content_hash);

        const changed = await repos.listings.upsertFromInput(tenant.id, { ...input, price: 760000 });
        expect(changed.status).toBe("changed");
        expect(changed.version_id).not.toBeNull();
        expect(changed.listing.id).toBe(first.listing.id);
        expect(changed.listing.content_hash).not.toBe(first.listing.content_hash);
        expect(changed.listing.price).toBe(760000);

        const versions = await repos.listings.versions(tenant.id, first.listing.id);
        expect(versions.map((v) => v.id)).toEqual([first.version_id, changed.version_id]);
        expect(versions[0]!.snapshot.price).toBe(745000);
        expect(versions[1]!.snapshot.price).toBe(760000);
        expect(await repos.listings.getVersion(tenant.id, changed.version_id!)).toMatchObject({ content_hash: changed.listing.content_hash });

        const fetched = await repos.listings.getById(tenant.id, first.listing.id);
        expect(fetched).toEqual(changed.listing);
        expect(await repos.listings.getById(newId(), first.listing.id)).toBeNull();
        expect(await repos.listings.getBySource(tenant.id, input.source, input.source_id)).toEqual(changed.listing);
      });

      it("returns copies, not live references", async () => {
        const input = sampleListingInput({ source_id: `copy-${newId()}` });
        const { listing } = await repos.listings.upsertFromInput(tenant.id, input);
        listing.features.push("mutated");
        const again = await repos.listings.getById(tenant.id, listing.id);
        expect(again!.features).not.toContain("mutated");
      });

      it("lists with keyset pagination and ownership filter", async () => {
        const t = await repos.tenants.ensureDefault(newId(), "Paging");
        for (let i = 0; i < 5; i++) {
          await repos.listings.upsertFromInput(t.id, sampleListingInput({ source_id: `p-${i}`, ownership: i % 2 ? "owned" : "third_party" }), new Date(Date.UTC(2026, 0, i + 1)));
        }
        const page1 = await repos.listings.list(t.id, { limit: 2 });
        expect(page1.items).toHaveLength(2);
        expect(page1.next).not.toBeNull();
        const page2 = await repos.listings.list(t.id, { limit: 2, cursor: page1.next });
        const page3 = await repos.listings.list(t.id, { limit: 2, cursor: page2.next });
        const ids = [...page1.items, ...page2.items, ...page3.items].map((l) => l.source_id);
        expect(ids).toEqual(["p-4", "p-3", "p-2", "p-1", "p-0"]);
        expect(page3.next).toBeNull();
        const owned = await repos.listings.list(t.id, { ownership: "owned" });
        expect(owned.items.map((l) => l.source_id).sort()).toEqual(["p-1", "p-3"]);
      });

      it("finds near duplicates within tolerance and not outside", async () => {
        const t = await repos.tenants.ensureDefault(newId(), "Dedup");
        const base = sampleListingInput({ source_id: "base", area: { gross_m2: 132, useful_m2: 118, plot_m2: null }, price: 745000 });
        const { listing: probe } = await repos.listings.upsertFromInput(t.id, base);
        const { listing: close } = await repos.listings.upsertFromInput(
          t.id,
          sampleListingInput({ source: "imovirtual-parsebot", source_id: "close", area: { gross_m2: 133, useful_m2: 120, plot_m2: null }, price: 750000 }),
        );
        await repos.listings.upsertFromInput(t.id, sampleListingInput({ source_id: "price-far", price: 800000 }));
        await repos.listings.upsertFromInput(t.id, sampleListingInput({ source_id: "area-far", area: { gross_m2: 150, useful_m2: 130, plot_m2: null } }));
        await repos.listings.upsertFromInput(t.id, sampleListingInput({ source_id: "typology", typology: "T2" }));
        await repos.listings.upsertFromInput(t.id, sampleListingInput({ source_id: "rent", transaction: "rent", price_period: "month" }));
        await repos.listings.upsertFromInput(
          t.id,
          sampleListingInput({ source_id: "parish", location: { ...base.location, parish: "Estrela" } }),
        );
        const { listing: grossOnly } = await repos.listings.upsertFromInput(
          t.id,
          sampleListingInput({ source_id: "gross-only", area: { gross_m2: 130, useful_m2: null, plot_m2: null } }),
        );
        // Other tenant, identical data: never a duplicate.
        const other = await repos.tenants.ensureDefault(newId(), "Other");
        await repos.listings.upsertFromInput(other.id, sampleListingInput({ source_id: "base" }));

        const dups = await repos.listings.findNearDuplicates(probe);
        expect(dups.map((d) => d.id).sort()).toEqual([close.id, grossOnly.id].sort());
        expect(dups.some((d) => d.id === probe.id)).toBe(false);

        const tight = await repos.listings.findNearDuplicates(probe, { area: 0.01, price: 0.005 });
        expect(tight).toHaveLength(0);

        const { listing: noPrice } = await repos.listings.upsertFromInput(t.id, sampleListingInput({ source_id: "no-price-a", price: null, price_period: null }));
        const { listing: noPriceB } = await repos.listings.upsertFromInput(
          t.id,
          sampleListingInput({ source: "casafari", source_id: "no-price-b", price: null, price_period: null }),
        );
        const nullDups = await repos.listings.findNearDuplicates(noPrice);
        expect(nullDups.map((d) => d.id)).toEqual([noPriceB.id]);
      });

      it("keeps listing groups", async () => {
        const { listing } = await repos.listings.upsertFromInput(tenant.id, sampleListingInput({ source_id: `g-${newId()}` }));
        const groupId = newId();
        await repos.listings.setGroup(tenant.id, { group_id: groupId, listing_id: listing.id, canonical: true });
        expect(await repos.listings.groupOf(tenant.id, listing.id)).toEqual({ group_id: groupId, listing_id: listing.id, canonical: true });
        expect(await repos.listings.groupMembers(tenant.id, groupId)).toHaveLength(1);
        await repos.listings.setGroup(tenant.id, { group_id: groupId, listing_id: listing.id, canonical: false });
        expect((await repos.listings.groupOf(tenant.id, listing.id))!.canonical).toBe(false);
      });
    });

    describe("jobs", () => {
      it("is idempotent on the content/profile/voice/version key", async () => {
        const { listing } = await repos.listings.upsertFromInput(tenant.id, sampleListingInput({ source_id: `job-${newId()}` }));
        const profile = await repos.profiles.getGeneration(tenant.id);
        const voice = await repos.profiles.getVoice(tenant.id);
        const base = { tenant_id: tenant.id, listing_id: listing.id, generation_profile_id: profile.id, voice_profile_id: voice!.id };

        const a = await repos.jobs.create(base);
        expect(a.created).toBe(true);
        expect(a.job.status).toBe("queued");
        expect(a.job.idempotency_key).toHaveLength(64);
        expect(a.job.require_audio).toBe(true);

        const b = await repos.jobs.create(base);
        expect(b.created).toBe(false);
        expect(b.job.id).toBe(a.job.id);

        const c = await repos.jobs.create({ ...base, pipeline_version: "v2" });
        expect(c.created).toBe(true);
        expect(c.job.id).not.toBe(a.job.id);

        const d = await repos.jobs.create({ ...base, voice_profile_id: null, require_audio: false });
        expect(d.created).toBe(true);
        expect(d.job.voice_profile_id).toBeNull();
        expect(d.job.require_audio).toBe(false);

        // Content change → new version → new key.
        const changed = await repos.listings.upsertFromInput(tenant.id, sampleListingInput({ source_id: listing.source_id, price: 700000 }));
        const e = await repos.jobs.create({ ...base, listing_version_id: changed.version_id });
        expect(e.created).toBe(true);
        expect(e.job.listing_version_id).toBe(changed.version_id);

        expect(await repos.jobs.get(a.job.id)).toEqual(a.job);
        expect(await repos.jobs.getByIdempotencyKey(a.job.idempotency_key)).toEqual(a.job);
        expect(await repos.jobs.get(newId())).toBeNull();
        await expect(repos.jobs.create({ ...base, listing_id: newId() })).rejects.toBeInstanceOf(NotFoundError);
      });

      it("updates status, lists by status and records steps", async () => {
        const { listing } = await repos.listings.upsertFromInput(tenant.id, sampleListingInput({ source_id: `job2-${newId()}` }));
        const profile = await repos.profiles.getGeneration(tenant.id);
        const { job } = await repos.jobs.create({ tenant_id: tenant.id, listing_id: listing.id, generation_profile_id: profile.id });

        const updated = await repos.jobs.update(job.id, { status: "generating", current_step: "generate", attempt: 1 });
        expect(updated.status).toBe("generating");
        expect(updated.current_step).toBe("generate");
        expect(updated.attempt).toBe(1);
        expect(updated.updated_at >= job.updated_at).toBe(true);

        const generating = await repos.jobs.list(tenant.id, { status: "generating" });
        expect(generating.map((j) => j.id)).toContain(job.id);
        expect((await repos.jobs.list(tenant.id, { status: ["published", "failed"] })).map((j) => j.id)).not.toContain(job.id);
        expect((await repos.jobs.list(tenant.id, { listing_id: listing.id })).map((j) => j.id)).toEqual([job.id]);

        const finishedAt = new Date().toISOString();
        const done = await repos.jobs.update(job.id, { status: "published", finished_at: finishedAt, last_error: null });
        expect(done.finished_at).toBe(finishedAt);
        await expect(repos.jobs.update(newId(), { status: "failed" })).rejects.toBeInstanceOf(NotFoundError);

        const s1 = await repos.jobs.addStep({
          job_id: job.id,
          step: "generate",
          attempt: 0,
          status: "succeeded",
          input_hash: H("in"),
          output_ref: null,
          error: null,
          usage: { input_tokens: 10 },
          cost_usd: 0.01,
          started_at: "2026-09-11T10:00:00.000Z",
          finished_at: "2026-09-11T10:00:05.000Z",
        });
        const s2 = await repos.jobs.addStep({
          job_id: job.id,
          step: "gate",
          attempt: 0,
          status: "failed",
          input_hash: null,
          output_ref: null,
          error: { code: "gate_failed" },
          usage: {},
          cost_usd: 0,
          started_at: "2026-09-11T10:00:06.000Z",
          finished_at: null,
        });
        const steps = await repos.jobs.steps(job.id);
        expect(steps.map((s) => s.id)).toEqual([s1.id, s2.id]);
        expect(steps[0]).toMatchObject({ step: "generate", cost_usd: 0.01, usage: { input_tokens: 10 } });
        expect(steps[1]!.error).toEqual({ code: "gate_failed" });
      });
    });

    describe("pipeline records", () => {
      let listing: Listing;
      let job: Job;
      let gen: GenerationRecord;
      let report: GateReport;
      let voiceId: string;

      beforeAll(async () => {
        listing = (await repos.listings.upsertFromInput(tenant.id, sampleListingInput({ source_id: `rec-${newId()}` }))).listing;
        const profile = await repos.profiles.getGeneration(tenant.id);
        const voice = await repos.profiles.getVoice(tenant.id);
        voiceId = voice!.id;
        job = (await repos.jobs.create({ tenant_id: tenant.id, listing_id: listing.id, generation_profile_id: profile.id, voice_profile_id: voiceId })).job;
        gen = generationFor(job, listing);
        await repos.generations.save(gen);
        report = gateReportFor(job, gen);
        await repos.gateReports.save(report);
      });

      it("stores generations and returns the latest for a job", async () => {
        expect(await repos.generations.get(gen.id)).toEqual(gen);
        const later = generationFor(job, listing, { attempt: 1, created_at: new Date(Date.now() + 1000).toISOString() });
        await repos.generations.save(later);
        expect((await repos.generations.latestForJob(job.id))!.id).toBe(later.id);
        expect((await repos.generations.listForJob(job.id)).map((g) => g.id)).toEqual([gen.id, later.id]);
        expect(await repos.generations.get(newId())).toBeNull();
      });

      it("stores gate reports with queryable decision and judge score", async () => {
        expect(await repos.gateReports.get(report.id)).toEqual(report);
        const failed = gateReportFor(job, gen, { decision: "needs_review", judge: null, created_at: new Date(Date.now() + 1000).toISOString() });
        await repos.gateReports.save(failed);
        expect((await repos.gateReports.listForJob(job.id)).map((r) => r.decision)).toEqual(["pass", "needs_review"]);
        expect((await repos.gateReports.latestForJob(job.id))!.id).toBe(failed.id);
      });

      it("stores narrations and the tts cache", async () => {
        const n = narrationFor(job, gen, voiceId);
        await repos.narrations.save(n);
        expect(await repos.narrations.get(n.id)).toEqual(n);
        expect((await repos.narrations.latestForJob(job.id))!.id).toBe(n.id);

        expect(await repos.ttsCache.get(n.text_hash, voiceId)).toBeNull();
        await repos.ttsCache.set(n.text_hash, voiceId, n.id);
        expect(await repos.ttsCache.get(n.text_hash, voiceId)).toBe(n.id);
        expect(await repos.ttsCache.get(n.text_hash, newId())).toBeNull();

        const n2 = { ...narrationFor(job, gen, voiceId), text_hash: n.text_hash };
        await repos.narrations.save(n2);
        await repos.ttsCache.set(n.text_hash, voiceId, n2.id);
        expect(await repos.ttsCache.get(n.text_hash, voiceId)).toBe(n2.id);
      });

      it("returns the latest output per listing and per job", async () => {
        const older = outputFor(job, gen, report, "2026-09-10T10:00:00.000Z");
        const newer = outputFor(job, gen, report, "2026-09-11T10:00:00.000Z");
        await repos.outputs.save(newer);
        await repos.outputs.save(older);
        expect((await repos.outputs.latestForListing(tenant.id, listing.id))!.id).toBe(newer.id);
        expect((await repos.outputs.getForJob(job.id))!.id).toBe(newer.id);
        expect(await repos.outputs.get(older.id)).toEqual(older);
        expect(await repos.outputs.latestForListing(newId(), listing.id)).toBeNull();
      });

      it("creates and resolves review items", async () => {
        const item = await repos.reviews.create({
          tenant_id: tenant.id,
          job_id: job.id,
          listing_id: listing.id,
          reason: "judge below threshold",
          gate_report_id: report.id,
          edited_sections: null,
        });
        expect(item.status).toBe("open");
        expect(item.resolved_at).toBeNull();
        expect((await repos.reviews.list(tenant.id, "open")).map((r) => r.id)).toContain(item.id);

        const edited = sampleGenerationResult({ cta: "Contacte-nos hoje para marcar a sua visita." });
        const resolved = await repos.reviews.resolve(item.id, "approved", edited);
        expect(resolved.status).toBe("approved");
        expect(resolved.resolved_at).not.toBeNull();
        expect(resolved.edited_sections?.cta).toBe(edited.cta);
        expect((await repos.reviews.list(tenant.id, "open")).map((r) => r.id)).not.toContain(item.id);
        expect((await repos.reviews.list(tenant.id, "approved")).map((r) => r.id)).toContain(item.id);
        expect(await repos.reviews.get(item.id)).toEqual(resolved);

        const rejected = await repos.reviews.resolve((await repos.reviews.create({ ...item, reason: "again" })).id, "rejected");
        expect(rejected.status).toBe("rejected");
        expect(rejected.edited_sections).toBeNull();
        await expect(repos.reviews.resolve(newId(), "approved")).rejects.toBeInstanceOf(NotFoundError);
      });

      it("records cost events, totals per month and budgets", async () => {
        const month = monthOf(new Date());
        const before = await repos.costs.totalForTenantMonth(tenant.id, month);
        await repos.costs.record({ tenant_id: tenant.id, job_id: job.id, step: "generate", provider: "gemini", model: "gemini-2.5-pro", input_tokens: 1500, output_tokens: 800, cost_usd: 0.018 });
        await repos.costs.record({ tenant_id: tenant.id, job_id: job.id, step: "judge", provider: "gemini", model: "gemini-2.5-flash", cost_usd: 0.002 });
        await repos.costs.record({ tenant_id: tenant.id, job_id: null, step: "narrate", provider: "voxcpm2-runpod", gpu_seconds: 21, cost_usd: 0.004 });
        expect(await repos.costs.totalForTenantMonth(tenant.id, month)).toBeCloseTo(before + 0.024, 6);
        expect(await repos.costs.totalForTenantMonth(tenant.id, "2001-01")).toBe(0);
        expect(await repos.costs.totalForTenantMonth(newId(), month)).toBe(0);

        const forJob = await repos.costs.listForJob(job.id);
        expect(forJob).toHaveLength(2);
        expect(forJob[0]).toMatchObject({ step: "generate", provider: "gemini", input_tokens: 1500, cost_usd: 0.018 });

        expect(await repos.costs.getBudget(tenant.id, month)).toBeNull();
        await repos.costs.setBudget({ tenant_id: tenant.id, month, soft_limit_usd: 50, hard_limit_usd: 100 });
        await repos.costs.setBudget({ tenant_id: tenant.id, month, soft_limit_usd: 60, hard_limit_usd: 100 });
        expect(await repos.costs.getBudget(tenant.id, month)).toEqual({ tenant_id: tenant.id, month, soft_limit_usd: 60, hard_limit_usd: 100 });
      });
    });

    describe("profiles", () => {
      it("creates a deterministic default generation profile per tenant", async () => {
        const a = await repos.profiles.getGeneration(tenant.id);
        const b = await repos.profiles.getGeneration(tenant.id, null);
        expect(a.id).toBe(defaultGenerationProfileId(tenant.id));
        expect(b).toEqual(a);
        expect(a.model).toBe("gemini-2.5-pro");
        const other = await repos.tenants.ensureDefault(newId(), "Other");
        expect((await repos.profiles.getGeneration(other.id)).id).not.toBe(a.id);
        await expect(repos.profiles.getGeneration(tenant.id, newId())).rejects.toBeInstanceOf(NotFoundError);
        await expect(repos.profiles.getGeneration(other.id, a.id)).rejects.toBeInstanceOf(NotFoundError);

        const custom = { ...a, id: newId(), name: "Premium", tone: "premium" as const, brand_name: "Lisboa Prime" };
        await repos.profiles.saveGeneration(custom);
        expect(await repos.profiles.getGeneration(tenant.id, custom.id)).toEqual(custom);
        await repos.profiles.saveGeneration({ ...custom, temperature: 0.5 });
        expect((await repos.profiles.getGeneration(tenant.id, custom.id)).temperature).toBe(0.5);
        expect((await repos.profiles.listGeneration(tenant.id)).map((p) => p.id)).toEqual(expect.arrayContaining([a.id, custom.id]));
      });

      it("returns a fake default voice profile and stored ones", async () => {
        const v = await repos.profiles.getVoice(tenant.id);
        expect(v).not.toBeNull();
        expect(v!.id).toBe(defaultVoiceProfileId(tenant.id));
        expect(v!.provider).toBe("fake");
        expect(v!.language_code).toBe("pt-PT");
        expect(await repos.profiles.getVoice(tenant.id, newId())).toBeNull();

        const custom = { ...v!, id: newId(), name: "Inês", provider: "voxcpm2-runpod" as const, consent_doc_ref: "consent/ines.pdf" };
        await repos.profiles.saveVoice(custom);
        expect(await repos.profiles.getVoice(tenant.id, custom.id)).toEqual(custom);
        expect((await repos.profiles.listVoice(tenant.id)).map((p) => p.id)).toEqual(expect.arrayContaining([v!.id, custom.id]));
      });
    });

    describe("webhooks", () => {
      it("lists enabled webhooks by event and records deliveries", async () => {
        const hook = await repos.webhooks.save({
          id: newId(),
          tenant_id: tenant.id,
          url: "https://example.org/hooks",
          secret: "0123456789abcdef0123",
          events: ["job.completed", "job.failed"],
          enabled: true,
          created_at: new Date().toISOString(),
        });
        await repos.webhooks.save({ ...hook, id: newId(), enabled: false });
        await repos.webhooks.save({ ...hook, id: newId(), events: ["listing.changed"] });

        expect((await repos.webhooks.listForTenant(tenant.id, "job.completed")).map((w) => w.id)).toEqual([hook.id]);
        expect((await repos.webhooks.listForTenant(tenant.id, "job.needs_review"))).toHaveLength(0);
        expect((await repos.webhooks.listForTenant(tenant.id))).toHaveLength(2);
        expect(await repos.webhooks.get(tenant.id, hook.id)).toEqual(hook);

        const delivery = await repos.webhooks.recordDelivery({
          id: newId(),
          tenant_id: tenant.id,
          webhook_id: hook.id,
          event: "job.completed",
          payload: { job_id: newId() },
          status: "pending",
          attempts: 1,
          last_error: null,
          next_attempt_at: null,
          created_at: new Date().toISOString(),
        });
        const failed = await repos.webhooks.recordDelivery({ ...delivery, status: "failed", attempts: 2, last_error: "500" });
        expect(failed.attempts).toBe(2);
        expect(await repos.webhooks.deliveries(hook.id)).toEqual([failed]);
        expect(await repos.webhooks.delete(tenant.id, hook.id)).toBe(true);
        expect(await repos.webhooks.delete(tenant.id, hook.id)).toBe(false);
      });
    });

    describe("saved searches and ingest runs", () => {
      it("lists enabled searches and tracks run progress", async () => {
        const search = await repos.savedSearches.save({
          id: newId(),
          tenant_id: tenant.id,
          source: "imovirtual-parsebot",
          query: { url: "https://www.imovirtual.com/comprar/apartamento/lisboa/" },
          cron: "0 6 * * *",
          enabled: true,
          max_pages: 3,
          max_credits_per_run: 100,
          last_run_at: null,
        });
        await repos.savedSearches.save({ ...search, id: newId(), enabled: false });
        expect((await repos.savedSearches.listEnabled(tenant.id)).map((x) => x.id)).toEqual([search.id]);
        expect((await repos.savedSearches.listEnabled()).map((x) => x.id)).toContain(search.id);
        expect((await repos.savedSearches.list(tenant.id))).toHaveLength(2);
        const ranAt = new Date("2026-09-11T06:00:00.000Z");
        await repos.savedSearches.markRun(search.id, ranAt);
        expect((await repos.savedSearches.get(tenant.id, search.id))!.last_run_at).toBe(ranAt.toISOString());

        const run = await repos.ingestRuns.save({
          id: newId(),
          saved_search_id: search.id,
          tenant_id: tenant.id,
          source: "imovirtual-parsebot",
          status: "running",
          page: 0,
          next_cursor: null,
          items_seen: 0,
          items_new: 0,
          items_changed: 0,
          credits_used: 0,
          error: null,
          started_at: "2026-09-11T06:00:00.000Z",
          finished_at: null,
        });
        const progressed = await repos.ingestRuns.save({ ...run, page: 2, next_cursor: "p3", items_seen: 40, items_new: 12, credits_used: 2.4 });
        expect(await repos.ingestRuns.get(run.id)).toEqual(progressed);
        const later = await repos.ingestRuns.save({ ...run, id: newId(), started_at: "2026-09-12T06:00:00.000Z", status: "succeeded", finished_at: "2026-09-12T06:05:00.000Z" });
        expect((await repos.ingestRuns.latestForSearch(search.id))!.id).toBe(later.id);
        expect((await repos.ingestRuns.list(tenant.id, { saved_search_id: search.id })).map((r) => r.id)).toEqual([later.id, run.id]);
        expect(await repos.savedSearches.delete(tenant.id, search.id)).toBe(true);
      });
    });

    describe("api keys", () => {
      it("finds keys by hash, touches and revokes", async () => {
        const key = await repos.apiKeys.create({
          id: newId(),
          tenant_id: tenant.id,
          prefix: "pk_live_abc",
          key_hash: H(`key-${newId()}`),
          scopes: ["*"],
          last_used_at: null,
          revoked_at: null,
          created_at: new Date().toISOString(),
        });
        expect(await repos.apiKeys.findByHash(key.key_hash)).toEqual(key);
        expect(await repos.apiKeys.findByHash(H("nope"))).toBeNull();
        const at = new Date("2026-09-11T12:00:00.000Z");
        await repos.apiKeys.touch(key.id, at);
        expect((await repos.apiKeys.findByHash(key.key_hash))!.last_used_at).toBe(at.toISOString());
        expect(await repos.apiKeys.revoke(newId(), key.id, at)).toBe(false);
        expect(await repos.apiKeys.revoke(tenant.id, key.id, at)).toBe(true);
        expect((await repos.apiKeys.list(tenant.id)).find((k) => k.id === key.id)!.revoked_at).toBe(at.toISOString());
      });
    });
  });
}
