import { ValidationError } from "@imovel/core";

export type Gender = "m" | "f";

export interface NumberOptions {
  gender?: Gender;
}

const UNITS = [
  "zero",
  "um",
  "dois",
  "três",
  "quatro",
  "cinco",
  "seis",
  "sete",
  "oito",
  "nove",
  "dez",
  "onze",
  "doze",
  "treze",
  "catorze",
  "quinze",
  "dezasseis",
  "dezassete",
  "dezoito",
  "dezanove",
];

const TENS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];

const HUNDREDS = [
  "",
  "cento",
  "duzentos",
  "trezentos",
  "quatrocentos",
  "quinhentos",
  "seiscentos",
  "setecentos",
  "oitocentos",
  "novecentos",
];

export const MAX_NUMBER = 999_999_999;

function feminine(word: string, gender: Gender): string {
  if (gender !== "f") return word;
  if (word === "um") return "uma";
  if (word === "dois") return "duas";
  if (word.endsWith("entos")) return `${word.slice(0, -2)}as`;
  return word;
}

/** 1..999, never zero. */
function group(n: number, gender: Gender): string {
  if (n === 100) return "cem";
  const h = Math.floor(n / 100);
  const rest = n % 100;
  const parts: string[] = [];
  if (h > 0) parts.push(feminine(HUNDREDS[h], gender));
  if (rest > 0) {
    if (rest < 20) parts.push(feminine(UNITS[rest], gender));
    else {
      const t = Math.floor(rest / 10);
      const u = rest % 10;
      parts.push(u === 0 ? TENS[t] : `${TENS[t]} e ${feminine(UNITS[u], gender)}`);
    }
  }
  return parts.join(" e ");
}

/**
 * The conjunction "e" after "mil" or "milhão" is used only when what follows is a single
 * "round" group: below one hundred or an exact multiple of one hundred.
 * "mil e vinte e um", "mil e duzentos", "um milhão e duzentos mil" but
 * "mil duzentos e cinquenta", "um milhão duzentos e cinquenta mil".
 */
function joiner(rest: number): string {
  const groups: number[] = [];
  let r = rest;
  while (r > 0) {
    groups.push(r % 1000);
    r = Math.floor(r / 1000);
  }
  const nonZero = groups.filter((g) => g > 0);
  if (nonZero.length !== 1) return " ";
  const g = nonZero[0];
  return g < 100 || g % 100 === 0 ? " e " : " ";
}

/** Integer 0..999 999 999 in European Portuguese words. */
export function numberToWordsPtPt(n: number, opts: NumberOptions = {}): string {
  const gender = opts.gender ?? "m";
  if (!Number.isInteger(n) || n < 0 || n > MAX_NUMBER) {
    throw new ValidationError(`numberToWordsPtPt: expected an integer in 0..${MAX_NUMBER}, got ${n}`);
  }
  if (n === 0) return "zero";

  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const units = n % 1000;

  let out = "";
  if (millions > 0) {
    out = millions === 1 ? "um milhão" : `${group(millions, "m")} milhões`;
    const rest = n % 1_000_000;
    if (rest > 0) out += joiner(rest);
  }
  if (thousands > 0) {
    out += thousands === 1 ? "mil" : `${group(thousands, gender)} mil`;
    if (units > 0) out += joiner(units);
  }
  if (units > 0) out += group(units, gender);
  return out;
}

/** "125,5" → "cento e vinte e cinco vírgula cinco". Accepts "," or "." as the decimal mark. */
export function decimalToWordsPtPt(value: string | number, opts: NumberOptions = {}): string {
  const s = String(value).trim().replace(".", ",");
  const m = /^(\d+)(?:,(\d+))?$/.exec(s);
  if (!m) throw new ValidationError(`decimalToWordsPtPt: cannot parse "${value}"`);
  const whole = numberToWordsPtPt(Number(m[1]), opts);
  const frac = m[2];
  if (frac === undefined || /^0+$/.test(frac)) return whole;
  return `${whole} vírgula ${fractionToWords(frac, opts)}`;
}

/** Fraction digits after the comma: "5" → "cinco", "50" → "cinquenta", "05" → "zero cinco". */
function fractionToWords(frac: string, opts: NumberOptions): string {
  if (frac.startsWith("0") || frac.length > 9) return digitsToWordsPtPt(frac);
  return numberToWordsPtPt(Number(frac), opts);
}

/** Digit by digit: "912" → "nove um dois". Fallback for anything that is not a quantity. */
export function digitsToWordsPtPt(digits: string): string {
  return Array.from(digits)
    .filter((c) => /\d/.test(c))
    .map((c) => UNITS[Number(c)])
    .join(" ");
}

const ORDINAL_UNITS = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono"];
const ORDINAL_TENS = [
  "",
  "décimo",
  "vigésimo",
  "trigésimo",
  "quadragésimo",
  "quinquagésimo",
  "sexagésimo",
  "septuagésimo",
  "octogésimo",
  "nonagésimo",
];

/** Ordinal 1..99: "décimo primeiro", feminine "décima primeira". */
export function ordinalToWordsPtPt(n: number, gender: Gender = "m"): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) {
    throw new ValidationError(`ordinalToWordsPtPt: expected an integer in 1..99, got ${n}`);
  }
  const t = Math.floor(n / 10);
  const u = n % 10;
  const words: string[] = [];
  if (t > 0) words.push(ORDINAL_TENS[t]);
  if (u > 0) words.push(ORDINAL_UNITS[u]);
  return words.map((w) => (gender === "f" ? `${w.slice(0, -1)}a` : w)).join(" ");
}

const ROMAN: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100 };

/** Roman numeral (I..C) → integer, or null when malformed. */
export function romanToInt(roman: string): number | null {
  const s = roman.toUpperCase();
  if (!/^[IVXLC]+$/.test(s)) return null;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = ROMAN[s[i]];
    const next = i + 1 < s.length ? ROMAN[s[i + 1]] : 0;
    total += cur < next ? -cur : cur;
  }
  return total > 0 ? total : null;
}
