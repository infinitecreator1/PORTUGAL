import { ValidationError } from "@imovel/core";
import { sampleGenerationResultPtBr } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { FakeLLMClient } from "../src/adapters/fake";
import { LlmPtPtEditor, cleanEditorOutput, editMaxTokens } from "../src/editor";
import {
  EDIT_HINTS_LABEL,
  EDIT_STRICT_INSTRUCTION,
  EDIT_SYSTEM_PROMPT,
  buildEditUserMessage,
  splitEditUserMessage,
} from "../src/prompts/edit";

const ptBr = sampleGenerationResultPtBr().descricao;

describe("LlmPtPtEditor", () => {
  it("sends the system prompt and parameters, and the fake edit removes pt-BR markers", async () => {
    const client = new FakeLLMClient();
    const editor = new LlmPtPtEditor({ id: "fake", client });

    const out = await editor.edit(ptBr);
    expect(editor.id).toBe("fake");
    expect(out.text).not.toMatch(/banheiro/i);
    expect(out.text).not.toMatch(/sacada/i);
    expect(out.text).toContain("casas de banho");
    expect(out.text).toContain("varanda");
    expect(out.text.split("\n\n")).toHaveLength(3);
    expect(out.model).toBe("fake-1");
    expect(out.usage.output_tokens).toBeGreaterThan(0);

    const req = client.calls[0];
    expect(req.messages[0]).toEqual({ role: "system", content: EDIT_SYSTEM_PROMPT });
    expect(req.messages[1]).toEqual({ role: "user", content: ptBr });
    expect(req).toMatchObject({
      temperature: 0.2,
      top_p: 0.9,
      seed: 42,
      max_tokens: editMaxTokens(ptBr),
      extra: { repetition_penalty: 1.05, purpose: "edit" },
    });
    expect(req.max_tokens).toBe(Math.ceil((ptBr.length / 3.5) * 1.5) + 64);
  });

  it("strict mode appends the instruction and the hints, and the fake still returns clean text", async () => {
    const client = new FakeLLMClient();
    const editor = new LlmPtPtEditor({ id: "fake", client, model: "amalia-test" });

    const out = await editor.edit(ptBr, { strict: true, hints: ["banheiro → casa de banho", "sacada → varanda"] });
    const user = client.calls[0].messages[1].content;
    expect(user.startsWith(ptBr)).toBe(true);
    expect(user).toContain(EDIT_STRICT_INSTRUCTION);
    expect(user).toContain(`${EDIT_HINTS_LABEL} banheiro → casa de banho; sacada → varanda.`);
    expect(client.calls[0].model).toBe("amalia-test");
    expect(out.text).not.toContain(EDIT_STRICT_INSTRUCTION);
    expect(out.text).not.toContain("banheiro");
  });

  it("throws ValidationError when the output length ratio leaves 0.5–2.0 or the output is empty", async () => {
    const text = "Este apartamento tem dois banheiros e uma sacada com vista para o rio.";
    const short = new LlmPtPtEditor({ id: "fake", client: new FakeLLMClient({ responder: () => "Sim." }) });
    await expect(short.edit(text)).rejects.toBeInstanceOf(ValidationError);

    const long = new LlmPtPtEditor({
      id: "fake",
      client: new FakeLLMClient({ responder: () => `${text} ${text} ${text}` }),
    });
    await expect(long.edit(text)).rejects.toBeInstanceOf(ValidationError);

    const empty = new LlmPtPtEditor({ id: "fake", client: new FakeLLMClient({ responder: () => '""' }) });
    await expect(empty.edit(text)).rejects.toBeInstanceOf(ValidationError);
  });

  it("returns empty input unchanged without calling the model", async () => {
    const client = new FakeLLMClient();
    const out = await new LlmPtPtEditor({ id: "fake", client }).edit("   ");
    expect(out.text).toBe("   ");
    expect(client.calls).toHaveLength(0);
  });

  it("forwards call options to the client", async () => {
    const client = new FakeLLMClient();
    const controller = new AbortController();
    controller.abort();
    await expect(
      new LlmPtPtEditor({ id: "fake", client }).edit("Texto com banheiro.", { signal: controller.signal }),
    ).rejects.toThrow(/aborted/);
  });
});

describe("cleanEditorOutput", () => {
  it("strips fences, labels, wrapping quotes and echoed instructions", () => {
    expect(cleanEditorOutput("```\nTexto limpo.\n```")).toBe("Texto limpo.");
    expect(cleanEditorOutput("```text\nTexto limpo.\n```")).toBe("Texto limpo.");
    expect(cleanEditorOutput("Texto revisto: Texto limpo.")).toBe("Texto limpo.");
    expect(cleanEditorOutput('"Texto limpo."')).toBe("Texto limpo.");
    expect(cleanEditorOutput("«Texto limpo.»")).toBe("Texto limpo.");
    expect(cleanEditorOutput(`Texto limpo.\n\n---\n${EDIT_STRICT_INSTRUCTION}`)).toBe("Texto limpo.");
    expect(cleanEditorOutput('  Ele disse "olá" e saiu.  ')).toBe('Ele disse "olá" e saiu.');
  });
});

describe("buildEditUserMessage / splitEditUserMessage", () => {
  it("round-trips the text with and without instructions", () => {
    const text = "Um texto.\n\nCom dois parágrafos.";
    expect(buildEditUserMessage(text)).toBe(text);
    expect(buildEditUserMessage(text, { hints: [] })).toBe(text);
    expect(splitEditUserMessage(text)).toEqual({ text, instructions: null });

    const strict = buildEditUserMessage(text, { strict: true, hints: [" a → b ", ""] });
    const split = splitEditUserMessage(strict);
    expect(split.text).toBe(text);
    expect(split.instructions).toBe(`${EDIT_STRICT_INSTRUCTION} ${EDIT_HINTS_LABEL} a → b.`);

    const hintsOnly = buildEditUserMessage(text, { hints: ["x → y"] });
    expect(splitEditUserMessage(hintsOnly).instructions).toBe(`${EDIT_HINTS_LABEL} x → y.`);
  });
});
