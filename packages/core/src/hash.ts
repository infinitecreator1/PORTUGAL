import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ListingInput } from "./schemas/listing";
import { MATERIAL_FIELDS } from "./schemas/listing";
import { stripDiacritics } from "./text";

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hmacSha256(secret: string, input: string): string {
  return createHmac("sha256", secret).update(input).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** JSON with sorted object keys and arrays kept in order, for stable hashing. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Hash of the material listing fields; photos and fetched_at are excluded on purpose. */
export function computeContentHash(listing: ListingInput): string {
  const material: Record<string, unknown> = {};
  for (const field of MATERIAL_FIELDS) {
    const v = listing[field];
    material[field] = field === "features" && Array.isArray(v) ? [...(v as string[])].sort() : v;
  }
  return sha256(canonicalJson(material));
}

/** Lower-case, accent-free, abbreviation-expanded street address for near-duplicate matching. */
export function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  let s = stripDiacritics(address.toLowerCase());
  const abbreviations: [RegExp, string][] = [
    [/\bav\.?\b/g, "avenida"],
    [/\br\.?\b/g, "rua"],
    [/\bpc\.?\b|\bpç\.?\b|\bpraca\b/g, "praca"],
    [/\blg\.?\b/g, "largo"],
    [/\btv\.?\b/g, "travessa"],
    [/\best\.?\b/g, "estrada"],
    [/\bn\.?[ºo°]\s*/g, "n "],
    [/\bs\.\s*/g, "sao "],
    [/\bsto\.?\s*/g, "santo "],
    [/\bsta\.?\s*/g, "santa "],
  ];
  for (const [re, rep] of abbreviations) s = s.replace(re, rep);
  s = s.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  return s || null;
}

/**
 * Coarse cross-source fingerprint: same transaction, typology, municipality and parish,
 * with the normalised address when present. Range checks on area and price happen in SQL.
 */
export function computeFingerprint(listing: ListingInput): string {
  const parts = [
    listing.transaction,
    listing.typology ?? "-",
    stripDiacritics(listing.location.municipality.toLowerCase()),
    stripDiacritics((listing.location.parish ?? "-").toLowerCase()),
    normalizeAddress(listing.location.address) ?? "-",
  ];
  return sha256(parts.join("|")).slice(0, 32);
}

export function idempotencyKey(parts: Array<string | number | null | undefined>): string {
  return sha256(parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|"));
}
