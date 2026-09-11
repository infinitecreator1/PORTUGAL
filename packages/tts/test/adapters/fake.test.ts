import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { FakeTTSProvider } from "../../src/adapters/fake";
import { wavDurationSeconds } from "../../src/wav";

describe("FakeTTSProvider", () => {
  it("synthesises a 24 kHz mono tone whose duration tracks the chunk length", async () => {
    const provider = new FakeTTSProvider();
    const profile = sampleVoiceProfile({ provider: "fake" });
    const text = "Uma frase de teste com um certo número de caracteres.";
    const audio = await provider.synthesize({ index: 0, text }, profile);

    expect(audio.sampleRate).toBe(24000);
    expect(audio.usage.chars).toBe(text.length);
    expect(wavDurationSeconds(audio.wav)).toBeCloseTo(Math.max(0.4, text.length / 15), 2);
    expect(audio.usage.gpu_seconds).toBeCloseTo(wavDurationSeconds(audio.wav) * 0.3, 2);
  });

  it("floors duration at 0.4s for very short chunks", async () => {
    const provider = new FakeTTSProvider();
    const profile = sampleVoiceProfile();
    const audio = await provider.synthesize({ index: 0, text: "Oi." }, profile);
    expect(wavDurationSeconds(audio.wav)).toBeCloseTo(0.4, 2);
  });

  it("varies pitch with the voice profile's seed", async () => {
    const provider = new FakeTTSProvider();
    const a = await provider.synthesize({ index: 0, text: "abc" }, sampleVoiceProfile({ seed: 1 }));
    const b = await provider.synthesize({ index: 0, text: "abc" }, sampleVoiceProfile({ seed: 99 }));
    expect(a.wav.equals(b.wav)).toBe(false);
  });

  it("records every call", async () => {
    const provider = new FakeTTSProvider();
    const profile = sampleVoiceProfile();
    await provider.synthesize({ index: 0, text: "um" }, profile);
    await provider.synthesize({ index: 1, text: "dois" }, profile);
    expect(provider.calls).toHaveLength(2);
    expect(provider.calls[0].chunk).toEqual({ index: 0, text: "um" });
    expect(provider.calls[1].chunk).toEqual({ index: 1, text: "dois" });
  });

  it("reports a maxChars limit", () => {
    expect(new FakeTTSProvider().limits().maxChars).toBeGreaterThan(0);
  });
});
