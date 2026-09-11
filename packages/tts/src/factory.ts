import type { Config, TTSProvider } from "@imovel/core";
import { ConfigError } from "@imovel/core";
import { ElevenLabsProvider } from "./adapters/elevenlabs";
import { FakeTTSProvider } from "./adapters/fake";
import { GeminiCloudTtsProvider } from "./adapters/geminiCloudTts";
import { VoxCpm2HttpProvider } from "./adapters/voxcpm2Http";
import { VoxCpm2RunpodProvider } from "./adapters/voxcpm2Runpod";

export interface TTSFactoryDeps {
  fetch?: typeof fetch;
  getReferenceAudio?: (key: string) => Promise<Buffer>;
}

function required(value: string | undefined, message: string): string {
  if (!value) throw new ConfigError([message]);
  return value;
}

/** Picks the `TTSProvider` implementation named by `cfg.TTS_PROVIDER`. */
export function createTTSProvider(cfg: Config, deps: TTSFactoryDeps = {}): TTSProvider {
  switch (cfg.TTS_PROVIDER) {
    case "voxcpm2-runpod":
      return new VoxCpm2RunpodProvider({
        apiKey: required(cfg.RUNPOD_API_KEY, "RUNPOD_API_KEY is required for TTS_PROVIDER=voxcpm2-runpod"),
        endpointId: required(
          cfg.RUNPOD_VOXCPM2_ENDPOINT_ID,
          "RUNPOD_VOXCPM2_ENDPOINT_ID is required for TTS_PROVIDER=voxcpm2-runpod",
        ),
        fetch: deps.fetch,
        getReferenceAudio: deps.getReferenceAudio,
      });
    case "voxcpm2-http":
      return new VoxCpm2HttpProvider({
        baseUrl: required(
          cfg.VOXCPM2_HTTP_BASE_URL,
          "VOXCPM2_HTTP_BASE_URL is required for TTS_PROVIDER=voxcpm2-http",
        ),
        fetch: deps.fetch,
        getReferenceAudio: deps.getReferenceAudio,
      });
    case "elevenlabs":
      return new ElevenLabsProvider({
        apiKey: required(cfg.ELEVENLABS_API_KEY, "ELEVENLABS_API_KEY is required for TTS_PROVIDER=elevenlabs"),
        fetch: deps.fetch,
      });
    case "gemini-cloud-tts":
      return new GeminiCloudTtsProvider({
        apiKey: required(
          cfg.GOOGLE_TTS_API_KEY,
          "GOOGLE_TTS_API_KEY is required for TTS_PROVIDER=gemini-cloud-tts",
        ),
        fetch: deps.fetch,
      });
    case "fake":
      return new FakeTTSProvider();
  }
}
