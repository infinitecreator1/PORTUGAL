/** Removes diacritics while keeping the base letters: "Óbidos" → "Obidos". */
export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Word count on whitespace, ignoring empty tokens. */
export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/** Splits text into sentences on ., !, ?, … followed by whitespace; keeps the terminator. */
export function splitSentences(s: string): string[] {
  return s
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…])\s+(?=[^\s])/u)
    .map((x) => x.trim())
    .filter(Boolean);
}

/** Tokenises on letters/digits, keeping Portuguese accents and hyphens inside words. */
export function tokenize(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? []) as string[];
}

/** Formats a whole-euro amount the Portuguese way: 350000 → "350 000 €". */
export function formatEuros(amount: number, period: "total" | "month" | null = null): string {
  const grouped = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return period === "month" ? `${grouped} €/mês` : `${grouped} €`;
}

/** Formats an area: 118.5 → "118,5 m²". */
export function formatArea(m2: number): string {
  const rounded = Math.round(m2 * 10) / 10;
  return `${rounded.toString().replace(".", ",")} m²`;
}

export function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
