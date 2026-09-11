import { describe, expect, it } from "vitest";
import {
  ConfigError,
  GenerationResult,
  Listing,
  ListingInput,
  computeContentHash,
  computeFingerprint,
  estimateCostUsd,
  formatArea,
  formatEuros,
  loadConfig,
  normalizeAddress,
  normalizeFeature,
  normalizeFeatures,
  splitSentences,
  wordCount,
} from "../src";
import {
  sampleGenerationResult,
  sampleGenerationResultPtBr,
  sampleListing,
  sampleListingInput,
} from "../src/fixtures";

describe("schemas", () => {
  it("parses the sample listing with defaults applied", () => {
    const l = sampleListing();
    expect(Listing.safeParse(l).success).toBe(true);
    expect(l.currency).toBe("EUR");
    expect(l.photos).toHaveLength(2);
    expect(l.agent.agency_id).toBe("lisboa-prime");
  });

  it("rejects a malformed postal code", () => {
    const r = ListingInput.safeParse({
      ...sampleListingInput(),
      location: { district: "Lisboa", municipality: "Lisboa", postal_code: "1350130" },
    });
    expect(r.success).toBe(false);
  });

  it("accepts both fixture generation results", () => {
    expect(GenerationResult.safeParse(sampleGenerationResult()).success).toBe(true);
    expect(GenerationResult.safeParse(sampleGenerationResultPtBr()).success).toBe(true);
  });
});

describe("hashing", () => {
  it("content hash ignores photos and fetched_at but tracks price", () => {
    const a = sampleListingInput();
    const b = sampleListingInput({ photos: [] });
    const c = sampleListingInput({ price: 750000 });
    expect(computeContentHash(a)).toBe(computeContentHash(b));
    expect(computeContentHash(a)).not.toBe(computeContentHash(c));
  });

  it("content hash is order-insensitive on features", () => {
    const a = sampleListingInput({ features: ["varanda", "elevador"] });
    const b = sampleListingInput({ features: ["elevador", "varanda"] });
    expect(computeContentHash(a)).toBe(computeContentHash(b));
  });

  it("normalises addresses for fingerprints", () => {
    expect(normalizeAddress("R. Ferreira Borges, n.º 12")).toBe("rua ferreira borges n 12");
    expect(normalizeAddress("Av. da República 5")).toBe("avenida da republica 5");
    expect(normalizeAddress(null)).toBeNull();
  });

  it("fingerprints match across sources with the same address", () => {
    const a = sampleListingInput({ source: "csv-feed" });
    const b = sampleListingInput({ source: "casafari", source_id: "cf-1", location: { ...a.location, address: "R. Ferreira Borges" } });
    expect(computeFingerprint(a)).toBe(computeFingerprint(b));
  });
});

describe("config", () => {
  it("loads fake providers with no keys", () => {
    const cfg = loadConfig({});
    expect(cfg.LLM_PROVIDER).toBe("fake");
    expect(cfg.GEN_MODEL).toBe("gemini-2.5-pro");
  });

  it("requires provider keys when a real provider is selected", () => {
    expect(() => loadConfig({ LLM_PROVIDER: "gemini" })).toThrow(ConfigError);
    expect(() => loadConfig({ GATE_EDITOR: "amalia", RUNPOD_API_KEY: "x" })).toThrow(/RUNPOD_AMALIA_ENDPOINT_ID/);
    expect(() => loadConfig({ LLM_PROVIDER: "gemini", GEMINI_API_KEY: "k" })).not.toThrow();
  });
});

describe("taxonomy", () => {
  it("maps pt-BR and English synonyms to pt-PT codes", () => {
    expect(normalizeFeature("Sacada")).toBe("varanda");
    expect(normalizeFeature("vaga de garagem")).toBe("garagem");
    expect(normalizeFeature("Academia")).toBe("ginasio");
    expect(normalizeFeature("Cozinha americana")).toBe("cozinha_aberta");
    expect(normalizeFeature("built-in wardrobes")).toBe("roupeiros");
    expect(normalizeFeature("piso laminado")).toBe("pavimento_flutuante");
    expect(normalizeFeature("Something unknown")).toBeNull();
    expect(normalizeFeatures(["Varanda", "varanda", "Elevador"])).toEqual(["varanda", "elevador"]);
  });
});

describe("text and pricing", () => {
  it("formats money and area the Portuguese way", () => {
    expect(formatEuros(745000)).toBe("745 000 €");
    expect(formatEuros(1250, "month")).toBe("1 250 €/mês");
    expect(formatArea(118)).toBe("118 m²");
    expect(formatArea(118.5)).toBe("118,5 m²");
  });

  it("splits sentences and counts words", () => {
    expect(splitSentences("Olá. Como está? Bem!")).toEqual(["Olá.", "Como está?", "Bem!"]);
    expect(wordCount("um dois  três")).toBe(3);
  });

  it("estimates costs from the pricing table", () => {
    const gen = estimateCostUsd({ tenant_id: "t", step: "generate", provider: "gemini", model: "gemini-2.5-pro", input_tokens: 1_000_000, output_tokens: 0 });
    expect(gen).toBeCloseTo(1.25, 6);
    const gpu = estimateCostUsd({ tenant_id: "t", step: "narrate", provider: "voxcpm2-runpod", gpu_seconds: 3600 });
    expect(gpu).toBeCloseTo(0.69, 6);
    const tts = estimateCostUsd({ tenant_id: "t", step: "narrate", provider: "elevenlabs", chars: 1000 });
    expect(tts).toBeCloseTo(0.1, 6);
  });
});
