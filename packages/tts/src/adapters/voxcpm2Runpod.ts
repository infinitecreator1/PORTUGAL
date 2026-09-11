import type { CallOptions, TTSAudio, TTSChunk, TTSProvider, VoiceProfile } from "@imovel/core";
import { TimeoutError, UpstreamError, errorFromStatus, runpodEndpointBaseUrl } from "@imovel/core";
import { encodeWav, parseWav } from "../wav";

const PROVIDER_LABEL = "voxcpm2-runpod";

type RunpodStatus = "COMPLETED" | "IN_QUEUE" | "IN_PROGRESS" | "FAILED";

interface RunpodJobResponse {
  id: string;
  status: RunpodStatus;
  output?: unknown;
  error?: string;
}

interface VoxCpm2TtsOutput {
  audio_b64: string;
  sample_rate: number;
  gpu_seconds?: number;
  format?: "wav" | "pcm16";
}

interface VoxCpm2TranscribeOutput {
  text: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface VoxCpm2RunpodOptions {
  apiKey: string;
  endpointId: string;
  fetch?: typeof fetch;
  /** Fetches the tenant's reference WAV from object storage, keyed by `profile.reference_audio_key`. */
  getReferenceAudio?: (key: string) => Promise<Buffer>;
  /** Delay between `/status` polls while the job is queued or running. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Overall time budget for a single `synthesize`/`transcribe` call. Default 300 000 ms. */
  timeoutMs?: number;
}

/**
 * `voxcpm2-runpod`: RunPod Serverless worker (`infra/runpod/voxcpm2/handler.py`) wrapping the
 * `voxcpm` library. Submits to `/runsync` and polls `/status/:id` while queued or running.
 */
export class VoxCpm2RunpodProvider implements TTSProvider {
  readonly id = "voxcpm2-runpod" as const;

  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly fetchFn: typeof fetch;
  private readonly getReferenceAudio: ((key: string) => Promise<Buffer>) | undefined;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(opts: VoxCpm2RunpodOptions) {
    this.apiKey = opts.apiKey;
    this.endpointId = opts.endpointId;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.getReferenceAudio = opts.getReferenceAudio;
    this.pollIntervalMs = opts.pollIntervalMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 300_000;
  }

  limits(): { maxChars: number } {
    return { maxChars: 300 };
  }

  async synthesize(chunk: TTSChunk, profile: VoiceProfile, opts?: CallOptions): Promise<TTSAudio> {
    let reference_audio_b64: string | undefined;
    if (profile.reference_audio_key && this.getReferenceAudio) {
      reference_audio_b64 = (await this.getReferenceAudio(profile.reference_audio_key)).toString("base64");
    }
    const output = await this.runJob(
      {
        op: "tts",
        text: `${profile.style_prompt}${chunk.text}`,
        reference_audio_b64,
        reference_transcript: profile.reference_transcript ?? undefined,
        cfg_value: profile.cfg_value,
        inference_timesteps: profile.inference_timesteps,
        seed: profile.seed + chunk.index,
        speaking_rate: profile.speaking_rate,
        sample_rate: 48000,
      },
      opts,
    );
    const audio = output as VoxCpm2TtsOutput;
    const wav =
      audio.format === "pcm16"
        ? encodeWav(Buffer.from(audio.audio_b64, "base64"), audio.sample_rate, 1, 16)
        : Buffer.from(audio.audio_b64, "base64");
    parseWav(wav); // throws ValidationError on a malformed container
    return {
      wav,
      sampleRate: audio.sample_rate,
      usage: { chars: chunk.text.length, gpu_seconds: audio.gpu_seconds },
    };
  }

  /** `op: 'transcribe'` on the same worker (faster-whisper, `language='pt'`). */
  async transcribe(wav: Buffer, opts?: CallOptions): Promise<string> {
    const output = await this.runJob({ op: "transcribe", audio_b64: wav.toString("base64") }, opts);
    return (output as VoxCpm2TranscribeOutput).text;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  private async runJob(input: Record<string, unknown>, opts?: CallOptions): Promise<unknown> {
    const baseUrl = runpodEndpointBaseUrl(this.endpointId);
    const submitRes = await this.fetchFn(`${baseUrl}/runsync`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ input }),
      signal: opts?.signal,
    });
    if (!submitRes.ok) {
      throw errorFromStatus(submitRes.status, await submitRes.text(), { provider: PROVIDER_LABEL });
    }
    let job = (await submitRes.json()) as RunpodJobResponse;
    const deadline = Date.now() + this.timeoutMs;

    while (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS") {
      if (Date.now() >= deadline) {
        throw new TimeoutError(`${PROVIDER_LABEL}: job ${job.id} did not complete in time`, {
          details: { jobId: job.id },
        });
      }
      if (this.pollIntervalMs > 0) await sleep(this.pollIntervalMs);
      const statusRes = await this.fetchFn(`${baseUrl}/status/${job.id}`, {
        headers: this.headers(),
        signal: opts?.signal,
      });
      if (!statusRes.ok) {
        throw errorFromStatus(statusRes.status, await statusRes.text(), { provider: PROVIDER_LABEL });
      }
      job = (await statusRes.json()) as RunpodJobResponse;
    }

    if (job.status === "FAILED") {
      throw new UpstreamError(`${PROVIDER_LABEL}: job ${job.id} failed: ${job.error ?? "unknown error"}`, {
        details: { jobId: job.id, error: job.error },
      });
    }
    return job.output;
  }
}
