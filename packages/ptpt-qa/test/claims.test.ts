import { describe, expect, it } from "vitest";
import { sampleGenerationResult } from "@imovel/core/fixtures";
import { checkClaims, FORBIDDEN_CLAIMS } from "../src/index";

describe("checkClaims", () => {
  it("passes the fixture", () => {
    const report = checkClaims(sampleGenerationResult());
    expect(report.ok).toBe(true);
    expect(report.name).toBe("claims");
    expect(report.severity).toBe("hard");
  });

  it("flags rentabilidade garantida, accent-insensitively", () => {
    const g = sampleGenerationResult();
    const report = checkClaims({ ...g, resumo: `${g.resumo} Rentabilidade garantida.` });
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(['resumo: forbidden claim "rentabilidade garantida"']);
    const noAccents = checkClaims({ ...g, cta: "Valorizacao garantida para quem investe agora." });
    expect(noAccents.issues).toEqual(['cta: forbidden claim "valorização garantida"']);
  });

  it("includes tenant phrases", () => {
    const g = sampleGenerationResult();
    const report = checkClaims({ ...g, cta: "Oportunidade única na cidade, marque a sua visita." }, ["oportunidade única"]);
    expect(report.ok).toBe(false);
    expect(report.issues).toEqual(['cta: forbidden claim "oportunidade única"']);
  });

  it("ships the built-in pt-PT list", () => {
    expect(FORBIDDEN_CLAIMS).toEqual(expect.arrayContaining(["retorno garantido", "melhor investimento", "sem risco", "não aceitamos"]));
  });

  it("matches whole phrases only", () => {
    const g = sampleGenerationResult();
    expect(checkClaims({ ...g, cta: "Sem riscos desnecessários, marque a sua visita." }).ok).toBe(true);
  });
});
