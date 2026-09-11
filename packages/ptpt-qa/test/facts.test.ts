import { describe, expect, it } from "vitest";
import { sectionsToText } from "@imovel/core";
import { sampleGenerationResult, sampleGenerationResultPtBr, sampleListing } from "@imovel/core/fixtures";
import { capitalisedSpans, diffFacts, extractFacts, listingFacts, numberTokens, preValidateFacts } from "../src/index";

describe("extractFacts", () => {
  it("normalises numbers, thousands separators, decimals and area units", () => {
    const keys = numberTokens("350 000 €, 350.000, 350,000, 118,5 m², 118m2, 118 m², 2021 e 3.º andar").map((t) => t.key);
    expect(keys).toEqual(["350000", "350000", "350000", "118.5m2", "118m2", "118m2", "2021", "3"]);
  });

  it("finds the facts of the pt-PT fixture", () => {
    const listing = sampleListing();
    const facts = extractFacts(sectionsToText(sampleGenerationResult()), listing);
    expect(facts.numbers.get("118m2")).toBeGreaterThanOrEqual(1);
    expect(facts.numbers.get("132m2")).toBe(1);
    expect(facts.numbers.get("745000")).toBe(1);
    expect(facts.numbers.get("2021")).toBeGreaterThanOrEqual(1);
    expect(facts.money.get("745000")).toBe(1);
    expect(facts.typology).toContain("T3");
    expect(facts.energy).toContain("B-");
    expect([...facts.places]).toEqual(
      expect.arrayContaining(["lisboa", "campo de ourique", "rua ferreira borges", "jardim da parada", "lisboa prime mediacao"]),
    );
  });

  it("reads spoken energy classes and signed classes", () => {
    expect(extractFacts("certificado energético de classe B menos").energy).toEqual(["B-"]);
    expect(extractFacts("classe energética A+").energy).toEqual(["A+"]);
    expect(extractFacts("Certificado energético B-").energy).toEqual(["B-"]);
    expect(extractFacts("a casa é boa").energy).toEqual([]);
  });

  it("extracts capitalised spans but skips sentence and line starts and acronyms", () => {
    const spans = capitalisedSpans("Apartamento em Campo de Ourique. O Mercado de Campo de Ourique fica perto.\nVaranda ampla com IMI baixo.");
    expect(spans).toEqual(["Campo de Ourique", "Mercado de Campo de Ourique"]);
  });

  it("does not count typology digits or letters as numbers", () => {
    const facts = extractFacts("T3 com B-");
    expect([...facts.numbers.keys()]).toEqual([]);
    expect(facts.typology).toEqual(["T3"]);
  });

  it("derives listing facts", () => {
    const facts = listingFacts(sampleListing());
    expect(facts.numbers.get("745000")).toBe(1);
    expect(facts.numbers.get("118m2")).toBe(1);
    expect(facts.numbers.get("132m2")).toBe(1);
    expect(facts.numbers.get("1958")).toBe(1);
    expect(facts.money.get("745000")).toBe(1);
    expect(facts.typology).toEqual(["T3"]);
    expect(facts.energy).toEqual(["B-"]);
    expect(facts.places.has("campo de ourique")).toBe(true);
  });
});

describe("diffFacts", () => {
  it("is ok for identical text", () => {
    const listing = sampleListing();
    const text = sectionsToText(sampleGenerationResult());
    expect(diffFacts(extractFacts(text, listing), extractFacts(text, listing)).ok).toBe(true);
  });

  it("detects a changed price and a dropped parish", () => {
    const listing = sampleListing();
    const before = sectionsToText(sampleGenerationResult());
    const priceChanged = before.replace("745 000 €", "750 000 €");
    const d1 = diffFacts(extractFacts(before, listing), extractFacts(priceChanged, listing));
    expect(d1.ok).toBe(false);
    expect(d1.missing).toEqual(expect.arrayContaining(["number 745000", "money 745000"]));
    expect(d1.added).toEqual(expect.arrayContaining(["number 750000", "money 750000"]));

    const parishDropped = before.replace(/Campo de Ourique/g, "a zona");
    const d2 = diffFacts(extractFacts(before, listing), extractFacts(parishDropped, listing));
    expect(d2.ok).toBe(false);
    expect(d2.missing).toContain("place campo de ourique");
  });

  it("reports count changes of a repeated number", () => {
    const before = extractFacts("118 m² e 118 m²");
    const after = extractFacts("118 m²");
    const d = diffFacts(before, after);
    expect(d.ok).toBe(false);
    expect(d.changed).toEqual(["number 118m2 ×2 → ×1"]);
  });
});

describe("preValidateFacts", () => {
  it("passes both fixtures against the sample listing", () => {
    const listing = sampleListing();
    expect(preValidateFacts(listing, sampleGenerationResult()).ok).toBe(true);
    expect(preValidateFacts(listing, sampleGenerationResultPtBr()).ok).toBe(true);
  });

  it("fails when an invented distance appears", () => {
    const listing = sampleListing();
    const gen = sampleGenerationResult();
    const report = preValidateFacts(listing, { ...gen, localizacao: `${gen.localizacao} Fica a 300 metros da praia.` });
    expect(report.ok).toBe(false);
    expect(report.severity).toBe("hard");
    expect(report.issues.join("\n")).toContain("300");
  });

  it("allows small numbers and plausible years", () => {
    const listing = sampleListing();
    const gen = sampleGenerationResult();
    const report = preValidateFacts(listing, { ...gen, localizacao: `${gen.localizacao} A 5 minutos do metro, num prédio de 1932.` });
    expect(report.ok).toBe(true);
  });

  it("fails on a typology that differs from the listing", () => {
    const listing = sampleListing();
    const gen = sampleGenerationResult();
    const report = preValidateFacts(listing, { ...gen, titulo: gen.titulo.replace("T3", "T4") });
    expect(report.ok).toBe(false);
    expect(report.issues.join("\n")).toContain("T4");
  });
});
