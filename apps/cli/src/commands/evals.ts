import { join } from "node:path";
import { GATE_THRESHOLDS, ListingInput, loadConfig, newId, type GenerationResult } from "@imovel/core";
import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { createLogger } from "@imovel/observability";
import { buildDeps, enqueueJobForListing, runJobSync } from "@imovel/pipeline";
import { extractFacts, diffFacts, scanSections } from "@imovel/ptpt-qa";
import { narrate, runAccentQa, FakeAccentJudge } from "@imovel/tts";
import { listJson, pct, readJson, repoRoot, table, writeJson } from "../util";

interface GoldenCase {
  id: string;
  listing: unknown;
  reference: GenerationResult | null;
  notes?: string;
}

/** Generates and gates every golden listing; reports scores against the CI thresholds. */
export async function evalGolden(opts: { dir?: string; report?: string } = {}): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: "warn" }) });
  const dir = opts.dir ?? join(repoRoot(), "evals", "golden", "listings");
  const rows: Array<Record<string, string | number | null>> = [];
  const scores: number[] = [];
  let blockHits = 0;
  let words = 0;
  let factPass = 0;
  let published = 0;
  let cost = 0;
  const started = Date.now();
  try {
    const tenant = await deps.repos.tenants.ensureDefault(cfg.DEFAULT_TENANT_ID);
    for (const file of listJson(dir)) {
      const c = readJson<GoldenCase>(file);
      const input = ListingInput.parse(c.listing);
      const { listing } = await deps.repos.listings.upsertFromInput(tenant.id, input, deps.now());
      const { job } = await enqueueJobForListing(deps, listing, { require_audio: false });
      const t0 = Date.now();
      let status = "error";
      let judge: number | null = null;
      let decision = "-";
      let hits = 0;
      let facts = "-";
      try {
        const res = await runJobSync(deps, job.id);
        status = res.job.status;
        const reports = await deps.repos.gateReports.listForJob(job.id);
        const last = reports.at(-1);
        judge = last?.judge?.pt_pt_score ?? null;
        decision = last?.decision ?? "-";
        const factsReport = last?.validators.find((v) => v.name === "facts");
        facts = factsReport ? (factsReport.ok ? "ok" : "FAIL") : "-";
        if (factsReport?.ok) factPass++;
        if (res.output) {
          const sectionHits = scanSections(res.output.sections).filter((h) => h.severity === "block");
          hits = sectionHits.length;
          blockHits += hits;
          words += Object.values(res.output.sections).flat().join(" ").split(/\s+/).length;
          if (c.reference) {
            const d = diffFacts(extractFacts(Object.values(c.reference).flat().join("\n"), listing), extractFacts(Object.values(res.output.sections).flat().join("\n"), listing));
            if (!d.ok) facts += ` (ref diff: ${d.added.length + d.missing.length})`;
          }
          published++;
        }
        if (judge != null) scores.push(judge);
        const costs = await deps.repos.costs.listForJob(job.id);
        cost += costs.reduce((s, x) => s + x.cost_usd, 0);
      } catch (err) {
        status = `error: ${err instanceof Error ? err.message.slice(0, 60) : String(err)}`;
      }
      rows.push({ case: c.id, status, decision, judge, block_hits: hits, facts, ms: Date.now() - t0 });
    }
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const min = scores.length ? Math.min(...scores) : 0;
    const summary = {
      cases: rows.length,
      published,
      judge_mean: Math.round(mean * 10) / 10,
      judge_min: min,
      block_hits_per_1k_words: words ? Math.round((blockHits / words) * 1000 * 100) / 100 : 0,
      fact_pass_rate: pct(factPass, rows.length),
      cost_usd: Math.round(cost * 1e4) / 1e4,
      elapsed_s: Math.round((Date.now() - started) / 100) / 10,
      thresholds: { judge_mean: 92, judge_min: 85, block_hits: 0, fact_pass: "100%" },
      providers: { llm: cfg.LLM_PROVIDER, editor: cfg.GATE_EDITOR },
    };
    console.log(table(rows));
    console.log(JSON.stringify(summary, null, 2));
    writeJson(opts.report ?? join(repoRoot(), "evals", "reports", `golden-${new Date().toISOString().slice(0, 10)}.json`), { rows, summary });
    const ok = published === rows.length && mean >= 92 && min >= 85 && blockHits === 0 && factPass === rows.length;
    return ok ? 0 : 1;
  } finally {
    await deps.close();
  }
}

interface EditorCase {
  id: string;
  field: string;
  input: string;
  expected_fixes: Array<{ from: string; to: string }>;
  protected_facts: string[];
}

/** Sends each injected-error case through the configured editor and measures the fix rate. */
export async function evalEditor(opts: { file?: string } = {}): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: "warn" }), judge: false });
  const cases = readJson<EditorCase[]>(opts.file ?? join(repoRoot(), "evals", "golden", "editor", "cases.json"));
  const rows: Array<Record<string, string | number>> = [];
  let expected = 0;
  let fixed = 0;
  let factBreaks = 0;
  try {
    for (const c of cases) {
      const t0 = Date.now();
      const out = await deps.editor.edit(c.input, { strict: false, hints: c.expected_fixes.map((f) => `${f.from} → ${f.to}`) });
      const lower = out.text.toLowerCase();
      const applied = c.expected_fixes.filter((f) => !lower.includes(f.from.toLowerCase())).length;
      const broken = c.protected_facts.filter((f) => !out.text.includes(f)).length;
      expected += c.expected_fixes.length;
      fixed += applied;
      factBreaks += broken;
      rows.push({ case: c.id, fixes: `${applied}/${c.expected_fixes.length}`, facts_broken: broken, ms: Date.now() - t0 });
    }
    console.log(table(rows));
    const summary = { fix_rate: pct(fixed, expected), facts_broken: factBreaks, editor: cfg.GATE_EDITOR, model: cfg.GATE_EDITOR === "amalia" ? cfg.AMALIA_MODEL : cfg.JUDGE_MODEL, threshold: "≥ 95% fixes, 0 facts broken" };
    console.log(JSON.stringify(summary, null, 2));
    return expected === 0 || (fixed / expected >= 0.95 && factBreaks === 0) ? 0 : 1;
  } finally {
    await deps.close();
  }
}

interface AccentSentence {
  id: string;
  text: string;
  shibboleths: string[];
}

/** Synthesises the shibboleth sentences and runs accent QA on each. */
export async function evalAccent(opts: { file?: string; out?: string } = {}): Promise<number> {
  const cfg = loadConfig();
  const deps = await buildDeps(cfg, { logger: createLogger({ level: "warn" }) });
  const sentences = readJson<AccentSentence[]>(opts.file ?? join(repoRoot(), "evals", "accent", "sentences.json"));
  const profile = (await deps.repos.profiles.getVoice(cfg.DEFAULT_TENANT_ID, null)) ?? sampleVoiceProfile({ provider: cfg.TTS_PROVIDER });
  const judge = deps.accentJudge ?? new FakeAccentJudge();
  const rows: Array<Record<string, string | number | boolean | null>> = [];
  let european = 0;
  try {
    for (const s of sentences) {
      const { narration } = await narrate({
        text: s.text,
        profile,
        provider: deps.tts,
        store: deps.store,
        keyPrefix: `evals/accent/${s.id}`,
        ids: { narration_id: newId(), job_id: newId(), generation_id: newId() },
        ffmpeg: { enabled: false },
        accentJudge: null,
        now: deps.now,
      });
      const wav = await deps.store.get(narration.wav_key);
      const qa = await runAccentQa(wav, narration.text_normalized, judge);
      if (qa.ok) european++;
      rows.push({ id: s.id, wer: qa.wer, european: qa.european_confidence, ok: qa.ok, wav: narration.wav_key });
    }
    console.log(table(rows));
    console.log(JSON.stringify({ european_ok: `${european}/${sentences.length}`, threshold: "≥ 18/20", provider: cfg.TTS_PROVIDER }, null, 2));
    return european >= Math.ceil(sentences.length * 0.9) ? 0 : 1;
  } finally {
    await deps.close();
  }
}

export const evalThresholds = GATE_THRESHOLDS;
