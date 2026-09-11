import type { Config } from "@imovel/core";
import { createRepos } from "@imovel/db";
import { createEditor, createGenerator, createLLMClient } from "@imovel/llm";
import { CompositeCostLedger, LoggingCostLedger, createLogger, type Logger } from "@imovel/observability";
import { createObjectStore } from "@imovel/storage";
import { createTTSProvider } from "@imovel/tts";
import type { PipelineDeps } from "./deps";

export interface BuiltDeps extends PipelineDeps {
  close(): Promise<void>;
}

/** Wires every provider from configuration. Fake providers need no keys and no network. */
export async function buildDeps(cfg: Config, opts: { logger?: Logger; fetch?: typeof fetch; judge?: boolean } = {}): Promise<BuiltDeps> {
  const logger = opts.logger ?? createLogger({ level: cfg.LOG_LEVEL, name: "pipeline" });
  const f = opts.fetch ?? globalThis.fetch;
  const { repos, queue, close } = await createRepos(cfg);
  const store = createObjectStore(cfg);
  const generator = createGenerator(cfg, { fetch: f });
  const editor = createEditor(cfg, { fetch: f });
  const judge = opts.judge === false ? null : createLLMClient(cfg, "judge", { fetch: f });
  const tts = createTTSProvider(cfg, { fetch: f, getReferenceAudio: (key: string) => store.get(key) });
  const ledger = new CompositeCostLedger([new LoggingCostLedger(logger), repos.costs]);
  // Accent QA needs a transcriber that hears the audio; the RunPod Whisper judge is wired in
  // production once the VoxCPM2 endpoint exposes `op: transcribe`. Off by default (MVP).
  const accentJudge = null;

  return {
    cfg,
    logger,
    repos,
    queue,
    generator,
    editor,
    judge,
    tts,
    store,
    ledger,
    accentJudge,
    ffmpeg: { enabled: cfg.NODE_ENV !== "test" },
    now: () => new Date(),
    fetch: f,
    close,
  };
}
