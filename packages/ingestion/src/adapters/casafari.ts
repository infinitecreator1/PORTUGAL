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
import { isRecord, numberOf, pick, pickArray, setParam } from "./apiCommon";

export interface CasafariOptions {
  apiKey: string;
  /** `cfg.CASAFARI_BASE_URL`, default `https://api.casafari.com`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
}

/**
 * Casafari — the intended production `ListingSource` (a Lisbon-based licensed B2B aggregator,
 * pre-deduplicated across portals). Its docs sit behind a login and pricing is by sales
 * conversation, so field names are UNVERIFIED; this adapter is written defensively against the
 * shapes the architecture doc calls "plausible key names" and must be mapped to the real payload
 * once a sandbox key arrives. `Authorization: Bearer <CASAFARI_API_KEY>`, `GET /v1/listings`
 * (search: `page`, `page_size`, filters) and `GET /v1/listings/{id}` (detail).
 */
export class CasafariSource implements ListingSource {
  readonly id = "casafari" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(opts: CasafariOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://api.casafari.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 3;
  }

  capabilities(): { search: boolean; detail: boolean; rpm: number } {
    return { search: true, detail: true, rpm: 60 };
  }

  async search(query: SavedSearch, cursor?: string | null, opts?: CallOptions): Promise<SearchPage> {
    const filters = (query.query ?? {}) as Record<string, unknown>;
    const pageSize = numberOf(filters.page_size) ?? 50;
    const page = cursor ? Number(cursor) || 1 : 1;

    const url = new URL(`${this.baseUrl}/v1/listings`);
    setParam(url, "page", page);
    setParam(url, "page_size", pageSize);
    for (const [key, value] of Object.entries(filters)) {
      if (key === "page" || key === "page_size") continue;
      setParam(url, key, value);
    }

    const data = await fetchJson<Record<string, unknown>>(
      url.toString(),
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    const items = pickArray(data, ["results", "items", "listings", "data"]);
    const pagination = isRecord(data.pagination) ? data.pagination : data;
    const totalCount = numberOf(pick(pagination, ["total_count", "total"]));
    const pageCount =
      numberOf(pick(pagination, ["page_count", "total_pages"])) ??
      (totalCount !== null && pageSize > 0 ? Math.ceil(totalCount / pageSize) : null);
    const next = pageCount !== null && page < pageCount ? String(page + 1) : items.length === pageSize ? String(page + 1) : null;
    return { items, next, total: totalCount, credits_used: 0 };
  }

  async detail(ref: { source_id: string; url?: string | null }, opts?: CallOptions): Promise<RawListing> {
    const url = new URL(`${this.baseUrl}/v1/listings/${encodeURIComponent(ref.source_id)}`);
    return fetchJson<Record<string, unknown>>(
      url.toString(),
      { headers: { Authorization: `Bearer ${this.apiKey}` } },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
  }

  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput {
    const r = raw as Record<string, unknown>;
    const loc = isRecord(r.location) ? r.location : {};
    const agent = isRecord(r.agency) ? r.agency : isRecord(r.agent) ? r.agent : {};

    const partial: Record<string, unknown> = {
      source: "casafari",
      source_id: pick(r, ["id", "listing_id", "reference"]),
      source_url: pick(r, ["url", "source_url"]),
      transaction: pick(r, ["transaction", "operation", "listing_type"]),
      property_type: pick(r, ["property_type", "type"]),
      typology: pick(r, ["typology", "bedrooms"]),
      price: pick(r, ["price", "asking_price"]),
      area_gross: pick(r, ["gross_area"]),
      area_useful: pick(r, ["area", "useful_area"]),
      floor: pick(r, ["floor"]),
      year_built: pick(r, ["year_built"]),
      bathrooms: pick(r, ["bathrooms"]),
      condition: pick(r, ["condition", "status"]),
      district: pick(loc, ["district"]) ?? pick(r, ["district"]),
      municipality: pick(loc, ["municipality"]) ?? pick(r, ["municipality"]),
      parish: pick(loc, ["parish"]) ?? pick(r, ["parish"]),
      neighbourhood: pick(loc, ["neighbourhood"]) ?? pick(r, ["neighbourhood"]),
      address: pick(loc, ["address"]) ?? pick(r, ["address"]),
      postal_code: pick(loc, ["postal_code"]) ?? pick(r, ["postal_code"]),
      lat: pick(loc, ["lat"]) ?? pick(r, ["lat"]),
      lng: pick(loc, ["lng"]) ?? pick(r, ["lng"]),
      features_raw: pick(r, ["features", "amenities"]),
      energy_certificate: pick(r, ["energy_certificate", "energy_rating"]),
      photos: pick(r, ["photos", "images"]),
      agent_name: pick(agent, ["name"]),
      agency: pick(agent, ["name", "agency_name"]),
      agency_id: pick(agent, ["id", "agency_id"]),
      agent_phone: pick(agent, ["phone"]),
      agent_email: pick(agent, ["email"]),
      description_original: pick(r, ["description"]),
      raw_ref: pick(r, ["id", "reference"]),
    };
    return finalizeListingInput(partial, ctx);
  }
}
