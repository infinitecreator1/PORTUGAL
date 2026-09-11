import { describe, expect, it } from "vitest";
import { sectionsToText } from "@imovel/core";
import { sampleGenerationResult, sampleGenerationResultPtBr } from "@imovel/core/fixtures";
import { editRatio } from "../src/index";

describe("editRatio", () => {
  it("is zero for identical text", () => {
    const text = sectionsToText(sampleGenerationResult());
    expect(editRatio(text, text)).toEqual({ token_change_ratio: 0, length_ratio: 1, sentence_delta: 0 });
  });

  it("is small for a one-word change", () => {
    const before = sampleGenerationResult().descricao;
    const after = before.replace("ampla e luminosa", "ampla e soalheira");
    const r = editRatio(before, after);
    expect(r.token_change_ratio).toBeGreaterThan(0);
    expect(r.token_change_ratio).toBeLessThan(0.02);
    expect(r.length_ratio).toBeCloseTo(1, 1);
    expect(r.sentence_delta).toBe(0);
  });

  it("is large for a rewrite", () => {
    const before = sampleGenerationResult().descricao;
    const after =
      "Uma casa diferente, noutra cidade, com outras divisões e outra história. Nada aqui se parece com o texto anterior, porque foi reescrito de raiz por outra pessoa, com outro tom e outra estrutura.";
    const r = editRatio(before, after);
    expect(r.token_change_ratio).toBeGreaterThan(0.6);
    expect(r.length_ratio).toBeLessThan(0.5);
    expect(r.sentence_delta).toBeLessThan(-1);
  });

  it("counts a substitution once, not twice", () => {
    expect(editRatio("um dois três quatro", "um dois cinco quatro").token_change_ratio).toBeCloseTo(0.25, 5);
  });

  it("stays under the threshold between the pt-BR and pt-PT fixtures", () => {
    const r = editRatio(sectionsToText(sampleGenerationResultPtBr()), sectionsToText(sampleGenerationResult()));
    expect(r.token_change_ratio).toBeGreaterThan(0.1);
    expect(Math.abs(r.sentence_delta)).toBeLessThanOrEqual(2);
  });
});
