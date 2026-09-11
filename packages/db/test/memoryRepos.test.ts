import { describe, expect, it } from "vitest";
import { sampleListing } from "@imovel/core/fixtures";
import { areaMatches, createMemoryRepos, deterministicUuid, isNearDuplicate, monthBounds, withinTolerance } from "../src";
import { runRepoSuite } from "./repoSuite";

runRepoSuite("memory", async () => ({ repos: createMemoryRepos() }));

describe("near-duplicate rules", () => {
  it("withinTolerance treats both-null as equal and one-null as different", () => {
    expect(withinTolerance(null, null, 0.02)).toBe(true);
    expect(withinTolerance(100, null, 0.02)).toBe(false);
    expect(withinTolerance(100, 102, 0.02)).toBe(true);
    expect(withinTolerance(100, 103, 0.02)).toBe(false);
  });

  it("areaMatches prefers useful_m2, then gross_m2, then no-area-at-all", () => {
    expect(areaMatches({ useful_m2: 118, gross_m2: 132, plot_m2: null }, { useful_m2: 120, gross_m2: 200, plot_m2: null }, 0.03)).toBe(true);
    expect(areaMatches({ useful_m2: 118, gross_m2: 132, plot_m2: null }, { useful_m2: null, gross_m2: 134, plot_m2: null }, 0.03)).toBe(true);
    expect(areaMatches({ useful_m2: 118, gross_m2: null, plot_m2: null }, { useful_m2: null, gross_m2: 134, plot_m2: null }, 0.03)).toBe(false);
    expect(areaMatches({ useful_m2: null, gross_m2: null, plot_m2: null }, { useful_m2: null, gross_m2: null, plot_m2: null }, 0.03)).toBe(true);
    expect(areaMatches({ useful_m2: null, gross_m2: null, plot_m2: null }, { useful_m2: 100, gross_m2: null, plot_m2: null }, 0.03)).toBe(false);
  });

  it("isNearDuplicate applies tenant, transaction, typology, location, area and price", () => {
    const a = sampleListing();
    const b = { ...sampleListing({ source_id: "b", price: 750000 }), id: "22222222-2222-4222-8222-222222222223" };
    expect(isNearDuplicate(a, b)).toBe(true);
    expect(isNearDuplicate(a, { ...b, tenant_id: "00000000-0000-4000-8000-000000000009" })).toBe(false);
    expect(isNearDuplicate(a, { ...b, transaction: "rent" })).toBe(false);
    expect(isNearDuplicate(a, { ...b, typology: null })).toBe(false);
    expect(isNearDuplicate(a, { ...b, location: { ...b.location, municipality: "Porto" } })).toBe(false);
    expect(isNearDuplicate(a, { ...b, location: { ...b.location, municipality: " LISBOA " } })).toBe(true);
    expect(isNearDuplicate(a, { ...b, price: 780000 })).toBe(false);
    expect(isNearDuplicate(a, a)).toBe(false);
  });
});

describe("ids", () => {
  it("deterministicUuid is stable and uuid-shaped", () => {
    const a = deterministicUuid("ns", "x");
    expect(a).toBe(deterministicUuid("ns", "x"));
    expect(a).not.toBe(deterministicUuid("ns", "y"));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("monthBounds covers the UTC month", () => {
    const { start, end } = monthBounds("2026-12");
    expect(start.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(() => monthBounds("2026-1")).toThrow();
  });
});
