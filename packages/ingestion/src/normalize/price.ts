import type { PricePeriod } from "@imovel/core";

export interface ParsedPrice {
  amount: number | null;
  period: PricePeriod | null;
}

const NUMBER_TOKEN = /\d(?:[\d.,\s\u00A0\u202F]*\d)?/;
const MONTH = /(\/\s*m[eê]s\b|\bmensal\b|\bmensais\b|\bmonth(ly)?\b|\/\s*mo\b|\bper month\b|\bpcm\b|\bp\/m\b|\/\s*m\b)/i;
const TOTAL = /\b(total|venda|sale)\b/i;

/**
 * Extracts a number from a free-form string, resolving European and English separators:
 * "745.000" → 745000, "745 000" → 745000, "745,000" → 745000, "118,5" → 118.5, "118.5" → 118.5.
 */
export function parseNumber(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (typeof input === "bigint") return Number(input);
  if (typeof input !== "string") return null;
  const m = NUMBER_TOKEN.exec(input);
  if (!m) return null;
  let token = m[0].replace(/[\s\u00A0\u202F]/g, "");
  const negative = /-\s*$/.test(input.slice(0, m.index));
  const hasDot = token.includes(".");
  const hasComma = token.includes(",");
  if (hasDot && hasComma) {
    const last = Math.max(token.lastIndexOf("."), token.lastIndexOf(","));
    const intPart = token.slice(0, last).replace(/[.,]/g, "");
    const decPart = token.slice(last + 1);
    token = `${intPart}.${decPart}`;
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = token.split(sep);
    const thousands = parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && parts[0]!.length <= 3;
    token = thousands ? parts.join("") : `${parts[0]}.${parts.slice(1).join("")}`;
  }
  const n = Number(token);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Integer or null; strings are parsed with `parseNumber` then truncated. */
export function parseInteger(input: unknown): number | null {
  const n = parseNumber(input);
  return n === null ? null : Math.trunc(n);
}

/**
 * Parses a price in whole euros and the period when the string says so
 * ("1.250 €/mês" → month). No marker → `period: null`; the caller decides by transaction.
 */
export function parsePrice(input: unknown): ParsedPrice {
  if (input === null || input === undefined) return { amount: null, period: null };
  if (typeof input === "number") {
    return { amount: input > 0 && Number.isFinite(input) ? Math.round(input) : null, period: null };
  }
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    const inner = parsePrice(o.amount ?? o.value ?? o.price ?? null);
    const period = parsePricePeriod(o.period ?? o.price_period ?? o.unit) ?? inner.period;
    return { amount: inner.amount, period };
  }
  if (typeof input !== "string") return { amount: null, period: null };
  const s = input.trim();
  if (!s) return { amount: null, period: null };
  const period: PricePeriod | null = MONTH.test(s) ? "month" : TOTAL.test(s) ? "total" : null;
  const n = parseNumber(s);
  const amount = n !== null && n > 0 ? Math.round(n) : null;
  return { amount, period };
}

export function parsePricePeriod(input: unknown): PricePeriod | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;
  if (s === "total" || s === "sale" || s === "venda" || s === "once") return "total";
  if (MONTH.test(s) || s === "month" || s === "mes" || s === "mês" || s === "monthly" || s === "mensal") return "month";
  return null;
}

/** Parses an area in m²: "118 m²", "118m2", "118,5", 118 → number or null when not positive. */
export function parseArea(input: unknown): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === "object") {
    const o = input as Record<string, unknown>;
    return parseArea(o.value ?? o.amount ?? o.m2 ?? null);
  }
  const n = parseNumber(input);
  if (n === null || n <= 0) return null;
  return Math.round(n * 100) / 100;
}
