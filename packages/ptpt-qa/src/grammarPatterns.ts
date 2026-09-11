/**
 * Grammar and register rules that separate European from Brazilian Portuguese, written as code.
 * The same rules are exposed to the lexicon (`lexicon/markers.ts` imports `GRAMMAR_RULES`) so
 * the `lexicon` and `grammar` validators report identical rule ids.
 */
import type { LexiconHit, SectionKey } from "@imovel/core";
import { matchAll } from "./lexicon/boundary";

export interface GrammarRule {
  id: string;
  /** Regex source; compiled by the scanner inside accent-aware boundaries with the `giu` flags. */
  pattern: string;
  severity: "block" | "warn";
  suggestion: string;
  category: "grammar" | "register";
  note?: string;
  /** Strings the rule must match (unit-tested). */
  examples: string[];
  /** Strings the rule must never match (unit-tested). */
  counterexamples: string[];
}

/** Auxiliaries that form the Brazilian progressive with a gerund. pt-PT uses "estar a + infinitivo". */
const GERUND_AUX =
  "(?:está|estão|estava|estavam|estará|estarão|esteja|estejam|vem|vêm|vinha|vinham|anda|andam|andava|continua|continuam|continuava|fica|ficam|ficava|segue|seguem|seguia)";

/**
 * Words ending in -ando/-endo/-indo that are not gerunds or belong to fixed pt-PT expressions,
 * plus common adjectives and first names that would otherwise be caught.
 */
const GERUND_EXCLUDE =
  "(?:sendo\\s+assim|tendo\\s+em\\s+conta|quando|segundo|comando|brando|lindo|lindos|estupendo|tremendo|horrendo|reverendo|dividendo|fernando|armando|orlando|rolando|ando|bando|fundo|mundo)";

/** Sentence start: beginning of text, after terminal punctuation plus whitespace, or after a line break. */
const SENTENCE_START = "(?<=^|[.!?…:]\\s+|\\n\\s*)";

/** "Nos" is also the contraction em+os ("Nos últimos anos"); skip the usual noun phrases. */
const NOS_EXCLUDE =
  "(?!\\s+(?:últimos|últimas|primeiros|primeiras|próximos|próximas|dias|anos|meses|fins|finais|arredores|bairros|casos|termos|pisos|andares|quartos|dois|três|quatro|seus|nossos|quais|melhores|mais))";

export const GRAMMAR_SOURCES = {
  progressive_gerund: `${GERUND_AUX}\\s+(?!${GERUND_EXCLUDE}(?![\\p{L}\\p{N}]))\\p{L}+(?:ando|endo|indo)`,
  initial_proclisis: `${SENTENCE_START}(?:Me|Te|Lhe|Lhes|Nos${NOS_EXCLUDE})\\s+\\p{L}+`,
  a_gente: "(?<!tod[ao]s?\\s+)a\\s+gente",
  pra_pro: "pr[ao]s?",
  possessive_no_article:
    "(?:agende|agenda|marque|marca|faça|veja|conheça|reserve|garanta|traga|visite|solicite|peça|ligue|envie|confirme)\\s+(?:sua|seu|suas|seus)",
  proximo_ao: "próxim[oa]s?\\s+(?:ao|à|aos|às)",
  demonstrative_esse: "(?:n|d)?ess(?:e|a|es|as)",
  voce: "vocês?",
} as const;

export const GRAMMAR_RULES: GrammarRule[] = [
  {
    id: "gr.progressive_gerund",
    pattern: GRAMMAR_SOURCES.progressive_gerund,
    severity: "block",
    suggestion: "estar a + infinitivo (está a oferecer, mantém, continua a crescer)",
    category: "grammar",
    note: "Progressive gerund is Brazilian; pt-PT uses «estar a + infinitivo» or the simple present.",
    examples: [
      "A sala está oferecendo acesso à varanda.",
      "O bairro vem mantendo o charme original.",
      "Os preços continuam subindo.",
      "A zona anda crescendo muito.",
      "O prédio fica ganhando valor.",
    ],
    counterexamples: [
      "Sendo assim, o imóvel é ideal.",
      "Está lindo por dentro.",
      "Fica tendo em conta a orientação solar.",
      "Está quando o sol se põe.",
      "O comando está no segundo andar.",
      "A cozinha está equipada.",
    ],
  },
  {
    id: "gr.initial_proclisis",
    pattern: GRAMMAR_SOURCES.initial_proclisis,
    severity: "block",
    suggestion: "ênclise no início da frase (Contacte-nos, Trata-se de, Permita-me)",
    category: "grammar",
    note: "«Se» is skipped on purpose: it is also a conjunction (Se quiser…).",
    examples: [
      "Me contacte para agendar.",
      "Ficamos à espera. Nos ligue hoje mesmo.",
      "Lhe apresentamos um T3 único.",
      "Excelente oportunidade! Te esperamos.",
    ],
    counterexamples: [
      "Se quiser, marque uma visita.",
      "Nos últimos anos a zona valorizou.",
      "Contacte-nos para saber mais.",
      "Trata-se de um imóvel único.",
    ],
  },
  {
    id: "gr.a_gente",
    pattern: GRAMMAR_SOURCES.a_gente,
    severity: "block",
    suggestion: "nós (recomendamos, ficamos à espera)",
    category: "register",
    note: "«toda a gente» is native pt-PT and is not flagged.",
    examples: ["A gente recomenda a visita.", "Fale com a gente."],
    counterexamples: ["Toda a gente conhece o bairro.", "Há muita gente na zona."],
  },
  {
    id: "gr.pra_pro",
    pattern: GRAMMAR_SOURCES.pra_pro,
    severity: "block",
    suggestion: "para / para o",
    category: "register",
    examples: ["Perfeito pra famílias.", "Ligue pro nosso escritório.", "Ideal pras férias."],
    counterexamples: ["Os prós e os contras.", "Para toda a família."],
  },
  {
    id: "gr.possessive_no_article",
    pattern: GRAMMAR_SOURCES.possessive_no_article,
    severity: "warn",
    suggestion: "artigo antes do possessivo (agende a sua visita, marque a sua visita)",
    category: "grammar",
    examples: ["Agende sua visita hoje.", "Marque seu horário.", "Garanta seu apartamento."],
    counterexamples: ["Agende a sua visita hoje.", "Marque a sua visita."],
  },
  {
    id: "gr.proximo_ao",
    pattern: GRAMMAR_SOURCES.proximo_ao,
    severity: "warn",
    suggestion: "próximo de / junto a / perto de",
    category: "grammar",
    examples: ["Fica próximo ao metro.", "Próxima à praia.", "Próximos aos serviços."],
    counterexamples: ["Fica próximo de todos os serviços.", "Junto ao rio."],
  },
  {
    id: "gr.demonstrative_esse",
    pattern: GRAMMAR_SOURCES.demonstrative_esse,
    severity: "warn",
    suggestion: "este / esta / neste / nesta / deste / desta quando se refere ao imóvel",
    category: "grammar",
    examples: ["Esse apartamento é único.", "Dois bens raros nessa região.", "O valor desse imóvel."],
    counterexamples: ["Este apartamento é único.", "Nesta zona da cidade.", "Interesse neste imóvel."],
  },
  {
    id: "reg.voce",
    pattern: GRAMMAR_SOURCES.voce,
    severity: "warn",
    suggestion: "forma impessoal ou «o senhor / a senhora»; omitir o pronome",
    category: "register",
    examples: ["Você vai adorar a vista.", "Vocês merecem este espaço."],
    counterexamples: ["Vai adorar a vista.", "Merece este espaço."],
  },
];

/** Runs every grammar rule over one field and returns hits sorted by position. */
export function scanGrammar(text: string, field: SectionKey): LexiconHit[] {
  const hits: LexiconHit[] = [];
  for (const rule of GRAMMAR_RULES) {
    for (const m of matchAll(rule.pattern, text)) {
      hits.push({
        rule_id: rule.id,
        term: m.term,
        field,
        index: m.index,
        severity: rule.severity,
        suggestion: rule.suggestion,
      });
    }
  }
  return hits.sort((a, b) => a.index - b.index || a.rule_id.localeCompare(b.rule_id));
}
