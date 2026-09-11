import { describe, expect, it } from "vitest";
import { FakeAccentJudge, RunpodWhisperJudge, runAccentQa, wordErrorRate } from "../src/accentQa";
import { sineWav } from "../src/wav";

const wav = sineWav({ seconds: 0.1, sampleRate: 16000, freq: 220 });

describe("wordErrorRate", () => {
  it("is zero for an identical transcript", () => {
    expect(wordErrorRate("Bom dia, tudo bem?", "bom dia tudo bem")).toBe(0);
  });

  it("ignores accents, case and punctuation", () => {
    expect(wordErrorRate("É um apartamento em Óbidos.", "e um apartamento em obidos")).toBe(0);
  });

  it("counts one substitution as one error over the reference length", () => {
    expect(wordErrorRate("um dois três quatro", "um dois cinco quatro")).toBeCloseTo(0.25, 5);
  });

  it("counts a missing word as one deletion", () => {
    expect(wordErrorRate("um dois três", "um três")).toBeCloseTo(1 / 3, 5);
  });

  it("treats an empty reference and empty hypothesis as a perfect match", () => {
    expect(wordErrorRate("", "")).toBe(0);
  });

  it("treats an empty reference with a non-empty hypothesis as fully wrong", () => {
    expect(wordErrorRate("", "algo")).toBe(1);
  });
});

describe("runAccentQa", () => {
  it("passes when the transcript matches and confidence is high", async () => {
    const judge = new FakeAccentJudge("Apresentamos um apartamento T três em Lisboa.");
    const result = await runAccentQa(wav, "Apresentamos um apartamento T três em Lisboa.", judge);
    expect(result.ok).toBe(true);
    expect(result.wer).toBe(0);
    expect(result.european_confidence).toBe(95);
    expect(result.notes).toBeNull();
  });

  it("fails when the word error rate exceeds the threshold", async () => {
    const judge = new FakeAccentJudge("Isto não tem nada a ver com o texto original de todo.");
    const result = await runAccentQa(wav, "Apresentamos um apartamento T três em Lisboa.", judge, { maxWer: 0.08 });
    expect(result.ok).toBe(false);
    expect(result.wer).toBeGreaterThan(0.08);
    expect(result.notes).toMatch(/word error rate/);
  });

  it("fails when the European-Portuguese confidence is too low", async () => {
    const judge = {
      transcribe: async () => "Apresentamos um apartamento T três em Lisboa.",
      europeanConfidence: async () => 40,
    };
    const result = await runAccentQa(wav, "Apresentamos um apartamento T três em Lisboa.", judge, {
      minEuropean: 90,
    });
    expect(result.ok).toBe(false);
    expect(result.european_confidence).toBe(40);
    expect(result.notes).toMatch(/confidence/);
  });

  it("returns a null-confidence pass when the judge cannot score the accent", async () => {
    const judge = {
      transcribe: async () => "Apresentamos um apartamento T três em Lisboa.",
      europeanConfidence: async () => null,
    };
    const result = await runAccentQa(wav, "Apresentamos um apartamento T três em Lisboa.", judge);
    expect(result.ok).toBe(true);
    expect(result.european_confidence).toBeNull();
  });

  it("reports transcription-unavailable when the judge returns null", async () => {
    const judge = { transcribe: async () => null, europeanConfidence: async () => 95 };
    const result = await runAccentQa(wav, "qualquer texto", judge);
    expect(result.ok).toBe(false);
    expect(result.wer).toBeNull();
    expect(result.european_confidence).toBeNull();
    expect(result.notes).toBe("transcription unavailable");
  });
});

describe("RunpodWhisperJudge", () => {
  it("delegates transcription to the given transcriber and never scores confidence", async () => {
    const transcriber = { transcribe: async (_wav: Buffer) => "texto transcrito" };
    const judge = new RunpodWhisperJudge(transcriber);
    expect(await judge.transcribe(wav)).toBe("texto transcrito");
    expect(await judge.europeanConfidence(wav, "texto transcrito")).toBeNull();
  });
});
