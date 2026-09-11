import { describe, expect, it } from "vitest";
import { GRAMMAR_RULES, MARKERS, scanGrammar } from "../src/index";

const ids = (text: string): string[] => scanGrammar(text, "descricao").map((h) => h.rule_id);

describe("grammar patterns", () => {
  it("every rule matches its examples and none of its counterexamples", () => {
    for (const rule of GRAMMAR_RULES) {
      for (const ex of rule.examples) {
        expect(ids(ex), `${rule.id} should match "${ex}"`).toContain(rule.id);
      }
      for (const ex of rule.counterexamples) {
        expect(ids(ex), `${rule.id} should not match "${ex}"`).not.toContain(rule.id);
      }
    }
  });

  it("shares its ids and patterns with the lexicon", () => {
    for (const rule of GRAMMAR_RULES) {
      const marker = MARKERS.find((m) => m.id === rule.id);
      expect(marker, rule.id).toBeDefined();
      expect(marker?.pattern).toBe(rule.pattern);
      expect(marker?.severity).toBe(rule.severity);
    }
  });

  it("detects the progressive gerund with every auxiliary", () => {
    for (const s of [
      "está oferecendo acesso",
      "estão vendendo rápido",
      "vem mantendo o charme",
      "vêm crescendo",
      "anda procurando casa",
      "continua valorizando",
      "fica sabendo",
      "segue mostrando",
    ]) {
      expect(ids(s), s).toContain("gr.progressive_gerund");
    }
  });

  it("does not flag pt-PT constructions or look-alikes", () => {
    for (const s of [
      "está a oferecer acesso",
      "sendo assim, vale a pena",
      "está sendo assim",
      "tendo em conta a localização",
      "quando quiser",
      "no segundo andar",
      "o comando à distância",
      "está lindo",
      "fica no segundo piso",
      "a cozinha está equipada",
      "continua a valorizar",
    ]) {
      expect(ids(s), s).not.toContain("gr.progressive_gerund");
    }
  });

  it("flags sentence-initial proclisis but not «Se» or mid-sentence clitics", () => {
    expect(ids("Me contacte para mais informações.")).toContain("gr.initial_proclisis");
    expect(ids("Excelente localização. Nos ligue hoje.")).toContain("gr.initial_proclisis");
    expect(ids("Primeira linha.\nLhe garantimos privacidade.")).toContain("gr.initial_proclisis");
    expect(ids("Se quiser, marque uma visita.")).not.toContain("gr.initial_proclisis");
    expect(ids("Se quiser")).toEqual([]);
    expect(ids("O agente pode me contactar.")).not.toContain("gr.initial_proclisis");
    expect(ids("Nos últimos anos valorizou.")).not.toContain("gr.initial_proclisis");
  });

  it("flags register and possessive issues", () => {
    expect(ids("Agende sua visita")).toContain("gr.possessive_no_article");
    expect(ids("Agende a sua visita")).toEqual([]);
    expect(ids("Fica próximo ao metro")).toContain("gr.proximo_ao");
    expect(ids("Você vai adorar")).toContain("reg.voce");
    expect(ids("A gente recomenda")).toContain("gr.a_gente");
    expect(ids("Toda a gente gosta")).toEqual([]);
    expect(ids("ideal pra famílias")).toContain("gr.pra_pro");
    expect(ids("Esse imóvel")).toContain("gr.demonstrative_esse");
    expect(ids("Este imóvel")).toEqual([]);
  });

  it("reports the field and a non-negative index", () => {
    const hits = scanGrammar("Ideal. Me contacte.", "cta");
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ field: "cta", index: 7, severity: "block" });
  });
});
