/**
 * Fact extraction: the numbers, money, typology, energy class and place names a text carries.
 * The gate compares the sets before and after the editor; the generator's pre-validator compares
 * the copy with the listing.
 */
import type { Listing } from "@imovel/core";
import { stripDiacritics } from "@imovel/core";

export interface FactSet {
  /** Multiset of normalised numeric tokens: "350 000" → "350000", "118,5" → "118.5", "118 m²" → "118m2". */
  numbers: Map<string, number>;
  /** Multiset of amounts followed by €, euros or EUR, keyed like `numbers`. */
  money: Map<string, number>;
  /** Typology tokens in reading order: T3, T6+, T2+1. */
  typology: string[];
  /** Energy classes in reading order: A+, A, B-, … */
  energy: string[];
  /** Case-folded, accent-stripped place names. */
  places: Set<string>;
}

export function emptyFactSet(): FactSet {
  return { numbers: new Map(), money: new Map(), typology: [], energy: [], places: new Set() };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

/** Folds a place name for comparison: lower-case, no diacritics, single spaces. */
export function foldPlace(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

// A numeric token: thousands groups separated by space, NBSP or dot; optional decimal part
// (comma or dot, one or two digits) or a comma-thousands group ("350,000"); optional area unit.
const NUMBER_RE =
  /(?<![\p{L}\p{N}])(\d{1,3}(?:[ \u00a0.]\d{3})+|\d+)(?:,(\d{3})(?!\d)|[,.](\d{1,2})(?!\d))?(?:\s*(m²|m2|metros\s+quadrados)(?![\p{L}\p{N}]))?/gu;
const MONEY_TAIL_RE = /^\s*(?:€|euros?|eur)(?![\p{L}\p{N}])/iu;
const TYPOLOGY_RE = /(?<![\p{L}\p{N}])T(\d)(?:\+(\d)?)?(?![\p{L}\p{N}])/gu;
const ENERGY_CONTEXT_RE =
  /(?:[Cc]lasse(?:\s+[Ee]nerg[ée]tica)?(?:\s+de)?\s+|[Cc]ertificado\s+[Ee]nerg[ée]tico\s+(?:de\s+)?(?:classe\s+)?)([A-F])(\+|-|\s+mais|\s+menos)?(?![\p{L}\p{N}])/gu;
const ENERGY_BARE_RE = /(?<![\p{L}\p{N}])([A-F])([+-])(?![\p{L}\p{N}])/gu;

export interface NumberToken {
  key: string;
  value: number;
  unit: "m2" | null;
  index: number;
  raw: string;
}

/** Normalised numeric tokens in `text`, in reading order. */
export function numberTokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  NUMBER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_RE.exec(text)) !== null) {
    const [raw, intPart, thousands, decimals, unit] = m;
    let digits = (intPart ?? "").replace(/[ \u00a0.]/g, "");
    if (thousands) digits += thousands;
    const key = decimals ? `${digits}.${decimals}` : digits;
    const value = Number.parseFloat(key);
    const normalisedUnit = unit ? "m2" : null;
    out.push({ key: normalisedUnit ? `${key}${normalisedUnit}` : key, value, unit: normalisedUnit, index: m.index, raw });
  }
  return out;
}

/** Energy classes mentioned in `text` (with context or as a signed letter such as "B-"). */
export function energyTokens(text: string): string[] {
  const found: Array<{ index: number; end: number; cls: string }> = [];
  ENERGY_CONTEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENERGY_CONTEXT_RE.exec(text)) !== null) {
    const sign = (m[2] ?? "").trim();
    const cls = m[1] + (sign === "+" || sign === "mais" ? "+" : sign === "-" || sign === "menos" ? "-" : "");
    found.push({ index: m.index, end: m.index + m[0].length, cls });
  }
  ENERGY_BARE_RE.lastIndex = 0;
  while ((m = ENERGY_BARE_RE.exec(text)) !== null) {
    const index = m.index;
    if (found.some((f) => index >= f.index && index < f.end)) continue;
    found.push({ index, end: index + m[0].length, cls: m[1] + m[2] });
  }
  return found.sort((a, b) => a.index - b.index).map((f) => f.cls);
}

export function typologyTokens(text: string): string[] {
  const out: string[] = [];
  TYPOLOGY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TYPOLOGY_RE.exec(text)) !== null) out.push(m[0]);
  return out;
}

const CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e", "d'", "d’"]);
const WORD_RE = /\p{L}[\p{L}'’-]*/gu;

interface Word {
  text: string;
  index: number;
  end: number;
}

function isCapitalised(w: string): boolean {
  if (w.length < 2) return false;
  const first = w[0] ?? "";
  if (first !== first.toUpperCase() || first === first.toLowerCase()) return false;
  const letters = w.replace(/[^\p{L}]/gu, "");
  return letters !== letters.toUpperCase(); // skip acronyms (IMI, AO90)
}

function isSentenceInitial(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const ch = text[i] ?? "";
    if (ch === "\n") return true;
    if (/[ \t\u00a0"'“«([]/u.test(ch)) continue;
    return /[.!?…:]/u.test(ch);
  }
  return true;
}

/** Capitalised spans of 1–4 capitalised tokens (connectors like "de" are free) that do not open a sentence. */
export function capitalisedSpans(text: string): string[] {
  const words: Word[] = [];
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) words.push({ text: m[0], index: m.index, end: m.index + m[0].length });

  const spans: string[] = [];
  const adjacent = (a: Word, b: Word): boolean => /^[ \t\u00a0]+$/u.test(text.slice(a.end, b.index));
  let i = 0;
  while (i < words.length) {
    const w = words[i]!;
    if (!isCapitalised(w.text) || isSentenceInitial(text, w.index)) {
      i++;
      continue;
    }
    let last = i;
    let capCount = 1;
    let j = i + 1;
    while (j < words.length && capCount < 4) {
      const next = words[j]!;
      if (!adjacent(words[last]!, next)) break;
      if (isCapitalised(next.text)) {
        last = j;
        capCount++;
        j++;
        continue;
      }
      const after = words[j + 1];
      if (CONNECTORS.has(next.text.toLowerCase()) && after && adjacent(next, after) && isCapitalised(after.text)) {
        last = j + 1;
        capCount++;
        j += 2;
        continue;
      }
      break;
    }
    spans.push(text.slice(w.index, words[last]!.end));
    i = last + 1;
  }
  return spans;
}

function listingPlaceNames(listing: Listing): string[] {
  const loc = listing.location;
  return [loc.district, loc.municipality, loc.parish, loc.neighbourhood, loc.address].filter(
    (x): x is string => typeof x === "string" && x.trim().length > 0,
  );
}

/** Facts carried by a text. With a listing, its location names are looked up explicitly. */
export function extractFacts(text: string, listing?: Listing): FactSet {
  const facts = emptyFactSet();
  for (const token of numberTokens(text)) {
    bump(facts.numbers, token.key);
    if (MONEY_TAIL_RE.test(text.slice(token.index + token.raw.length))) bump(facts.money, token.key);
  }
  facts.typology = typologyTokens(text);
  facts.energy = energyTokens(text);

  if (listing) {
    const folded = foldPlace(text);
    for (const name of listingPlaceNames(listing)) {
      const f = foldPlace(name);
      if (f && folded.includes(f)) facts.places.add(f);
    }
  }
  for (const span of capitalisedSpans(text)) facts.places.add(foldPlace(span));
  return facts;
}

/** The facts a listing states, in the same normalised form. */
export function listingFacts(listing: Listing): FactSet {
  const facts = emptyFactSet();
  const addNumber = (v: number | null | undefined, unit: "m2" | null = null): void => {
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    const key = Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
    bump(facts.numbers, unit ? `${key}${unit}` : key);
  };
  if (listing.price !== null) {
    addNumber(listing.price);
    bump(facts.money, String(Math.round(listing.price)));
  }
  addNumber(listing.area.gross_m2, "m2");
  addNumber(listing.area.useful_m2, "m2");
  addNumber(listing.area.plot_m2, "m2");
  if (listing.floor !== null) {
    const n = Number.parseInt(listing.floor, 10);
    if (Number.isFinite(n)) addNumber(n);
  }
  addNumber(listing.year_built);
  addNumber(listing.bathrooms);
  if (listing.typology) {
    facts.typology.push(listing.typology);
    const digit = Number.parseInt(listing.typology.slice(1), 10);
    if (Number.isFinite(digit)) addNumber(digit);
  }
  if (listing.energy_certificate && listing.energy_certificate !== "isento") facts.energy.push(listing.energy_certificate);
  for (const name of listingPlaceNames(listing)) facts.places.add(foldPlace(name));
  return facts;
}

/** Every numeric value the listing states (areas, price, floor, year, bathrooms, typology digit, postal code parts). */
export function listingNumericValues(listing: Listing): Set<number> {
  const values = new Set<number>();
  const add = (v: number | null | undefined): void => {
    if (v !== null && v !== undefined && Number.isFinite(v)) {
      values.add(v);
      values.add(Math.round(v));
    }
  };
  add(listing.price);
  add(listing.area.gross_m2);
  add(listing.area.useful_m2);
  add(listing.area.plot_m2);
  add(listing.year_built);
  add(listing.bathrooms);
  if (listing.floor !== null) add(Number.parseInt(listing.floor, 10));
  if (listing.typology) add(Number.parseInt(listing.typology.slice(1), 10));
  if (listing.location.postal_code) for (const part of listing.location.postal_code.split("-")) add(Number.parseInt(part, 10));
  return values;
}
