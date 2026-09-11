import type { CallOptions, TTSAudio, TTSChunk, TTSProvider, VoiceProfile } from "@imovel/core";
import { ValidationError, errorFromStatus } from "@imovel/core";

const SAMPLE_RATE = 24000;
const MAX_INPUT_BYTES = 4000;

export interface GeminiCloudTtsOptions {
  apiKey: string;
  fetch?: typeof fetch;
}

interface SynthesizeResponse {
  audioContent: string;
}

/** `gemini-cloud-tts`: Google Cloud Text-to-Speech's Gemini voices (`gemini-2.5-flash-tts`). */
export class GeminiCloudTtsProvider implements TTSProvider {
  readonly id = "gemini-cloud-tts" as const;

  private readonly apiKey: string;
  private readonly fetchFn: typeof fetch;

  constructor(opts: GeminiCloudTtsOptions) {
    this.apiKey = opts.apiKey;
    this.fetchFn = opts.fetch ?? globalThis.fetch;
  }

  /** Higher than the other adapters: Google's TTS endpoint accepts long-form input directly. */
  limits(): { maxChars: number } {
    return { maxChars: 1200 };
  }

  async synthesize(chunk: TTSChunk, profile: VoiceProfile, opts?: CallOptions): Promise<TTSAudio> {
    if (Buffer.byteLength(chunk.text, "utf8") > MAX_INPUT_BYTES) {
      throw new ValidationError(`gemini-cloud-tts: input text exceeds ${MAX_INPUT_BYTES} bytes`);
    }
    const res = await this.fetchFn(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(this.apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { text: chunk.text, prompt: profile.style_prompt },
          voice: {
            languageCode: "pt-PT",
            name: profile.voice_ref ?? "Kore",
            modelName: "gemini-2.5-flash-tts",
          },
          audioConfig: {
            audioEncoding: "LINEAR16",
            sampleRateHertz: SAMPLE_RATE,
            speakingRate: profile.speaking_rate,
          },
        }),
        signal: opts?.signal,
      },
    );
    if (!res.ok) {
      throw errorFromStatus(res.status, await res.text(), { provider: "gemini-cloud-tts" });
    }
    const data = (await res.json()) as SynthesizeResponse;
    const wav = Buffer.from(data.audioContent, "base64");
    return { wav, sampleRate: SAMPLE_RATE, usage: { chars: chunk.text.length } };
  }
}
