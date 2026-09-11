import { RateLimitError, ValidationError } from "@imovel/core";
import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { describe, expect, it, vi } from "vitest";
import { GeminiCloudTtsProvider } from "../../src/adapters/geminiCloudTts";
import { parseWav, sineWav } from "../../src/wav";

describe("GeminiCloudTtsProvider", () => {
  it("posts to text:synthesize and decodes the base64 WAV response", async () => {
    const wav = sineWav({ seconds: 0.1, sampleRate: 24000, freq: 220 });
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://texttospeech.googleapis.com/v1/text:synthesize?key=g-key");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({
        input: { text: "Olá.", prompt: expect.any(String) },
        voice: { languageCode: "pt-PT", name: "Kore", modelName: "gemini-2.5-flash-tts" },
        audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: 24000, speakingRate: 1 },
      });
      return new Response(JSON.stringify({ audioContent: wav.toString("base64") }), { status: 200 });
    });
    const provider = new GeminiCloudTtsProvider({ apiKey: "g-key", fetch: fetchFn as unknown as typeof fetch });
    const profile = sampleVoiceProfile({ provider: "gemini-cloud-tts", voice_ref: null });
    const audio = await provider.synthesize({ index: 0, text: "Olá." }, profile);
    expect(audio.sampleRate).toBe(24000);
    expect(parseWav(audio.wav).sampleRate).toBe(24000);
  });

  it("uses the profile's voice_ref as the voice name when present", async () => {
    const wav = sineWav({ seconds: 0.05, sampleRate: 24000, freq: 220 });
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as { voice: { name: string } };
      expect(body.voice.name).toBe("Puck");
      return new Response(JSON.stringify({ audioContent: wav.toString("base64") }), { status: 200 });
    });
    const provider = new GeminiCloudTtsProvider({ apiKey: "g-key", fetch: fetchFn as unknown as typeof fetch });
    const profile = sampleVoiceProfile({ provider: "gemini-cloud-tts", voice_ref: "Puck" });
    await provider.synthesize({ index: 0, text: "Olá." }, profile);
  });

  it("reports a higher maxChars limit than the other providers", () => {
    const provider = new GeminiCloudTtsProvider({ apiKey: "g-key" });
    expect(provider.limits().maxChars).toBe(1200);
  });

  it("throws ValidationError when the text exceeds 4000 bytes", async () => {
    const provider = new GeminiCloudTtsProvider({ apiKey: "g-key" });
    const profile = sampleVoiceProfile({ provider: "gemini-cloud-tts" });
    const longText = "a".repeat(4001);
    await expect(provider.synthesize({ index: 0, text: longText }, profile)).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("maps a 429 response to RateLimitError", async () => {
    const provider = new GeminiCloudTtsProvider({
      apiKey: "g-key",
      fetch: (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch,
    });
    const profile = sampleVoiceProfile({ provider: "gemini-cloud-tts" });
    await expect(provider.synthesize({ index: 0, text: "x" }, profile)).rejects.toBeInstanceOf(RateLimitError);
  });
});
