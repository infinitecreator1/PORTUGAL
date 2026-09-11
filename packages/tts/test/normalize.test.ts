import { sampleGenerationResult } from "@imovel/core/fixtures";
import { describe, expect, it } from "vitest";
import { normalizeForSpeech } from "../src/normalize";

describe("normalizeForSpeech / fixture narração", () => {
  it("leaves no digits and speaks the known landmarks in words", () => {
    const { text } = normalizeForSpeech(sampleGenerationResult().narracao);
    expect(text).not.toMatch(/\d/);
    expect(text).toContain("T três");
    expect(text).toContain("B menos");
    expect(text).toContain("setecentos e quarenta e cinco mil euros");
    expect(text).toContain("cento e dezoito metros quadrados");
    expect(text).toContain("dois mil e vinte e um");
  });
});

describe("rule (a): glossary", () => {
  it("respells whole words, accent-sensitively, before any other rule runs", () => {
    const r = normalizeForSpeech("Fica junto a Algés, perto do Cacém.", {
      glossary: { Algés: "al-jéch", Cacém: "ca-sém" },
    });
    expect(r.text).toBe("Fica junto a al-jéch, perto do ca-sém.");
    expect(r.rules_applied).toContain("glossary");
  });

  it("does not respell a look-alike word without the accent", () => {
    const r = normalizeForSpeech("Ourem fica perto.", { glossary: { Óurem: "oh-rehm" } });
    expect(r.text).toBe("Ourem fica perto.");
    expect(r.rules_applied).not.toContain("glossary");
  });

  it("is applied on whole words only, never inside a longer word", () => {
    const r = normalizeForSpeech("Algésia não é Algés.", { glossary: { Algés: "AL-JESH" } });
    expect(r.text).toContain("Algésia");
    expect(r.text).toContain("AL-JESH");
  });
});

describe("rule (b): money", () => {
  it("reads whole-euro amounts with a space or dot thousands separator", () => {
    expect(normalizeForSpeech("350 000 €").text).toBe("trezentos e cinquenta mil euros.");
    expect(normalizeForSpeech("350.000 €").text).toBe("trezentos e cinquenta mil euros.");
    expect(normalizeForSpeech("€350.000").text).toBe("trezentos e cinquenta mil euros.");
    expect(normalizeForSpeech("745 000 euros").text).toBe("setecentos e quarenta e cinco mil euros.");
  });

  it("reads cents and drops a zero fraction", () => {
    expect(normalizeForSpeech("350.000,00 €").text).toBe("trezentos e cinquenta mil euros.");
    expect(normalizeForSpeech("10,50 €").text).toBe("dez euros e cinquenta cêntimos.");
    expect(normalizeForSpeech("10,01 €").text).toBe("dez euros e um cêntimo.");
  });

  it("reads a monthly rent with 'por mês'", () => {
    expect(normalizeForSpeech("1 250 €/mês").text).toBe("mil duzentos e cinquenta euros por mês.");
  });

  it("uses the singular for exactly one euro", () => {
    expect(normalizeForSpeech("1 €").text).toBe("um euro.");
  });
});

describe("rule (c): area", () => {
  it("reads m² in its symbol and ASCII forms, and hectares", () => {
    expect(normalizeForSpeech("118 m²").text).toBe("cento e dezoito metros quadrados.");
    expect(normalizeForSpeech("118m2").text).toBe("cento e dezoito metros quadrados.");
    expect(normalizeForSpeech("2 ha").text).toBe("dois hectares.");
  });

  it("reads a decimal area", () => {
    expect(normalizeForSpeech("118,5 m²").text).toBe("cento e dezoito vírgula cinco metros quadrados.");
  });
});

describe("rule (d): typology", () => {
  it("spells T0..T5 and the +N / + variants", () => {
    expect(normalizeForSpeech("T0").text).toBe("T zero.");
    expect(normalizeForSpeech("T1").text).toBe("T um.");
    expect(normalizeForSpeech("T2").text).toBe("T dois.");
    expect(normalizeForSpeech("T3").text).toBe("T três.");
    expect(normalizeForSpeech("T4").text).toBe("T quatro.");
    expect(normalizeForSpeech("T5").text).toBe("T cinco.");
    expect(normalizeForSpeech("T3+1").text).toBe("T três mais um.");
    expect(normalizeForSpeech("T6+").text).toBe("T seis ou superior.");
  });
});

describe("rule (e): energy", () => {
  it("reads a + suffix as 'mais' and a - suffix as 'menos'", () => {
    expect(normalizeForSpeech("A+").text).toBe("A mais.");
    expect(normalizeForSpeech("B-").text).toBe("B menos.");
    expect(normalizeForSpeech("classe energética CE")).toEqual(
      expect.objectContaining({ text: "classe energética certificado energético." }),
    );
  });
});

describe("rule (f): ordinals, floors, house numbers", () => {
  it("reads floor ordinals in both the .º/.ª and bare forms", () => {
    expect(normalizeForSpeech("2.º andar").text).toBe("segundo andar.");
    expect(normalizeForSpeech("2º andar").text).toBe("segundo andar.");
    expect(normalizeForSpeech("2.ª casa").text).toBe("segunda casa.");
    expect(normalizeForSpeech("3ª casa").text).toBe("terceira casa.");
  });

  it("reads the ground floor and negative floors", () => {
    expect(normalizeForSpeech("R/C").text).toBe("rés-do-chão.");
    expect(normalizeForSpeech("rés do chão").text).toBe("rés-do-chão.");
    expect(normalizeForSpeech("piso -1").text).toBe("piso menos um.");
  });

  it("reads n.º / nº as 'número'", () => {
    expect(normalizeForSpeech("n.º 5").text).toBe("número cinco.");
    expect(normalizeForSpeech("nº 5").text).toBe("número cinco.");
  });
});

describe("rule (g): percent", () => {
  it("reads % as 'por cento', including decimals", () => {
    expect(normalizeForSpeech("12%").text).toBe("doze por cento.");
    expect(normalizeForSpeech("12,5%").text).toBe("doze vírgula cinco por cento.");
  });
});

describe("rule (h): abbreviations", () => {
  it("expands street-name abbreviations", () => {
    expect(normalizeForSpeech("Av. da Liberdade").text).toBe("Avenida da Liberdade.");
    expect(normalizeForSpeech("R. Ferreira Borges").text).toBe("Rua Ferreira Borges.");
    expect(normalizeForSpeech("Pç. do Comércio").text).toBe("Praça do Comércio.");
    expect(normalizeForSpeech("Pc. do Comércio").text).toBe("Praça do Comércio.");
    expect(normalizeForSpeech("Lg. do Carmo").text).toBe("Largo do Carmo.");
    expect(normalizeForSpeech("Tv. do Carmo").text).toBe("Travessa do Carmo.");
    expect(normalizeForSpeech("Est. Nacional").text).toBe("Estrada Nacional.");
  });

  it("expands honorifics", () => {
    expect(normalizeForSpeech("Dr. Silva").text).toBe("Doutor Silva.");
    expect(normalizeForSpeech("Dra. Silva").text).toBe("Doutora Silva.");
    expect(normalizeForSpeech("Sr. Silva").text).toBe("Senhor Silva.");
    expect(normalizeForSpeech("Sra. Silva").text).toBe("Senhora Silva.");
    expect(normalizeForSpeech("Sto. António").text).toBe("Santo António.");
    expect(normalizeForSpeech("Sta. Maria").text).toBe("Santa Maria.");
    expect(normalizeForSpeech("S. Bento").text).toBe("São Bento.");
  });

  it("expands units and acronyms", () => {
    expect(normalizeForSpeech("10 km").text).toBe("dez quilómetros.");
    expect(normalizeForSpeech("5 min").text).toBe("cinco minutos.");
    expect(normalizeForSpeech("3 h").text).toBe("três horas.");
    expect(normalizeForSpeech("WC").text).toBe("casa de banho.");
    expect(normalizeForSpeech("2 WC").text).toBe("duas casas de banho.");
    expect(normalizeForSpeech("AC").text).toBe("ar condicionado.");
    expect(normalizeForSpeech("A/C").text).toBe("ar condicionado.");
    expect(normalizeForSpeech("CE").text).toBe("certificado energético.");
    expect(normalizeForSpeech("IMI").text).toBe("I M I.");
    expect(normalizeForSpeech("IMT").text).toBe("I M T.");
  });

  it("expands century, com/sem, and aproximadamente", () => {
    expect(normalizeForSpeech("séc. XIX").text).toBe("século dezanove.");
    expect(normalizeForSpeech("c/ garagem").text).toBe("com garagem.");
    expect(normalizeForSpeech("s/ garagem").text).toBe("sem garagem.");
    expect(normalizeForSpeech("aprox. 100 m²").text).toBe("aproximadamente cem metros quadrados.");
  });
});

describe("rule (i): years", () => {
  it("reads a 1900..2099 year as a full number, not digit-by-digit", () => {
    expect(normalizeForSpeech("1958").text).toBe("mil novecentos e cinquenta e oito.");
    expect(normalizeForSpeech("2021").text).toBe("dois mil e vinte e um.");
  });

  it("still spells years outside the range as a plain number", () => {
    expect(normalizeForSpeech("1899").text).toBe("mil oitocentos e noventa e nove.");
    expect(normalizeForSpeech("2100").text).toBe("dois mil e cem.");
  });
});

describe("rule (j): remaining integers, decimals, feminine agreement", () => {
  it("spells thousands-separated integers", () => {
    expect(normalizeForSpeech("1350-130").text).toBe("mil trezentos e cinquenta, cento e trinta.");
  });

  it("agrees feminine nouns that follow a bare count", () => {
    expect(normalizeForSpeech("3 casas").text).toBe("três casas.");
    expect(normalizeForSpeech("2 divisões").text).toBe("duas divisões.");
    expect(normalizeForSpeech("2 assoalhadas").text).toBe("duas assoalhadas.");
    expect(normalizeForSpeech("2 frações").text).toBe("duas frações.");
    expect(normalizeForSpeech("1 vaga").text).toBe("uma vaga.");
    expect(normalizeForSpeech("2 garagens").text).toBe("duas garagens.");
    expect(normalizeForSpeech("2 áreas").text).toBe("duas áreas.");
    expect(normalizeForSpeech("4 salas").text).toBe("quatro salas.");
  });
});

describe("rule (k): whitespace cleanup and terminal punctuation", () => {
  it("collapses runs of whitespace", () => {
    expect(normalizeForSpeech("Isto   tem    espaços.").text).toBe("Isto tem espaços.");
  });

  it("adds terminal punctuation when missing, and keeps it when present", () => {
    expect(normalizeForSpeech("Isto é um teste").text).toBe("Isto é um teste.");
    expect(normalizeForSpeech("Isto termina bem!").text).toBe("Isto termina bem!");
  });

  it("keeps paragraph breaks", () => {
    expect(normalizeForSpeech("Primeiro parágrafo\n\nSegundo parágrafo").text).toBe(
      "Primeiro parágrafo.\n\nSegundo parágrafo.",
    );
  });
});

describe("no digits survive a realistic mixed paragraph", () => {
  it("normalises every rule at once, leaving only glossary respellings with digits", () => {
    const r = normalizeForSpeech(
      "Apartamento T3+1 com 118,5 m² (aprox.), no 2.º andar, R/C livre, a 10 km da Av. da " +
        "Liberdade, construído em 1987, por 350.000,00 €, 12% de desconto, CE classe A+, " +
        "Dr. Silva, n.º 5, 2 WC, IMI e IMT a pagar, séc. XIX, c/ garagem s/ elevador.",
    );
    expect(r.text).not.toMatch(/\d/);
  });
});
