import { numberToWordsPtPt, decimalToWordsPtPt, digitsToWordsPtPt, ordinalToWordsPtPt, romanToInt } from "./numbers";
import type { Gender } from "./numbers";

export * from "./numbers";

export interface NormalizeOptions {
  /** Whole-word respellings applied first, e.g. { "Algés": "al-jéch" }. */
  glossary?: Record<string, string>;
}

export interface NormalizeResult {
  text: string;
  /** Names of the rules that changed the text, in application order. */
  rules_applied: string[];
}

// Unicode-aware word boundaries: JS `\b` only understands ASCII letters.
const NB = "(?<![\\p{L}\\p{N}])";
const NA = "(?![\\p{L}\\p{N}])";
// A number with optional thousands separators (space or dot, 3-digit groups) and optional decimals.
const NUM = "(?<![\\p{N},.])(?:\\d{1,3}(?:[ .]\\d{3})+|\\d+)(?:,\\d+)?(?![\\p{N}])";

/** Nouns that force feminine agreement when they follow a bare number. */
const FEMININE_NOUNS = new Set([
  "casa", "casas",
  "divisão", "divisões",
  "assoalhada", "assoalhadas",
  "fração", "frações", "fracção", "fracções",
  "vaga", "vagas",
  "garagem", "garagens",
  "área", "áreas",
  "sala", "salas",
  "suite", "suites", "suíte", "suítes",
  "varanda", "varandas",
  "pessoa", "pessoas",
  "hora", "horas",
  "semana", "semanas",
  "arrecadação", "arrecadações",
  "cozinha", "cozinhas",
  "vivenda", "vivendas",
  "moradia", "moradias",
  "unidade", "unidades",
  "estação", "estações",
  "paragem", "paragens",
  "escola", "escolas",
  "praia", "praias",
  "linha", "linhas",
]);

const PERIODS: Record<string, string> = {
  "mês": "por mês", mes: "por mês", ano: "por ano", dia: "por dia", semana: "por semana",
  noite: "por noite", "m²": "por metro quadrado", m2: "por metro quadrado",
};

function re(pattern: string, flags = "gu"): RegExp {
  return new RegExp(pattern, flags);
}

/** "350 000" / "350.000" / "350000" → 350000. */
function parseGrouped(s: string): number {
  return Number(s.replace(/[ .]/g, ""));
}

function splitDecimal(raw: string): { whole: number; frac: string | null } {
  const [w, f] = raw.split(",");
  return { whole: parseGrouped(w), frac: f ?? null };
}

/** Number (possibly decimal) to words; digit-by-digit fallback beyond the supported range. */
function quantity(raw: string, gender: Gender = "m"): string {
  const { whole, frac } = splitDecimal(raw);
  if (!Number.isSafeInteger(whole) || whole > 999_999_999) return digitsToWordsPtPt(raw);
  if (frac === null) return numberToWordsPtPt(whole, { gender });
  return decimalToWordsPtPt(`${whole},${frac}`, { gender });
}

/** Adds a unit with number agreement and the "de" required after "milhão/milhões". */
function withUnit(raw: string, singular: string, plural: string, gender: Gender = "m"): string {
  const { whole, frac } = splitDecimal(raw);
  const words = quantity(raw, gender);
  const isOne = whole === 1 && (frac === null || /^0+$/.test(frac));
  if (isOne) return `${words} ${singular}`;
  const exactMillions = frac === null && whole > 0 && whole % 1_000_000 === 0;
  return exactMillions ? `${words} de ${plural}` : `${words} ${plural}`;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Glossary respellings are shielded from every later rule with private-use placeholders.
const PH_OPEN = "";
const PH_CLOSE = "";

function placeholder(i: number): string {
  return `${PH_OPEN}${String.fromCharCode(0xe100 + i)}${PH_CLOSE}`;
}

type Rule = (text: string) => string;

const cents = (frac: string): string => {
  const n = Number(frac.length === 1 ? `${frac}0` : frac.slice(0, 2));
  if (n === 0) return "";
  return n === 1 ? " e um cêntimo" : ` e ${numberToWordsPtPt(n)} cêntimos`;
};

const rules: Array<[string, Rule]> = [
  [
    "money",
    (t) =>
      t
        // "350 000 €", "350.000,00 €", "745 000 euros", "1 250 €/mês", "€350.000", "€ 1 250/mês"
        .replace(
          re(`(?:€\\s*)?(${NUM})\\s*(?:€|euros?|EUR)?(?:\\s*/\\s*(mês|mes|ano|dia|semana|noite|m²|m2)${NA})?(?![\\p{L}])`),
          (m, num: string, period: string | undefined) => {
            if (!/€|euro|EUR/.test(m)) return m;
            const { whole, frac } = splitDecimal(num);
            const words = withUnit(String(whole), "euro", "euros");
            const suffix = period ? ` ${PERIODS[period]}` : "";
            return `${words}${frac ? cents(frac) : ""}${suffix}`;
          },
        )
        .replace(re(`€\\s*/\\s*(mês|mes|ano|dia|semana|noite|m²|m2)${NA}`), (_m, p: string) => `euros ${PERIODS[p]}`)
        .replace(re(`${NB}EUR${NA}|€`), "euros"),
  ],
  [
    "area",
    (t) =>
      t
        .replace(re(`(${NUM})\\s*(?:m²|m2|m\\^2)${NA}`), (_m, num: string) =>
          withUnit(num, "metro quadrado", "metros quadrados"),
        )
        .replace(re(`(${NUM})\\s*ha${NA}`), (_m, num: string) => withUnit(num, "hectare", "hectares"))
        .replace(re(`${NB}(?:m²|m2)${NA}`), "metros quadrados"),
  ],
  [
    "typology",
    (t) =>
      t.replace(re(`${NB}T(\\d)(?:\\+(\\d)|(\\+))?${NA}`), (_m, a: string, b: string | undefined, plus: string | undefined) => {
        const base = `T ${numberToWordsPtPt(Number(a))}`;
        if (b !== undefined) return `${base} mais ${numberToWordsPtPt(Number(b))}`;
        if (plus) return `${base} ou superior`;
        return base;
      }),
  ],
  [
    "energy",
    (t) =>
      t.replace(re(`${NB}([A-G])([+\\-−–])${NA}`), (_m, cls: string, sign: string) =>
        sign === "+" ? `${cls} mais` : `${cls} menos`,
      ),
  ],
  [
    "ordinals",
    (t) =>
      t
        .replace(re(`${NB}(\\d{1,3})\\.?([ºª°])(?:s)?${NA}`), (m, n: string, mark: string) => {
          const v = Number(n);
          const gender: Gender = mark === "ª" ? "f" : "m";
          if (v >= 1 && v <= 99) return ordinalToWordsPtPt(v, gender);
          return v <= 999 ? numberToWordsPtPt(v, { gender }) : m;
        })
        .replace(re(`${NB}[Rr]/[Cc]${NA}|${NB}[Rr]és[ -]do[ -]ch[ãa]o${NA}`), "rés-do-chão")
        .replace(re(`${NB}(piso|andar|cave|nível|nivel)\\s+[-−–]\\s?(\\d{1,2})${NA}`, "giu"), (_m, w: string, n: string) =>
          `${w} menos ${numberToWordsPtPt(Number(n))}`,
        )
        .replace(re(`${NB}([Nn])\\.?[º°](?:s)?${NA}`), (_m, n: string) => (n === "N" ? "Número" : "número")),
  ],
  [
    "percent",
    (t) => t.replace(re(`(${NUM})\\s*%`), (_m, num: string) => `${quantity(num)} por cento`),
  ],
  [
    "abbreviations",
    (t) =>
      t
        .replace(re(`${NB}Av\\.\\s*(?=\\p{L})`), "Avenida ")
        .replace(re(`${NB}R\\.\\s*(?=\\p{Lu}|d[aeo]s?\\s)`), "Rua ")
        .replace(re(`${NB}P[çc]\\.\\s*(?=\\p{L})`), "Praça ")
        .replace(re(`${NB}Lg\\.\\s*(?=\\p{L})`), "Largo ")
        .replace(re(`${NB}Tv\\.\\s*(?=\\p{L})`), "Travessa ")
        .replace(re(`${NB}Est\\.\\s*(?=\\p{L})`), "Estrada ")
        .replace(re(`${NB}Dra\\.\\s*(?=\\p{Lu})|${NB}Dr\\.ª\\s*(?=\\p{Lu})`), "Doutora ")
        .replace(re(`${NB}Dr\\.\\s*(?=\\p{Lu})`), "Doutor ")
        .replace(re(`${NB}Sra\\.\\s*(?=\\p{Lu})|${NB}Sr\\.ª\\s*(?=\\p{Lu})`), "Senhora ")
        .replace(re(`${NB}Sr\\.\\s*(?=\\p{Lu})`), "Senhor ")
        .replace(re(`${NB}Sto\\.\\s*(?=\\p{Lu})`), "Santo ")
        .replace(re(`${NB}Sta\\.\\s*(?=\\p{Lu})`), "Santa ")
        .replace(re(`${NB}S\\.\\s*(?=\\p{Lu}\\p{Ll})`), "São ")
        .replace(re(`(${NUM})\\s*km\\s*/\\s*h${NA}`), (_m, num: string) =>
          `${withUnit(num, "quilómetro", "quilómetros")} por hora`,
        )
        .replace(re(`(${NUM})\\s*km${NA}`), (_m, num: string) => withUnit(num, "quilómetro", "quilómetros"))
        .replace(re(`${NB}km${NA}`), "quilómetros")
        .replace(re(`(${NUM})\\s*min\\.?(?=\\s+[\\p{Ll}\\p{N}])|(${NUM})\\s*min${NA}`), (_m, a: string | undefined, b: string | undefined) =>
          withUnit((a ?? b) as string, "minuto", "minutos"),
        )
        .replace(re(`(?<![\\p{N},.])(\\d{1,2})h(\\d{2})${NA}`), (_m, h: string, mm: string) =>
          `${withUnit(h, "hora", "horas", "f")} e ${numberToWordsPtPt(Number(mm), { gender: "f" })}`,
        )
        .replace(re(`(${NUM})\\s*h${NA}`), (_m, num: string) => withUnit(num, "hora", "horas", "f"))
        .replace(re(`(${NUM})\\s*WCs?${NA}`), (_m, num: string) => withUnit(num, "casa de banho", "casas de banho", "f"))
        .replace(re(`${NB}WCs?${NA}`), "casa de banho")
        .replace(re(`${NB}A/?C${NA}`), "ar condicionado")
        .replace(re(`${NB}CE${NA}`), "certificado energético")
        .replace(re(`${NB}IMI${NA}`), "I M I")
        .replace(re(`${NB}IMT${NA}`), "I M T")
        .replace(re(`${NB}[Ss]éc\\.\\s*`), "século ")
        .replace(re(`${NB}(século)\\s+([IVXLC]+)${NA}`, "giu"), (m, w: string, roman: string) => {
          const n = romanToInt(roman);
          return n === null || n > 99 ? m : `${w} ${numberToWordsPtPt(n)}`;
        })
        .replace(re(`${NB}[Cc]/(?=\\s*\\p{L})`), "com ")
        .replace(re(`${NB}[Ss]/(?=\\s*\\p{L})`), "sem ")
        .replace(re(`${NB}[Aa]prox\\.(?=\\s+[\\p{Ll}\\p{N}])|${NB}[Aa]prox${NA}`), "aproximadamente"),
  ],
  [
    "years",
    (t) => t.replace(re(`(?<![\\p{N},.])((?:19|20)\\d{2})(?![\\p{N},.]\\d)`), (_m, y: string) => numberToWordsPtPt(Number(y))),
  ],
  [
    "numbers",
    (t) =>
      t
        // postal codes "1350-130" → "mil trezentos e cinquenta, cento e trinta"
        .replace(re(`(?<![\\p{N},.])(\\d{4})-(\\d{3})${NA}`), (_m, a: string, b: string) =>
          `${numberToWordsPtPt(Number(a))}, ${numberToWordsPtPt(Number(b))}`,
        )
        // small ranges "2-3 quartos" → "dois a três quartos"
        .replace(re(`(?<![\\p{N},.])(\\d{1,3})\\s*[-–]\\s*(\\d{1,3})(?![\\p{N},.]\\d)`), (_m, a: string, b: string) =>
          `${numberToWordsPtPt(Number(a))} a ${numberToWordsPtPt(Number(b))}`,
        )
        // dot-decimal with one or two digits, "3.5" → "três vírgula cinco"
        .replace(re(`(?<![\\p{N},.])(\\d+)\\.(\\d{1,2})(?![\\p{N}])`), (_m, w: string, f: string) => decimalToWordsPtPt(`${w},${f}`))
        // everything else, with feminine agreement when a feminine noun follows. The lookahead
        // is wrapped in an alternation (rather than quantified with `?`) because the `u` flag
        // forbids quantifying an assertion directly.
        .replace(re(`(${NUM})(?:(?=\\s+(\\p{L}+))|)`), (_m, num: string, noun: string | undefined) => {
          const gender: Gender = noun && FEMININE_NOUNS.has(noun.toLowerCase()) ? "f" : "m";
          return quantity(num, gender);
        })
        // whatever is left (broken separators, ids) is spelt digit by digit
        .replace(/\d+/gu, (d) => digitsToWordsPtPt(d)),
  ],
];

const TERMINAL = /[.!?…]["”»)]?$/u;

function cleanup(text: string): string {
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) =>
      p
        .replace(/\s+/g, " ")
        .replace(/\s+([,.;:!?…])/g, "$1")
        .replace(/([,;:])(?=\p{L})/gu, "$1 ")
        .trim(),
    )
    .filter(Boolean)
    .map((p) => (TERMINAL.test(p) ? p : `${p}.`));
  return paragraphs.join("\n\n");
}

/**
 * Rewrites listing copy so a TTS engine reads it as European Portuguese: money, areas,
 * typology, energy classes, ordinals, abbreviations and every remaining digit become words.
 * Paragraph breaks ("\n\n") are preserved for the chunker.
 */
export function normalizeForSpeech(text: string, opts: NormalizeOptions = {}): NormalizeResult {
  const applied: string[] = [];
  // NBSP, narrow NBSP, thin space — normalised to a plain space before any rule runs.
  let t = text.replace(/[\u00a0\u202f\u2009]/g, " ");

  // (a) glossary — whole-word, case-insensitive, accent-sensitive; shielded from later rules.
  const shielded: string[] = [];
  const entries = Object.entries(opts.glossary ?? {})
    .filter(([k]) => k.trim().length > 0)
    .sort((a, b) => b[0].length - a[0].length);
  for (const [term, respelling] of entries) {
    const before = t;
    t = t.replace(re(`${NB}${escapeRegExp(term.trim())}${NA}`, "giu"), () => {
      shielded.push(respelling);
      return placeholder(shielded.length - 1);
    });
    if (t !== before && !applied.includes("glossary")) applied.push("glossary");
  }

  for (const [name, rule] of rules) {
    const before = t;
    t = rule(t);
    if (t !== before) applied.push(name);
  }

  const before = t;
  t = cleanup(t);
  if (t !== before) applied.push("cleanup");

  t = t.replace(re(`${PH_OPEN}(.)${PH_CLOSE}`), (_m, c: string) => shielded[c.charCodeAt(0) - 0xe100] ?? "");
  return { text: t, rules_applied: applied };
}
