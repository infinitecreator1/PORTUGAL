import type { PropertyType } from "@imovel/core";
import { stripDiacritics } from "@imovel/core";

/** Ordered so that the more specific categories win over "apartamento"/"moradia". */
const RULES: Array<[PropertyType, RegExp]> = [
  ["quinta", /\b(quinta|quintinha|herdade|monte alentejano|farm|farmhouse|country ?house|countryhouse|rustic|rustico|agricola)\b/],
  ["terreno", /\b(terreno|terrenos|lote|lotes|land|plot|plots|parcela|solar urbano)\b/],
  ["predio", /\b(predio|predios|building|buildings|imovel de rendimento|edificio)\b/],
  ["armazem", /\b(armazem|armazens|warehouse|industrial|pavilhao|nave|galpao)\b/],
  ["escritorio", /\b(escritorio|escritorios|office|offices|sala comercial|gabinete)\b/],
  ["loja", /\b(loja|lojas|shop|shops|retail|comercio|comercial|commercial|premises|store|espaco comercial|ponto comercial|restaurante|cafe)\b/],
  ["moradia", /\b(moradia|moradias|casa|casas|vivenda|vivendas|house|houses|villa|villas|sobrado|chalet|chale|townhouse|bungalow|geminada|isolada|palacete|solar)\b/],
  ["apartamento", /\b(apartamento|apartamentos|flat|flats|apartment|apartments|andar|andares|t\d|penthouse|duplex|triplex|estudio|studio|kitnet|loft|cobertura|piso)\b/],
];

/**
 * Maps pt-PT, pt-BR, English and portal property-type terms to the canonical enum.
 * Falls back to "outro".
 */
export function parsePropertyType(input: unknown): PropertyType {
  if (typeof input !== "string") return "outro";
  const s = stripDiacritics(input).toLowerCase().replace(/[_\-/]+/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "outro";
  for (const [type, re] of RULES) if (re.test(s)) return type;
  return "outro";
}
