import type { EnergyClass } from "@imovel/core";
import { stripDiacritics } from "@imovel/core";

const NOISE = /\b(classe|class|certificado|certificacao|certificate|certification|energetic[ao]|energy|energia|rating|ce|ep|epc)\b/g;
const PENDING = /(avaliacao|processo|pendente|pending|em curso|nao aplicavel|n\/a|na\b|requerido|solicitado|aguarda|tramitacao)/;
const EXEMPT = /(isent[oa]|exempt|dispensad[oa]|sem certificado|nao obrigatorio)/;

/**
 * Parses an energy class from portal strings: "B-", "b -", "Classe B-", "CE: A+", "Isento".
 * "Em avaliação", "Em processo", "Não aplicável" and unknown values → null. Class G is not
 * in the canonical enum and maps to null.
 */
export function parseEnergyClass(input: unknown): EnergyClass | null {
  if (input === null || input === undefined) return null;
  if (typeof input !== "string") return null;
  let s = stripDiacritics(input).toLowerCase().trim();
  if (!s) return null;
  if (EXEMPT.test(s)) return "isento";
  if (PENDING.test(s)) return null;
  s = s.replace(NOISE, " ").replace(/[:.]/g, " ").replace(/\s+/g, "").trim();
  switch (s) {
    case "a+":
    case "a+.":
    case "amais":
      return "A+";
    case "a":
      return "A";
    case "b":
      return "B";
    case "b-":
    case "bmenos":
      return "B-";
    case "c":
      return "C";
    case "d":
      return "D";
    case "e":
      return "E";
    case "f":
      return "F";
    default:
      return null;
  }
}
