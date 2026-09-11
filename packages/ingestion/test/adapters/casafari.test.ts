import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizeContext, SavedSearch } from "@imovel/core";
import { describe, expect, it, vi } from "vitest";
import { CasafariSource } from "../../src/adapters/casafari";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "../fixtures/casafari");
const searchFixture = JSON.parse(readFileSync(join(FIXTURES, "search.json"), "utf-8"));
const detailFixture = JSON.parse(readFileSync(join(FIXTURES, "detail.json"), "utf-8"));

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: ["cascais-living"] };

function query(q: Record<string, unknown> = {}): SavedSearch {
  return {
    id: "s1",
    tenant_id: "t1",
    source: "casafari",
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

describe("CasafariSource", () => {
  it("search() sends Bearer auth and returns items with the next page cursor", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, searchFixture));
    const source = new CasafariSource({ apiKey: "secret", baseUrl: "https://api.casafari.com", fetch: fetchImpl });

    const page = await source.search(query({ municipality: "Cascais", page_size: 20 }), null);
    expect(page.items).toHaveLength(1);
    expect(page.next).toBeNull(); // page_count: 1, so no next page
    expect(page.total).toBe(3);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(new URL(url as string).pathname).toBe("/v1/listings");
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer secret");
  });

  it("detail() fetches /v1/listings/{id}", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, detailFixture));
    const source = new CasafariSource({ apiKey: "secret", fetch: fetchImpl });
    const raw = await source.detail({ source_id: "cf-100234" });
    expect((raw as Record<string, unknown>).id).toBe("cf-100234");
    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.pathname).toBe("/v1/listings/cf-100234");
  });

  it("normalize() maps a defensive payload into a valid ListingInput", () => {
    const source = new CasafariSource({ apiKey: "secret" });
    const input = source.normalize(detailFixture, ctx);

    expect(input.source).toBe("casafari");
    expect(input.transaction).toBe("sale");
    expect(input.property_type).toBe("apartamento"); // "apartment" via the property-type synonyms
    expect(input.typology).toBe("T4");
    expect(input.price).toBe(1490000);
    expect(input.area.gross_m2).toBe(320);
    expect(input.area.useful_m2).toBe(280);
    expect(input.location.district).toBe("Lisboa");
    expect(input.location.municipality).toBe("Cascais");
    expect(input.location.parish).toBe("Cascais e Estoril");
    expect(input.location.neighbourhood).toBe("Birre");
    expect(input.energy_certificate).toBe("A");
    expect(input.features).toContain("piscina");
    expect(input.features).toContain("paineis_solares");
    expect(input.agent.agency_id).toBe("cascais-living");
    expect(input.ownership).toBe("owned");
    expect(input.photos).toHaveLength(2);
  });

  it("maps a 429 to RateLimitError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 429 }));
    const source = new CasafariSource({ apiKey: "secret", fetch: fetchImpl, retries: 0 });
    await expect(source.search(query(), null)).rejects.toMatchObject({ name: "RateLimitError" });
  });
});
