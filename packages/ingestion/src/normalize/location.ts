import type { Location } from "@imovel/core";
import { Location as LocationSchema, ValidationError } from "@imovel/core";
import { parseNumber } from "./price";

export interface LocationParts {
  district?: unknown;
  municipality?: unknown;
  parish?: unknown;
  neighbourhood?: unknown;
  address?: unknown;
  postal_code?: unknown;
  lat?: unknown;
  lng?: unknown;
  /** Free text such as "Campo de Ourique, Lisboa, Lisboa", split from the right. */
  text?: unknown;
}

const POSTAL = /\b(\d{4})\s*-\s*(\d{3})\b/;
const POSTAL_COMPACT = /^\s*(\d{4})(\d{3})\s*$/;

/** Extracts a Portuguese "dddd-ddd" postal code from any string, or null. */
export function extractPostalCode(input: unknown): string | null {
  if (typeof input === "number") input = String(input);
  if (typeof input !== "string") return null;
  const compact = POSTAL_COMPACT.exec(input);
  if (compact) return `${compact[1]}-${compact[2]}`;
  const m = POSTAL.exec(input);
  return m ? `${m[1]}-${m[2]}` : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return String(v);
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s ? s : null;
}

function coord(v: unknown, min: number, max: number): number | null {
  const n = typeof v === "string" ? parseNumber(v.replace(",", ".")) : parseNumber(v);
  if (n === null || n < min || n > max) return null;
  return n;
}

/**
 * Builds a canonical `Location`. When only free text is given ("Cascais e Estoril, Cascais, Lisboa")
 * the comma-separated parts are read from the right as district, municipality, parish, neighbourhood.
 * Throws `ValidationError` when neither district nor municipality can be determined.
 */
export function parseLocation(input: LocationParts): Location {
  let district = str(input.district);
  let municipality = str(input.municipality);
  let parish = str(input.parish);
  let neighbourhood = str(input.neighbourhood);
  const address = str(input.address);
  const text = str(input.text);

  if (text && (!district || !municipality)) {
    const parts = text
      .split(/[,;|]/)
      .map((p) => p.replace(POSTAL, "").trim())
      .filter((p) => p && !/^\d+$/.test(p));
    if (parts.length >= 1) {
      const fromRight = (i: number): string | null => parts[parts.length - 1 - i] ?? null;
      if (!district && !municipality) {
        district = fromRight(0);
        municipality = parts.length >= 2 ? fromRight(1) : district;
        parish = parish ?? (parts.length >= 3 ? fromRight(2) : null);
        neighbourhood = neighbourhood ?? (parts.length >= 4 ? fromRight(3) : null);
      } else if (!district) {
        district = fromRight(0);
      } else {
        municipality = parts.length >= 2 ? fromRight(1) : fromRight(0);
        parish = parish ?? (parts.length >= 3 ? fromRight(2) : null);
      }
    }
  }

  if (!district && !municipality) {
    throw new ValidationError("location: district and municipality could not be determined", {
      details: { text, address },
    });
  }
  district = district ?? municipality;
  municipality = municipality ?? district;

  const postal_code =
    extractPostalCode(input.postal_code) ?? extractPostalCode(address) ?? extractPostalCode(text);

  const parsed = LocationSchema.safeParse({
    district,
    municipality,
    parish,
    neighbourhood,
    address,
    postal_code,
    lat: coord(input.lat, -90, 90),
    lng: coord(input.lng, -180, 180),
  });
  if (!parsed.success) {
    throw new ValidationError("location: invalid", { details: { issues: parsed.error.issues } });
  }
  return parsed.data;
}
