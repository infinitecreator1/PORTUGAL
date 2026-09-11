import { describe, expect, it } from "vitest";
import { parsePropertyType } from "../../src/normalize/propertyType";

describe("parsePropertyType", () => {
  it.each([
    ["Apartamento", "apartamento"],
    ["apartment", "apartamento"],
    ["flat", "apartamento"],
    ["T3", "apartamento"],
    ["Moradia", "moradia"],
    ["house", "moradia"],
    ["villa", "moradia"],
    ["Terreno", "terreno"],
    ["land", "terreno"],
    ["Loja", "loja"],
    ["shop", "loja"],
    ["Escritório", "escritorio"],
    ["office", "escritorio"],
    ["Armazém", "armazem"],
    ["warehouse", "armazem"],
    ["Prédio", "predio"],
    ["building", "predio"],
    ["Quinta", "quinta"],
    ["farmhouse", "quinta"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parsePropertyType(input)).toBe(expected);
  });

  it("falls back to 'outro' for unknown or non-string input", () => {
    expect(parsePropertyType("xyz-tipo-desconhecido")).toBe("outro");
    expect(parsePropertyType(null)).toBe("outro");
    expect(parsePropertyType(undefined)).toBe("outro");
    expect(parsePropertyType(42)).toBe("outro");
    expect(parsePropertyType("")).toBe("outro");
  });
});
