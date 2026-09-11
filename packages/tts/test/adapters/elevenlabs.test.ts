import { RateLimitError, ValidationError } from "@imovel/core";
import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { describe, expect, it, vi } from "vitest";
import { ElevenLabsProvider } from "../../src/adapters/elevenlabs";
import { parseWav } from "../../src/wav";

describe("ElevenLabsProvider", () => {
  it("posts PCM16 and wraps it into a 24 kHz WAV", async () => {
    const pcm = Buffer.from(new Int16Array([1, 2, 3, 4]).buffer);
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice-123?output_format=pcm_24000");
      expect((init?.headers as Record<string, string>)["xi-api-key"]).toBe("xi-key");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        text: "Olá.",
        model_id: "eleven_multilingual_v2",
        language_code: "pt",
        voice_settings: { stability: 0.5, similarity_boost: 0.8 },
      });
      return new Response(pcm, { status: 200 });
    });
    const provider = new ElevenLabsProvider({ apiKey: "xi-key", fetch: fetchFn as unknown as typeof fetch });
    const profile = sampleVoiceProfile({ provider: "elevenlabs", voice_ref: "voice-123" });
    const audio = await provider.synthesize({ index: 0, text: "Olá." }, profile);
    expect(audio.sampleRate).toBe(24000);
    const parsed = parseWav(audio.wav);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("throws ValidationError when the profile has no voice_ref", async () => {
    const provider = new ElevenLabsProvider({ apiKey: "xi-key" });
    const profile = sampleVoiceProfile({ provider: "elevenlabs", voice_ref: null });
    await expect(provider.synthesize({ index: 0, text: "x" }, profile)).rejects.toBeInstanceOf(ValidationError);
  });

  it("maps a 429 response to RateLimitError", async () => {
    const provider = new ElevenLabsProvider({
      apiKey: "xi-key",
      fetch: (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch,
    });
    const profile = sampleVoiceProfile({ provider: "elevenlabs", voice_ref: "voice-123" });
    await expect(provider.synthesize({ index: 0, text: "x" }, profile)).rejects.toBeInstanceOf(RateLimitError);
  });
});
