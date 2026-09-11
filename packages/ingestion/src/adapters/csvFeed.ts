import { readFileSync } from "node:fs";
import type {
  ListingInput,
  ListingSource,
  NormalizeContext,
  RawListing,
  SavedSearch,
  SearchPage,
} from "@imovel/core";
import { ValidationError } from "@imovel/core";
import { XMLParser } from "fast-xml-parser";
import Papa from "papaparse";
import { finalizeListingInput } from "../normalize/index";

const DEFAULT_PAGE_SIZE = 200;

function readSource(q: Record<string, unknown>, source: "csv-feed" | "xml-feed"): string {
  if (typeof q.content === "string") return q.content;
  if (typeof q.path === "string") {
    try {
      return readFileSync(q.path, "utf-8");
    } catch (cause) {
      throw new ValidationError(`${source}: could not read file at query.path`, {
        cause,
        details: { path: q.path },
      });
    }
  }
  throw new ValidationError(`${source}: query.query.content or query.query.path is required`);
}

function pageSizeOf(q: Record<string, unknown>): number {
  const n = q.page_size;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : DEFAULT_PAGE_SIZE;
}

function pageOf(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const n = Number(cursor);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function paginate<T>(rows: T[], q: Record<string, unknown>, cursor: string | null | undefined) {
  const pageSize = pageSizeOf(q);
  const page = pageOf(cursor);
  const start = page * pageSize;
  const items = rows.slice(start, start + pageSize);
  const next = start + pageSize < rows.length ? String(page + 1) : null;
  return { items, next, total: rows.length };
}

/** Converts every blank CSV cell ("") to `null` so downstream parsers see a clean absent value. */
function blanksToNull(row: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) out[key] = value === "" ? null : value;
  return out;
}

/**
 * Agency CSV feed. Columns match `evals/golden/listings/sample.csv`: pipe-separated `features`
 * and `photos`, blank cells become `null`. Always available for owned listings; no API key needed.
 */
export class CsvFeedSource implements ListingSource {
  readonly id = "csv-feed" as const;

  capabilities(): { search: boolean; detail: boolean; rpm: number } {
    return { search: true, detail: false, rpm: 10_000 };
  }

  async search(query: SavedSearch, cursor: string | null = null): Promise<SearchPage> {
    const q = query.query as Record<string, unknown>;
    const content = readSource(q, "csv-feed");
    const parsed = Papa.parse<Record<string, string>>(content, { header: true, skipEmptyLines: true });
    const rows = parsed.data.map(blanksToNull);
    return paginate(rows, q, cursor);
  }

  async detail(_ref: { source_id: string; url?: string | null }): Promise<RawListing> {
    throw new ValidationError("csv-feed does not support detail fetches");
  }

  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput {
    return finalizeListingInput({ ...raw, source: "csv-feed", ownership: raw.ownership ?? "owned" }, ctx);
  }
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  parseAttributeValue: false,
  parseTagValue: false,
});

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function attr(v: unknown, name: string): unknown {
  return isRecord(v) ? v[`@_${name}`] : undefined;
}

/**
 * Agency XML feed:
 * `<listings><listing><source_id>…</source_id>…<features><feature>…</feature></features>
 * <photos><photo url="…" room="…"/></photos></listing></listings>`. Other listing fields use the
 * same names as the CSV feed (`transaction`, `property_type`, `typology`, `price`, `area_gross`, …).
 */
export class XmlFeedSource implements ListingSource {
  readonly id = "xml-feed" as const;

  capabilities(): { search: boolean; detail: boolean; rpm: number } {
    return { search: true, detail: false, rpm: 10_000 };
  }

  async search(query: SavedSearch, cursor: string | null = null): Promise<SearchPage> {
    const q = query.query as Record<string, unknown>;
    const content = readSource(q, "xml-feed");
    let doc: unknown;
    try {
      doc = xmlParser.parse(content);
    } catch (cause) {
      throw new ValidationError("xml-feed: could not parse XML", { cause });
    }
    const root = isRecord(doc) && isRecord(doc.listings) ? doc.listings : undefined;
    const listings = asArray(root?.listing).filter(isRecord) as RawListing[];
    return paginate(listings, q, cursor);
  }

  async detail(_ref: { source_id: string; url?: string | null }): Promise<RawListing> {
    throw new ValidationError("xml-feed does not support detail fetches");
  }

  normalize(raw: RawListing, ctx: NormalizeContext): ListingInput {
    const featuresNode = isRecord(raw.features) ? raw.features : undefined;
    const features_raw = asArray(featuresNode?.feature).map((f) => String(f).trim()).filter(Boolean);

    const photosNode = isRecord(raw.photos) ? raw.photos : undefined;
    const photos = asArray(photosNode?.photo).map((p) => ({
      url: attr(p, "url") ?? (typeof p === "string" ? p : undefined),
      room: attr(p, "room") ?? null,
    }));

    const { features: _features, photos: _photos, ...rest } = raw;
    const partial: Record<string, unknown> = {
      ...rest,
      source: "xml-feed",
      features_raw,
      photos,
      ownership: raw.ownership ?? "owned",
    };
    return finalizeListingInput(partial, ctx);
  }
}
