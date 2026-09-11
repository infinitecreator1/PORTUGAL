import type {
  CallOptions,
  ListingInput,
  ListingSource,
  NormalizeContext,
  RawListing,
  SavedSearch,
  SearchPage,
} from "@imovel/core";
import { fetchJson } from "../http";
import { finalizeListingInput } from "../normalize/index";
import { isRecord, numberOf, pick, pickArray, setParam, slugFromUrl } from "./apiCommon";

/** Parse.bot's Imovirtual `search_listings` costs 5 credits per call, `get_listing_detail` costs 1. */
export const PARSEBOT_SEARCH_CREDITS = 5;
export const PARSEBOT_DETAIL_CREDITS = 1;

export interface ImovirtualParsebotOptions {
  apiKey: string;
  /** Default `https://api.parse.bot/v1/imovirtual` — unverified; Parse.bot's exact base URL is not confirmed. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Parse.bot wrapper over the Imovirtual portal. Endpoints, credit costs and the returned summary
 * fields (id, title, slug, estate type, transaction mode, location, images, price, area, rooms,
 * pagination) are verified Sept 2026; the exact base URL and JSON key names are NOT verified, so
 * `normalize` reads several plausible key spellings defensively.
 */
export class ImovirtualParsebotSource implements ListingSource {
  readonly id = "imovirtual-parsebot" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(opts: ImovirtualParsebotOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.parse.bot/v1/imovirtual").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 3;
  }

  capabilities(): { search: boolean; detail: boolean; rpm: number } {
    // Parse.bot's per-tier requests/minute is account-specific and not published; 60 is a
    // conservative default until a real tier is configured. Callers can wrap search()/detail()
    // in their own `createRateLimiter(rpm)` sized to their actual plan.
    return { search: true, detail: true, rpm: 60 };
  }

  async search(query: SavedSearch, cursor?: string | null, opts?: CallOptions): Promise<SearchPage> {
    const filters = (query.query ?? {}) as Record<string, unknown>;
    const page = cursor ? Number(cursor) || 1 : 1;
    const url = new URL(`${this.baseUrl}/search_listings`);
    setParam(url, "transaction_type", filters.transaction ?? filters.transaction_type);
    setParam(url, "location", filters.location);
    setParam(url, "price_min", filters.price_min);
    setParam(url, "price_max", filters.price_max);
    setParam(url, "area_min", filters.area_min);
    setParam(url, "area_max", filters.area_max);
    setParam(url, "typology", filters.typology);
    setParam(url, "sort", filters.sort);
    setParam(url, "page", page);

    const data = await fetchJson<Record<string, unknown>>(
      url.toString(),
      { headers: { "X-API-Key": this.apiKey } },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    const items = pickArray(data, ["results", "items", "listings", "data"]);
    const pagination = isRecord(data.pagination) ? data.pagination : data;
    const currentPage = numberOf(pick(pagination, ["current_page", "page"])) ?? page;
    const pageCount = numberOf(pick(pagination, ["page_count", "total_pages"]));
    const totalCount = numberOf(pick(pagination, ["total_count", "total"]));
    const next = pageCount !== null && currentPage < pageCount ? String(currentPage + 1) : null;
    return { items, next, total: totalCount, credits_used: PARSEBOT_SEARCH_CREDITS };
  }

  async detail(ref: { source_id: string; url?: string | null }, opts?: CallOptions): Promise<RawListing> {
    const slug = (ref.url ? slugFromUrl(ref.url) : null) ?? ref.source_id;
    const url = new URL(`${this.baseUrl}/get_listing_detail`);
    setParam(url, "slug", slug);
    const data = await fetchJson<Record<string, unknown>>(
      url.toString(),
      { headers: { "X-API-Key": this.apiKey } },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    // `__credits_used` is a convention this package uses to report per-call cost from `detail()`,
    // whose core `ListingSource` return type (`RawListing`) has no dedicated field for it; see runner.ts.
    return { ...data, __credits_used: PARSEBOT_DETAIL_CREDITS };
  }

  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput {
    const r = raw as Record<string, unknown>;
    const loc = isRecord(r.location) ? r.location : {};
    const agent = isRecord(r.agency) ? r.agency : isRecord(r.owner) ? r.owner : isRecord(r.contact) ? r.contact : {};
    const price = pick(r, ["price"]);
    const priceValue = isRecord(price) ? pick(price, ["value", "amount", "price"]) : price;

    const partial: Record<string, unknown> = {
      source: "imovirtual-parsebot",
      source_id: pick(r, ["id", "listing_id", "slug"]),
      source_url: pick(r, ["url", "source_url", "link"]) ?? urlFromSlug(pick(r, ["slug"])),
      transaction: pick(r, ["transaction_type", "transaction_mode", "transaction", "operation"]),
      property_type: pick(r, ["estate_type", "property_type", "type"]),
      typology: pick(r, ["typology", "rooms", "bedrooms", "number_of_rooms"]),
      price: priceValue,
      currency: isRecord(price) ? pick(price, ["currency"]) : undefined,
      area_useful: pick(r, ["area", "area_m2", "useful_area", "size"]),
      floor: pick(r, ["floor"]),
      year_built: pick(r, ["year_built", "construction_year"]),
      bathrooms: pick(r, ["bathrooms", "number_of_bathrooms"]),
      condition: pick(r, ["condition", "state", "status"]),
      district: pick(loc, ["district"]) ?? pick(r, ["district"]),
      municipality: pick(loc, ["municipality", "city"]) ?? pick(r, ["municipality", "city"]),
      parish: pick(loc, ["parish"]) ?? pick(r, ["parish"]),
      neighbourhood: pick(loc, ["neighbourhood", "neighborhood"]) ?? pick(r, ["neighbourhood"]),
      address: pick(loc, ["address"]) ?? pick(r, ["address"]),
      postal_code: pick(loc, ["postal_code", "zip_code"]) ?? pick(r, ["postal_code"]),
      lat: pick(loc, ["lat", "latitude"]) ?? pick(r, ["lat", "latitude"]),
      lng: pick(loc, ["lng", "lon", "longitude"]) ?? pick(r, ["lng", "longitude"]),
      location_text: typeof r.location === "string" ? r.location : undefined,
      features_raw: pick(r, ["characteristics", "features", "amenities"]),
      energy_certificate: pick(r, ["energy_certificate", "energy_rating", "energy_class"]),
      photos: pick(r, ["images", "photos", "gallery"]),
      agent_name: pick(agent, ["name"]),
      agency: pick(agent, ["agency_name", "name", "company"]),
      agency_id: pick(agent, ["id", "agency_id"]),
      agent_phone: pick(agent, ["phone", "telephone"]),
      agent_email: pick(agent, ["email"]),
      description_original: pick(r, ["description", "description_original"]),
      raw_ref: pick(r, ["slug", "id"]),
    };
    return finalizeListingInput(partial, ctx);
  }
}

function urlFromSlug(slug: unknown): string | undefined {
  return typeof slug === "string" && slug ? `https://www.imovirtual.com/anuncio/${slug}.html` : undefined;
}
