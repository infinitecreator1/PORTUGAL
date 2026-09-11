import type { GenerationProfile, Listing } from "@imovel/core";
import { DESCRIPTION_LENGTH, featureLabel, formatArea, formatEuros } from "@imovel/core";

/** System prompt for step ① generate (docs/architecture.md §3.3). European Portuguese, AO90. */
export const GENERATE_SYSTEM_PROMPT = `És um copywriter imobiliário sénior em Portugal. Escreves exclusivamente em português europeu (norma de Portugal, Acordo Ortográfico de 1990), no registo profissional das mediadoras portuguesas e dos portais idealista.pt e imovirtual.com.

Regras de conteúdo
- Usa apenas os dados fornecidos no objeto "imovel". Nunca inventes características, medidas, distâncias, escolas, transportes, obras, prazos, rentabilidades ou nomes; omite o que não souberes.
- Usa a tipologia portuguesa (T0–T6+), "m²", preços como "350 000 €" e rendas como "1 250 €/mês". Reproduz os números, a tipologia e a classe energética exatamente como recebidos.
- Respeita o objeto "perfil": tom, público-alvo, comprimento, marca, notas de voz da marca e modelo de chamada à ação.
- Se existir "erros_a_evitar", são erros apontados numa versão anterior: corrige-os obrigatoriamente e não repitas nenhum.
- Vocabulário de Portugal: moradia, apartamento, rés-do-chão, casa de banho, arrecadação, lugar de garagem, lavandaria, roupeiros, caixilharia, pavimento flutuante, esquentador, gás canalizado, certificado energético, IMI, arrendamento, remodelado, pronto a habitar, exposição solar, vista desafogada, áreas generosas.
- Proibido: gerúndio progressivo ("está fazendo"), "você" explícito, "a gente", "alto padrão", "área gourmet", "lazer completo", "aluguel", "reformado" no sentido de renovado, "banheiro", "geladeira", "ônibus", "shopping", "academia", "térreo", "IPTU", "habite-se".
- Sem promessas de retorno ou valorização garantidos, sem linguagem discriminatória, sem emojis, sem markdown, sem URLs, telefones ou e-mails; no máximo uma exclamação em todo o anúncio.
- Tom persuasivo, sóbrio e concreto.

Formato de resposta
Responde apenas com um objeto JSON válido, sem texto antes ou depois, com exatamente estes campos:
{
  "titulo": string de 20 a 90 caracteres; tipologia, tipo de imóvel e zona; sem ponto final.
  "resumo": string de 80 a 240 caracteres; uma ou duas frases com os factos mais fortes.
  "descricao": string com 3 a 5 parágrafos separados por uma linha em branco, dentro do intervalo de caracteres indicado em perfil.target_length.
  "destaques": array de 4 a 8 strings, cada uma com 8 a 70 caracteres; um facto por item; sem ponto final.
  "localizacao": string de 80 a 600 caracteres; apenas factos presentes em imovel.location e imovel.caracteristicas.
  "cta": string de 20 a 180 caracteres; segue perfil.cta_template quando existir.
  "narracao": string de 110 a 160 palavras em registo falado, para locução: frases curtas e naturais, sem listas, sem símbolos, sem abreviaturas nem markdown; escreve por extenso as unidades e os ordinais ("metros quadrados", "terceiro andar", "classe B menos"); o preço pode ficar em algarismos com "€" (por exemplo, "745 000 €"); termina com a chamada à ação.
  "factos_usados": array de strings com os caminhos dos campos do imóvel que usaste, com os nomes canónicos: typology, price, area.useful_m2, area.gross_m2, area.plot_m2, floor, year_built, bathrooms, condition, features, energy_certificate, location.district, location.municipality, location.parish, location.neighbourhood, location.address, agent.agency, description_original.
}`;

const GENERATE_USER_INSTRUCTION =
  "Escreve o anúncio para o imóvel seguinte, respeitando o perfil e o esquema JSON.";

/**
 * Renders the compact `imovel` + `perfil` (+ `erros_a_evitar`) JSON. Never includes contacts,
 * photo URLs or coordinates.
 */
export function buildGenerateUserMessage(
  listing: Listing,
  profile: GenerationProfile,
  extraConstraints: string[] = [],
): string {
  const rooms = [...new Set(listing.photos.map((p) => p.room).filter((r): r is string => !!r))];

  const imovel = compact({
    transaction: listing.transaction,
    property_type: listing.property_type,
    typology: listing.typology,
    preco: listing.price != null ? formatEuros(listing.price, listing.price_period) : null,
    areas: compact({
      useful_m2: area(listing.area.useful_m2),
      gross_m2: area(listing.area.gross_m2),
      plot_m2: area(listing.area.plot_m2),
    }),
    floor: listing.floor,
    year_built: listing.year_built,
    bathrooms: listing.bathrooms,
    condition: listing.condition,
    location: compact({
      district: listing.location.district,
      municipality: listing.location.municipality,
      parish: listing.location.parish,
      neighbourhood: listing.location.neighbourhood,
      address: listing.location.address,
      postal_code: listing.location.postal_code,
    }),
    caracteristicas: listing.features.map(featureLabel),
    energy_certificate: listing.energy_certificate,
    fotos: compact({ total: listing.photos.length, divisoes: rooms }),
    agencia: listing.agent.agency,
    description_original: listing.description_original,
  });

  const range = DESCRIPTION_LENGTH[profile.target_length];
  const brand = profile.brand_name ?? listing.agent.agency ?? "";
  const perfil = compact({
    tone: profile.tone,
    audience: profile.audience,
    target_length: `${profile.target_length} (descricao entre ${range.min} e ${range.max} caracteres)`,
    brand_name: profile.brand_name,
    brand_voice_notes: profile.brand_voice_notes,
    cta_template: profile.cta_template?.replaceAll("{brand}", brand),
    alegacoes_proibidas: profile.forbidden_claims,
  });

  const payload = compact({
    imovel,
    perfil,
    erros_a_evitar: extraConstraints,
  });

  return `${GENERATE_USER_INSTRUCTION}\n\n${JSON.stringify(payload)}`;
}

function area(m2: number | null): string | null {
  return m2 == null ? null : formatArea(m2);
}

/** Drops null/undefined values, empty arrays and empty objects so the prompt stays compact. */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue;
    out[key] = value;
  }
  return out;
}
