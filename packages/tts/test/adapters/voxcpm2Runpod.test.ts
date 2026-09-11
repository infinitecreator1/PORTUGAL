import { RateLimitError, UpstreamError } from "@imovel/core";
import { sampleVoiceProfile } from "@imovel/core/fixtures";
import { describe, expect, it, vi } from "vitest";
import { VoxCpm2RunpodProvider } from "../../src/adapters/voxcpm2Runpod";
import { parseWav, sineWav } from "../../src/wav";

const wav = sineWav({ seconds: 0.1, sampleRate: 48000, freq: 220 });
const wavB64 = wav.toString("base64");

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("VoxCpm2RunpodProvider.synthesize", () => {
  it("returns the WAV straight away on COMPLETED", async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      calls.push(String(url));
      return json({ id: "job1", status: "COMPLETED", output: { audio_b64: wavB64, sample_rate: 48000, gpu_seconds: 0.7, format: "wav" } });
    });
    const provider = new VoxCpm2RunpodProvider({ apiKey: "k", endpointId: "ep1", fetch: fetchFn as unknown as typeof fetch });
    const profile = sampleVoiceProfile({ provider: "voxcpm2-runpod" });

    const audio = await provider.synthesize({ index: 0, text: "Olá." }, profile);

    expect(audio.sampleRate).toBe(48000);
    expect(audio.usage.gpu_seconds).toBe(0.7);
    expect(audio.usage.chars).toBe("Olá.".length);
    expect(parseWav(audio.wav).sampleRate).toBe(48000);
    expect(calls).toEqual(["https://api.runpod.ai/v2/ep1/runsync"]);

    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string) as {
      input: Record<string, unknown>;
    };
    expect(body.input.op).toBe("tts");
    expect(body.input.text).toBe(`${profile.style_prompt}Olá.`);
    expect(body.input.seed).toBe(profile.seed + 0);
    expect(body.input.sample_rate).toBe(48000);
    expect(body.input.cfg_value).toBe(profile.cfg_value);
    expect(body.input.inference_timesteps).toBe(profile.inference_timesteps);
  });

  it("polls /status while IN_QUEUE / IN_PROGRESS, then returns on COMPLETED", async () => {
    const statuses = ["IN_QUEUE", "IN_PROGRESS", "COMPLETED"];
    const fetchFn = vi.fn(async (url: string | URL) => {
      if (String(url).endsWith("/runsync")) return json({ id: "job2", status: "IN_QUEUE" });
      const status = statuses.shift();
      return status === "COMPLETED"
        ? json({ id: "job2", status: "COMPLETED", output: { audio_b64: wavB64, sample_rate: 48000, format: "wav" } })
        : json({ id: "job2", status });
    });
    const provider = new VoxCpm2RunpodProvider({
      apiKey: "k",
      endpointId: "ep2",
      fetch: fetchFn as unknown as typeof fetch,
      pollIntervalMs: 0,
    });
    const audio = await provider.synthesize({ index: 0, text: "Olá." }, sampleVoiceProfile());
    expect(audio.sampleRate).toBe(48000);
    // one /runsync + two /status polls before the final COMPLETED response.
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("wraps a pcm16 output into a WAV", async () => {
    const pcm = Buffer.from(new Int16Array([1, 2, 3, 4]).buffer);
    const fetchFn = vi.fn(async () =>
      json({ id: "job3", status: "COMPLETED", output: { audio_b64: pcm.toString("base64"), sample_rate: 48000, format: "pcm16" } }),
    );
    const provider = new VoxCpm2RunpodProvider({ apiKey: "k", endpointId: "ep3", fetch: fetchFn as unknown as typeof fetch });
    const audio = await provider.synthesize({ index: 0, text: "Olá." }, sampleVoiceProfile());
    const parsed = parseWav(audio.wav);
    expect(parsed.pcm.equals(pcm)).toBe(true);
    expect(parsed.sampleRate).toBe(48000);
  });

  it("fetches and base64-encodes the reference audio when the profile has one", async () => {
    const refBuf = Buffer.from([9, 8, 7, 6]);
    const fetchFn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      json({ id: "job4", status: "COMPLETED", output: { audio_b64: wavB64, sample_rate: 48000, format: "wav" } }),
    );
    const getReferenceAudio = vi.fn(async (key: string) => {
      expect(key).toBe("voices/lisboa-prime/ines-ref.wav");
      return refBuf;
    });
    const provider = new VoxCpm2RunpodProvider({
      apiKey: "k",
      endpointId: "ep4",
      fetch: fetchFn as unknown as typeof fetch,
      getReferenceAudio,
    });
    await provider.synthesize({ index: 0, text: "Olá." }, sampleVoiceProfile());
    expect(getReferenceAudio).toHaveBeenCalledOnce();
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string) as {
      input: Record<string, unknown>;
    };
    expect(body.input.reference_audio_b64).toBe(refBuf.toString("base64"));
  });

  it("throws UpstreamError when the job status is FAILED", async () => {
    const fetchFn = vi.fn(async () => json({ id: "job5", status: "FAILED", error: "model crashed" }));
    const provider = new VoxCpm2RunpodProvider({ apiKey: "k", endpointId: "ep5", fetch: fetchFn as unknown as typeof fetch });
    await expect(provider.synthesize({ index: 0, text: "Olá." }, sampleVoiceProfile())).rejects.toBeInstanceOf(
      UpstreamError,
    );
  });

  it("maps a 429 response to RateLimitError", async () => {
    const fetchFn = vi.fn(async () => new Response("rate limited", { status: 429 }));
    const provider = new VoxCpm2RunpodProvider({ apiKey: "k", endpointId: "ep6", fetch: fetchFn as unknown as typeof fetch });
    await expect(provider.synthesize({ index: 0, text: "Olá." }, sampleVoiceProfile())).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("reports the maxChars limit", () => {
    const provider = new VoxCpm2RunpodProvider({ apiKey: "k", endpointId: "ep" });
    expect(provider.limits().maxChars).toBeGreaterThan(0);
  });
});

describe("VoxCpm2RunpodProvider.transcribe", () => {
  it("submits op:'transcribe' and returns the text", async () => {
    const fetchFn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      json({ id: "job7", status: "COMPLETED", output: { text: "Olá, mundo." } }),
    );
    const provider = new VoxCpm2RunpodProvider({ apiKey: "k", endpointId: "ep7", fetch: fetchFn as unknown as typeof fetch });
    const text = await provider.transcribe(wav);
    expect(text).toBe("Olá, mundo.");
    const body = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string) as {
      input: Record<string, unknown>;
    };
    expect(body.input.op).toBe("transcribe");
    expect(body.input.audio_b64).toBe(wav.toString("base64"));
  });
});
