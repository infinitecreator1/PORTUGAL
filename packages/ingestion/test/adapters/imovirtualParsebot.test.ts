import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizeContext, SavedSearch } from "@imovel/core";
import { describe, expect, it, vi } from "vitest";
import { ImovirtualParsebotSource } from "../../src/adapters/imovirtualParsebot";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, "../fixtures/imovirtualParsebot");
const searchFixture = JSON.parse(readFileSync(join(FIXTURES, "search.json"), "utf-8"));
const detailFixture = JSON.parse(readFileSync(join(FIXTURES, "detail.json"), "utf-8"));

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: ["lisboa-prime"] };

function query(filters: Record<string, unknown> = {}): SavedSearch {
  return {
    id: "s1",
    tenant_id: "t1",
    source: "imovirtual-parsebot",
    query: filters,
    cron: "0 6 * * *",
    enabled: true,
    max_pages: 10,
    max_credits_per_run: 500,
    last_run_at: null,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("ImovirtualParsebotSource", () => {
  it("search() returns items and the next cursor from pagination", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, searchFixture));
    const source = new ImovirtualParsebotSource({ apiKey: "key", fetch: fetchImpl });

    const page = await source.search(query({ transaction: "sale", location: "Lisboa" }), null);

    expect(page.items).toHaveLength(1);
    expect(page.next).toBe("2");
    expect(page.total).toBe(41);
    expect(page.credits_used).toBe(5);

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.pathname).toContain("search_listings");
    expect(fetchImpl.mock.calls[0]![1].headers["X-API-Key"]).toBe("key");
  });

  it("detail() returns the raw payload tagged with its credit cost", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, detailFixture));
    const source = new ImovirtualParsebotSource({ apiKey: "key", fetch: fetchImpl });

    const raw = await source.detail({ source_id: "78321" });
    expect((raw as Record<string, unknown>).__credits_used).toBe(1);

    const url = new URL(fetchImpl.mock.calls[0]![0] as string);
    expect(url.searchParams.get("slug")).toBe("78321");
  });

  it("normalize() maps a detail payload into a valid ListingInput", async () => {
    const source = new ImovirtualParsebotSource({ apiKey: "key" });
    const input = source.normalize(detailFixture, ctx);

    expect(input.source).toBe("imovirtual-parsebot");
    expect(input.source_id).toBe("78321");
    expect(input.transaction).toBe("sale");
    expect(input.property_type).toBe("apartamento");
    expect(input.typology).toBe("T3");
    expect(input.price).toBe(745000);
    expect(input.area.useful_m2).toBe(118);
    expect(input.location.district).toBe("Lisboa");
    expect(input.location.municipality).toBe("Lisboa");
    expect(input.location.parish).toBe("Campo de Ourique");
    expect(input.features).toContain("varanda");
    expect(input.features).toContain("garagem");
    expect(input.agent.agency_id).toBe("lisboa-prime");
    expect(input.ownership).toBe("owned"); // agency_id matches ctx.agency_ids
    expect(input.photos).toHaveLength(2);
  });

  it("normalize() from the search summary alone still produces a valid ListingInput", async () => {
    const source = new ImovirtualParsebotSource({ apiKey: "key" });
    const summary = searchFixture.results[0];
    const input = source.normalize(summary, ctx);
    expect(input.typology).toBe("T3");
    expect(input.price).toBe(745000);
    expect(input.location.parish).toBe("Campo de Ourique");
  });

  it("maps a 429 to RateLimitError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: "slow down" }));
    const source = new ImovirtualParsebotSource({ apiKey: "key", fetch: fetchImpl, retries: 0 });
    await expect(source.search(query(), null)).rejects.toMatchObject({ name: "RateLimitError" });
  });
});
