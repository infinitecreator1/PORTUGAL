import { describe, expect, it } from "vitest";
import { parseArea, parseNumber, parsePrice } from "../../src/normalize/price";

describe("parsePrice", () => {
  it.each([
    ["745.000 €", 745000, null],
    ["745 000€", 745000, null],
    ["€745,000", 745000, null],
    ["745000", 745000, null],
    ["1.250 €/mês", 1250, "month"],
    ["1 250 € / mês", 1250, "month"],
    ["1250/month", 1250, "month"],
  ])("parses %s -> amount %d, period %s", (input, amount, period) => {
    expect(parsePrice(input)).toEqual({ amount, period });
  });

  it("accepts a plain number", () => {
    expect(parsePrice(745000)).toEqual({ amount: 745000, period: null });
  });

  it("returns null amount for absent, non-positive or unparseable input", () => {
    expect(parsePrice(null)).toEqual({ amount: null, period: null });
    expect(parsePrice(undefined)).toEqual({ amount: null, period: null });
    expect(parsePrice("")).toEqual({ amount: null, period: null });
    expect(parsePrice(-5)).toEqual({ amount: null, period: null });
  });

  it("reads an object shape with amount/value/price and a period", () => {
    expect(parsePrice({ value: 520000, period: "total" })).toEqual({ amount: 520000, period: "total" });
    expect(parsePrice({ amount: 1250, price_period: "month" })).toEqual({ amount: 1250, period: "month" });
  });
});

describe("parseNumber", () => {
  it.each([
    ["745.000", 745000],
    ["745 000", 745000],
    ["745,000", 745000],
    ["118,5", 118.5],
    ["118.5", 118.5],
  ])("parses %s -> %d", (input, expected) => {
    expect(parseNumber(input)).toBe(expected);
  });
});

describe("parseArea", () => {
  it.each([
    ["118 m²", 118],
    ["118m2", 118],
    ["118,5", 118.5],
    [118, 118],
  ])("parses %s -> %d", (input, expected) => {
    expect(parseArea(input)).toBe(expected);
  });

  it("returns null for non-positive or unparseable input", () => {
    expect(parseArea(null)).toBeNull();
    expect(parseArea(undefined)).toBeNull();
    expect(parseArea(0)).toBeNull();
    expect(parseArea(-10)).toBeNull();
    expect(parseArea("sem área")).toBeNull();
  });
});
