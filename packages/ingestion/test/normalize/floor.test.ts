import { describe, expect, it } from "vitest";
import { parseFloor } from "../../src/normalize/floor";

describe("parseFloor", () => {
  it.each([
    ["3.º andar", "3"],
    ["Rés do chão", "R/C"],
    ["r/c", "R/C"],
    ["cave", "-1"],
    ["andar 5", "5"],
    [3, "3"],
  ])("parses %s -> %s", (input, expected) => {
    expect(parseFloor(input)).toBe(expected);
  });

  it("returns null for absent input", () => {
    expect(parseFloor(null)).toBeNull();
    expect(parseFloor(undefined)).toBeNull();
    expect(parseFloor("")).toBeNull();
  });

  it("keeps unrecognised text, truncated to 24 chars", () => {
    const long = "penthouse com terraço panorâmico enorme";
    const result = parseFloor(long);
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(24);
  });
});
