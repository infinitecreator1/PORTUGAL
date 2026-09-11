import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NormalizeContext, SavedSearch } from "@imovel/core";
import { ListingInput } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { XmlFeedSource } from "../../src/adapters/csvFeed";

const here = dirname(fileURLToPath(import.meta.url));
const SAMPLE_XML_PATH = join(here, "../fixtures/xmlFeed/sample.xml");

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "third_party", agency_ids: [] };

function search(query: Record<string, unknown>): SavedSearch {
  return {
    id: "s1",
    tenant_id: "t1",
    source: "xml-feed",
    query,
    cron: "0 6 * * *",
    enabled: true,
    max_pages: 10,
    max_credits_per_run: 500,
    last_run_at: null,
  };
}

describe("XmlFeedSource", () => {
  it("parses <listings><listing>… into raw items and normalises them into valid ListingInput", async () => {
    const source = new XmlFeedSource();
    const page = await source.search(search({ path: SAMPLE_XML_PATH }), null);
    expect(page.items).toHaveLength(2);
    expect(page.next).toBeNull();

    const inputs = page.items.map((raw) => source.normalize(raw, ctx));
    for (const input of inputs) expect(() => ListingInput.parse(input)).not.toThrow();

    const first = inputs[0]!;
    expect(first.source).toBe("xml-feed");
    expect(first.source_id).toBe("XML-2026-0001");
    expect(first.typology).toBe("T3");
    expect(first.price).toBe(320000);
    expect(first.features).toContain("elevador");
    expect(first.features).toContain("garagem");
    expect(first.features).toContain("arrecadacao");
    expect(first.agent.agency_id).toBe("braga-casas");
    expect(first.ownership).toBe("owned");
    expect(first.photos).toHaveLength(2);
    expect(first.photos[0]?.url).toBe("https://example.org/xml-0001-1.jpg");
    expect(first.photos[0]?.room).toBe("sala");

    const second = inputs[1]!;
    expect(second.transaction).toBe("rent");
    expect(second.price_period).toBe("month");
    // A single <photo/> element (not wrapped in an array by the XML parser) still normalises to one photo.
    expect(second.photos).toHaveLength(1);
    expect(second.features).toContain("mobilado");
  });

  it("pages with a small page_size", async () => {
    const source = new XmlFeedSource();
    const query = search({ path: SAMPLE_XML_PATH, page_size: 1 });

    const page1 = await source.search(query, null);
    expect(page1.items).toHaveLength(1);
    expect(page1.next).toBe("1");

    const page2 = await source.search(query, page1.next);
    expect(page2.items).toHaveLength(1);
    expect(page2.next).toBeNull();
  });

  it("detail() is not supported", async () => {
    const source = new XmlFeedSource();
    await expect(source.detail({ source_id: "x" })).rejects.toMatchObject({ name: "ValidationError" });
  });

  it("throws on malformed XML content", async () => {
    const source = new XmlFeedSource();
    await expect(source.search(search({ content: "not xml at all <<<" }), null)).rejects.toMatchObject({
      name: "ValidationError",
    });
  });
});
