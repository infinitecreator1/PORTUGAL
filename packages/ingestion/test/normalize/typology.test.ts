import { describe, expect, it } from "vitest";
import { parseTypology } from "../../src/normalize/typology";

describe("parseTypology", () => {
  it.each([
    ["T3", "T3"],
    ["t3", "T3"],
    ["T3+1", "T3"],
    ["T 3", "T3"],
    ["3 quartos", "T3"],
    ["3 bedrooms", "T3"],
    ["3 dormitórios", "T3"],
    ["4 assoalhadas", "T3"],
    ["Estúdio", "T0"],
    ["Studio", "T0"],
    ["kitnet", "T0"],
    ["T0", "T0"],
    ["6", "T6+"],
    ["8 quartos", "T6+"],
    ["T9", "T6+"],
  ])("parses %s -> %s", (input, expected) => {
    expect(parseTypology(input)).toBe(expected);
  });

  it("accepts numeric input", () => {
    expect(parseTypology(3)).toBe("T3");
    expect(parseTypology(0)).toBe("T0");
    expect(parseTypology(6)).toBe("T6+");
    expect(parseTypology(12)).toBe("T6+");
  });

  it("returns null for unparseable or absent input", () => {
    expect(parseTypology(null)).toBeNull();
    expect(parseTypology(undefined)).toBeNull();
    expect(parseTypology("")).toBeNull();
    expect(parseTypology("sem informação")).toBeNull();
  });
});
