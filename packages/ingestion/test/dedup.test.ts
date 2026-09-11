import { sampleListingInput } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { DedupIndex, exactKey, isMaterialChange, nearDuplicate } from "../src/dedup";

describe("exactKey", () => {
  it("is source:source_id", () => {
    expect(exactKey({ source: "csv-feed", source_id: "LP-1" })).toBe("csv-feed:LP-1");
  });
});

describe("isMaterialChange", () => {
  it("is false when no material field changed", () => {
    const a = sampleListingInput();
    const b = sampleListingInput();
    expect(isMaterialChange(a, b)).toBe(false);
  });

  it("is true when price changes", () => {
    const a = sampleListingInput();
    const b = sampleListingInput({ price: 750000 });
    expect(isMaterialChange(a, b)).toBe(true);
  });

  it("is false for a features re-order (order-insensitive)", () => {
    const a = sampleListingInput({ features: ["varanda", "garagem"] });
    const b = sampleListingInput({ features: ["garagem", "varanda"] });
    expect(isMaterialChange(a, b)).toBe(false);
  });

  it("is unaffected by fetched_at-style fields not part of ListingInput", () => {
    // description_original IS material; photos and raw_ref churn is not part of MATERIAL_FIELDS.
    const a = sampleListingInput({ raw_ref: "ref-1" });
    const b = sampleListingInput({ raw_ref: "ref-2" });
    expect(isMaterialChange(a, b)).toBe(false);
  });
});

describe("nearDuplicate", () => {
  const base = sampleListingInput();

  it("matches within tolerance on area and price with the same normalised address", () => {
    const other = sampleListingInput({
      source: "casafari",
      source_id: "casafari-1",
      price: 750000, // within 2%
      area: { ...base.area, useful_m2: 120 }, // within 3% of 118
    });
    expect(nearDuplicate(base, other)).toBe(true);
  });

  it("does not match when price is outside tolerance", () => {
    const other = sampleListingInput({
      source: "casafari",
      source_id: "casafari-2",
      price: 800000, // >2% away from 745000
    });
    expect(nearDuplicate(base, other)).toBe(false);
  });

  it("does not match when area is outside tolerance", () => {
    const other = sampleListingInput({
      source: "casafari",
      source_id: "casafari-3",
      area: { ...base.area, useful_m2: 140 },
    });
    expect(nearDuplicate(base, other)).toBe(false);
  });

  it("does not match a different typology, transaction or municipality", () => {
    expect(nearDuplicate(base, sampleListingInput({ typology: "T2", source_id: "d1" }))).toBe(false);
    expect(nearDuplicate(base, sampleListingInput({ transaction: "rent", price_period: "month", source_id: "d2" }))).toBe(false);
    expect(
      nearDuplicate(
        base,
        sampleListingInput({
          source_id: "d3",
          location: { ...base.location, municipality: "Porto" },
        }),
      ),
    ).toBe(false);
  });

  it("respects a custom tolerance", () => {
    const other = sampleListingInput({ source_id: "d4", price: 760000 }); // ~2% over 745000
    expect(nearDuplicate(base, other, { price: 0.005 })).toBe(false);
    expect(nearDuplicate(base, other, { price: 0.05 })).toBe(true);
  });
});

describe("DedupIndex", () => {
  it("reports new, changed and unchanged on add()", () => {
    const index = new DedupIndex();
    const v1 = sampleListingInput();
    expect(index.add(v1)).toBe("new");
    expect(index.add(v1)).toBe("unchanged");
    const v2 = sampleListingInput({ price: 760000 });
    expect(index.add(v2)).toBe("changed");
    expect(index.size).toBe(1);
  });

  it("finds near duplicates by fingerprint across different exact keys", () => {
    const index = new DedupIndex();
    const owned = sampleListingInput();
    index.add(owned);

    const scraped = sampleListingInput({ source: "casafari", source_id: "casafari-1", price: 750000 });
    const matches = index.findNearDuplicates(scraped);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.source_id).toBe(owned.source_id);
  });

  it("does not return itself as a near duplicate", () => {
    const index = new DedupIndex();
    const a = sampleListingInput();
    index.add(a);
    expect(index.findNearDuplicates(a)).toHaveLength(0);
  });
});
