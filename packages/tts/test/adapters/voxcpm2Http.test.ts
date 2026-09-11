import { RateLimitError, UpstreamError } from "@imovel/core";
import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { describe, expect, it, vi } from "vitest";
import { VoxCpm2HttpProvider } from "../../src/adapters/voxcpm2Http";
import { parseWav, sineWav } from "../../src/wav";

const wav = sineWav({ seconds: 0.1, sampleRate: 48000, freq: 220 });

describe("VoxCpm2HttpProvider", () => {
  it("posts to /v1/audio/speech and returns the WAV body", async () => {
    const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
      expect(String(url)).toBe("http://pod:8000/v1/audio/speech");
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body).toMatchObject({ model: "openbmb/VoxCPM2", voice: "default", response_format: "wav" });
      return new Response(wav, { status: 200 });
    });
    const provider = new VoxCpm2HttpProvider({ baseUrl: "http://pod:8000", fetch: fetchFn as unknown as typeof fetch });
    const profile = sampleVoiceProfile();
    const audio = await provider.synthesize({ index: 0, text: "Olá." }, profile);
    expect(parseWav(audio.wav).sampleRate).toBe(48000);
    expect(audio.usage.chars).toBe("Olá.".length);
  });

  it("base64-encodes the reference audio when the profile has one and a fetcher is given", async () => {
    const refBuf = Buffer.from([1, 2, 3]);
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      expect(body.ref_audio).toBe(refBuf.toString("base64"));
      return new Response(wav, { status: 200 });
    });
    const getReferenceAudio = vi.fn(async () => refBuf);
    const provider = new VoxCpm2HttpProvider({
      baseUrl: "http://pod:8000",
      fetch: fetchFn as unknown as typeof fetch,
      getReferenceAudio,
    });
    await provider.synthesize({ index: 0, text: "Olá." }, sampleVoiceProfile());
    expect(getReferenceAudio).toHaveBeenCalledOnce();
  });

  it("maps a 500 response to UpstreamError and a 429 to RateLimitError", async () => {
    const provider500 = new VoxCpm2HttpProvider({
      baseUrl: "http://pod:8000",
      fetch: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
    });
    await expect(
      provider500.synthesize({ index: 0, text: "x" }, sampleVoiceProfile()),
    ).rejects.toBeInstanceOf(UpstreamError);

    const provider429 = new VoxCpm2HttpProvider({
      baseUrl: "http://pod:8000",
      fetch: (async () => new Response("slow down", { status: 429 })) as unknown as typeof fetch,
    });
    await expect(
      provider429.synthesize({ index: 0, text: "x" }, sampleVoiceProfile()),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
