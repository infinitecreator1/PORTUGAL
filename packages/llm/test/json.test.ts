import { ValidationError } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeLLMClient } from "../src/adapters/fake";
import {
  JSON_REPAIR_INSTRUCTION,
  completeJson,
  describeZodSchema,
  extractJson,
  parseJsonWith,
} from "../src/json";

describe("extractJson", () => {
  it("strips code fences with and without a language tag", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJson('```\n{"a": 1}\n```')).toBe('{"a": 1}');
    expect(extractJson('Aqui está:\n```json\n{"a": 1}\n```\nEspero que ajude.')).toBe('{"a": 1}');
  });

  it("finds the first balanced object inside prose, honouring braces in strings", () => {
    const text = 'Claro! O resultado é {"titulo": "Casa {nova} em [Lisboa]", "n": [1, {"x": "}"}]} e pronto.';
    expect(extractJson(text)).toBe('{"titulo": "Casa {nova} em [Lisboa]", "n": [1, {"x": "}"}]}');
  });

  it("handles arrays and escaped quotes", () => {
    expect(extractJson('lista: ["a\\"b", "c"] fim')).toBe('["a\\"b", "c"]');
  });

  it("returns the tail when the JSON is truncated so JSON.parse reports the problem", () => {
    expect(extractJson('{"a": [1, 2')).toBe('{"a": [1, 2');
    expect(() => JSON.parse(extractJson('{"a": [1, 2'))).toThrow();
  });

  it("returns the trimmed input when there is no JSON at all", () => {
    expect(extractJson("  nada  ")).toBe("nada");
  });
});

const Answer = z.object({ titulo: z.string().min(5), n: z.number().int(), tags: z.array(z.string()).default([]) });

describe("parseJsonWith", () => {
  it("parses and validates", () => {
    expect(parseJsonWith('```json\n{"titulo":"Olá mundo","n":2}\n```', Answer)).toEqual({
      titulo: "Olá mundo",
      n: 2,
      tags: [],
    });
  });

  it("throws ValidationError with issues on schema mismatch and on invalid JSON", () => {
    const err = (() => {
      try {
        parseJsonWith('{"titulo":"oi","n":"x"}', Answer);
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as ValidationError).details.issues).toEqual(
      expect.arrayContaining([expect.stringContaining("titulo:"), expect.stringContaining("n:")]),
    );
    expect(() => parseJsonWith("{oops", Answer)).toThrow(ValidationError);
  });
});

describe("completeJson", () => {
  it("returns parsed data without repair when the first answer validates", async () => {
    const client = new FakeLLMClient({ responder: () => '{"titulo":"Olá mundo","n":1}' });
    const out = await completeJson(client, { messages: [{ role: "user", content: "x" }] }, Answer);
    expect(out.repaired).toBe(false);
    expect(out.data).toEqual({ titulo: "Olá mundo", n: 1, tags: [] });
    expect(client.calls).toHaveLength(1);
  });

  it("repairs once with the schema and issues in Portuguese, summing usage", async () => {
    let n = 0;
    const client = new FakeLLMClient({
      responder: () => (n++ === 0 ? '{"titulo":"oi","n":"um"}' : '{"titulo":"Olá mundo","n":1}'),
    });
    const req = { messages: [{ role: "user" as const, content: "escreve" }], temperature: 0.7, extra: { purpose: "generate" } };
    const out = await completeJson(client, req, Answer);

    expect(out.repaired).toBe(true);
    expect(out.data.n).toBe(1);
    expect(client.calls).toHaveLength(2);

    const repair = client.calls[1];
    expect(repair.temperature).toBe(0);
    expect(repair.extra).toEqual({ purpose: "generate" });
    expect(repair.messages[0]).toEqual(req.messages[0]);
    const prompt = repair.messages[repair.messages.length - 1].content;
    expect(prompt).toContain(JSON_REPAIR_INSTRUCTION);
    expect(prompt).toContain("titulo:");
    expect(prompt).toContain("n:");
    expect(prompt).toContain('"titulo": string (mínimo 5 caracteres)');
    expect(prompt).toContain('{"titulo":"oi","n":"um"}');

    const single = await client.chat({ messages: req.messages });
    expect(out.response.usage.input_tokens).toBeGreaterThan(single.usage.input_tokens);
  });

  it("throws ValidationError after the single repair attempt fails", async () => {
    const client = new FakeLLMClient({ responder: () => "isto não é JSON" });
    const err = await completeJson(client, { messages: [{ role: "user", content: "x" }] }, Answer).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ValidationError);
    expect(client.calls).toHaveLength(2);
    expect((err as ValidationError).details.first_issues).toBeDefined();
  });

  it("does not repair when repairOnce is false", async () => {
    const client = new FakeLLMClient({ responder: () => "nope" });
    await expect(
      completeJson(client, { messages: [{ role: "user", content: "x" }] }, Answer, { repairOnce: false }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(client.calls).toHaveLength(1);
  });
});

describe("describeZodSchema", () => {
  it("renders objects, arrays, bounds, enums, nullable and defaults", () => {
    const S = z.object({
      titulo: z.string().min(20).max(90),
      destaques: z.array(z.string().min(8).max(70)).min(4).max(8),
      tom: z.enum(["profissional", "premium"]),
      nota: z.string().nullable(),
      factos: z.array(z.string()).default([]),
      n: z.number().int().min(0),
    });
    const text = describeZodSchema(S);
    expect(text).toContain('"titulo": string (20–90 caracteres)');
    expect(text).toContain('"destaques": array de string (8–70 caracteres) (4–8 itens)');
    expect(text).toContain('"tom": "profissional" | "premium"');
    expect(text).toContain('"nota": string | null');
    expect(text).toContain('"factos"?: array de string (por omissão: [])');
    expect(text).toContain('"n": inteiro (mínimo 0)');
  });
});
