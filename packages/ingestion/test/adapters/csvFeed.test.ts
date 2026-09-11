import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizeContext, SavedSearch } from "@imovel/core";
import { ListingInput } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { CsvFeedSource } from "../../src/adapters/csvFeed";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_CSV_PATH = join(here, "../../../../evals/golden/listings/sample.csv");

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: [] };

function search(query: Record<string, unknown>) {
  const savedSearch: SavedSearch = {
    id: "s1",
    tenant_id: "t1",
    source: "csv-feed",
    query,
    cron: "0 6 * * *",
    enabled: true,
    max_pages: 10,
    max_credits_per_run: 500,
    last_run_at: null,
  };
  return savedSearch;
}

describe("CsvFeedSource", () => {
  it("parses evals/golden/listings/sample.csv into 5 valid ListingInput rows", async () => {
    const source = new CsvFeedSource();
    const page = await source.search(search({ path: SAMPLE_CSV_PATH }), null);
    expect(page.items).toHaveLength(5);
    expect(page.next).toBeNull();

    const inputs = page.items.map((raw) => source.normalize(raw, ctx));
    for (const input of inputs) {
      expect(() => ListingInput.parse(input)).not.toThrow();
    }

    const first = inputs[0]!;
    expect(first.typology).toBe("T3");
    expect(first.price).toBe(745000);
    expect(first.features).toContain("varanda");
    expect(first.features).toContain("garagem");
    expect(first.agent.agency_id).toBe("lisboa-prime");
    expect(first.ownership).toBe("owned");
  });

  it("reads from query.query.content as an alternative to a path", async () => {
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(SAMPLE_CSV_PATH, "utf-8");
    const source = new CsvFeedSource();
    const page = await source.search(search({ content }), null);
    expect(page.items).toHaveLength(5);
  });

  it("pages with a small page_size", async () => {
    const source = new CsvFeedSource();
    const query = search({ path: SAMPLE_CSV_PATH, page_size: 2 });

    const page1 = await source.search(query, null);
    expect(page1.items).toHaveLength(2);
    expect(page1.next).toBe("1");

    const page2 = await source.search(query, page1.next);
    expect(page2.items).toHaveLength(2);
    expect(page2.next).toBe("2");

    const page3 = await source.search(query, page2.next);
    expect(page3.items).toHaveLength(1);
    expect(page3.next).toBeNull();

    const seen = new Set([...page1.items, ...page2.items, ...page3.items].map((r) => (r as Record<string, unknown>).source_id));
    expect(seen.size).toBe(5);
  });

  it("turns blank cells into null", async () => {
    const source = new CsvFeedSource();
    const page = await source.search(search({ path: SAMPLE_CSV_PATH }), null);
    // BRG-2026-0509 has a blank neighbourhood column.
    const brg = page.items.find((r) => (r as Record<string, unknown>).source_id === "BRG-2026-0509")!;
    expect((brg as Record<string, unknown>).neighbourhood).toBeNull();
  });

  it("detail() is not supported", async () => {
    const source = new CsvFeedSource();
    await expect(source.detail({ source_id: "x" })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("throws when neither content nor path is given", async () => {
    const source = new CsvFeedSource();
    await expect(source.search(search({}), null)).rejects.toMatchObject({ name: "ValidationError" });
  });
});
