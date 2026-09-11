import { stripDiacritics } from "../text";

export interface FeatureDef {
  code: string;
  /** pt-PT label used in copy. */
  label: string;
  /** Portal strings, pt-BR and English synonyms that map to this code. */
  synonyms: string[];
}

/** Closed feature vocabulary. Copy may only mention features present here or in structured data. */
export const FEATURES: FeatureDef[] = [
  { code: "varanda", label: "varanda", synonyms: ["varanda", "sacada", "balcony", "balcão"] },
  { code: "terraco", label: "terraço", synonyms: ["terraço", "terraco", "terrace", "rooftop"] },
  { code: "jardim", label: "jardim", synonyms: ["jardim", "garden", "quintal", "logradouro"] },
  { code: "piscina", label: "piscina", synonyms: ["piscina", "pool", "swimming pool"] },
  { code: "garagem", label: "lugar de garagem", synonyms: ["garagem", "garage", "lugar de garagem", "vaga de garagem", "vaga", "parqueamento", "box"] },
  { code: "estacionamento", label: "estacionamento", synonyms: ["estacionamento", "parking", "lugar de estacionamento"] },
  { code: "elevador", label: "elevador", synonyms: ["elevador", "elevator", "lift", "ascensor"] },
  { code: "arrecadacao", label: "arrecadação", synonyms: ["arrecadação", "arrecadacao", "storage", "storage room", "despensa", "depósito"] },
  { code: "ar_condicionado", label: "ar condicionado", synonyms: ["ar condicionado", "ar-condicionado", "air conditioning", "ac", "a/c", "split"] },
  { code: "aquecimento_central", label: "aquecimento central", synonyms: ["aquecimento central", "central heating", "aquecimento"] },
  { code: "lareira", label: "lareira", synonyms: ["lareira", "fireplace", "recuperador de calor", "salamandra"] },
  { code: "piso_radiante", label: "piso radiante", synonyms: ["piso radiante", "underfloor heating"] },
  { code: "paineis_solares", label: "painéis solares", synonyms: ["painéis solares", "paineis solares", "solar panels", "solar", "fotovoltaico"] },
  { code: "cozinha_equipada", label: "cozinha equipada", synonyms: ["cozinha equipada", "equipped kitchen", "fitted kitchen", "cozinha mobilada", "cozinha planejada"] },
  { code: "cozinha_aberta", label: "cozinha em open space", synonyms: ["open space", "cozinha aberta", "cozinha americana", "open kitchen", "open-plan"] },
  { code: "roupeiros", label: "roupeiros embutidos", synonyms: ["roupeiros", "roupeiros embutidos", "armários embutidos", "built-in wardrobes", "closets", "closet", "armários planejados", "guarda-roupa"] },
  { code: "suite", label: "suite", synonyms: ["suite", "suíte", "en-suite", "ensuite", "master suite"] },
  { code: "lavandaria", label: "lavandaria", synonyms: ["lavandaria", "lavanderia", "área de serviço", "laundry", "laundry room"] },
  { code: "vidros_duplos", label: "vidros duplos", synonyms: ["vidros duplos", "double glazing", "double glazed", "janelas duplas", "caixilharia com vidro duplo"] },
  { code: "caixilharia_aluminio", label: "caixilharia de alumínio", synonyms: ["caixilharia de alumínio", "esquadrias de alumínio", "aluminium frames"] },
  { code: "estores_eletricos", label: "estores elétricos", synonyms: ["estores elétricos", "estores eletricos", "electric shutters", "persianas elétricas"] },
  { code: "pavimento_madeira", label: "soalho de madeira", synonyms: ["soalho", "soalho de madeira", "piso de madeira", "wooden floor", "parquet", "taco", "tacos"] },
  { code: "pavimento_flutuante", label: "pavimento flutuante", synonyms: ["pavimento flutuante", "piso laminado", "laminate floor", "flutuante"] },
  { code: "vista_mar", label: "vista de mar", synonyms: ["vista mar", "vista de mar", "vista para o mar", "sea view", "frente mar", "frente-mar"] },
  { code: "vista_rio", label: "vista de rio", synonyms: ["vista rio", "vista de rio", "vista para o rio", "river view", "vista tejo", "vista douro"] },
  { code: "vista_desafogada", label: "vista desafogada", synonyms: ["vista desafogada", "open view", "vista livre", "vista panorâmica", "vista panoramica"] },
  { code: "exposicao_solar", label: "boa exposição solar", synonyms: ["exposição solar", "exposicao solar", "ensolarado", "sunny", "sun exposure", "nascente/poente", "luminoso"] },
  { code: "condominio_fechado", label: "condomínio fechado", synonyms: ["condomínio fechado", "condominio fechado", "gated community", "condomínio privado"] },
  { code: "portaria", label: "portaria", synonyms: ["portaria", "porteiro", "concierge", "portaria 24h", "segurança 24h", "zelador"] },
  { code: "videoporteiro", label: "vídeo-porteiro", synonyms: ["vídeo-porteiro", "video porteiro", "videoporteiro", "intercomunicador", "interfone", "porteiro eletrônico", "porteiro eletrónico"] },
  { code: "alarme", label: "alarme", synonyms: ["alarme", "alarm", "sistema de alarme", "segurança"] },
  { code: "ginasio", label: "ginásio", synonyms: ["ginásio", "ginasio", "gym", "academia", "fitness"] },
  { code: "parque_infantil", label: "parque infantil", synonyms: ["parque infantil", "playground", "espaço infantil"] },
  { code: "churrasqueira", label: "churrasqueira", synonyms: ["churrasqueira", "barbecue", "bbq", "área gourmet", "varanda gourmet"] },
  { code: "acesso_mobilidade_reduzida", label: "acesso para mobilidade reduzida", synonyms: ["mobilidade reduzida", "wheelchair access", "acessibilidade", "sem barreiras"] },
  { code: "mobilado", label: "mobilado", synonyms: ["mobilado", "mobiliado", "furnished"] },
  { code: "gas_canalizado", label: "gás canalizado", synonyms: ["gás canalizado", "gas canalizado", "gás encanado", "gás natural", "piped gas"] },
  { code: "esquentador", label: "esquentador", synonyms: ["esquentador", "aquecedor a gás", "water heater", "termoacumulador", "cilindro"] },
  { code: "sotao", label: "sótão", synonyms: ["sótão", "sotao", "attic", "águas-furtadas"] },
  { code: "cave", label: "cave", synonyms: ["cave", "porão", "subsolo", "basement", "piso -1"] },
  { code: "anexo", label: "anexo", synonyms: ["anexo", "edícula", "annex", "casa de apoio"] },
  { code: "duplex", label: "duplex", synonyms: ["duplex", "dúplex", "two floors", "dois pisos"] },
  { code: "penthouse", label: "penthouse", synonyms: ["penthouse", "cobertura", "último andar", "ultimo andar"] },
];

const SYNONYM_INDEX: Map<string, string> = new Map();
for (const f of FEATURES) {
  for (const s of f.synonyms) SYNONYM_INDEX.set(normalizeKey(s), f.code);
  SYNONYM_INDEX.set(normalizeKey(f.code), f.code);
  SYNONYM_INDEX.set(normalizeKey(f.label), f.code);
}

function normalizeKey(s: string): string {
  return stripDiacritics(s.toLowerCase()).replace(/[^a-z0-9/ -]/g, "").replace(/\s+/g, " ").trim();
}

/** Maps a portal feature string to a taxonomy code, or null when unknown. */
export function normalizeFeature(raw: string): string | null {
  const key = normalizeKey(raw);
  if (!key) return null;
  const direct = SYNONYM_INDEX.get(key);
  if (direct) return direct;
  for (const [syn, code] of SYNONYM_INDEX) {
    if (syn.length >= 4 && (key === syn || key.includes(` ${syn}`) || key.startsWith(`${syn} `))) return code;
  }
  return null;
}

/** Maps a list of raw strings to unique taxonomy codes, in first-seen order. */
export function normalizeFeatures(raw: string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const code = normalizeFeature(r);
    if (code && !out.includes(code)) out.push(code);
  }
  return out;
}

export function featureLabel(code: string): string {
  return FEATURES.find((f) => f.code === code)?.label ?? code.replace(/_/g, " ");
}
