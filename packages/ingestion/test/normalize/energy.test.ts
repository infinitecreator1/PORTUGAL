import { describe, expect, it } from "vitest";
import { parseEnergyClass } from "../../src/normalize/energy";

describe("parseEnergyClass", () => {
  it.each([
    ["B-", "B-"],
    ["b -", "B-"],
    ["Classe B-", "B-"],
    ["CE: A+", "A+"],
    ["A", "A"],
    ["C", "C"],
    ["F", "F"],
  ])("parses %s -> %s", (input, expected) => {
    expect(parseEnergyClass(input)).toBe(expected);
  });

  it("maps exemption wording to 'isento'", () => {
    expect(parseEnergyClass("Isento")).toBe("isento");
    expect(parseEnergyClass("isento de certificado")).toBe("isento");
  });

  it("maps pending/not-applicable wording to null", () => {
    expect(parseEnergyClass("Em avaliação")).toBeNull();
    expect(parseEnergyClass("Em processo")).toBeNull();
    expect(parseEnergyClass("Não aplicável")).toBeNull();
  });

  it("returns null for absent, non-string or unknown input", () => {
    expect(parseEnergyClass(null)).toBeNull();
    expect(parseEnergyClass(undefined)).toBeNull();
    expect(parseEnergyClass(123)).toBeNull();
    expect(parseEnergyClass("G")).toBeNull();
    expect(parseEnergyClass("")).toBeNull();
  });
});
