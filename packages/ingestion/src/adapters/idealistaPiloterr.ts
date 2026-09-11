import type {
  CallOptions,
  ListingInput,
  ListingSource,
  NormalizeContext,
  RawListing,
  SavedSearch,
  SearchPage,
} from "@imovel/core";
import { ValidationError } from "@imovel/core";
import { fetchJson } from "../http";
import { finalizeListingInput } from "../normalize/index";
import { isRecord, numberOf, pick, pickArray } from "./apiCommon";

/** Verified Sept 2026: Piloterr charges 3 credits for a `search` call and 3 for a `property` call. */
export const PILOTERR_SEARCH_CREDITS = 3;
export const PILOTERR_DETAIL_CREDITS = 3;

export interface IdealistaPiloterrOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Piloterr's Idealista scraper. `GET /v2/idealista/search?query=<full idealista search URL>` and
 * `GET /v2/idealista/property?query=<property URL>`, header `x-api-key`. The documented search
 * summary (price, title, details[] with bedrooms/surface/floor, picture, currency, truncated
 * description, listing_company(_url), parking_included, plus `pagination {current, next, total,
 * has_next}`) does not include structured location or transaction/property type, so `normalize`
 * also probes plausible alternate keys (address/location/operation/propertyType) that a real
 * payload may carry; when a search-page item still lacks a location it throws `ValidationError`
 * and the caller should fetch `detail()` for that item instead. idealista.pt support is unverified.
 */
export class IdealistaPiloterrSource implements ListingSource {
  readonly id = "idealista-piloterr" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(opts: IdealistaPiloterrOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.piloterr.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 3;
  }

  capabilities(): { search: boolean; detail: boolean; rpm: number } {
    return { search: true, detail: true, rpm: 60 };
  }

  /**
   * `query.query.search_url` (or `.url`) must be a full idealista.pt search URL. Piloterr paginates
   * by URL (`pagination.next`), so the cursor this adapter returns/accepts is that URL, not a page number.
   */
  async search(query: SavedSearch, cursor?: string | null, opts?: CallOptions): Promise<SearchPage> {
    const q = (query.query ?? {}) as Record<string, unknown>;
    const searchUrl = typeof q.search_url === "string" ? q.search_url : typeof q.url === "string" ? q.url : null;
    if (!searchUrl) {
      throw new ValidationError("idealista-piloterr: query.query.search_url (a full idealista.pt search URL) is required");
    }
    const target = cursor ?? searchUrl;
    const url = new URL(`${this.baseUrl}/v2/idealista/search`);
    url.searchParams.set("query", target);

    const data = await fetchJson<Record<string, unknown>>(
      url.toString(),
      { headers: { "x-api-key": this.apiKey } },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    const items = pickArray(data, ["results", "items"]);
    const pagination = isRecord(data.pagination) ? data.pagination : data;
    const hasNext = pick(pagination, ["has_next"]);
    const nextUrl = pick(pagination, ["next"]);
    const next = hasNext === false ? null : typeof nextUrl === "string" && nextUrl ? nextUrl : null;
    const total = numberOf(pick(pagination, ["total"]));
    return { items, next, total, credits_used: PILOTERR_SEARCH_CREDITS };
  }

  async detail(ref: { source_id: string; url?: string | null }, opts?: CallOptions): Promise<RawListing> {
    if (!ref.url) throw new ValidationError("idealista-piloterr: detail() requires ref.url (the property URL)");
    const url = new URL(`${this.baseUrl}/v2/idealista/property`);
    url.searchParams.set("query", ref.url);
    const data = await fetchJson<Record<string, unknown>>(
      url.toString(),
      { headers: { "x-api-key": this.apiKey } },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    // See `imovirtualParsebot.ts` for why the per-call credit cost rides along as `__credits_used`.
    return { ...data, __credits_used: PILOTERR_DETAIL_CREDITS };
  }

  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput {
    const r = raw as Record<string, unknown>;
    const details = Array.isArray(r.details) ? r.details.filter(isRecord) : [];
    const detailsOf = (keys: string[]): unknown => {
      for (const d of details) {
        const v = pick(d, keys);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const loc = isRecord(r.location) ? r.location : {};
    const priceValue = isRecord(r.price) ? pick(r.price, ["value", "amount"]) : r.price;

    const partial: Record<string, unknown> = {
      source: "idealista-piloterr",
      source_id: pick(r, ["property_code", "id", "source_id"]) ?? slugFromAnyUrl(r),
      source_url: pick(r, ["url", "source_url", "link"]),
      transaction: pick(r, ["operation", "transaction", "transaction_type"]),
      property_type: pick(r, ["property_type", "propertyType", "type"]),
      typology: detailsOf(["bedrooms", "rooms"]) ?? pick(r, ["bedrooms", "rooms"]),
      price: priceValue,
      area_useful: detailsOf(["surface", "area"]) ?? pick(r, ["surface", "area"]),
      floor: detailsOf(["floor"]) ?? pick(r, ["floor"]),
      condition: pick(r, ["status", "condition"]),
      district: pick(loc, ["district"]) ?? pick(r, ["district", "province"]),
      municipality: pick(loc, ["municipality", "city"]) ?? pick(r, ["municipality", "city"]),
      parish: pick(loc, ["parish"]) ?? pick(r, ["parish", "neighborhood"]),
      address: pick(loc, ["address"]) ?? pick(r, ["address"]),
      postal_code: pick(loc, ["postal_code"]) ?? pick(r, ["postal_code"]),
      lat: pick(loc, ["lat", "latitude"]) ?? pick(r, ["latitude"]),
      lng: pick(loc, ["lng", "longitude"]) ?? pick(r, ["longitude"]),
      location_text: typeof r.location === "string" ? r.location : undefined,
      features_raw: pick(r, ["features", "amenities", "characteristics"]),
      energy_certificate: pick(r, ["energy_rating", "energy_certificate"]),
      photos: pick(r, ["photos", "images"]) ?? (typeof r.picture === "string" ? [r.picture] : undefined),
      agent_name: pick(r, ["listing_company", "agent_name"]),
      agency: pick(r, ["listing_company"]),
      agency_id: pick(r, ["listing_company_url", "agency_id"]),
      description_original: pick(r, ["description", "description_original"]),
    };
    return finalizeListingInput(partial, ctx);
  }
}

function slugFromAnyUrl(r: Record<string, unknown>): string | undefined {
  const url = r.url ?? r.source_url ?? r.link;
  if (typeof url !== "string") return undefined;
  const m = /\/(\d+)\/?(?:$|[?#])/.exec(url) ?? /-(\d+)\.html/.exec(url);
  return m ? m[1] : undefined;
}
