import { z } from "zod";

const optionalString = z
  .string()
  .transform((s) => (s.trim() === "" ? undefined : s.trim()))
  .optional();

const optionalUrl = optionalString.pipe(z.string().url().optional());

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  DEFAULT_TENANT_ID: z.string().uuid().default("00000000-0000-4000-8000-000000000001"),

  DATABASE_URL: optionalString,

  LLM_PROVIDER: z.enum(["gemini", "lovable-gateway", "fake"]).default("fake"),
  GATE_EDITOR: z.enum(["amalia", "gemini", "fake"]).default("fake"),
  TTS_PROVIDER: z
    .enum(["voxcpm2-runpod", "voxcpm2-http", "elevenlabs", "gemini-cloud-tts", "fake"])
    .default("fake"),
  STORAGE_PROVIDER: z.enum(["supabase-s3", "fs"]).default("fs"),
  FS_STORAGE_DIR: z.string().default("./out/storage"),

  GEN_MODEL: z.string().default("gemini-2.5-pro"),
  JUDGE_MODEL: z.string().default("gemini-2.5-flash"),
  AMALIA_MODEL: z.string().default("amalia-llm/AMALIA-9B-0626-DPO"),

  GEMINI_API_KEY: optionalString,
  GEMINI_BASE_URL: z.string().url().default("https://generativelanguage.googleapis.com/v1beta/openai"),
  LOVABLE_API_KEY: optionalString,
  LOVABLE_BASE_URL: z.string().url().default("https://ai.gateway.lovable.dev/v1"),

  RUNPOD_API_KEY: optionalString,
  RUNPOD_AMALIA_ENDPOINT_ID: optionalString,
  RUNPOD_VOXCPM2_ENDPOINT_ID: optionalString,
  VOXCPM2_HTTP_BASE_URL: optionalUrl,
  ELEVENLABS_API_KEY: optionalString,
  GOOGLE_TTS_API_KEY: optionalString,

  SUPABASE_S3_ENDPOINT: optionalUrl,
  SUPABASE_S3_REGION: z.string().default("eu-west-1"),
  SUPABASE_S3_ACCESS_KEY_ID: optionalString,
  SUPABASE_S3_SECRET_ACCESS_KEY: optionalString,
  SUPABASE_S3_BUCKET: z.string().default("pipeline-artifacts"),

  PARSEBOT_API_KEY: optionalString,
  PILOTERR_API_KEY: optionalString,
  CASAFARI_API_KEY: optionalString,
  CASAFARI_BASE_URL: z.string().url().default("https://api.casafari.com"),

  WEBHOOK_SIGNING_SECRET: z.string().default("change-me"),

  OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
  OTEL_SERVICE_NAME: z.string().default("imovel-em-voz"),
});

export type Config = z.infer<typeof ConfigSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  ${issues.join("\n  ")}`);
    this.name = "ConfigError";
  }
}

/**
 * Loads and validates configuration from an env-like object. Fails fast with every
 * problem listed. Provider-specific keys are checked against the selected providers.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(
      parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    );
  }
  const cfg = parsed.data;
  const missing: string[] = [];
  const need = (cond: boolean, key: keyof Config, why: string) => {
    if (cond && !cfg[key]) missing.push(`${key} is required when ${why}`);
  };

  need(cfg.LLM_PROVIDER === "gemini", "GEMINI_API_KEY", "LLM_PROVIDER=gemini");
  need(cfg.LLM_PROVIDER === "lovable-gateway", "LOVABLE_API_KEY", "LLM_PROVIDER=lovable-gateway");
  need(cfg.GATE_EDITOR === "amalia", "RUNPOD_API_KEY", "GATE_EDITOR=amalia");
  need(cfg.GATE_EDITOR === "amalia", "RUNPOD_AMALIA_ENDPOINT_ID", "GATE_EDITOR=amalia");
  need(cfg.GATE_EDITOR === "gemini", "GEMINI_API_KEY", "GATE_EDITOR=gemini");
  need(cfg.TTS_PROVIDER === "voxcpm2-runpod", "RUNPOD_API_KEY", "TTS_PROVIDER=voxcpm2-runpod");
  need(
    cfg.TTS_PROVIDER === "voxcpm2-runpod",
    "RUNPOD_VOXCPM2_ENDPOINT_ID",
    "TTS_PROVIDER=voxcpm2-runpod",
  );
  need(cfg.TTS_PROVIDER === "voxcpm2-http", "VOXCPM2_HTTP_BASE_URL", "TTS_PROVIDER=voxcpm2-http");
  need(cfg.TTS_PROVIDER === "elevenlabs", "ELEVENLABS_API_KEY", "TTS_PROVIDER=elevenlabs");
  need(cfg.TTS_PROVIDER === "gemini-cloud-tts", "GOOGLE_TTS_API_KEY", "TTS_PROVIDER=gemini-cloud-tts");
  need(cfg.STORAGE_PROVIDER === "supabase-s3", "SUPABASE_S3_ENDPOINT", "STORAGE_PROVIDER=supabase-s3");
  need(
    cfg.STORAGE_PROVIDER === "supabase-s3",
    "SUPABASE_S3_ACCESS_KEY_ID",
    "STORAGE_PROVIDER=supabase-s3",
  );
  need(
    cfg.STORAGE_PROVIDER === "supabase-s3",
    "SUPABASE_S3_SECRET_ACCESS_KEY",
    "STORAGE_PROVIDER=supabase-s3",
  );

  if (missing.length) throw new ConfigError(missing);
  return cfg;
}

/** RunPod OpenAI-compatible base URL for a serverless vLLM endpoint. */
export function runpodOpenAiBaseUrl(endpointId: string): string {
  return `https://api.runpod.ai/v2/${endpointId}/openai/v1`;
}

/** RunPod queue-based endpoint base URL (runsync / run / status). */
export function runpodEndpointBaseUrl(endpointId: string): string {
  return `https://api.runpod.ai/v2/${endpointId}`;
}
