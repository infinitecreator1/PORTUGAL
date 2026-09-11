import type { Listing } from "@imovel/core";
import { DEFAULT_NEAR_DUPLICATE_TOLERANCE, type NearDuplicateTolerance } from "./types";

/** `|candidate − probe| ≤ tol × probe`; both null counts as equal, one null as different. */
export function withinTolerance(probe: number | null | undefined, candidate: number | null | undefined, tol: number): boolean {
  if (probe == null && candidate == null) return true;
  if (probe == null || candidate == null) return false;
  return Math.abs(candidate - probe) <= tol * Math.abs(probe);
}

/**
 * Area rule shared by the memory repo and the SQL in the Postgres repo: compare useful_m2 when
 * both have it, otherwise gross_m2 when both have it, otherwise match only when neither side has
 * any area at all.
 */
export function areaMatches(probe: Listing["area"], candidate: Listing["area"], tol: number): boolean {
  if (probe.useful_m2 != null && candidate.useful_m2 != null) {
    return withinTolerance(probe.useful_m2, candidate.useful_m2, tol);
  }
  if (probe.gross_m2 != null && candidate.gross_m2 != null) {
    return withinTolerance(probe.gross_m2, candidate.gross_m2, tol);
  }
  return probe.useful_m2 == null && probe.gross_m2 == null && candidate.useful_m2 == null && candidate.gross_m2 == null;
}

function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
}

export function resolveTolerance(tol?: Partial<NearDuplicateTolerance>): NearDuplicateTolerance {
  return { ...DEFAULT_NEAR_DUPLICATE_TOLERANCE, ...tol };
}

/** Pure form of `ListingsRepo.findNearDuplicates`; the Postgres repo expresses the same rules in SQL. */
export function isNearDuplicate(probe: Listing, candidate: Listing, tol?: Partial<NearDuplicateTolerance>): boolean {
  const t = resolveTolerance(tol);
  if (candidate.id === probe.id) return false;
  if (candidate.tenant_id !== probe.tenant_id) return false;
  if (candidate.transaction !== probe.transaction) return false;
  if ((candidate.typology ?? null) !== (probe.typology ?? null)) return false;
  if (!sameText(candidate.location.municipality, probe.location.municipality)) return false;
  if (!sameText(candidate.location.parish, probe.location.parish)) return false;
  if (!areaMatches(probe.area, candidate.area, t.area)) return false;
  if (!withinTolerance(probe.price, candidate.price, t.price)) return false;
  return true;
}
