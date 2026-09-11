import type { ListingInput, NormalizeContext, Ownership, Photo } from "@imovel/core";
import { ListingInput as ListingInputSchema, ValidationError, normalizeFeatures } from "@imovel/core";
import { applyPiiPolicy } from "../pii";
import { parseEnergyClass } from "./energy";
import { parseFloor } from "./floor";
import { parseLocation } from "./location";
import { parseArea, parseInteger, parsePrice, parsePricePeriod } from "./price";
import { parsePropertyType } from "./propertyType";
import { parseCondition, parseLanguageTag, parseOwnership, parseTransaction } from "./transaction";
import { parseTypology } from "./typology";

export * from "./typology";
export * from "./energy";
export * from "./propertyType";
export * from "./price";
export * from "./floor";
export * from "./location";
export * from "./transaction";

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}

/** Array of strings from an array, a delimiter-separated string ("|", ";" or newline) or nothing. */
export function toStringList(v: unknown, delimiter: RegExp = /\s*[|;\n]\s*/): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) {
    return v
      .map((x) => (isRecord(x) ? text(x.label ?? x.name ?? x.value ?? x.title) : text(x)))
      .filter((x): x is string => x !== null);
  }
  if (typeof v === "string") return v.split(delimiter).map((s) => s.trim()).filter(Boolean);
  if (isRecord(v)) {
    // { "Elevador": true, "Piscina": "sim", "Ano": 1958 } → ["Elevador", "Piscina", "Ano: 1958"]
    return Object.entries(v).flatMap(([k, val]) => {
      if (val === true || val === "true" || val === "sim" || val === "yes" || val === 1) return [k];
      if (val === false || val === null || val === undefined || val === "" || val === "não" || val === "no") return [];
      return [`${k}: ${String(val)}`];
    });
  }
  return [];
}

function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Photos from URL strings or {url, room?, order?, stored_key?} objects; invalid URLs are dropped. */
export function toPhotos(v: unknown): Photo[] {
  const list: unknown[] = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\s*[|\n]\s*/) : [];
  const out: Photo[] = [];
  for (const item of list) {
    let url: string | null = null;
    let room: string | null = null;
    let stored_key: string | null = null;
    let order: number | null = null;
    if (typeof item === "string") url = item.trim();
    else if (isRecord(item)) {
      url = text(item.url ?? item.src ?? item.href ?? item.large ?? item.medium ?? item.image);
      room = text(item.room ?? item.tag ?? item.label ?? item.category);
      stored_key = text(item.stored_key);
      order = parseInteger(item.order);
    }
    if (!url || !isHttpUrl(url)) continue;
    out.push({ url, room, order: order ?? out.length, stored_key });
  }
  return out;
}

function toArea(partial: Rec): { gross_m2: number | null; useful_m2: number | null; plot_m2: number | null } {
  const a = isRecord(partial.area) ? partial.area : {};
  return {
    gross_m2: parseArea(a.gross_m2 ?? partial.area_gross ?? partial.gross_m2 ?? partial.area_gross_m2),
    useful_m2: parseArea(a.useful_m2 ?? partial.area_useful ?? partial.useful_m2 ?? partial.area_useful_m2),
    plot_m2: parseArea(a.plot_m2 ?? partial.area_plot ?? partial.plot_m2 ?? partial.area_plot_m2),
  };
}

function toAgent(partial: Rec): Rec {
  const a = isRecord(partial.agent) ? partial.agent : {};
  const email = text(a.email ?? partial.agent_email);
  return {
    name: text(a.name ?? partial.agent_name),
    agency: text(a.agency ?? partial.agency ?? partial.agency_name),
    agency_id: text(a.agency_id ?? partial.agency_id),
    phone: text(a.phone ?? partial.agent_phone),
    // An unparseable email must not reject the listing.
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
  };
}

function toLocation(partial: Rec) {
  const loc = isRecord(partial.location) ? partial.location : {};
  return parseLocation({
    district: loc.district ?? partial.district,
    municipality: loc.municipality ?? partial.municipality ?? loc.city ?? partial.city ?? loc.concelho,
    parish: loc.parish ?? partial.parish ?? loc.freguesia,
    neighbourhood: loc.neighbourhood ?? partial.neighbourhood ?? loc.neighborhood ?? loc.zone ?? loc.bairro,
    address: loc.address ?? partial.address ?? loc.street,
    postal_code: loc.postal_code ?? partial.postal_code ?? loc.zip ?? loc.zipcode ?? loc.postcode,
    lat: loc.lat ?? partial.lat ?? loc.latitude ?? partial.latitude,
    lng: loc.lng ?? partial.lng ?? loc.lon ?? loc.longitude ?? partial.longitude,
    text: typeof partial.location === "string" ? partial.location : (loc.text ?? partial.location_text),
  });
}

/** Ownership: a matching tenant agency wins, then an explicit value on the record, then the context default. */
export function resolveOwnership(agencyId: string | null, explicit: unknown, ctx: NormalizeContext): Ownership {
  if (agencyId && ctx.agency_ids.some((id) => id.trim().toLowerCase() === agencyId.trim().toLowerCase())) {
    return "owned";
  }
  return parseOwnership(explicit) ?? ctx.ownership_default;
}

/**
 * Turns a loosely typed record (portal strings, CSV cells, adapter output) into a validated
 * `ListingInput`: applies every parser, the feature taxonomy, ownership resolution and the
 * PII policy, then `ListingInput.parse`. Throws `ValidationError` when the record cannot be mapped.
 */
export function finalizeListingInput(partial: Record<string, unknown>, ctx: NormalizeContext): ListingInput {
  const transaction = parseTransaction(partial.transaction ?? partial.operation ?? partial.transaction_mode);
  if (!transaction) {
    throw new ValidationError("listing: transaction (sale|rent) is required", {
      details: { source_id: text(partial.source_id), value: partial.transaction },
    });
  }
  const source_id = text(partial.source_id ?? partial.id);
  if (!source_id) throw new ValidationError("listing: source_id is required");

  const price = parsePrice(partial.price);
  const price_period =
    price.amount === null
      ? null
      : (parsePricePeriod(partial.price_period) ?? price.period ?? (transaction === "rent" ? "month" : "total"));

  const features_raw = [...toStringList(partial.features_raw), ...toStringList(partial.features)];
  const features = normalizeFeatures(features_raw);

  const agent = toAgent(partial);
  const ownership = resolveOwnership(agent.agency_id as string | null, partial.ownership, ctx);

  const source_url = text(partial.source_url ?? partial.url);
  const year = parseInteger(partial.year_built ?? partial.construction_year ?? partial.year);

  const candidate = {
    source: text(partial.source),
    source_id,
    source_url: source_url && isHttpUrl(source_url) ? source_url : null,
    ownership,
    consent_ref: text(partial.consent_ref),
    transaction,
    property_type: parsePropertyType(partial.property_type ?? partial.estate_type ?? partial.type),
    typology: parseTypology(partial.typology ?? partial.rooms ?? partial.bedrooms),
    price: price.amount,
    currency: "EUR" as const,
    price_period,
    area: toArea(partial),
    floor: parseFloor(partial.floor),
    year_built: year !== null && year >= 1500 && year <= 2100 ? year : null,
    bathrooms: (() => {
      const b = parseInteger(partial.bathrooms);
      return b !== null && b >= 0 ? b : null;
    })(),
    condition: parseCondition(partial.condition ?? partial.status ?? partial.state),
    location: toLocation(partial),
    features,
    features_raw: [...new Set(toStringList(partial.features_raw).length ? toStringList(partial.features_raw) : features_raw)],
    energy_certificate: parseEnergyClass(partial.energy_certificate ?? partial.energy_rating ?? partial.energy_class),
    photos: toPhotos(partial.photos ?? partial.images),
    agent,
    description_original: text(partial.description_original ?? partial.description),
    language_original: parseLanguageTag(partial.language_original ?? partial.language),
    raw_ref: text(partial.raw_ref),
  };

  const parsed = ListingInputSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ValidationError(`listing ${source_id}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`, {
      details: { source_id, issues: parsed.error.issues },
    });
  }
  return applyPiiPolicy(parsed.data);
}
