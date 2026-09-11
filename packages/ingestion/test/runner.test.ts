import { sampleListingInput } from "@imovel/core/fixtures";
import { UpstreamError, ValidationError } from "@imovel/core";
import type { ListingInput, ListingSource, NormalizeContext, RawListing, SavedSearch } from "@imovel/core";
import type Bottleneck from "bottleneck";
import { describe, expect, it, vi } from "vitest";
import type { CircuitBreaker } from "../src/breaker";
import { runIngestion } from "../src/runner";

const ctx: NormalizeContext = { tenant_id: "t1", ownership_default: "owned", agency_ids: [] };
const query: SavedSearch = {
  id: "s1",
  tenant_id: "t1",
  source: "csv-feed",
  query: {},
  cron: "0 6 * * *",
  enabled: true,
  max_pages: 10,
  max_credits_per_run: 500,
  last_run_at: null,
};

/** A fake ListingSource with a fixed 3-page catalogue: page N returns item N, cursor is the page index. */
function makeThreePageSource(opts: { failOnPage?: number; creditsPerPage?: number } = {}): {
  source: ListingSource;
  searchCalls: Array<string | null | undefined>;
} {
  const searchCalls: Array<string | null | undefined> = [];
  const source: ListingSource = {
    id: "csv-feed",
    capabilities: () => ({ search: true, detail: false, rpm: 1000 }),
    async search(_q, cursor) {
      searchCalls.push(cursor);
      const page = cursor ? Number(cursor) : 0;
      if (opts.failOnPage !== undefined && page === opts.failOnPage) {
        throw new UpstreamError("upstream hiccup");
      }
      const item: RawListing = { source_id: `item-${page}`, page };
      const next = page < 2 ? String(page + 1) : null;
      return { items: [item], next, total: 3, credits_used: opts.creditsPerPage ?? 1 };
    },
    async detail() {
      throw new ValidationError("not supported");
    },
    normalize(raw): ListingInput {
      const r = raw as Record<string, unknown>;
      if (r.invalid) throw new ValidationError("bad payload");
      return sampleListingInput({ source_id: String(r.source_id) });
    },
  };
  return { source, searchCalls };
}

describe("runIngestion", () => {
  it("pages a 3-page source to completion", async () => {
    const { source } = makeThreePageSource();
    const seen: string[] = [];
    const result = await runIngestion({
      source,
      query,
      ctx,
      onItem: async (input) => {
        seen.push(input.source_id);
        return "new";
      },
    });

    expect(result.status).toBe("succeeded");
    expect(result.page).toBe(3);
    expect(result.next_cursor).toBeNull();
    expect(result.items_seen).toBe(3);
    expect(result.items_new).toBe(3);
    expect(result.credits_used).toBe(3);
    expect(seen).toEqual(["item-0", "item-1", "item-2"]);
  });

  it("resumes from a given cursor", async () => {
    const { source, searchCalls } = makeThreePageSource();
    const result = await runIngestion({
      source,
      query,
      ctx,
      cursor: "1",
      onItem: async () => "new",
    });
    expect(searchCalls).toEqual(["1", "2"]);
    expect(result.status).toBe("succeeded");
    expect(result.items_seen).toBe(2);
  });

  it("stops at maxCredits and preserves the cursor to resume", async () => {
    const { source } = makeThreePageSource({ creditsPerPage: 5 });
    const result = await runIngestion({
      source,
      query,
      ctx,
      maxCredits: 5,
      onItem: async () => "new",
    });
    expect(result.status).toBe("budget_stopped");
    expect(result.credits_used).toBe(5);
    expect(result.next_cursor).toBe("1"); // stopped after page 0, ready to resume at page 1
    expect(result.page).toBe(1);
  });

  it("stops at maxPages and preserves the cursor to resume", async () => {
    const { source } = makeThreePageSource();
    const result = await runIngestion({ source, query, ctx, maxPages: 2, onItem: async () => "new" });
    expect(result.status).toBe("budget_stopped");
    expect(result.page).toBe(2);
    expect(result.next_cursor).toBe("2");
  });

  it("counts a normalise error on one item as skipped and continues the run", async () => {
    const source: ListingSource = {
      id: "csv-feed",
      capabilities: () => ({ search: true, detail: false, rpm: 1000 }),
      async search() {
        return {
          items: [{ source_id: "ok-1" }, { source_id: "bad-1", invalid: true }, { source_id: "ok-2" }],
          next: null,
        };
      },
      async detail() {
        throw new ValidationError("not supported");
      },
      normalize(raw) {
        const r = raw as Record<string, unknown>;
        if (r.invalid) throw new ValidationError("bad payload");
        return sampleListingInput({ source_id: String(r.source_id) });
      },
    };

    const result = await runIngestion({ source, query, ctx, onItem: async () => "new" });
    expect(result.status).toBe("succeeded");
    expect(result.items_seen).toBe(3);
    expect(result.items_new).toBe(2);
    expect(result.items_skipped).toBe(1);
  });

  it("fails the run on a transport error while fetching a page, preserving the cursor", async () => {
    const { source } = makeThreePageSource({ failOnPage: 1 });
    const result = await runIngestion({ source, query, ctx, onItem: async () => "new" });
    expect(result.status).toBe("failed");
    expect(result.next_cursor).toBe("1"); // the page that failed to fetch
    expect(result.items_seen).toBe(1); // only page 0 was processed
    expect(result.error).toContain("upstream hiccup");
  });

  it("reports new/changed/unchanged from onItem", async () => {
    const source: ListingSource = {
      id: "csv-feed",
      capabilities: () => ({ search: true, detail: false, rpm: 1000 }),
      async search() {
        return { items: [{ source_id: "a" }, { source_id: "b" }, { source_id: "c" }], next: null };
      },
      async detail() {
        throw new ValidationError("not supported");
      },
      normalize(raw) {
        return sampleListingInput({ source_id: String((raw as Record<string, unknown>).source_id) });
      },
    };
    const outcomes = new Map<string, "new" | "changed" | "unchanged">([
      ["a", "new"],
      ["b", "changed"],
      ["c", "unchanged"],
    ]);
    const result = await runIngestion({
      source,
      query,
      ctx,
      onItem: async (input) => outcomes.get(input.source_id) ?? "unchanged",
    });
    expect(result.items_new).toBe(1);
    expect(result.items_changed).toBe(1);
    expect(result.items_skipped).toBe(0);
  });

  it("calls onProgress once per page", async () => {
    const { source } = makeThreePageSource();
    const onProgress = vi.fn();
    await runIngestion({ source, query, ctx, onItem: async () => "new", onProgress });
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("wraps search/detail through the limiter and breaker when given", async () => {
    const { source } = makeThreePageSource();
    const scheduleCalls: unknown[] = [];
    const limiter = {
      schedule: (fn: () => Promise<unknown>) => {
        scheduleCalls.push(fn);
        return fn();
      },
    } as unknown as Bottleneck;
    let execCalls = 0;
    const breaker = {
      exec: async (fn: () => Promise<unknown>) => {
        execCalls += 1;
        return fn();
      },
    } as unknown as CircuitBreaker;

    const result = await runIngestion({ source, query, ctx, limiter, breaker, onItem: async () => "new" });
    expect(result.status).toBe("succeeded");
    expect(scheduleCalls.length).toBe(3);
    expect(execCalls).toBe(3);
  });
});
