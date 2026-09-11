import { describe, expect, it } from "vitest";
import { extractPostalCode, parseLocation } from "../../src/normalize/location";
import { ValidationError } from "@imovel/core";

describe("parseLocation", () => {
  it("builds a Location from explicit fields", () => {
    const loc = parseLocation({
      district: "Lisboa",
      municipality: "Lisboa",
      parish: "Campo de Ourique",
      address: "Rua Ferreira Borges",
      postal_code: "1350-130",
      lat: "38.7167",
      lng: "-9.1667",
    });
    expect(loc).toMatchObject({
      district: "Lisboa",
      municipality: "Lisboa",
      parish: "Campo de Ourique",
      postal_code: "1350-130",
      lat: 38.7167,
      lng: -9.1667,
    });
  });

  it("splits free text from the right into district/municipality/parish/neighbourhood", () => {
    const loc = parseLocation({ text: "Campo de Ourique, Lisboa, Lisboa" });
    expect(loc.district).toBe("Lisboa");
    expect(loc.municipality).toBe("Lisboa");
    expect(loc.parish).toBe("Campo de Ourique");
  });

  it("extracts a postal code from the address when not given explicitly", () => {
    const loc = parseLocation({
      district: "Porto",
      municipality: "Porto",
      address: "Rua do Passeio Alegre, 4150-586 Porto",
    });
    expect(loc.postal_code).toBe("4150-586");
  });

  it("throws ValidationError when neither district nor municipality can be determined", () => {
    expect(() => parseLocation({})).toThrow(ValidationError);
    expect(() => parseLocation({ address: "Rua Sem Nome" })).toThrow(ValidationError);
  });
});

describe("extractPostalCode", () => {
  it.each([
    ["1350-130", "1350-130"],
    ["Rua X, 4150-586 Porto", "4150-586"],
    ["1350130", "1350-130"],
  ])("extracts %s -> %s", (input, expected) => {
    expect(extractPostalCode(input)).toBe(expected);
  });

  it("returns null when no postal code is present", () => {
    expect(extractPostalCode("Rua sem código")).toBeNull();
    expect(extractPostalCode(null)).toBeNull();
  });
});
