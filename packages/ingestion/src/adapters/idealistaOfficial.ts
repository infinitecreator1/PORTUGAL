import type {
  CallOptions,
  ListingInput,
  ListingSource,
  NormalizeContext,
  RawListing,
  SavedSearch,
  SearchPage,
} from "@imovel/core";
import { UpstreamError, ValidationError } from "@imovel/core";
import { fetchJson } from "../http";
import { finalizeListingInput } from "../normalize/index";
import { numberOf, pick, pickArray } from "./apiCommon";

export interface IdealistaOfficialOptions {
  apiKey: string;
  apiSecret: string;
  /** Default `https://api.idealista.com`. */
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  retries?: number;
  /** Injectable clock for token-expiry tests. Default `Date.now`. */
  now?: () => number;
}

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/**
 * Idealista's official partner API. Verified Sept 2026: OAuth2 client-credentials at
 * `POST /oauth/token` (`grant_type=client_credentials&scope=read`, HTTP Basic `apikey:secret`),
 * search `POST /3.5/pt/search` (form fields `operation`, `propertyType=homes`, `center`,
 * `distance`, `maxItems`, `numPage`, `locale=pt`), response `elementList[]` with `propertyCode,
 * price, size, rooms, bathrooms, floor, address, municipality, district, province, latitude,
 * longitude, thumbnail, hasLift, description, operation, propertyType, status`. Partner approval
 * is required to get real credentials, so this adapter — unlike the field list above — is UNVERIFIED
 * against a live account; treat it as implemented-from-docs until a partner key confirms it.
 *
 * No per-listing detail endpoint is documented, so `detail()` throws; the search summary is the
 * full record this API offers.
 */
export class IdealistaOfficialSource implements ListingSource {
  readonly id = "idealista-official" as const;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly now: () => number;
  private token: CachedToken | null = null;

  constructor(opts: IdealistaOfficialOptions) {
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.baseUrl = (opts.baseUrl ?? "https://api.idealista.com").replace(/\/+$/, "");
    this.fetchImpl = opts.fetch;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.retries = opts.retries ?? 3;
    this.now = opts.now ?? (() => Date.now());
  }

  capabilities(): { search: boolean; detail: boolean; rpm: number } {
    // Idealista's real per-tier rate limit is not published; 100 is a conservative placeholder.
    return { search: true, detail: false, rpm: 100 };
  }

  /** Cached client-credentials token; refreshed 5 s before its declared `expires_in`. */
  private async accessToken(opts?: CallOptions): Promise<string> {
    if (this.token && this.token.expiresAt > this.now()) return this.token.accessToken;
    const basic = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString("base64");
    const data = await fetchJson<Record<string, unknown>>(
      `${this.baseUrl}/oauth/token`,
      {
        method: "POST",
        headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: "grant_type=client_credentials&scope=read",
      },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    const accessToken = pick(data, ["access_token"]);
    if (typeof accessToken !== "string" || !accessToken) {
      throw new UpstreamError("idealista-official: token response has no access_token", {
        details: { provider: this.id },
      });
    }
    const expiresIn = numberOf(pick(data, ["expires_in"])) ?? 3600;
    this.token = { accessToken, expiresAt: this.now() + expiresIn * 1000 - 5_000 };
    return accessToken;
  }

  async search(query: SavedSearch, cursor?: string | null, opts?: CallOptions): Promise<SearchPage> {
    const filters = (query.query ?? {}) as Record<string, unknown>;
    const numPage = cursor ? Number(cursor) || 1 : 1;
    const token = await this.accessToken(opts);

    const body = new URLSearchParams();
    body.set("operation", String(pick(filters, ["operation"]) ?? "sale"));
    body.set("propertyType", String(pick(filters, ["propertyType"]) ?? "homes"));
    body.set("locale", "pt");
    body.set("numPage", String(numPage));
    if (filters.center !== undefined) body.set("center", String(filters.center));
    if (filters.distance !== undefined) body.set("distance", String(filters.distance));
    if (filters.maxItems !== undefined) body.set("maxItems", String(filters.maxItems));

    const data = await fetchJson<Record<string, unknown>>(
      `${this.baseUrl}/3.5/pt/search`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      },
      { provider: this.id, fetch: this.fetchImpl, timeoutMs: opts?.timeoutMs ?? this.timeoutMs, retries: this.retries },
    );
    const items = pickArray(data, ["elementList"]);
    const totalPages = numberOf(pick(data, ["totalPages"]));
    const actualPage = numberOf(pick(data, ["actualPage"])) ?? numPage;
    const total = numberOf(pick(data, ["total"]));
    const next = totalPages !== null && actualPage < totalPages ? String(actualPage + 1) : null;
    return { items, next, total, credits_used: 0 };
  }

  async detail(): Promise<RawListing> {
    throw new ValidationError(
      "idealista-official: no documented per-listing detail endpoint; the search summary is already complete",
    );
  }

  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput {
    const r = raw as Record<string, unknown>;
    const features_raw: string[] = [];
    if (r.hasLift === true) features_raw.push("elevador");

    const partial: Record<string, unknown> = {
      source: "idealista-official",
      source_id: pick(r, ["propertyCode"]),
      source_url: pick(r, ["url"]),
      transaction: pick(r, ["operation"]),
      property_type: pick(r, ["propertyType", "detailedType"]),
      typology: pick(r, ["rooms"]),
      price: pick(r, ["price"]),
      area_useful: pick(r, ["size"]),
      floor: pick(r, ["floor"]),
      bathrooms: pick(r, ["bathrooms"]),
      condition: pick(r, ["status"]),
      // Idealista's "province" is the closest analogue to a PT district; its own "district" field
      // is a city sub-area, mapped to `neighbourhood` rather than our `district`.
      district: pick(r, ["province"]),
      municipality: pick(r, ["municipality"]),
      neighbourhood: pick(r, ["district"]),
      address: pick(r, ["address"]),
      lat: pick(r, ["latitude"]),
      lng: pick(r, ["longitude"]),
      features_raw,
      photos: typeof r.thumbnail === "string" ? [r.thumbnail] : undefined,
      description_original: pick(r, ["description"]),
      raw_ref: pick(r, ["propertyCode"]),
    };
    return finalizeListingInput(partial, ctx);
  }
}
