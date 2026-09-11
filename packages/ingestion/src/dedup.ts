import type { ListingInput } from "@imovel/core";
import { computeContentHash, computeFingerprint, normalizeAddress, stripDiacritics } from "@imovel/core";

export interface NearDuplicateTolerance {
  /** Relative area tolerance, default 0.03 (±3%). */
  area: number;
  /** Relative price tolerance, default 0.02 (±2%). */
  price: number;
}

export const DEFAULT_TOLERANCE: NearDuplicateTolerance = { area: 0.03, price: 0.02 };

/** `${source}:${source_id}` — the exact identity of a listing within a tenant. */
export function exactKey(input: Pick<ListingInput, "source" | "source_id">): string {
  return `${input.source}:${input.source_id}`;
}

/** True when a material field changed (content hash differs). `fetched_at` churn never counts. */
export function isMaterialChange(prev: ListingInput, next: ListingInput): boolean {
  return computeContentHash(prev) !== computeContentHash(next);
}

function fold(s: string | null | undefined): string | null {
  if (!s) return null;
  const f = stripDiacritics(s).toLowerCase().replace(/\s+/g, " ").trim();
  return f || null;
}

function within(a: number | null, b: number | null, tol: number): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  const base = Math.max(Math.abs(a), Math.abs(b));
  if (base === 0) return a === b;
  return Math.abs(a - b) / base <= tol;
}

function comparableArea(input: ListingInput): number | null {
  return input.area.useful_m2 ?? input.area.gross_m2 ?? null;
}

/**
 * Cross-source fuzzy match: same transaction, typology, municipality and parish (accent-insensitive),
 * area within tolerance (useful or gross m²), price within tolerance and the normalised address equal
 * or absent on both.
 */
export function nearDuplicate(
  a: ListingInput,
  b: ListingInput,
  tol: Partial<NearDuplicateTolerance> = {},
): boolean {
  const t = { ...DEFAULT_TOLERANCE, ...tol };
  if (a.transaction !== b.transaction) return false;
  if (a.typology !== b.typology) return false;
  if (fold(a.location.municipality) !== fold(b.location.municipality)) return false;
  if (fold(a.location.parish) !== fold(b.location.parish)) return false;
  if (!within(comparableArea(a), comparableArea(b), t.area)) return false;
  if (!within(a.price, b.price, t.price)) return false;
  return normalizeAddress(a.location.address) === normalizeAddress(b.location.address);
}

export type DedupOutcome = "new" | "changed" | "unchanged";

/** In-memory index by exact key and by coarse fingerprint. Pure; the DB-backed version lives in @imovel/db. */
export class DedupIndex {
  private readonly byKey = new Map<string, ListingInput>();
  private readonly byFingerprint = new Map<string, Set<string>>();
  private readonly fingerprintOf = new Map<string, string>();

  constructor(seed: Iterable<ListingInput> = []) {
    for (const input of seed) this.add(input);
  }

  get size(): number {
    return this.byKey.size;
  }

  get(key: string): ListingInput | undefined {
    return this.byKey.get(key);
  }

  has(input: Pick<ListingInput, "source" | "source_id">): boolean {
    return this.byKey.has(exactKey(input));
  }

  /** Stores the input and reports whether it is new, materially changed or unchanged. */
  add(input: ListingInput): DedupOutcome {
    const key = exactKey(input);
    const prev = this.byKey.get(key);
    const outcome: DedupOutcome = !prev ? "new" : isMaterialChange(prev, input) ? "changed" : "unchanged";
    const fp = computeFingerprint(input);
    const oldFp = this.fingerprintOf.get(key);
    if (oldFp && oldFp !== fp) this.byFingerprint.get(oldFp)?.delete(key);
    this.byKey.set(key, input);
    this.fingerprintOf.set(key, fp);
    let bucket = this.byFingerprint.get(fp);
    if (!bucket) {
      bucket = new Set();
      this.byFingerprint.set(fp, bucket);
    }
    bucket.add(key);
    return outcome;
  }

  /** Other stored listings (different exact key) that look like the same property. */
  findNearDuplicates(input: ListingInput, tol?: Partial<NearDuplicateTolerance>): ListingInput[] {
    const key = exactKey(input);
    const bucket = this.byFingerprint.get(computeFingerprint(input));
    if (!bucket) return [];
    const out: ListingInput[] = [];
    for (const otherKey of bucket) {
      if (otherKey === key) continue;
      const other = this.byKey.get(otherKey);
      if (other && nearDuplicate(input, other, tol)) out.push(other);
    }
    return out;
  }

  values(): ListingInput[] {
    return [...this.byKey.values()];
  }
}
