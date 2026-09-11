import { describe, expect, it } from "vitest";
import { chunkForSpeech } from "../src/chunker";

describe("chunkForSpeech", () => {
  it("packs short sentences greedily into a single chunk under the limit", () => {
    const chunks = chunkForSpeech("Frase um. Frase dois. Frase três.", 100);
    expect(chunks).toEqual([{ index: 0, text: "Frase um. Frase dois. Frase três.", paragraphBreakBefore: false }]);
  });

  it("starts a new chunk once the next sentence would overflow the limit", () => {
    const chunks = chunkForSpeech("Frase um. Frase dois. Frase três.", 15);
    expect(chunks.map((c) => c.text)).toEqual(["Frase um.", "Frase dois.", "Frase três."]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chunks.every((c) => !c.paragraphBreakBefore)).toBe(true);
  });

  it("never splits a sentence that fits, even alone, under the limit", () => {
    const chunks = chunkForSpeech("Uma frase curta.", 300);
    expect(chunks).toEqual([{ index: 0, text: "Uma frase curta.", paragraphBreakBefore: false }]);
  });

  it("splits an over-long sentence at the last comma or semicolon before the limit", () => {
    const sentence =
      "Este é um apartamento fantástico, com vista de mar, perto da praia, ideal para férias em família.";
    const chunks = chunkForSpeech(sentence, 40);
    expect(chunks.map((c) => c.text)).toEqual([
      "Este é um apartamento fantástico,",
      "com vista de mar, perto da praia,",
      "ideal para férias em família.",
    ]);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(40);
  });

  it("falls back to the last space when an over-long sentence has no comma or semicolon", () => {
    const sentence =
      "Este apartamento tem uma vista fantastica sobre o mar e a montanha ao fundo sem qualquer virgula no meio";
    const chunks = chunkForSpeech(sentence, 40);
    expect(chunks.map((c) => c.text)).toEqual([
      "Este apartamento tem uma vista",
      "fantastica sobre o mar e a montanha ao",
      "fundo sem qualquer virgula no meio",
    ]);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(40);
  });

  it("hard-cuts a single token longer than the limit rather than looping forever", () => {
    const chunks = chunkForSpeech("a".repeat(50), 10);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map((c) => c.text).join("")).toBe("a".repeat(50));
  });

  it("marks only the first chunk of a new paragraph, never the very first paragraph", () => {
    const chunks = chunkForSpeech("Primeiro parágrafo com uma frase.\n\nSegundo parágrafo com outra frase.", 300);
    expect(chunks).toEqual([
      { index: 0, text: "Primeiro parágrafo com uma frase.", paragraphBreakBefore: false },
      { index: 1, text: "Segundo parágrafo com outra frase.", paragraphBreakBefore: true },
    ]);
  });

  it("marks the paragraph break on the first chunk even when a paragraph spans several chunks", () => {
    const chunks = chunkForSpeech("Frase A. Frase B.\n\nFrase C. Frase D.", 10);
    expect(chunks.map((c) => [c.text, c.paragraphBreakBefore])).toEqual([
      ["Frase A.", false],
      ["Frase B.", false],
      ["Frase C.", true],
      ["Frase D.", false],
    ]);
  });

  it("defaults maxChars to 300", () => {
    const chunks = chunkForSpeech("Uma frase curta.");
    expect(chunks).toHaveLength(1);
  });

  it("rejects a non-positive maxChars", () => {
    expect(() => chunkForSpeech("texto", 0)).toThrow(RangeError);
  });

  it("returns no chunks for empty or whitespace-only text", () => {
    expect(chunkForSpeech("")).toEqual([]);
    expect(chunkForSpeech("   \n\n  ")).toEqual([]);
  });
});
