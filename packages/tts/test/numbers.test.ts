import { describe, expect, it } from "vitest";
import {
  decimalToWordsPtPt,
  numberToWordsPtPt,
  ordinalToWordsPtPt,
  romanToInt,
} from "../src/normalize/numbers";

describe("numberToWordsPtPt", () => {
  it("spells the low numbers, with European pt-PT teens", () => {
    expect(numberToWordsPtPt(0)).toBe("zero");
    expect(numberToWordsPtPt(1)).toBe("um");
    expect(numberToWordsPtPt(1, { gender: "f" })).toBe("uma");
    expect(numberToWordsPtPt(2)).toBe("dois");
    expect(numberToWordsPtPt(2, { gender: "f" })).toBe("duas");
    expect(numberToWordsPtPt(14)).toBe("catorze");
    expect(numberToWordsPtPt(16)).toBe("dezasseis");
    expect(numberToWordsPtPt(17)).toBe("dezassete");
    expect(numberToWordsPtPt(19)).toBe("dezanove");
    expect(numberToWordsPtPt(21)).toBe("vinte e um");
  });

  it("uses cem for exactly 100 and cento for 101..199", () => {
    expect(numberToWordsPtPt(100)).toBe("cem");
    expect(numberToWordsPtPt(101)).toBe("cento e um");
    expect(numberToWordsPtPt(118)).toBe("cento e dezoito");
  });

  it("agrees hundreds in gender", () => {
    expect(numberToWordsPtPt(200)).toBe("duzentos");
    expect(numberToWordsPtPt(200, { gender: "f" })).toBe("duzentas");
  });

  it("never says 'um mil' for exactly one thousand", () => {
    expect(numberToWordsPtPt(1000)).toBe("mil");
  });

  it("joins a thousand with its remainder without 'e' unless the remainder is round", () => {
    expect(numberToWordsPtPt(1250)).toBe("mil duzentos e cinquenta");
    expect(numberToWordsPtPt(1021)).toBe("mil e vinte e um");
    expect(numberToWordsPtPt(1200)).toBe("mil e duzentos");
  });

  it("spells multiples of one thousand", () => {
    expect(numberToWordsPtPt(250_000)).toBe("duzentos e cinquenta mil");
    expect(numberToWordsPtPt(745_000)).toBe("setecentos e quarenta e cinco mil");
  });

  it("spells millions, singular and plural, with the same joining rule", () => {
    expect(numberToWordsPtPt(1_000_000)).toBe("um milhão");
    expect(numberToWordsPtPt(1_250_000)).toBe("um milhão duzentos e cinquenta mil");
    expect(numberToWordsPtPt(1_200_000)).toBe("um milhão e duzentos mil");
    expect(numberToWordsPtPt(2_000_000)).toBe("dois milhões");
  });

  it("rejects out-of-range or non-integer input", () => {
    expect(() => numberToWordsPtPt(-1)).toThrow();
    expect(() => numberToWordsPtPt(1_000_000_000)).toThrow();
    expect(() => numberToWordsPtPt(1.5)).toThrow();
  });
});

describe("decimalToWordsPtPt", () => {
  it("reads the decimal comma as 'vírgula'", () => {
    expect(decimalToWordsPtPt("125,5")).toBe("cento e vinte e cinco vírgula cinco");
    expect(decimalToWordsPtPt("125.5")).toBe("cento e vinte e cinco vírgula cinco");
  });

  it("drops a purely zero fraction", () => {
    expect(decimalToWordsPtPt("10,0")).toBe("dez");
  });
});

describe("ordinalToWordsPtPt", () => {
  const expected = [
    "primeiro",
    "segundo",
    "terceiro",
    "quarto",
    "quinto",
    "sexto",
    "sétimo",
    "oitavo",
    "nono",
    "décimo",
    "décimo primeiro",
    "décimo segundo",
  ];

  it("spells 1..12", () => {
    expected.forEach((word, i) => {
      expect(ordinalToWordsPtPt(i + 1)).toBe(word);
    });
  });

  it("composes tens with units, and agrees feminine", () => {
    expect(ordinalToWordsPtPt(21)).toBe("vigésimo primeiro");
    expect(ordinalToWordsPtPt(21, "f")).toBe("vigésima primeira");
    expect(ordinalToWordsPtPt(30)).toBe("trigésimo");
  });

  it("covers every decade name up to ninety", () => {
    expect(ordinalToWordsPtPt(40)).toBe("quadragésimo");
    expect(ordinalToWordsPtPt(50)).toBe("quinquagésimo");
    expect(ordinalToWordsPtPt(60)).toBe("sexagésimo");
    expect(ordinalToWordsPtPt(70)).toBe("septuagésimo");
    expect(ordinalToWordsPtPt(80)).toBe("octogésimo");
    expect(ordinalToWordsPtPt(90)).toBe("nonagésimo");
  });

  it("rejects out-of-range input", () => {
    expect(() => ordinalToWordsPtPt(0)).toThrow();
    expect(() => ordinalToWordsPtPt(100)).toThrow();
  });
});

describe("romanToInt", () => {
  it("parses roman numerals up to C", () => {
    expect(romanToInt("XIX")).toBe(19);
    expect(romanToInt("XX")).toBe(20);
    expect(romanToInt("iv")).toBe(4);
  });

  it("returns null for malformed input", () => {
    expect(romanToInt("")).toBeNull();
    expect(romanToInt("XYZ")).toBeNull();
  });
});
