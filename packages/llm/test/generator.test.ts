import { GenerationResult, ValidationError } from "@imovel/core";
import { sampleGenerationProfile, sampleListing } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { FakeLLMClient } from "../src/adapters/fake";
import { GeminiDescriptionGenerator } from "../src/generator";
import { GENERATE_SYSTEM_PROMPT, buildGenerateUserMessage } from "../src/prompts/generate";

const listing = sampleListing();
const profile = sampleGenerationProfile();

describe("GeminiDescriptionGenerator", () => {
  it("returns a valid GenerationResult with usage and provider from the fake client", async () => {
    const client = new FakeLLMClient();
    const generator = new GeminiDescriptionGenerator({ client });

    const out = await generator.generate(listing, profile);
    expect(generator.id).toBe("gemini");
    expect(() => GenerationResult.parse(out.result)).not.toThrow();
    expect(out.provider).toBe("fake");
    expect(out.model).toBe("fake-1");
    expect(out.usage.input_tokens).toBeGreaterThan(0);
    expect(out.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("sends the agency name but never contacts, photo URLs or coordinates", async () => {
    const client = new FakeLLMClient();
    await new GeminiDescriptionGenerator({ client }).generate(listing, profile);

    const sent = client.calls[0].messages.map((m) => m.content).join("\n");
    expect(sent).toContain("Lisboa Prime Mediação");
    expect(sent).not.toContain("+351 912 345 678");
    expect(sent).not.toContain("912 345 678");
    expect(sent).not.toContain("marta.silva@example.org");
    expect(sent).not.toContain("example.org/photos");
    expect(sent).not.toContain("https://");
    expect(sent).not.toContain("38.7167");
    expect(sent).not.toContain("Marta Silva");
  });

  it("includes erros_a_evitar only when constraints are passed and varies the seed with them", async () => {
    const client = new FakeLLMClient();
    const generator = new GeminiDescriptionGenerator({ client, model: "gemini-2.5-pro" });

    await generator.generate(listing, profile);
    await generator.generate(listing, profile, ['não uses "sacada"', "evita o gerúndio progressivo"]);

    const plain = client.calls[0];
    const constrained = client.calls[1];
    expect(plain.messages[1].content).not.toContain("erros_a_evitar");
    expect(constrained.messages[1].content).toContain("erros_a_evitar");
    expect(constrained.messages[1].content).toContain('não uses \\"sacada\\"');
    expect(plain.seed).not.toBe(constrained.seed);

    expect(plain.model).toBe("gemini-2.5-pro");
    expect(plain.messages[0]).toEqual({ role: "system", content: GENERATE_SYSTEM_PROMPT });
    expect(plain).toMatchObject({
      temperature: profile.temperature,
      top_p: 0.95,
      max_tokens: 1800,
      response_format: { type: "json_object" },
      extra: { reasoning_effort: "low", purpose: "generate" },
    });
    expect(typeof plain.seed).toBe("number");
  });

  it("throws ValidationError when the model never returns a valid result", async () => {
    const client = new FakeLLMClient({ responder: () => '{"titulo":"curto"}' });
    await expect(new GeminiDescriptionGenerator({ client }).generate(listing, profile)).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(client.calls).toHaveLength(2);
  });
});

describe("buildGenerateUserMessage", () => {
  it("renders formatted price and areas, pt-PT feature labels and the profile block", () => {
    const message = buildGenerateUserMessage(listing, profile, []);
    const json = JSON.parse(message.slice(message.indexOf("{"))) as Record<string, Record<string, unknown>>;

    expect(json.imovel).toMatchObject({
      transaction: "sale",
      property_type: "apartamento",
      typology: "T3",
      preco: "745 000 €",
      areas: { useful_m2: "118 m²", gross_m2: "132 m²" },
      floor: "3",
      year_built: 1958,
      bathrooms: 2,
      condition: "renovado",
      energy_certificate: "B-",
      agencia: "Lisboa Prime Mediação",
      fotos: { total: 2, divisoes: ["sala", "cozinha"] },
    });
    expect(json.imovel.caracteristicas).toEqual([
      "varanda",
      "elevador",
      "arrecadação",
      "lugar de garagem",
      "roupeiros embutidos",
      "vidros duplos",
      "cozinha equipada",
    ]);
    expect(json.imovel.location).toEqual({
      district: "Lisboa",
      municipality: "Lisboa",
      parish: "Campo de Ourique",
      neighbourhood: "Campo de Ourique",
      address: "Rua Ferreira Borges",
      postal_code: "1350-130",
    });
    expect(json.perfil).toMatchObject({
      tone: "profissional",
      audience: "compradores",
      target_length: "media (descricao entre 900 e 1600 caracteres)",
      brand_name: "Lisboa Prime Mediação",
      cta_template: "Marque a sua visita com a Lisboa Prime Mediação.",
    });
    expect(json).not.toHaveProperty("erros_a_evitar");
  });

  it("formats rents per month and omits missing fields", () => {
    const rent = sampleListing({ transaction: "rent", price: 1250, price_period: "month", photos: [], typology: null });
    const message = buildGenerateUserMessage(rent, profile);
    const json = JSON.parse(message.slice(message.indexOf("{"))) as { imovel: Record<string, unknown> };
    expect(json.imovel.preco).toBe("1 250 €/mês");
    expect(json.imovel).not.toHaveProperty("typology");
    expect(json.imovel.fotos).toEqual({ total: 0 });
  });
});
