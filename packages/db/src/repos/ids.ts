import { sha256 } from "@imovel/core";

/**
 * Deterministic UUID (v4-shaped, sha256-derived) for "one per tenant" rows such as the default
 * generation and voice profiles. Same inputs → same id in memory and in Postgres.
 */
export function deterministicUuid(namespace: string, ...parts: string[]): string {
  const hex = sha256([namespace, ...parts].join("|")).slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export const DEFAULT_GENERATION_PROFILE_NS = "imovel:generation-profile:default";
export const DEFAULT_VOICE_PROFILE_NS = "imovel:voice-profile:default";

export function defaultGenerationProfileId(tenantId: string): string {
  return deterministicUuid(DEFAULT_GENERATION_PROFILE_NS, tenantId);
}

export function defaultVoiceProfileId(tenantId: string): string {
  return deterministicUuid(DEFAULT_VOICE_PROFILE_NS, tenantId);
}

/** Opaque keyset cursor for paginated lists: (created_at, id) encoded as base64url JSON. */
export function encodeCursor(c: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | null | undefined): { created_at: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { created_at?: unknown }).created_at === "string" &&
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as { created_at: string; id: string };
    }
  } catch {
    // fall through
  }
  return null;
}

/** `YYYY-MM` in UTC for a date. */
export function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** [start, end) UTC bounds of a `YYYY-MM` month. Throws on a malformed month. */
export function monthBounds(month: string): { start: Date; end: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Invalid month "${month}", expected YYYY-MM`);
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  return { start: new Date(Date.UTC(y, mo, 1)), end: new Date(Date.UTC(y, mo + 1, 1)) };
}

export function slugify(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "tenant"
  );
}
