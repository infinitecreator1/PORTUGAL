import type { CallOptions, TTSAudio, TTSChunk, TTSProvider, VoiceProfile } from "@imovel/core";
import { sineWav } from "../wav";

export interface FakeTTSCall {
  chunk: TTSChunk;
  profile: VoiceProfile;
}

/**
 * Deterministic offline provider: a mono sine tone whose duration tracks the chunk length
 * and whose pitch tracks the voice profile's seed. Used for the smoke pipeline and tests.
 */
export class FakeTTSProvider implements TTSProvider {
  readonly id = "fake" as const;
  readonly calls: FakeTTSCall[] = [];

  limits(): { maxChars: number } {
    return { maxChars: 300 };
  }

  async synthesize(chunk: TTSChunk, profile: VoiceProfile, _opts?: CallOptions): Promise<TTSAudio> {
    this.calls.push({ chunk, profile });
    const sampleRate = 24000;
    const chars = chunk.text.length;
    const seconds = Math.max(0.4, chars / 15);
    const freq = 220 + (profile.seed % 400);
    const wav = sineWav({ seconds, sampleRate, freq });
    return {
      wav,
      sampleRate,
      usage: { chars, gpu_seconds: seconds * 0.3 },
    };
  }
}
