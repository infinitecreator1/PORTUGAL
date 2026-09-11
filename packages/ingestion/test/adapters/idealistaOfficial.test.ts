import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizeContext, SavedSearch } from "@imovel/core";
import { describe, expect, it, vi } from "vitest";
import { IdealistaOfficialSource } from "../../src/adapters/idealistaOfficial";

const here = dirname(fileURLToPath(import.meta.url));
const searchFixture = JSON.parse(readFileSync(join(here, "../fixtures/idealistaOfficial/search.json"), "utf-8"));

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: [] };

function query(q: Record<string, unknown> = {}): SavedSearch {
  return {
    id: "s1",
    tenant_id: "t1",
    source: "idealista-official",
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

function fakeFetch() {
  return vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok-1", expires_in: 3600 }))
    .mockResolvedValueOnce(jsonResponse(200, searchFixture));
}

describe("IdealistaOfficialSource", () => {
  it("search() gets an OAuth token then posts the search, returning items and the next page", async () => {
    const fetchImpl = fakeFetch();
    const source = new IdealistaOfficialSource({ apiKey: "key", apiSecret: "secret", fetch: fetchImpl });

    const page = await source.search(query({ operation: "sale" }), null);
    expect(page.items).toHaveLength(1);
    expect(page.next).toBeNull(); // totalPages: 1
    expect(page.total).toBe(1);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [tokenUrl, tokenInit] = fetchImpl.mock.calls[0]!;
    expect((tokenUrl as string).endsWith("/oauth/token")).toBe(true);
    expect((tokenInit as RequestInit & { headers: Record<string, string> }).headers.Authorization).toMatch(/^Basic /);

    const [searchUrl, searchInit] = fetchImpl.mock.calls[1]!;
    expect((searchUrl as string).endsWith("/3.5/pt/search")).toBe(true);
    expect((searchInit as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe("Bearer tok-1");
    expect(String(searchInit!.body)).toContain("operation=sale");
  });

  it("caches the access token across two search() calls (only one token fetch)", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok-1", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse(200, searchFixture))
      .mockResolvedValueOnce(jsonResponse(200, searchFixture));
    const source = new IdealistaOfficialSource({ apiKey: "key", apiSecret: "secret", fetch: fetchImpl, now: () => now });

    await source.search(query(), null);
    now += 1000;
    await source.search(query(), "1");
    expect(fetchImpl).toHaveBeenCalledTimes(3); // 1 token fetch + 2 searches
  });

  it("refreshes the token once it has expired", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok-1", expires_in: 10 }))
      .mockResolvedValueOnce(jsonResponse(200, searchFixture))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok-2", expires_in: 10 }))
      .mockResolvedValueOnce(jsonResponse(200, searchFixture));
    const source = new IdealistaOfficialSource({ apiKey: "key", apiSecret: "secret", fetch: fetchImpl, now: () => now });

    await source.search(query(), null);
    now += 11_000; // past the 10s expiry
    await source.search(query(), null);
    expect(fetchImpl).toHaveBeenCalledTimes(4); // 2 token fetches + 2 searches
  });

  it("normalize() maps an elementList item into a valid ListingInput", () => {
    const source = new IdealistaOfficialSource({ apiKey: "key", apiSecret: "secret" });
    const input = source.normalize(searchFixture.elementList[0], ctx);

    expect(input.source).toBe("idealista-official");
    expect(input.source_id).toBe("98765432");
    expect(input.transaction).toBe("sale");
    expect(input.property_type).toBe("apartamento");
    expect(input.typology).toBe("T3");
    expect(input.price).toBe(745000);
    expect(input.area.useful_m2).toBe(118);
    expect(input.bathrooms).toBe(2);
    expect(input.condition).toBe("renovado"); // status: "renew"
    expect(input.location.district).toBe("Lisboa"); // mapped from "province"
    expect(input.location.municipality).toBe("Lisboa");
    expect(input.features).toContain("elevador"); // hasLift: true
    expect(input.photos).toHaveLength(1);
  });

  it("maps a 429 on the search call to RateLimitError", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "tok-1", expires_in: 3600 }))
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 429 }));
    const source = new IdealistaOfficialSource({ apiKey: "key", apiSecret: "secret", fetch: fetchImpl, retries: 0 });
    await expect(source.search(query(), null)).rejects.toMatchObject({ name: "RateLimitError" });
  });

  it("detail() is not supported (no documented per-listing endpoint)", async () => {
    const source = new IdealistaOfficialSource({ apiKey: "key", apiSecret: "secret" });
    await expect(source.detail()).rejects.toMatchObject({ name: "ValidationError" });
  });
});
