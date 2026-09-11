import { ConfigError, loadConfig } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { ElevenLabsProvider } from "../src/adapters/elevenlabs";
import { FakeTTSProvider } from "../src/adapters/fake";
import { GeminiCloudTtsProvider } from "../src/adapters/geminiCloudTts";
import { VoxCpm2HttpProvider } from "../src/adapters/voxcpm2Http";
import { VoxCpm2RunpodProvider } from "../src/adapters/voxcpm2Runpod";
import { createTTSProvider } from "../src/factory";

describe("createTTSProvider", () => {
  it("defaults to the fake provider", () => {
    expect(createTTSProvider(loadConfig({}))).toBeInstanceOf(FakeTTSProvider);
  });

  it("builds the RunPod VoxCPM2 provider", () => {
    const cfg = loadConfig({
      TTS_PROVIDER: "voxcpm2-runpod",
      RUNPOD_API_KEY: "rk",
      RUNPOD_VOXCPM2_ENDPOINT_ID: "ep1",
    });
    const provider = createTTSProvider(cfg);
    expect(provider).toBeInstanceOf(VoxCpm2RunpodProvider);
    expect(provider.id).toBe("voxcpm2-runpod");
  });

  it("builds the VoxCPM2 HTTP (vLLM-Omni) provider", () => {
    const cfg = loadConfig({ TTS_PROVIDER: "voxcpm2-http", VOXCPM2_HTTP_BASE_URL: "http://pod:8000" });
    expect(createTTSProvider(cfg)).toBeInstanceOf(VoxCpm2HttpProvider);
  });

  it("builds the ElevenLabs provider", () => {
    const cfg = loadConfig({ TTS_PROVIDER: "elevenlabs", ELEVENLABS_API_KEY: "xi" });
    expect(createTTSProvider(cfg)).toBeInstanceOf(ElevenLabsProvider);
  });

  it("builds the Gemini Cloud TTS provider", () => {
    const cfg = loadConfig({ TTS_PROVIDER: "gemini-cloud-tts", GOOGLE_TTS_API_KEY: "g" });
    expect(createTTSProvider(cfg)).toBeInstanceOf(GeminiCloudTtsProvider);
  });

  it("guards against a missing key even if the caller built Config without loadConfig's checks", () => {
    const cfg = { ...loadConfig({}), TTS_PROVIDER: "elevenlabs" as const };
    expect(() => createTTSProvider(cfg)).toThrow(ConfigError);
  });

  it("passes fetch and getReferenceAudio through to the provider", () => {
    const cfg = loadConfig({
      TTS_PROVIDER: "voxcpm2-runpod",
      RUNPOD_API_KEY: "rk",
      RUNPOD_VOXCPM2_ENDPOINT_ID: "ep1",
    });
    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
    const getReferenceAudio = async (_key: string) => Buffer.alloc(0);
    expect(() => createTTSProvider(cfg, { fetch: fetchImpl, getReferenceAudio })).not.toThrow();
  });
});
