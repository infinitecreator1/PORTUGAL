import type { CallOptions, TTSAudio, TTSChunk, TTSProvider, VoiceProfile } from "@imovel/core";
import { ValidationError, errorFromStatus } from "@imovel/core";
import { encodeWav } from "../wav";

const SAMPLE_RATE = 24000;

export interface ElevenLabsOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

/** `elevenlabs`: pt-multilingual failover voice. `voice_ref` on the profile is the ElevenLabs `voice_id`. */
export class ElevenLabsProvider implements TTSProvider {
  readonly id = "elevenlabs" as const;

  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: ElevenLabsOptions) {
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  limits(): { maxChars: number } {
    return { maxChars: 300 };
  }

  async synthesize(chunk: TTSChunk, profile: VoiceProfile, opts?: CallOptions): Promise<TTSAudio> {
    if (!profile.voice_ref) {
      throw new ValidationError("ElevenLabsProvider: voice profile has no voice_ref (ElevenLabs voice id)");
    }
    const res = await this.fetchFn(
      `https://api.elevenlabs.io/v1/text-to-speech/${profile.voice_ref}?output_format=pcm_24000`,
      {
        method: "POST",
        headers: { "xi-api-key": this.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunk.text,
          model_id: "eleven_multilingual_v2",
          language_code: "pt",
          voice_settings: { stability: 0.5, similarity_boost: 0.8 },
        }),
        signal: opts?.signal,
      },
    );
    if (!res.ok) {
      throw errorFromStatus(res.status, await res.text(), { provider: "elevenlabs" });
    }
    const pcm = Buffer.from(await res.arrayBuffer());
    const wav = encodeWav(pcm, SAMPLE_RATE, 1, 16);
    return { wav, sampleRate: SAMPLE_RATE, usage: { chars: chunk.text.length } };
  }
}
