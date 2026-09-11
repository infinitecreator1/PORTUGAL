import { describe, expect, it } from "vitest";
import { sampleGenerationResult } from "@imovel/core/fixtures";
import { checkShape } from "../src/index";

describe("checkShape", () => {
  it("passes fixture against itself", () => {
    const g = sampleGenerationResult();
    const report = checkShape(g, g);
    expect(report.ok).toBe(true);
    expect(report.name).toBe("shape");
    expect(report.severity).toBe("hard");
    expect(report.issues).toEqual([]);
  });

  it("fails on an emoji", () => {
    const g = sampleGenerationResult();
    const report = checkShape(g, { ...g, cta: `${g.cta} 🏡` });
    expect(report.ok).toBe(false);
    expect(report.issues.join("\n")).toMatch(/emoji/);
  });

  it("fails on a phone number but allows a large price", () => {
    const g = sampleGenerationResult();
    const report = checkShape(g, { ...g, cta: "Marque a sua visita pelo +351 912 345 678 com a Lisboa Prime Mediação." });
    expect(report.ok).toBe(false);
    expect(report.issues.join("\n")).toMatch(/phone/);
    const price = checkShape(g, { ...g, narracao: g.narracao.replace("745 000 €", "12 500 000 €") });
    expect(price.issues.join("\n")).not.toMatch(/phone/);
  });

  it("fails on an e-mail or a URL", () => {
    const g = sampleGenerationResult();
    expect(checkShape(g, { ...g, cta: "Escreva para marta.silva@example.org e marque a sua visita." }).issues.join("\n")).toMatch(/e-mail/);
    expect(checkShape(g, { ...g, cta: "Veja mais em https://example.org/imovel e marque a sua visita." }).issues.join("\n")).toMatch(/URL/);
  });

  it("fails on a bullet or symbol in narracao", () => {
    const g = sampleGenerationResult();
    const bullet = checkShape(g, { ...g, narracao: `${g.narracao}\n- Lugar de garagem incluído` });
    expect(bullet.ok).toBe(false);
    expect(bullet.issues.join("\n")).toMatch(/bullet/);
    const symbol = checkShape(g, { ...g, narracao: g.narracao.replace("Inclui lugar", "Inclui * lugar") });
    expect(symbol.issues.join("\n")).toMatch(/symbol/);
  });

  it("fails on markdown", () => {
    const g = sampleGenerationResult();
    expect(checkShape(g, { ...g, descricao: g.descricao.replace("Este apartamento", "Este **apartamento**") }).issues.join("\n")).toMatch(/markdown/);
  });

  it("fails when the paragraph count of descricao changes", () => {
    const g = sampleGenerationResult();
    const report = checkShape(g, { ...g, descricao: g.descricao.replace(/\n\n/g, " ") });
    expect(report.ok).toBe(false);
    expect(report.issues.join("\n")).toMatch(/paragraph count/);
  });

  it("fails when destaques count or a field length drifts too far", () => {
    const g = sampleGenerationResult();
    const fewer = checkShape(g, { ...g, destaques: g.destaques.slice(0, 4) });
    expect(fewer.issues.join("\n")).toMatch(/destaques count/);
    const longer = checkShape(g, { ...g, cta: `${g.cta} ${g.cta}` });
    expect(longer.issues.join("\n")).toMatch(/cta length ratio/);
  });

  it("reports schema violations", () => {
    const g = sampleGenerationResult();
    const report = checkShape(g, { ...g, titulo: "curto" });
    expect(report.ok).toBe(false);
    expect(report.issues.some((i) => i.startsWith("schema titulo"))).toBe(true);
  });
});
