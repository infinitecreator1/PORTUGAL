import type {
  CallOptions,
  ChatRequest,
  DescriptionGenerator,
  GenerationOutput,
  GenerationProfile,
  LLMClient,
  Listing,
} from "@imovel/core";
import { GenerationResult, seedFrom } from "@imovel/core";
import { completeJson } from "./json";
import { GENERATE_SYSTEM_PROMPT, buildGenerateUserMessage } from "./prompts/generate";

export interface GeminiDescriptionGeneratorOptions {
  client: LLMClient;
  /** Overrides the client's default model. */
  model?: string;
}

/** Step ① generate. Designed for Gemini but works with any `LLMClient` (including the fake). */
export class GeminiDescriptionGenerator implements DescriptionGenerator {
  readonly id = "gemini";
  private readonly client: LLMClient;
  private readonly model: string | undefined;

  constructor(opts: GeminiDescriptionGeneratorOptions) {
    this.client = opts.client;
    this.model = opts.model;
  }

  async generate(
    listing: Listing,
    profile: GenerationProfile,
    extraConstraints: string[] = [],
    opts?: CallOptions,
  ): Promise<GenerationOutput> {
    const req: ChatRequest = {
      ...(this.model ? { model: this.model } : {}),
      messages: [
        { role: "system", content: GENERATE_SYSTEM_PROMPT },
        { role: "user", content: buildGenerateUserMessage(listing, profile, extraConstraints) },
      ],
      temperature: profile.temperature,
      top_p: 0.95,
      max_tokens: 1800,
      seed: seedFrom(`${listing.id}:${extraConstraints.length}`),
      response_format: { type: "json_object" },
      extra: { reasoning_effort: "low", purpose: "generate" },
    };
    const { data, response } = await completeJson(this.client, req, GenerationResult, { opts });
    return {
      result: data,
      usage: response.usage,
      model: response.model,
      provider: this.client.provider,
      latency_ms: response.latency_ms,
    };
  }
}
