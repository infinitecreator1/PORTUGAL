import type { GenerationResult, Listing, ValidatorReport } from "@imovel/core";
import { sectionsToText } from "@imovel/core";
import { extractFacts, listingNumericValues, numberTokens, type FactSet } from "./extract";

export interface FactDiff {
  ok: boolean;
  /** Facts present before and absent after. */
  missing: string[];
  /** Facts absent before and present after. */
  added: string[];
  /** Facts present in both with a different count. */
  changed: string[];
}

function toMultiset(items: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const item of items) map.set(item, (map.get(item) ?? 0) + 1);
  return map;
}

function diffMultiset(label: string, before: Map<string, number>, after: Map<string, number>, out: FactDiff): void {
  for (const [key, count] of before) {
    const other = after.get(key) ?? 0;
    if (other === 0) out.missing.push(`${label} ${key}`);
    else if (other !== count) out.changed.push(`${label} ${key} ×${count} → ×${other}`);
  }
  for (const key of after.keys()) if (!before.has(key)) out.added.push(`${label} ${key}`);
}

/** Numbers, money, typology and energy must be identical multisets; places identical sets. */
export function diffFacts(before: FactSet, after: FactSet): FactDiff {
  const out: FactDiff = { ok: true, missing: [], added: [], changed: [] };
  diffMultiset("number", before.numbers, after.numbers, out);
  diffMultiset("money", before.money, after.money, out);
  diffMultiset("typology", toMultiset(before.typology), toMultiset(after.typology), out);
  diffMultiset("energy", toMultiset(before.energy), toMultiset(after.energy), out);
  for (const p of before.places) if (!after.places.has(p)) out.missing.push(`place ${p}`);
  for (const p of after.places) if (!before.places.has(p)) out.added.push(`place ${p}`);
  out.ok = out.missing.length === 0 && out.added.length === 0 && out.changed.length === 0;
  return out;
}

export interface PreValidateOptions {
  /** Upper bound for "looks like a year"; defaults to the current year. */
  currentYear?: number;
  /** Numbers up to this value are always allowed (counts of rooms, minutes, floors). Default 12. */
  smallNumberMax?: number;
}

/**
 * Runs before the gate: every number in the copy must be derivable from the listing.
 * Allowed: listing numbers (and their formatted variants, which normalise to the same key),
 * numbers ≤ 12, and years between 1500 and the current year. Anything else is an invented fact.
 */
export function preValidateFacts(listing: Listing, gen: GenerationResult, opts: PreValidateOptions = {}): ValidatorReport {
  const currentYear = opts.currentYear ?? new Date().getUTCFullYear();
  const smallMax = opts.smallNumberMax ?? 12;
  const allowed = listingNumericValues(listing);
  const text = sectionsToText(gen);
  const issues: string[] = [];
  const offending: string[] = [];
  for (const token of numberTokens(text)) {
    const v = token.value;
    if (allowed.has(v)) continue;
    if (v <= smallMax) continue;
    if (Number.isInteger(v) && v >= 1500 && v <= currentYear) continue;
    offending.push(token.raw.trim());
  }
  const unique = [...new Set(offending)];
  for (const raw of unique) issues.push(`number "${raw}" is not derivable from the listing`);

  const listingTypology = listing.typology;
  const typologies = new Set(extractFacts(text).typology);
  for (const t of typologies) {
    if (listingTypology && t !== listingTypology) issues.push(`typology ${t} differs from listing ${listingTypology}`);
    if (!listingTypology) issues.push(`typology ${t} is not in the listing`);
  }
  const energies = new Set(extractFacts(text).energy);
  for (const e of energies) {
    if (listing.energy_certificate && e !== listing.energy_certificate) issues.push(`energy class ${e} differs from listing ${listing.energy_certificate}`);
    if (!listing.energy_certificate) issues.push(`energy class ${e} is not in the listing`);
  }

  return {
    name: "facts_pre",
    ok: issues.length === 0,
    severity: "hard",
    issues,
    details: { offending: unique, allowed: [...allowed].sort((a, b) => a - b) },
  };
}
