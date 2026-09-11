import { describe, expect, it } from "vitest";
import { sampleGenerationResult, sampleGenerationResultPtBr } from "@imovel/core/fixtures";
import { MARKERS, MARKER_BY_ID, compileBounded, hitsPer1kWords, hitsToHints, scanSections, scanText } from "../src/index";

const PRECISION_LIST = [
  "ação",
  "ótimo",
  "direto",
  "atual",
  "ideia",
  "assembleia",
  "condomínio",
  "garagem",
  "piscina",
  "elevador",
  "varanda",
  "terraço",
  "quintal",
  "churrasqueira",
  "banheira",
  "imóvel",
  "residência",
  "contacto",
  "facto",
  "registo",
  "receção",
  "aspeto",
  "secção",
  "económico",
  "género",
  "fato",
  "um fato de bom corte",
  "200 gramas",
  "1 grama",
  "sendo assim",
  "está sendo assim",
  "tendo em conta",
  "Se quiser",
  "Se quiser, marque uma visita.",
  "quando",
  "está quando",
  "segundo andar",
  "T3",
  "m²",
  "Campo de Ourique",
  "Lisboa",
  "toda a gente",
  "Nos últimos anos",
  "cartório notarial",
  "moradia térrea",
  "fica lindo",
  "tão perto",
  "situação legal",
  "a cozinha está equipada",
  "Marque a sua visita",
  "Contacte-nos",
];

describe("marker lexicon", () => {
  it("has at least 130 entries with unique ids and non-empty suggestions", () => {
    expect(MARKERS.length).toBeGreaterThanOrEqual(130);
    const ids = new Set(MARKERS.map((m) => m.id));
    expect(ids.size).toBe(MARKERS.length);
    for (const m of MARKERS) {
      expect(m.suggestion.trim().length, m.id).toBeGreaterThan(0);
      expect(m.examples.length, m.id).toBeGreaterThan(0);
      expect(MARKER_BY_ID.get(m.id)).toBe(m);
    }
  });

  it("compiles every pattern inside accent-aware boundaries and never uses \\b or \\w", () => {
    for (const m of MARKERS) {
      expect(() => compileBounded(m.pattern), m.id).not.toThrow();
      expect(m.pattern, m.id).not.toMatch(/\\b|\\w/);
    }
  });

  it("matches at least one of its own examples (every marker, block and warn)", () => {
    for (const m of MARKERS) {
      const matched = m.examples.some((ex) => scanText(ex, "descricao", [m]).some((h) => h.rule_id === m.id));
      expect(matched, `${m.id} matches none of ${JSON.stringify(m.examples)}`).toBe(true);
    }
  });

  it("never flags the precision list", () => {
    for (const s of PRECISION_LIST) {
      const hits = scanText(s, "descricao");
      expect(hits, `"${s}" flagged by ${hits.map((h) => h.rule_id).join(", ")}`).toEqual([]);
    }
  });

  it("flags the pt-BR fixture heavily and the pt-PT fixture not at all", () => {
    const br = scanSections(sampleGenerationResultPtBr());
    const blocks = br.filter((h) => h.severity === "block");
    expect(blocks.length).toBeGreaterThanOrEqual(10);
    const terms = br.map((h) => h.term.toLowerCase());
    for (const expected of [
      "banheiro",
      "sacada",
      "vaga",
      "dormitório",
      "reformado",
      "alto padrão",
      "cozinha americana",
      "está oferecendo",
      "vem mantendo",
      "a gente",
      "pronto para morar",
      "agende sua",
    ]) {
      expect(terms.some((t) => t.includes(expected)), `expected a hit containing "${expected}"`).toBe(true);
    }
    expect(br.some((h) => h.term.toLowerCase().includes("térreo"))).toBe(false);
    for (const h of br) {
      expect(h.index).toBeGreaterThanOrEqual(0);
      expect(h.suggestion.length).toBeGreaterThan(0);
    }

    const pt = scanSections(sampleGenerationResult());
    expect(pt.filter((h) => h.severity === "block")).toEqual([]);
  });

  it("keeps the longest span when markers overlap", () => {
    const hits = scanText("ponto de ônibus em frente", "localizacao");
    expect(hits.map((h) => h.rule_id)).toEqual(["lex.ponto_de_onibus"]);
    const vaga = scanText("com 2 vagas de garagem", "descricao");
    expect(vaga).toHaveLength(1);
    expect(vaga[0]?.severity).toBe("block");
    expect(vaga[0]?.term).toBe("2 vagas de garagem");
  });

  it("does not match inside words", () => {
    expect(scanText("mobiliário de qualidade", "descricao")).toEqual([]);
    expect(scanText("transporte público", "descricao")).toEqual([]);
    expect(scanText("está", "descricao")).toEqual([]);
  });

  it("formats hints as 'termo → sugestão', deduplicated", () => {
    const hits = scanText("banheiro amplo e outro banheiro pequeno", "descricao");
    expect(hits).toHaveLength(2);
    expect(hitsToHints(hits)).toEqual(["banheiro → casa de banho"]);
    expect(hitsPer1kWords(hits, "banheiro amplo e outro banheiro pequeno")).toBeCloseTo((2 / 6) * 1000, 5);
  });
});
