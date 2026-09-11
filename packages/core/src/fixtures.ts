/**
 * Shared test fixtures. Every package's tests can import from "@imovel/core/fixtures".
 * Portuguese copy here is European Portuguese and must stay that way; the pt-BR variant is
 * deliberately wrong and exists to exercise the gate.
 */
import { computeContentHash, computeFingerprint } from "./hash";
import type { GenerationProfile, GenerationResult } from "./schemas/generation";
import type { Listing, ListingInput } from "./schemas/listing";
import { Listing as ListingSchema, ListingInput as ListingInputSchema } from "./schemas/listing";
import type { VoiceProfile } from "./schemas/voice";
import { VoiceProfile as VoiceProfileSchema } from "./schemas/voice";
import { GenerationProfile as GenerationProfileSchema } from "./schemas/generation";

export const FIXTURE_TENANT_ID = "00000000-0000-4000-8000-000000000001";
export const FIXTURE_LISTING_ID = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
export const FIXTURE_VOICE_ID = "33333333-3333-4333-8333-333333333333";

export function sampleListingInput(overrides: Partial<ListingInput> = {}): ListingInput {
  return ListingInputSchema.parse({
    source: "csv-feed",
    source_id: "LP-2026-0417",
    source_url: null,
    ownership: "owned",
    transaction: "sale",
    property_type: "apartamento",
    typology: "T3",
    price: 745000,
    price_period: "total",
    area: { gross_m2: 132, useful_m2: 118, plot_m2: null },
    floor: "3",
    year_built: 1958,
    bathrooms: 2,
    condition: "renovado",
    location: {
      district: "Lisboa",
      municipality: "Lisboa",
      parish: "Campo de Ourique",
      neighbourhood: "Campo de Ourique",
      address: "Rua Ferreira Borges",
      postal_code: "1350-130",
      lat: 38.7167,
      lng: -9.1667,
    },
    features: ["varanda", "elevador", "arrecadacao", "garagem", "roupeiros", "vidros_duplos", "cozinha_equipada"],
    features_raw: ["Varanda", "Elevador", "Arrecadação", "Lugar de garagem", "Roupeiros", "Vidros duplos", "Cozinha equipada"],
    energy_certificate: "B-",
    photos: [
      { url: "https://example.org/photos/lp-0417-1.jpg", room: "sala", order: 0 },
      { url: "https://example.org/photos/lp-0417-2.jpg", room: "cozinha", order: 1 },
    ],
    agent: {
      name: "Marta Silva",
      agency: "Lisboa Prime Mediação",
      agency_id: "lisboa-prime",
      phone: "+351 912 345 678",
      email: "marta.silva@example.org",
    },
    description_original:
      "Apartamento T3 remodelado em 2021 em Campo de Ourique, com varanda, arrecadação e lugar de garagem.",
    language_original: "pt-PT",
    ...overrides,
  });
}

export function sampleListing(overrides: Partial<ListingInput> = {}): Listing {
  const input = sampleListingInput(overrides);
  return ListingSchema.parse({
    ...input,
    id: FIXTURE_LISTING_ID,
    tenant_id: FIXTURE_TENANT_ID,
    fetched_at: "2026-09-11T10:00:00.000Z",
    content_hash: computeContentHash(input),
    fingerprint: computeFingerprint(input),
  });
}

export function sampleGenerationProfile(overrides: Partial<GenerationProfile> = {}): GenerationProfile {
  return GenerationProfileSchema.parse({
    id: FIXTURE_PROFILE_ID,
    tenant_id: FIXTURE_TENANT_ID,
    name: "Lisboa Prime · profissional",
    brand_name: "Lisboa Prime Mediação",
    cta_template: "Marque a sua visita com a {brand}.",
    ...overrides,
  });
}

export function sampleVoiceProfile(overrides: Partial<VoiceProfile> = {}): VoiceProfile {
  return VoiceProfileSchema.parse({
    id: FIXTURE_VOICE_ID,
    tenant_id: FIXTURE_TENANT_ID,
    name: "Voz Lisboa · Inês",
    provider: "fake",
    reference_audio_key: "voices/lisboa-prime/ines-ref.wav",
    reference_transcript:
      "Bom dia. Chamo-me Inês e vou apresentar-lhe este imóvel com todo o pormenor, desde as áreas até à localização.",
    consent_doc_ref: "consent/2026-08-01-ines.pdf",
    ...overrides,
  });
}

/** Valid, native European Portuguese copy for the sample listing. */
export function sampleGenerationResult(overrides: Partial<GenerationResult> = {}): GenerationResult {
  return {
    titulo: "Apartamento T3 remodelado com varanda e garagem em Campo de Ourique",
    resumo:
      "T3 com 118 m² úteis, totalmente remodelado em 2021, com varanda, arrecadação e lugar de garagem, num 3.º andar com elevador em Campo de Ourique.",
    descricao:
      "Este apartamento T3 ocupa o 3.º andar de um prédio com elevador em Campo de Ourique, um dos bairros mais procurados de Lisboa. Com 118 m² de área útil e 132 m² de área bruta, foi remodelado em 2021 com materiais de qualidade e mantém a traça original da década de 1950 nos pormenores que importam.\n\nA sala é ampla e luminosa e abre para uma varanda com exposição poente, ideal para o fim do dia. A cozinha está equipada e os três quartos dispõem de roupeiros embutidos. Há duas casas de banho completas, vidros duplos em toda a caixilharia e um certificado energético de classe B-.\n\nO imóvel inclui um lugar de garagem e uma arrecadação, dois bens raros nesta zona da cidade. Está pronto a habitar e adequa-se tanto a uma família como a quem procura um investimento sólido numa localização consolidada.",
    destaques: [
      "Remodelado em 2021 com materiais de qualidade",
      "Varanda com exposição solar poente",
      "Lugar de garagem e arrecadação",
      "Certificado energético B-",
      "3.º andar com elevador",
    ],
    localizacao:
      "Campo de Ourique é um bairro residencial consolidado, com comércio de rua, o Mercado de Campo de Ourique, escolas e transportes a curta distância. A Rua Ferreira Borges fica a poucos minutos a pé do Jardim da Parada.",
    cta: "Marque a sua visita com a Lisboa Prime Mediação e conheça este T3 pessoalmente.",
    narracao:
      "Apresentamos um apartamento T3 remodelado em Campo de Ourique, em Lisboa. Fica no terceiro andar de um prédio com elevador e tem 118 metros quadrados de área útil. Foi renovado em 2021 e conserva o carácter do edifício original. A sala abre para uma varanda virada a poente, a cozinha está equipada e os três quartos têm roupeiros embutidos. Conta com duas casas de banho, vidros duplos e certificado energético de classe B menos. Inclui lugar de garagem e arrecadação. O preço é de 745 000 €. Marque a sua visita com a Lisboa Prime Mediação.",
    factos_usados: [
      "typology",
      "area.useful_m2",
      "area.gross_m2",
      "floor",
      "condition",
      "features",
      "energy_certificate",
      "price",
      "location.parish",
      "agent.agency",
    ],
    ...overrides,
  };
}

/** The same copy with Brazilian Portuguese vocabulary, spelling and grammar. For gate tests. */
export function sampleGenerationResultPtBr(): GenerationResult {
  const base = sampleGenerationResult();
  return {
    ...base,
    titulo: "Apartamento 3 dormitórios reformado com sacada e vaga em Campo de Ourique",
    resumo:
      "Apartamento de 3 dormitórios com 118 m², totalmente reformado em 2021, com sacada, depósito e vaga de garagem, no 3º andar com elevador em Campo de Ourique.",
    descricao:
      "Esse apartamento de 3 dormitórios está localizado no 3º andar de um prédio com elevador em Campo de Ourique, um dos bairros mais procurados de Lisboa. Com 118 m² de área útil e 132 m² de área total, foi reformado em 2021 com acabamentos de alto padrão e vem mantendo o charme original da década de 1950.\n\nA sala é ampla e ensolarada e está oferecendo acesso a uma sacada voltada para o poente, perfeita para o final do dia. A cozinha americana é planejada e os três dormitórios contam com armários embutidos. São dois banheiros completos, esquadrias com vidros duplos e certificado energético classe B-.\n\nO imóvel inclui uma vaga de garagem e um depósito, dois itens raros nessa região. Você vai adorar: está pronto para morar e a gente recomenda tanto para famílias quanto para quem busca um ótimo investimento.",
    destaques: [
      "Reformado em 2021 com acabamentos de alto padrão",
      "Sacada com sol da tarde",
      "Vaga de garagem e depósito",
      "Certificado energético B-",
      "3º andar com elevador",
    ],
    localizacao:
      "Campo de Ourique é um bairro nobre e consolidado, com comércio de rua, o Mercado de Campo de Ourique, escolas e transporte público próximo ao imóvel. A Rua Ferreira Borges fica a poucos minutos caminhando do Jardim da Parada.",
    cta: "Agende sua visita com a Lisboa Prime Mediação e venha conhecer esse apartamento.",
    narracao:
      "Apresentamos um apartamento de três dormitórios reformado em Campo de Ourique, em Lisboa. Fica no terceiro andar de um prédio com elevador e tem 118 metros quadrados de área útil. Foi reformado em 2021 e vem conservando o charme do prédio original. A sala está oferecendo acesso a uma sacada voltada para o poente, a cozinha americana é planejada e os três dormitórios têm armários embutidos. Conta com dois banheiros, esquadrias com vidros duplos e certificado energético classe B menos. Inclui vaga de garagem e depósito. O preço é de 745 000 €. Agende sua visita com a Lisboa Prime Mediação.",
  };
}
