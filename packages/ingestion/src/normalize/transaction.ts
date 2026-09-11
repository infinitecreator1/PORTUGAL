import type { Condition, LanguageTag, Ownership, Transaction } from "@imovel/core";
import { stripDiacritics } from "@imovel/core";

const RENT = /\b(rent|rental|renting|to let|let|lease|arrend[ao]r?|arrendamento|arrendamentos|aluguer|alugar|aluguel|locacao|alquiler|rent_?out|for-?rent|mensal)\b/;
const SALE = /\b(sale|sell|buy|purchase|venda|vender|comprar|compra|for-?sale|vente)\b/;

/** "sale"/"venda"/"comprar" → sale, "rent"/"arrendar"/"aluguer" → rent, else null. */
export function parseTransaction(input: unknown): Transaction | null {
  if (typeof input !== "string") return null;
  const s = stripDiacritics(input).toLowerCase().replace(/[_/]+/g, " ").trim();
  if (!s) return null;
  if (RENT.test(s)) return "rent";
  if (SALE.test(s)) return "sale";
  return null;
}

const CONDITION_RULES: Array<[Condition, RegExp]> = [
  ["em_construcao", /\b(em construcao|construcao|under construction|off[- ]plan|em projeto|em projecto|new ?development|newdevelopment)\b/],
  ["para_recuperar", /\b(para recuperar|para restaurar|para reabilitar|para remodelar|a precisar de obras|to renovate|to restore|needs? (renovation|work)|ruina|em ruinas|devoluto|fixer)\b/],
  ["renovado", /\b(renovado|renovada|remodelado|remodelada|reformado|reformada|renovated|refurbished|restaurado|recuperado|renew)\b/],
  ["novo", /\b(novo|nova|new|brand new|a estrear|por estrear|primeira ocupacao)\b/],
  ["usado", /\b(usado|usada|used|second[- ]hand|em bom estado|bom estado|good|habitavel|resale|pre-?owned)\b/],
];

export function parseCondition(input: unknown): Condition | null {
  if (typeof input !== "string") return null;
  const s = stripDiacritics(input).toLowerCase().replace(/[_/-]+/g, " ").trim();
  if (!s) return null;
  for (const [cond, re] of CONDITION_RULES) if (re.test(s)) return cond;
  return null;
}

export function parseOwnership(input: unknown): Ownership | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (s === "owned" || s === "own" || s === "proprio" || s === "próprio") return "owned";
  if (s === "represented" || s === "representado" || s === "representada" || s === "mandate") return "represented";
  if (s === "third_party" || s === "third" || s === "terceiros" || s === "external") return "third_party";
  return null;
}

export function parseLanguageTag(input: unknown): LanguageTag | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase().replace("_", "-");
  if (!s) return null;
  if (s === "pt-pt" || s === "pt" || s === "por" || s === "portuguese" || s === "português") return "pt-PT";
  if (s === "pt-br") return "pt-BR";
  if (s === "en" || s.startsWith("en-") || s === "english" || s === "eng") return "en";
  return "other";
}
