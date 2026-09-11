/**
 * Accent-aware word boundaries. JavaScript's `\b` only knows ASCII word characters, so
 * "remodelação" or "ónibus" would break it. Every lexicon pattern is compiled as
 * `(?<![\p{L}\p{N}])(?:pattern)(?![\p{L}\p{N}])` with the `giu` flags.
 */

const BOUNDARY_BEFORE = "(?<![\\p{L}\\p{N}])";
const BOUNDARY_AFTER = "(?![\\p{L}\\p{N}])";

const cache = new Map<string, RegExp>();

/** Wraps a regex source in accent-aware boundaries and compiles it once (global, case-insensitive, unicode). */
export function compileBounded(source: string): RegExp {
  const cached = cache.get(source);
  if (cached) {
    cached.lastIndex = 0;
    return cached;
  }
  const re = new RegExp(`${BOUNDARY_BEFORE}(?:${source})${BOUNDARY_AFTER}`, "giu");
  cache.set(source, re);
  return re;
}

/** Escapes a literal string for use inside a regex source. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RawMatch {
  index: number;
  term: string;
}

/** All non-overlapping matches of a bounded pattern in `text`. */
export function matchAll(source: string, text: string): RawMatch[] {
  const re = compileBounded(source);
  const out: RawMatch[] = [];
  let m: RegExpExecArray | null;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ index: m.index, term: m[0] });
  }
  return out;
}
