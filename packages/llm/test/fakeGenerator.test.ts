import { describe, expect, it } from "vitest";
import { GenerationResult } from "@imovel/core";
import { sampleGenerationProfile, sampleListing } from "@imovel/core/fixtures";
import { buildGenerateUserMessage } from "../src/prompts/generate";
import { fakeGenerateFromMessage, parseGeneratePayload } from "../src/adapters/fakeGenerator";
import { applyHintFixes } from "../src/adapters/fake";

describe("fake generator", () => {
  it("templates copy from the listing payload, not from the fixture", () => {
    const listing = sampleListing({
      source_id: "CSC-1",
      property_type: "moradia",
      typology: "T4",
      price: 1490000,
      area: { gross_m2: 320, useful_m2: 280, plot_m2: 900 },
      floor: null,
      year_built: 2016,
      bathrooms: 4,
      condition: "usado",
      energy_certificate: "A",
      location: { district: "Lisboa", municipality: "Cascais", parish: "Cascais e Estoril", neighbourhood: "Birre", address: "Rua das Amoreiras", postal_code: "2750-640", lat: null, lng: null },
      features: ["jardim", "piscina", "garagem", "paineis_solares"],
    });
    const msg = buildGenerateUserMessage(listing, sampleGenerationProfile());
    expect(parseGeneratePayload(msg)?.imovel?.typology).toBe("T4");
    const out = fakeGenerateFromMessage(msg);
    expect(GenerationResult.safeParse(out).success).toBe(true);
    expect(out.titulo).toContain("Moradia T4");
    expect(out.descricao).toContain("280 m²");
    expect(out.descricao).toContain("1 490 000 €");
    expect(out.descricao).not.toContain("118");
    expect(out.descricao).not.toContain("Campo de Ourique");
    expect(out.narracao).toContain("classe A");
    expect(out.factos_usados).toContain("area.plot_m2");
  });

  it("handles rentals and missing optional fields", () => {
    const listing = sampleListing({ transaction: "rent", price: 1250, price_period: "month", floor: null, year_built: null, bathrooms: null, condition: null, features: [], energy_certificate: null });
    const out = fakeGenerateFromMessage(buildGenerateUserMessage(listing, sampleGenerationProfile()));
    expect(GenerationResult.safeParse(out).success).toBe(true);
    expect(out.descricao).toContain("A renda é de 1 250 €/mês.");
    expect(out.destaques.length).toBeGreaterThanOrEqual(4);
  });

  it("falls back to the fixture when the message has no payload", () => {
    const out = fakeGenerateFromMessage("no json here");
    expect(out.titulo).toContain("Campo de Ourique");
  });
});

describe("fake editor hints", () => {
  it("applies every mandatory hint from the instructions block", () => {
    const text = "Estamos oferecendo esta moradia. Você vai adorar o jardim.";
    const instructions = "Corrige obrigatoriamente: Estamos oferecendo → Oferecemos; Você vai adorar → Vai adorar.";
    expect(applyHintFixes(text, instructions)).toBe("Oferecemos esta moradia. Vai adorar o jardim.");
    expect(applyHintFixes(text, null)).toBe(text);
  });
});
