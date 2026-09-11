import type { GenerationResult } from "@imovel/core";
import { GenerationResult as GenerationResultSchema, formatArea } from "@imovel/core";
import { sampleGenerationResult } from "@imovel/core/fixtures";

/**
 * Offline stand-in for Gemini: templates native European Portuguese copy from the `imovel`
 * payload the real prompt sends, using only the listing's own facts. Good enough for the
 * smoke run, the evals with fake providers and CI; never used with a real key.
 */

interface ImovelPayload {
  transaction?: "sale" | "rent";
  property_type?: string;
  typology?: string | null;
  preco?: string | null;
  areas?: { useful_m2?: string | number | null; gross_m2?: string | number | null; plot_m2?: string | number | null };
  floor?: string | null;
  year_built?: number | null;
  bathrooms?: number | null;
  condition?: string | null;
  location?: { district?: string; municipality?: string; parish?: string | null; neighbourhood?: string | null; address?: string | null };
  caracteristicas?: string[];
  energy_certificate?: string | null;
  agencia?: string | null;
}

interface PerfilPayload {
  cta_template?: string | null;
  brand_name?: string | null;
}

export interface GeneratePayload {
  imovel?: ImovelPayload;
  perfil?: PerfilPayload;
  erros_a_evitar?: string[];
}

const TYPE_LABEL: Record<string, string> = {
  apartamento: "Apartamento",
  moradia: "Moradia",
  terreno: "Terreno",
  loja: "Loja",
  escritorio: "Escritório",
  armazem: "Armazém",
  predio: "Prédio",
  quinta: "Quinta",
  outro: "Imóvel",
};

const CONDITION: Record<string, { adj: string; sentence: string }> = {
  novo: { adj: "novo", sentence: "É um imóvel novo, pronto a habitar." },
  renovado: { adj: "remodelado", sentence: "Foi remodelado com materiais de qualidade e está pronto a habitar." },
  usado: { adj: "", sentence: "Encontra-se em bom estado de conservação e pronto a habitar." },
  em_construcao: { adj: "em construção", sentence: "Encontra-se em construção, com acabamentos a definir." },
  para_recuperar: { adj: "para recuperar", sentence: "Necessita de obras de recuperação, o que abre espaço para um projeto à medida." },
};

const SMALL_NUMBERS = ["zero", "uma", "duas", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze"];

/** Extracts the JSON payload from the generate user message. */
export function parseGeneratePayload(userMessage: string): GeneratePayload | null {
  const at = userMessage.indexOf("{");
  if (at === -1) return null;
  try {
    return JSON.parse(userMessage.slice(at)) as GeneratePayload;
  } catch {
    return null;
  }
}

function areaText(v: string | number | null | undefined): string | null {
  if (v == null) return null;
  return typeof v === "number" ? formatArea(v) : v;
}

function floorText(floor: string): string {
  if (/^\d+$/.test(floor)) return floor === "0" ? "rés-do-chão" : `${floor}.º andar`;
  if (/^(r\/?c|rés|res)/i.test(floor)) return "rés-do-chão";
  return floor;
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function bathroomsText(n: number): string {
  if (n === 1) return "uma casa de banho";
  const word = n < SMALL_NUMBERS.length ? SMALL_NUMBERS[n] : String(n);
  return `${word} casas de banho`;
}

/** Trims or pads a string into [min, max] using neutral sentences that carry no facts. */
function fit(text: string, min: number, max: number, pads: string[]): string {
  let out = text.trim();
  let i = 0;
  while (out.length < min && i < pads.length) out = `${out} ${pads[i++]}`;
  while (out.length < min) out = `${out} Marque a sua visita.`;
  if (out.length > max) out = `${out.slice(0, max - 1).replace(/\s\S*$/, "")}.`;
  return out;
}

export function fakeGenerateFromPayload(payload: GeneratePayload): GenerationResult {
  const im = payload.imovel ?? {};
  const perfil = payload.perfil ?? {};
  const tipo = TYPE_LABEL[im.property_type ?? "outro"] ?? "Imóvel";
  const tipoLower = tipo.toLowerCase();
  const tip = im.typology ? ` ${im.typology}` : "";
  const loc = im.location ?? {};
  const municipio = loc.municipality ?? "";
  const zona = loc.parish ?? loc.neighbourhood ?? municipio;
  const distrito = loc.district ?? "";
  const cond = im.condition ? (CONDITION[im.condition] ?? null) : null;
  const feats = (im.caracteristicas ?? []).filter(Boolean);
  const util = areaText(im.areas?.useful_m2);
  const bruta = areaText(im.areas?.gross_m2);
  const lote = areaText(im.areas?.plot_m2);
  const isRent = im.transaction === "rent";
  const precoSentence = im.preco ? (isRent ? `A renda é de ${im.preco}.` : `O preço é de ${im.preco}.`) : "";
  const hasLift = feats.some((f) => /elevador/i.test(f));
  const agencia = perfil.brand_name ?? im.agencia ?? null;
  const facts: string[] = [];
  const used = (k: string) => {
    if (!facts.includes(k)) facts.push(k);
  };

  if (im.typology) used("typology");
  if (im.preco) used("price");
  if (util) used("area.useful_m2");
  if (bruta) used("area.gross_m2");
  if (lote) used("area.plot_m2");
  if (loc.parish) used("location.parish");
  if (municipio) used("location.municipality");
  if (distrito) used("location.district");

  const titulo = fit(
    `${tipo}${tip}${cond?.adj ? ` ${cond.adj}` : ""}${feats[0] ? ` com ${feats[0]}` : ""} em ${zona}`,
    20,
    90,
    [`, ${municipio}`],
  ).replace(/\.$/, "");

  const resumo = fit(
    `${tipo}${tip}${util ? ` com ${util} de área útil` : ""} em ${zona}${municipio && municipio !== zona ? `, ${municipio}` : ""}${feats.length ? `, com ${joinPt(feats.slice(0, 3))}` : ""}.${precoSentence ? ` ${precoSentence}` : ""}`,
    80,
    240,
    [cond?.sentence ?? "Pronto a habitar."],
  );

  const p1Parts = [
    `Este ${tipoLower}${tip} fica em ${zona}${municipio && municipio !== zona ? `, ${municipio}` : ""}${distrito ? `, no distrito de ${distrito}` : ""}.`,
  ];
  if (im.floor) {
    p1Parts.push(`Situa-se no ${floorText(im.floor)}${hasLift ? " de um prédio com elevador" : ""}.`);
    used("floor");
  }
  if (util || bruta || lote) {
    const areas: string[] = [];
    if (util) areas.push(`${util} de área útil`);
    if (bruta) areas.push(`${bruta} de área bruta`);
    p1Parts.push(`Tem ${joinPt(areas.length ? areas : [lote ?? ""])}${areas.length && lote ? `, num lote de ${lote}` : ""}.`);
  }
  if (im.year_built) {
    p1Parts.push(`O edifício é de ${im.year_built}.`);
    used("year_built");
  }
  if (cond) {
    p1Parts.push(cond.sentence);
    used("condition");
  }

  const p2Parts: string[] = [];
  if (feats.length) {
    p2Parts.push(`Conta com ${joinPt(feats)}.`);
    used("features");
  }
  if (im.bathrooms) {
    p2Parts.push(`Dispõe de ${bathroomsText(im.bathrooms)}.`);
    used("bathrooms");
  }
  if (im.energy_certificate) {
    p2Parts.push(`O certificado energético é de classe ${im.energy_certificate}.`);
    used("energy_certificate");
  }
  if (!p2Parts.length) p2Parts.push("As divisões são funcionais e bem distribuídas, com boa luz natural.");

  const p3 = `A localização em ${zona} combina o quotidiano de ${municipio || zona} com uma envolvente residencial consolidada. ${isRent ? "Uma solução de arrendamento equilibrada para quem procura conforto e praticidade." : "Uma oportunidade sólida tanto para habitação própria como para investimento."} ${precoSentence}`.trim();

  const descricao = fit([p1Parts.join(" "), p2Parts.join(" "), p3].join("\n\n"), 400, 2600, [
    "Marque a sua visita e conheça pessoalmente todos os pormenores deste imóvel.",
    "A nossa equipa acompanha todo o processo, da visita à escritura.",
  ]);

  const destaqueCandidates = [
    `${tipo}${tip} em ${zona}`,
    util ? `${util} de área útil` : null,
    ...feats.slice(0, 4).map(cap),
    im.energy_certificate ? `Certificado energético ${im.energy_certificate}` : null,
    cond?.adj ? `Imóvel ${cond.adj}` : null,
    im.floor ? cap(floorText(im.floor)) : null,
    municipio ? `Localizado em ${municipio}` : null,
    im.typology ? `Tipologia ${im.typology}` : null,
  ].filter((d): d is string => !!d && d.length >= 8 && d.length <= 70);
  const destaques = [...new Set(destaqueCandidates)].slice(0, 8);
  while (destaques.length < 4) destaques.push(`Pronto a habitar em ${municipio || zona}`.slice(0, 70));

  const localizacao = fit(
    `${zona} pertence ao concelho de ${municipio || zona}${distrito ? `, no distrito de ${distrito}` : ""}.${loc.address ? ` O imóvel situa-se na ${loc.address}.` : ""} A zona oferece uma envolvente residencial e serviços de proximidade.`,
    80,
    600,
    ["É uma localização consolidada e procurada."],
  );
  if (loc.address) used("location.address");

  const cta = fit(perfil.cta_template ?? `Marque a sua visita com a ${agencia ?? "nossa equipa"} e conheça este imóvel pessoalmente.`, 20, 180, ["Contacte-nos."]);
  if (agencia) used("agent.agency");

  const narracao = fit(
    [
      `Apresentamos um ${tipoLower}${tip} em ${zona}${municipio && municipio !== zona ? `, em ${municipio}` : ""}.`,
      im.floor ? `Fica no ${floorText(im.floor)}${hasLift ? " de um prédio com elevador" : ""}.` : "",
      util ? `Tem ${util} de área útil.` : "",
      cond ? cond.sentence : "",
      feats.length ? `Conta com ${joinPt(feats)}.` : "",
      im.bathrooms ? `Dispõe de ${bathroomsText(im.bathrooms)}.` : "",
      im.energy_certificate ? `O certificado energético é de classe ${im.energy_certificate}.` : "",
      precoSentence,
      cta,
    ]
      .filter(Boolean)
      .join(" "),
    300,
    1400,
    [`Uma oportunidade a não perder em ${municipio || zona}.`, "Estamos ao seu dispor para esclarecer qualquer dúvida."],
  );

  const result = { titulo, resumo, descricao, destaques, localizacao, cta, narracao, factos_usados: facts };
  const parsed = GenerationResultSchema.safeParse(result);
  return parsed.success ? parsed.data : sampleGenerationResult();
}

/** Convenience for the fake responder: payload parse + template, fixture on failure. */
export function fakeGenerateFromMessage(userMessage: string): GenerationResult {
  const payload = parseGeneratePayload(userMessage);
  return payload?.imovel ? fakeGenerateFromPayload(payload) : sampleGenerationResult();
}
