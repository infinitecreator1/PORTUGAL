import { z } from "zod";

export const TTSProviderId = z.enum([
  "voxcpm2-runpod",
  "voxcpm2-http",
  "elevenlabs",
  "gemini-cloud-tts",
  "fake",
]);
export type TTSProviderId = z.infer<typeof TTSProviderId>;

export const DEFAULT_STYLE_PROMPT =
  "(voz adulta, tom profissional e caloroso, sotaque de Lisboa, ritmo moderado)";

export const VoiceProfile = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid().nullable().default(null),
  name: z.string().min(1),
  provider: TTSProviderId,
  /** Provider-specific voice reference: ElevenLabs voice_id, Gemini-TTS voice name, or null for cloning. */
  voice_ref: z.string().nullable().default(null),
  /** Object-store key of the reference WAV used for VoxCPM2 cloning. */
  reference_audio_key: z.string().nullable().default(null),
  /** Exact transcript of the reference audio (VoxCPM2 "ultimate cloning"). */
  reference_transcript: z.string().nullable().default(null),
  style_prompt: z.string().max(500).default(DEFAULT_STYLE_PROMPT),
  language_code: z.literal("pt-PT").default("pt-PT"),
  speaking_rate: z.number().min(0.7).max(1.3).default(1.0),
  seed: z.number().int().nonnegative().default(42),
  cfg_value: z.number().min(1).max(4).default(2.0),
  inference_timesteps: z.number().int().min(4).max(32).default(10),
  /** Per-profile pronunciation respellings applied before synthesis. */
  glossary: z.record(z.string()).default({}),
  /** Reference to the signed consent of the cloned speaker. Required before use. */
  consent_doc_ref: z.string().nullable().default(null),
});
export type VoiceProfile = z.infer<typeof VoiceProfile>;

export const AccentQa = z.object({
  wer: z.number().min(0).nullable().default(null),
  european_confidence: z.number().min(0).max(100).nullable().default(null),
  ok: z.boolean(),
  notes: z.string().nullable().default(null),
});
export type AccentQa = z.infer<typeof AccentQa>;

export const NarrationResult = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  generation_id: z.string().uuid(),
  provider: TTSProviderId,
  voice_profile_id: z.string().uuid(),
  text_normalized: z.string(),
  text_hash: z.string().length(64),
  chunks: z.number().int().positive(),
  wav_key: z.string(),
  mp3_key: z.string().nullable().default(null),
  duration_s: z.number().nonnegative(),
  loudness_lufs: z.number().nullable().default(null),
  sample_rate: z.number().int().positive(),
  sha256: z.string().length(64),
  accent_qa: AccentQa.nullable().default(null),
  ai_generated: z.literal(true).default(true),
  usage: z.object({
    chars: z.number().int().nonnegative(),
    gpu_seconds: z.number().nonnegative().nullable().default(null),
  }),
  created_at: z.string().datetime(),
});
export type NarrationResult = z.infer<typeof NarrationResult>;
