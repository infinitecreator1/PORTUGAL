import { stripDiacritics } from "@imovel/core";

const GROUND = /\b(res[- ]?do[- ]?chao|r\/c|rc|ground(?: floor)?|terreo|bajo|planta baja|rez[- ]de[- ]chaussee)\b/;
const BASEMENT = /\b(cave|basement|sotano|subsolo|porao)\b/;
const ATTIC = /\b(sotao|attic|aguas[- ]furtadas|penthouse|cobertura|ultimo andar)\b/;
const ORDINAL = /(-?\d{1,2})\s*(?:\.?\s*[ºo°]|st|nd|rd|th)?\s*(?:andar|piso|floor|planta)?/;
const PREFIXED = /(?:andar|piso|floor|planta)\s*(-?\d{1,2})/;

/**
 * Normalises a floor to a short label: "3.º andar" → "3", "Rés do chão" → "R/C",
 * "cave" → "-1", numbers → their string. Unknown text is kept trimmed (max 24 chars).
 */
export function parseFloor(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "number") return Number.isFinite(input) ? String(Math.trunc(input)) : null;
  if (typeof input !== "string") return null;
  const raw = input.trim();
  if (!raw) return null;
  const s = stripDiacritics(raw).toLowerCase();
  if (GROUND.test(s)) return "R/C";
  if (BASEMENT.test(s)) return "-1";
  const prefixed = PREFIXED.exec(s);
  if (prefixed) return String(Number(prefixed[1]));
  const ord = ORDINAL.exec(s);
  if (ord && (ord.index === 0 || /andar|piso|floor|planta/.test(s))) return String(Number(ord[1]));
  if (ATTIC.test(s)) return raw.length <= 24 ? raw : raw.slice(0, 24);
  return raw.length <= 24 ? raw : raw.slice(0, 24);
}
