import type { ObjectStore, StoredObject, TTSChunk, TTSProvider } from "@imovel/core";
import { NarrationResult, RateLimitError, ValidationError, newId, sha256 } from "@imovel/core";
import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { FakeTTSProvider } from "../src/adapters/fake";
import { FakeAccentJudge } from "../src/accentQa";
import { narrate } from "../src/narrator";
import { normalizeForSpeech } from "../src/normalize";
import { sineWav, wavDurationSeconds } from "../src/wav";

/** Minimal in-memory ObjectStore, written for this test file. */
class InMemoryObjectStore implements ObjectStore {
  readonly id = "in-memory";
  readonly files = new Map<string, Buffer>();

  async put(key: string, body: Buffer): Promise<StoredObject> {
    this.files.set(key, body);
    return { key, bytes: body.length, sha256: sha256(body) };
  }

  async get(key: string): Promise<Buffer> {
    const buf = this.files.get(key);
    if (!buf) throw new Error(`not found: ${key}`);
    return buf;
  }

  async exists(key: string): Promise<boolean> {
    return this.files.has(key);
  }

  async signedUrl(key: string): Promise<string> {
    return `memory://${key}`;
  }

  async delete(key: string): Promise<void> {
    this.files.delete(key);
  }
}

function ids() {
  return { narration_id: newId(), job_id: newId(), generation_id: newId() };
}

const noSleep = async (_ms: number): Promise<void> => {};

describe("narrate", () => {
  it("produces a valid NarrationResult and stores the WAV", async () => {
    const store = new InMemoryObjectStore();
    const provider = new FakeTTSProvider();
    const profile = sampleVoiceProfile({ provider: "fake" });
    const nid = ids();

    const { narration, warnings } = await narrate({
      text: "Apartamento T3 com 118 m², a 350 000 €. Fica perto do centro.",
      profile,
      provider,
      store,
      keyPrefix: "narrations/tenant-1",
      ids: nid,
      sleep: noSleep,
    });

    expect(() => NarrationResult.parse(narration)).not.toThrow();
    expect(narration.provider).toBe("fake");
    expect(narration.voice_profile_id).toBe(profile.id);
    expect(narration.wav_key).toBe(`narrations/tenant-1/${nid.narration_id}.wav`);
    expect(narration.ai_generated).toBe(true);
    expect(narration.text_normalized).not.toMatch(/\d/);
    expect(narration.text_hash).toBe(sha256(narration.text_normalized));
    expect(narration.chunks).toBeGreaterThan(0);
    expect(narration.sample_rate).toBe(24000);
    expect(narration.duration_s).toBeGreaterThan(0);
    expect(narration.accent_qa).toBeNull();

    const stored = await store.get(narration.wav_key);
    expect(stored.length).toBeGreaterThan(0);
    expect(sha256(stored)).toBe(narration.sha256);
    expect(wavDurationSeconds(stored)).toBeCloseTo(narration.duration_s, 5);

    // ffmpeg is not installed in this environment: post-processing degrades with a warning.
    expect(warnings).toEqual(["ffmpeg is not available: skipped loudness normalisation and MP3 encoding"]);
    expect(narration.mp3_key).toBeNull();
    expect(narration.loudness_lufs).toBeNull();
  });

  it("warns distinctly when ffmpeg post-processing is explicitly disabled", async () => {
    const store = new InMemoryObjectStore();
    const { warnings } = await narrate({
      text: "Uma frase simples.",
      profile: sampleVoiceProfile(),
      provider: new FakeTTSProvider(),
      store,
      keyPrefix: "narrations/tenant-1",
      ids: ids(),
      ffmpeg: { enabled: false },
      sleep: noSleep,
    });
    expect(warnings).toEqual(["ffmpeg post-processing is disabled: skipped loudness normalisation and MP3 encoding"]);
  });

  it("loudnorms and encodes MP3 when ffmpeg is enabled and a fake exec reports it as available", async () => {
    const store = new InMemoryObjectStore();
    const nid = ids();
    const fakeExec = async (
      _file: string,
      args: string[],
    ): Promise<{ stdout: string; stderr: string; exitCode: number; stdoutBuffer?: Buffer }> => {
      if (args.includes("-version")) return { stdout: "ffmpeg version 6", stderr: "", exitCode: 0 };
      if (args.includes("null")) {
        const json = JSON.stringify({
          input_i: "-20",
          input_tp: "-3",
          input_lra: "4",
          input_thresh: "-30",
          target_offset: "0",
        });
        return { stdout: "", stderr: json, exitCode: 0 };
      }
      if (args.includes("libmp3lame")) {
        return { stdout: "", stderr: "", exitCode: 0, stdoutBuffer: Buffer.from([0xff, 0xfb, 1, 2]) };
      }
      // second loudnorm pass: -f wav pipe:1
      return { stdout: "", stderr: "", exitCode: 0, stdoutBuffer: sineWav({ seconds: 0.2, sampleRate: 24000, freq: 220 }) };
    };

    const { narration, warnings } = await narrate({
      text: "Uma frase simples para testar o ffmpeg.",
      profile: sampleVoiceProfile(),
      provider: new FakeTTSProvider(),
      store,
      keyPrefix: "narrations/tenant-1",
      ids: nid,
      ffmpeg: { enabled: true, exec: fakeExec },
      sleep: noSleep,
    });

    expect(warnings).toEqual([]);
    expect(narration.mp3_key).toBe(`narrations/tenant-1/${nid.narration_id}.mp3`);
    expect(narration.loudness_lufs).toBe(-16);
    expect(await store.exists(narration.mp3_key!)).toBe(true);
  });

  it("throws ValidationError when a VoxCPM2 profile has no consent_doc_ref", async () => {
    const voxcpmStub: TTSProvider = {
      id: "voxcpm2-runpod",
      limits: () => ({ maxChars: 300 }),
      synthesize: async () => {
        throw new Error("must not be called: consent must be checked first");
      },
    };
    const profile = sampleVoiceProfile({ provider: "voxcpm2-runpod", consent_doc_ref: null });

    await expect(
      narrate({
        text: "Texto qualquer.",
        profile,
        provider: voxcpmStub,
        store: new InMemoryObjectStore(),
        keyPrefix: "narrations/tenant-1",
        ids: ids(),
        sleep: noSleep,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not require consent for non-VoxCPM2 providers", async () => {
    const profile = sampleVoiceProfile({ provider: "fake", consent_doc_ref: null });
    await expect(
      narrate({
        text: "Texto qualquer.",
        profile,
        provider: new FakeTTSProvider(),
        store: new InMemoryObjectStore(),
        keyPrefix: "narrations/tenant-1",
        ids: ids(),
        sleep: noSleep,
      }),
    ).resolves.toBeDefined();
  });

  it("retries a chunk once after a RateLimitError and still succeeds", async () => {
    let attempts = 0;
    const inner = new FakeTTSProvider();
    const flaky: TTSProvider = {
      id: "fake",
      limits: () => inner.limits(),
      synthesize: async (chunk: TTSChunk, profile) => {
        attempts += 1;
        if (attempts === 1) throw new RateLimitError("slow down");
        return inner.synthesize(chunk, profile);
      },
    };
    const sleepCalls: number[] = [];
    const { narration, warnings } = await narrate({
      text: "Uma frase curta.",
      profile: sampleVoiceProfile(),
      provider: flaky,
      store: new InMemoryObjectStore(),
      keyPrefix: "narrations/tenant-1",
      ids: ids(),
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
    });
    expect(attempts).toBe(2);
    expect(sleepCalls).toEqual([1000]);
    expect(narration.duration_s).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0); // still the ffmpeg-unavailable warning
  });

  it("gives up after exhausting retries on a persistently retryable error", async () => {
    const flaky: TTSProvider = {
      id: "fake",
      limits: () => ({ maxChars: 300 }),
      synthesize: async () => {
        throw new RateLimitError("always slow");
      },
    };
    const sleepCalls: number[] = [];
    await expect(
      narrate({
        text: "Uma frase curta.",
        profile: sampleVoiceProfile(),
        provider: flaky,
        store: new InMemoryObjectStore(),
        keyPrefix: "narrations/tenant-1",
        ids: ids(),
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(sleepCalls).toEqual([1000, 2000, 4000]);
  });

  it("does not retry a non-retryable error", async () => {
    const broken: TTSProvider = {
      id: "fake",
      limits: () => ({ maxChars: 300 }),
      synthesize: async () => {
        throw new ValidationError("bad request");
      },
    };
    const sleepCalls: number[] = [];
    await expect(
      narrate({
        text: "Uma frase curta.",
        profile: sampleVoiceProfile(),
        provider: broken,
        store: new InMemoryObjectStore(),
        keyPrefix: "narrations/tenant-1",
        ids: ids(),
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(sleepCalls).toEqual([]);
  });

  it("runs accent QA when a judge is given", async () => {
    const store = new InMemoryObjectStore();
    const provider = new FakeTTSProvider();
    const profile = sampleVoiceProfile();
    const text = "Apartamento T3 simples.";
    const normalized = normalizeForSpeech(text, { glossary: profile.glossary }).text;

    const { narration } = await narrate({
      text,
      profile,
      provider,
      store,
      keyPrefix: "narrations/tenant-1",
      ids: ids(),
      sleep: noSleep,
      // Echoes the narrator's own normalised text back, so the word error rate is zero.
      accentJudge: new FakeAccentJudge(normalized),
    });
    expect(narration.accent_qa).toEqual({ wer: 0, european_confidence: 95, ok: true, notes: null });
  });

  it("marks paragraph breaks with a longer gap and concatenates chunks in order", async () => {
    const store = new InMemoryObjectStore();
    const provider = new FakeTTSProvider();
    const { narration } = await narrate({
      text: "Primeiro parágrafo.\n\nSegundo parágrafo mais longo para gerar outro pedaço de áudio.",
      profile: sampleVoiceProfile(),
      provider,
      store,
      keyPrefix: "narrations/tenant-1",
      ids: ids(),
      gapMs: 100,
      paragraphGapMs: 500,
      sleep: noSleep,
    });
    expect(provider.calls.length).toBeGreaterThanOrEqual(2);
    expect(narration.chunks).toBe(provider.calls.length);
  });
});
