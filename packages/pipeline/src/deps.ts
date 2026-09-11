import type {
  Config,
  CostLedger,
  DescriptionGenerator,
  JobQueue,
  LLMClient,
  ObjectStore,
  PtPtEditor,
  TTSProvider,
} from "@imovel/core";
import type { Repos } from "@imovel/db";
import type { Logger } from "@imovel/observability";
import type { AccentJudge } from "@imovel/tts";

/** Everything a pipeline step needs. Built once per process by `buildDeps`, or by hand in tests. */
export interface PipelineDeps {
  cfg: Config;
  logger: Logger;
  repos: Repos;
  queue: JobQueue;
  generator: DescriptionGenerator;
  editor: PtPtEditor;
  /** Null disables the judge (offline runs). */
  judge: LLMClient | null;
  tts: TTSProvider;
  store: ObjectStore;
  ledger: CostLedger;
  accentJudge: AccentJudge | null;
  ffmpeg: { enabled: boolean };
  now: () => Date;
  fetch: typeof fetch;
}

export const PIPELINE_VERSION = "1";

/** Queue payloads, one per step. Constraints from a failed gate ride along with the regenerate payload. */
export interface GeneratePayload {
  job_id: string;
  extraConstraints?: string[];
}
export interface GatePayload {
  job_id: string;
  generation_id: string;
}
export interface NarratePayload {
  job_id: string;
  generation_id: string;
}
export interface PublishPayload {
  job_id: string;
  generation_id: string;
  narration_id?: string | null;
  warnings?: string[];
}
export interface IngestPayload {
  saved_search_id?: string;
  tenant_id: string;
  source: string;
  query: Record<string, unknown>;
  cursor?: string | null;
}

export interface NextAction {
  queue: string;
  payload: GeneratePayload | GatePayload | NarratePayload | PublishPayload;
}
