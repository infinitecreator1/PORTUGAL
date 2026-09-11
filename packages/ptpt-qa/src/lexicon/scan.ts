import type { GenerationResult, LexiconHit, SectionKey } from "@imovel/core";
import { SECTION_KEYS, wordCount } from "@imovel/core";
import { matchAll } from "./boundary";
import { MARKERS, type Marker } from "./markers";

/** Text of one section as the scanners see it (`destaques` joined with newlines). */
export function sectionText(result: GenerationResult, field: SectionKey): string {
  return field === "destaques" ? result.destaques.join("\n") : result[field];
}

/**
 * Scans one field with every marker. Overlapping matches keep the longest span (so
 * "ponto de ônibus" wins over "ônibus"); hits are sorted by position.
 */
export function scanText(text: string, field: SectionKey, markers: readonly Marker[] = MARKERS): LexiconHit[] {
  const raw: LexiconHit[] = [];
  for (const marker of markers) {
    for (const m of matchAll(marker.pattern, text)) {
      raw.push({
        rule_id: marker.id,
        term: m.term,
        field,
        index: m.index,
        severity: marker.severity,
        suggestion: marker.suggestion,
      });
    }
  }
  raw.sort((a, b) => a.index - b.index || b.term.length - a.term.length || a.rule_id.localeCompare(b.rule_id));
  const kept: LexiconHit[] = [];
  let lastEnd = -1;
  for (const hit of raw) {
    if (hit.index < lastEnd) continue;
    kept.push(hit);
    lastEnd = hit.index + hit.term.length;
  }
  return kept;
}

/** Scans every section of a generation result. */
export function scanSections(result: GenerationResult, markers: readonly Marker[] = MARKERS): LexiconHit[] {
  const hits: LexiconHit[] = [];
  for (const field of SECTION_KEYS) hits.push(...scanText(sectionText(result, field), field, markers));
  return hits;
}

/** Hits per thousand words of `text`; the eval reports this per generation. */
export function hitsPer1kWords(hits: readonly LexiconHit[], text: string): number {
  const words = Math.max(wordCount(text), 1);
  return (hits.length / words) * 1000;
}

/** Editor hints formatted as "termo → sugestão", deduplicated case-insensitively. */
export function hitsToHints(hits: readonly LexiconHit[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const hit of hits) {
    const term = hit.term.replace(/\s+/g, " ").trim();
    const key = `${term.toLowerCase()}→${hit.suggestion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${term} → ${hit.suggestion}`);
  }
  return out;
}

export function blockHits(hits: readonly LexiconHit[]): LexiconHit[] {
  return hits.filter((h) => h.severity === "block");
}

export function warnHits(hits: readonly LexiconHit[]): LexiconHit[] {
  return hits.filter((h) => h.severity === "warn");
}
