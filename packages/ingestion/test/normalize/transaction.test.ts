import { describe, expect, it } from "vitest";
import {
  parseCondition,
  parseLanguageTag,
  parseOwnership,
  parseTransaction,
} from "../../src/normalize/transaction";

describe("parseTransaction", () => {
  it.each([
    ["sale", "sale"],
    ["Venda", "sale"],
    ["comprar", "sale"],
    ["rent", "rent"],
    ["Arrendamento", "rent"],
    ["aluguer", "rent"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseTransaction(input)).toBe(expected);
  });

  it("returns null for unknown or non-string input", () => {
    expect(parseTransaction("qualquer coisa")).toBeNull();
    expect(parseTransaction(null)).toBeNull();
  });
});

describe("parseCondition", () => {
  it.each([
    ["renovado", "renovado"],
    ["remodelado", "renovado"],
    ["novo", "novo"],
    ["a estrear", "novo"],
    ["usado", "usado"],
    ["para recuperar", "para_recuperar"],
    ["em construção", "em_construcao"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseCondition(input)).toBe(expected);
  });

  it("returns null for unknown input", () => {
    expect(parseCondition("estado desconhecido")).toBeNull();
  });
});

describe("parseOwnership", () => {
  it.each([
    ["owned", "owned"],
    ["próprio", "owned"],
    ["represented", "represented"],
    ["mandate", "represented"],
    ["third_party", "third_party"],
    ["terceiros", "third_party"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseOwnership(input)).toBe(expected);
  });

  it("returns null for unknown input", () => {
    expect(parseOwnership("desconhecido")).toBeNull();
    expect(parseOwnership(null)).toBeNull();
  });
});

describe("parseLanguageTag", () => {
  it.each([
    ["pt-PT", "pt-PT"],
    ["pt", "pt-PT"],
    ["pt-BR", "pt-BR"],
    ["en", "en"],
    ["en-US", "en"],
  ])("maps %s -> %s", (input, expected) => {
    expect(parseLanguageTag(input)).toBe(expected);
  });

  it("falls back to 'other' for an unrecognised string", () => {
    expect(parseLanguageTag("fr")).toBe("other");
  });

  it("returns null for non-string input", () => {
    expect(parseLanguageTag(null)).toBeNull();
  });
});
