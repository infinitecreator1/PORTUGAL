import { z } from "zod";

export const Tone = z.enum(["profissional", "premium", "familiar", "investidor"]);
export type Tone = z.infer<typeof Tone>;

export const Audience = z.enum(["compradores", "arrendatarios", "investidores", "estrangeiros"]);
export type Audience = z.infer<typeof Audience>;

export const TargetLength = z.enum(["curta", "media", "longa"]);
export type TargetLength = z.infer<typeof TargetLength>;

/** Character targets for `descricao` per target length. */
export const DESCRIPTION_LENGTH: Record<TargetLength, { min: number; max: number }> = {
  curta: { min: 600, max: 1000 },
  media: { min: 900, max: 1600 },
  longa: { min: 1400, max: 2400 },
};

export const GenerationProfile = z.object({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  name: z.string().min(1),
  model: z.string().default("gemini-2.5-pro"),
  temperature: z.number().min(0).max(1).default(0.7),
  target_length: TargetLength.default("media"),
  tone: Tone.default("profissional"),
  audience: Audience.default("compradores"),
  brand_name: z.string().max(120).nullable().default(null),
  brand_voice_notes: z.string().max(1500).nullable().default(null),
  cta_template: z.string().max(300).nullable().default(null),
  use_photo_insights: z.boolean().default(false),
  forbidden_claims: z.array(z.string()).default([]),
});
export type GenerationProfile = z.infer<typeof GenerationProfile>;

export const SECTION_KEYS = [
  "titulo",
  "resumo",
  "descricao",
  "destaques",
  "localizacao",
  "cta",
  "narracao",
] as const;
export type SectionKey = (typeof SECTION_KEYS)[number];
export const SectionKey = z.enum(SECTION_KEYS);

/** Structured copy produced by the generator and edited by the gate. */
export const GenerationResult = z.object({
  titulo: z.string().min(20).max(90),
  resumo: z.string().min(80).max(240),
  descricao: z.string().min(400).max(2600),
  destaques: z.array(z.string().min(8).max(70)).min(4).max(8),
  localizacao: z.string().min(80).max(600),
  cta: z.string().min(20).max(180),
  /** Spoken-register script, 110–160 words, no lists or symbols. This is what gets voiced. */
  narracao: z.string().min(300).max(1400),
  /** Listing field paths the model reports having used. */
  factos_usados: z.array(z.string()).default([]),
});
export type GenerationResult = z.infer<typeof GenerationResult>;

export const GenerationRecord = z.object({
  id: z.string().uuid(),
  job_id: z.string().uuid(),
  listing_id: z.string().uuid(),
  attempt: z.number().int().nonnegative(),
  loop: z.number().int().nonnegative(),
  model: z.string(),
  provider: z.string(),
  result: GenerationResult,
  usage: z.object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    reasoning_tokens: z.number().int().nonnegative().optional(),
  }),
  latency_ms: z.number().nonnegative(),
  text_hash: z.string().length(64),
  created_at: z.string().datetime(),
});
export type GenerationRecord = z.infer<typeof GenerationRecord>;

/** Joins the sections in reading order; used for hashing and for whole-text validators. */
export function sectionsToText(r: GenerationResult): string {
  return [
    r.titulo,
    r.resumo,
    r.descricao,
    r.destaques.join("\n"),
    r.localizacao,
    r.cta,
    r.narracao,
  ].join("\n\n");
}
