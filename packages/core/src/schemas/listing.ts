import { z } from "zod";

export const SourceId = z.enum([
  "casafari",
  "imovirtual-parsebot",
  "idealista-piloterr",
  "idealista-parsebot",
  "idealista-official",
  "csv-feed",
  "xml-feed",
  "api",
]);
export type SourceId = z.infer<typeof SourceId>;

export const Ownership = z.enum(["owned", "represented", "third_party"]);
export type Ownership = z.infer<typeof Ownership>;

export const Transaction = z.enum(["sale", "rent"]);
export type Transaction = z.infer<typeof Transaction>;

export const PropertyType = z.enum([
  "apartamento",
  "moradia",
  "terreno",
  "loja",
  "escritorio",
  "armazem",
  "predio",
  "quinta",
  "outro",
]);
export type PropertyType = z.infer<typeof PropertyType>;

export const Typology = z.enum(["T0", "T1", "T2", "T3", "T4", "T5", "T6+"]);
export type Typology = z.infer<typeof Typology>;

export const EnergyClass = z.enum(["A+", "A", "B", "B-", "C", "D", "E", "F", "isento"]);
export type EnergyClass = z.infer<typeof EnergyClass>;

export const Condition = z.enum(["novo", "usado", "renovado", "em_construcao", "para_recuperar"]);
export type Condition = z.infer<typeof Condition>;

export const PricePeriod = z.enum(["total", "month"]);
export type PricePeriod = z.infer<typeof PricePeriod>;

export const LanguageTag = z.enum(["pt-PT", "pt-BR", "en", "other"]);
export type LanguageTag = z.infer<typeof LanguageTag>;

export const Location = z.object({
  district: z.string().min(1),
  municipality: z.string().min(1),
  parish: z.string().nullable().default(null),
  neighbourhood: z.string().nullable().default(null),
  address: z.string().nullable().default(null),
  postal_code: z
    .string()
    .regex(/^\d{4}-\d{3}$/, "Portuguese postal code is dddd-ddd")
    .nullable()
    .default(null),
  lat: z.number().min(-90).max(90).nullable().default(null),
  lng: z.number().min(-180).max(180).nullable().default(null),
});
export type Location = z.infer<typeof Location>;

export const Area = z.object({
  gross_m2: z.number().positive().nullable().default(null),
  useful_m2: z.number().positive().nullable().default(null),
  plot_m2: z.number().positive().nullable().default(null),
});
export type Area = z.infer<typeof Area>;

export const Photo = z.object({
  url: z.string().url(),
  room: z.string().nullable().default(null),
  order: z.number().int().nonnegative().default(0),
  stored_key: z.string().nullable().default(null),
});
export type Photo = z.infer<typeof Photo>;

export const AgentInfo = z.object({
  name: z.string().nullable().default(null),
  agency: z.string().nullable().default(null),
  agency_id: z.string().nullable().default(null),
  phone: z.string().nullable().default(null),
  email: z.string().email().nullable().default(null),
});
export type AgentInfo = z.infer<typeof AgentInfo>;

/** Fields a source adapter or the import API produces. Ids, tenant and hashes are assigned by the pipeline. */
export const ListingInput = z.object({
  source: SourceId,
  source_id: z.string().min(1),
  source_url: z.string().url().nullable().default(null),
  ownership: Ownership.default("third_party"),
  consent_ref: z.string().nullable().default(null),
  transaction: Transaction,
  property_type: PropertyType,
  typology: Typology.nullable().default(null),
  price: z.number().positive().nullable().default(null),
  currency: z.literal("EUR").default("EUR"),
  price_period: PricePeriod.nullable().default(null),
  area: Area.default({}),
  floor: z.string().nullable().default(null),
  year_built: z.number().int().min(1500).max(2100).nullable().default(null),
  bathrooms: z.number().int().nonnegative().nullable().default(null),
  condition: Condition.nullable().default(null),
  location: Location,
  features: z.array(z.string()).default([]),
  features_raw: z.array(z.string()).default([]),
  energy_certificate: EnergyClass.nullable().default(null),
  photos: z.array(Photo).default([]),
  agent: AgentInfo.default({}),
  description_original: z.string().nullable().default(null),
  language_original: LanguageTag.nullable().default(null),
  raw_ref: z.string().nullable().default(null),
});
export type ListingInput = z.infer<typeof ListingInput>;
export type ListingInputRaw = z.input<typeof ListingInput>;

export const Listing = ListingInput.extend({
  id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  fetched_at: z.string().datetime(),
  content_hash: z.string().length(64),
  fingerprint: z.string().nullable().default(null),
});
export type Listing = z.infer<typeof Listing>;

export const ListingVersion = z.object({
  id: z.string().uuid(),
  listing_id: z.string().uuid(),
  content_hash: z.string().length(64),
  snapshot: ListingInput,
  created_at: z.string().datetime(),
});
export type ListingVersion = z.infer<typeof ListingVersion>;

/** Fields whose change is "material": a new version and a new job. */
export const MATERIAL_FIELDS = [
  "transaction",
  "typology",
  "price",
  "price_period",
  "area",
  "floor",
  "energy_certificate",
  "features",
  "condition",
  "location",
  "description_original",
] as const satisfies readonly (keyof ListingInput)[];
