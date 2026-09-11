import type { CallOptions, TTSAudio, TTSChunk, TTSProvider, VoiceProfile } from "@imovel/core";
import { errorFromStatus } from "@imovel/core";
import { parseWav } from "../wav";

export interface VoxCpm2HttpOptions {
  /** Base URL of the vLLM-Omni server, up to and including the host/port (e.g. `http://pod:8000`). */
  baseUrl: string;
  fetch?: typeof fetch;
  getReferenceAudio?: (key: string) => Promise<Buffer>;
}

/**
 * `voxcpm2-http`: a Pod running `vllm serve openbmb/VoxCPM2 --omni`, exposing an
 * OpenAI-audio-compatible `/v1/audio/speech`. Production alternative to the RunPod worker,
 * batching for RTF ≈ 0.12 but needing ≥ 24 GB VRAM kept warm.
 */
export class VoxCpm2HttpProvider implements TTSProvider {
  readonly id = "voxcpm2-http" as const;

  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly getReferenceAudio: ((key: string) => Promise<Buffer>) | undefined;

  constructor(opts: VoxCpm2HttpOptions) {
    this.baseUrl = opts.baseUrl;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
    this.getReferenceAudio = opts.getReferenceAudio;
  }

  limits(): { maxChars: number } {
    return { maxChars: 300 };
  }

  async synthesize(chunk: TTSChunk, profile: VoiceProfile, opts?: CallOptions): Promise<TTSAudio> {
    let ref_audio: string | undefined;
    if (profile.reference_audio_key && this.getReferenceAudio) {
      ref_audio = (await this.getReferenceAudio(profile.reference_audio_key)).toString("base64");
    }
    const res = await this.fetchFn(`${this.baseUrl}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "openbmb/VoxCPM2",
        input: `${profile.style_prompt}${chunk.text}`,
        voice: "default",
        response_format: "wav",
        ref_audio,
      }),
      signal: opts?.signal,
    });
    if (!res.ok) {
      throw errorFromStatus(res.status, await res.text(), { provider: "voxcpm2-http" });
    }
    const wav = Buffer.from(await res.arrayBuffer());
    const parsed = parseWav(wav);
    return { wav, sampleRate: parsed.sampleRate, usage: { chars: chunk.text.length } };
  }
}
