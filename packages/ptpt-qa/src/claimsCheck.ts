import type { GenerationResult, SectionKey, ValidatorReport } from "@imovel/core";
import { SECTION_KEYS, stripDiacritics } from "@imovel/core";
import { escapeRegex } from "./lexicon/boundary";

/** Promises and discriminatory phrases that may never appear in published copy (pt-PT). */
export const FORBIDDEN_CLAIMS: readonly string[] = [
  "retorno garantido",
  "rentabilidade garantida",
  "valorização garantida",
  "lucro garantido",
  "melhor investimento",
  "sem risco",
  "isento de impostos",
  "só para",
  "apenas para famílias",
  "não aceitamos",
  "exclusivo para casais",
];

export interface ClaimHit {
  field: SectionKey;
  phrase: string;
}

function fold(s: string): string {
  return stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function phraseRegex(phrase: string): RegExp {
  const folded = fold(phrase);
  const source = escapeRegex(folded).replace(/ /g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${source}(?![\\p{L}\\p{N}])`, "iu");
}

/** Finds forbidden phrases in the sections, accent-insensitively. Tenant phrases are added to the built-in list. */
export function findClaims(after: GenerationResult, forbidden: readonly string[] = []): ClaimHit[] {
  const phrases = [...new Set([...FORBIDDEN_CLAIMS, ...forbidden].map((p) => p.trim()).filter(Boolean))];
  const regexes = phrases.map((p) => [p, phraseRegex(p)] as const);
  const hits: ClaimHit[] = [];
  for (const field of SECTION_KEYS) {
    const text = fold(field === "destaques" ? after.destaques.join("\n") : after[field]);
    for (const [phrase, re] of regexes) if (re.test(text)) hits.push({ field, phrase });
  }
  return hits;
}

export function checkClaims(after: GenerationResult, forbidden: readonly string[] = []): ValidatorReport {
  const hits = findClaims(after, forbidden);
  return {
    name: "claims",
    ok: hits.length === 0,
    severity: "hard",
    issues: hits.map((h) => `${h.field}: forbidden claim "${h.phrase}"`),
    details: { hits },
  };
}
