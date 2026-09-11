/** Small helpers shared by the wrapper-API adapters (Parse.bot, Piloterr, Casafari, Idealista). */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function numberOf(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** First array found among the given keys of `obj`, or `[]`. Field names across these wrapper APIs are not fully verified. */
export function pickArray(obj: unknown, keys: string[]): Record<string, unknown>[] {
  if (!isRecord(obj)) return [];
  for (const key of keys) {
    const v = obj[key];
    if (Array.isArray(v)) return v.filter(isRecord);
  }
  return [];
}

/** First defined, non-null value among the given keys of `obj`. */
export function pick(obj: unknown, keys: string[]): unknown {
  if (!isRecord(obj)) return undefined;
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

/** Best-effort slug from an Idealista/Imovirtual listing URL: the last non-empty path segment. */
export function slugFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1]!.replace(/\.html?$/i, "") : null;
  } catch {
    return null;
  }
}

export function setParam(url: URL, key: string, value: unknown): void {
  if (value === undefined || value === null || value === "") return;
  url.searchParams.set(key, String(value));
}
