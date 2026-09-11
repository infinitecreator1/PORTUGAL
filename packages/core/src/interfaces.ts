import type { Listing, ListingInput, Ownership, SourceId } from "./schemas/listing";
import type { GenerationProfile, GenerationResult } from "./schemas/generation";
import type { ValidatorReport } from "./schemas/gate";
import type { VoiceProfile } from "./schemas/voice";
import type { SavedSearch } from "./schemas/tenant";

// ---------------------------------------------------------------------------
// LLM (OpenAI chat-completions wire format, as used by the existing chat function)
// ---------------------------------------------------------------------------

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  /** Defaults to the client's `defaultModel`. */
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  seed?: number;
  stop?: string[];
  response_format?: { type: "json_object" } | { type: "json_schema"; json_schema: unknown };
  /** Provider passthrough (e.g. `reasoning_effort`, `repetition_penalty`). */
  extra?: Record<string, unknown>;
}

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens?: number;
}

export interface ChatResponse {
  content: string;
  model: string;
  finish_reason: string | null;
  usage: ChatUsage;
  latency_ms: number;
}

export interface CallOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
}

export interface LLMCapabilities {
  jsonSchema: boolean;
  seed: boolean;
  reasoningEffort: boolean;
}

export interface LLMClient {
  readonly provider: string;
  readonly defaultModel: string;
  readonly capabilities: LLMCapabilities;
  chat(req: ChatRequest, opts?: CallOptions): Promise<ChatResponse>;
  health(): Promise<{ ok: boolean; latency_ms: number }>;
}

// ---------------------------------------------------------------------------
// Generation and gate
// ---------------------------------------------------------------------------

export interface GenerationOutput {
  result: GenerationResult;
  usage: ChatUsage;
  model: string;
  provider: string;
  latency_ms: number;
}

export interface DescriptionGenerator {
  readonly id: string;
  generate(
    listing: Listing,
    profile: GenerationProfile,
    extraConstraints?: string[],
    opts?: CallOptions,
  ): Promise<GenerationOutput>;
}

export interface EditOptions {
  /** Second attempt: only isolated words and punctuation, fix the listed hints. */
  strict?: boolean;
  /** Lexicon hits or judge spans the editor must fix, as "termo → sugestão". */
  hints?: string[];
}

export interface EditOutput {
  text: string;
  usage: ChatUsage;
  model: string;
  latency_ms: number;
}

/** Edits one field of pt text into flawless pt-PT without changing facts. */
export interface PtPtEditor {
  readonly id: "amalia" | "gemini" | "fake";
  edit(text: string, opts?: EditOptions & CallOptions): Promise<EditOutput>;
}

export interface GateContext {
  listing: Listing;
  before: GenerationResult;
  after: GenerationResult;
  loop: number;
  attempt: number;
}

export interface Validator {
  readonly name: string;
  run(ctx: GateContext): Promise<ValidatorReport>;
}

// ---------------------------------------------------------------------------
// Voice
// ---------------------------------------------------------------------------

export interface TTSChunk {
  index: number;
  text: string;
}

export interface TTSAudio {
  /** RIFF WAV bytes, mono. */
  wav: Buffer;
  sampleRate: number;
  usage: { chars: number; gpu_seconds?: number };
}

export interface TTSProvider {
  readonly id: VoiceProfile["provider"];
  limits(): { maxChars: number };
  synthesize(chunk: TTSChunk, profile: VoiceProfile, opts?: CallOptions): Promise<TTSAudio>;
}

// ---------------------------------------------------------------------------
// Ingestion
// ---------------------------------------------------------------------------

export type RawListing = Record<string, unknown>;

export interface SearchPage {
  items: RawListing[];
  next: string | null;
  total?: number | null;
  credits_used?: number;
}

export interface NormalizeContext {
  tenant_id: string;
  /** Ownership to assign when the agency does not match a tenant agency. */
  ownership_default: Ownership;
  /** Agency ids registered by the tenant for this source. */
  agency_ids: string[];
}

export interface ListingSource {
  readonly id: SourceId;
  capabilities(): { search: boolean; detail: boolean; rpm: number };
  search(query: SavedSearch, cursor?: string | null, opts?: CallOptions): Promise<SearchPage>;
  detail(ref: { source_id: string; url?: string | null }, opts?: CallOptions): Promise<RawListing>;
  /** Pure. Throws `ValidationError` when the raw payload cannot be mapped. */
  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput;
}

// ---------------------------------------------------------------------------
// Storage, queue, cost
// ---------------------------------------------------------------------------

export interface StoredObject {
  key: string;
  bytes: number;
  sha256: string;
}

export interface ObjectStore {
  readonly id: string;
  put(key: string, body: Buffer, opts: { contentType: string }): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  signedUrl(key: string, ttlSeconds: number): Promise<string>;
  delete(key: string): Promise<void>;
}

export interface SendOptions {
  singletonKey?: string;
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
  deadLetter?: string;
  startAfterSeconds?: number;
}

export interface JobQueue {
  send(queue: string, data: unknown, opts?: SendOptions): Promise<string | null>;
  work<T>(
    queue: string,
    handler: (data: T, meta: { id: string; retryCount: number }) => Promise<void>,
  ): Promise<void>;
  schedule(queue: string, cron: string, data?: unknown): Promise<void>;
  unschedule(queue: string): Promise<void>;
  size(queue: string): Promise<number>;
  stop(): Promise<void>;
}

export interface CostEvent {
  tenant_id: string;
  job_id?: string | null;
  step: "ingest" | "generate" | "gate" | "judge" | "narrate" | "accent_qa" | "publish";
  provider: string;
  model?: string | null;
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  chars?: number;
  gpu_seconds?: number;
  credits?: number;
  cost_usd: number;
}

export interface CostLedger {
  record(event: CostEvent): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
