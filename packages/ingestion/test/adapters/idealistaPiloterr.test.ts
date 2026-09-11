import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizeContext, SavedSearch } from "@imovel/core";
import { describe, expect, it, vi } from "vitest";
import { IdealistaPiloterrSource } from "../../src/adapters/idealistaPiloterr";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "../fixtures/idealistaPiloterr");
const searchFixture = JSON.parse(readFileSync(join(FIXTURES, "search.json"), "utf-8"));
const propertyFixture = JSON.parse(readFileSync(join(FIXTURES, "property.json"), "utf-8"));

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: [] };

function query(q: Record<string, unknown>): SavedSearch {
  return {
    id: "s1",
    tenant_id: "t1",
    source: "idealista-piloterr",
    query: q,
    cron: "0 6 * * *",
    enabled: true,
    max_pages: 10,
    max_credits_per_run: 500,
    last_run_at: null,
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const SEARCH_URL = "https://www.idealista.pt/comprar-casas/porto/";

describe("IdealistaPiloterrSource", () => {
  it("search() returns items and the pagination.next URL as the cursor", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, searchFixture));
    const source = new IdealistaPiloterrSource({ apiKey: "key", fetch: fetchImpl });

    const page = await source.search(query({ search_url: SEARCH_URL }), null);
    expect(page.items).toHaveLength(1);
    expect(page.next).toBe("https://api.piloterr.com/v2/idealista/search?query=next-page-url");
    expect(page.total).toBe(12);
    expect(page.credits_used).toBe(3);

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("query")).toBe(SEARCH_URL);
    expect(fetchImpl.mock.calls[0]![1].headers["x-api-key"]).toBe("key");
  });

  it("search() fetches the cursor URL directly on the next page", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { results: [], pagination: { has_next: false } }));
    const source = new IdealistaPiloterrSource({ apiKey: "key", fetch: fetchImpl });

    const cursor = "https://api.piloterr.com/v2/idealista/search?query=next-page-url";
    const page = await source.search(query({ search_url: SEARCH_URL }), cursor);
    expect(page.next).toBeNull();

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("query")).toBe(cursor);
  });

  it("detail() returns the property payload tagged with its credit cost", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, propertyFixture));
    const source = new IdealistaPiloterrSource({ apiKey: "key", fetch: fetchImpl });

    const raw = await source.detail({ source_id: "33445566", url: "https://www.idealista.pt/imovel/33445566/" });
    expect((raw as Record<string, unknown>).__credits_used).toBe(3);
  });

  it("normalize() maps a property payload into a valid ListingInput", () => {
    const source = new IdealistaPiloterrSource({ apiKey: "key" });
    const input = source.normalize(propertyFixture, ctx);

    expect(input.source).toBe("idealista-piloterr");
    expect(input.transaction).toBe("sale");
    expect(input.property_type).toBe("apartamento");
    expect(input.typology).toBe("T2");
    expect(input.price).toBe(520000);
    expect(input.area.useful_m2).toBe(92);
    expect(input.floor).toBe("5");
    expect(input.location.municipality).toBe("Porto");
    expect(input.features).toContain("varanda");
    expect(input.features).toContain("vista_mar");
    expect(input.energy_certificate).toBe("B");
    expect(input.photos).toHaveLength(2);
  });

  it("maps a 429 to RateLimitError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 429 }));
    const source = new IdealistaPiloterrSource({ apiKey: "key", fetch: fetchImpl, retries: 0 });
    await expect(source.search(query({ search_url: SEARCH_URL }), null)).rejects.toMatchObject({
      name: "RateLimitError",
    });
  });

  it("throws when query.query.search_url is missing", async () => {
    const source = new IdealistaPiloterrSource({ apiKey: "key" });
    await expect(source.search(query({}), null)).rejects.toMatchObject({ name: "ValidationError" });
  });
});
