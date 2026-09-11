import type { EditOptions } from "@imovel/core";

/** System prompt for step ② gate, editor role (docs/architecture.md §3.4). */
export const EDIT_SYSTEM_PROMPT = `És uma revisora linguística especializada em português europeu para o mercado imobiliário. Recebes um texto e devolves o mesmo texto corrigido para português europeu impecável (norma de Portugal, Acordo Ortográfico de 1990): vocabulário e ortografia do Brasil substituídos pelas formas de Portugal, gramática, pontuação, colocação dos pronomes clíticos ("Trata-se de…", "Contacte-nos"), "estar a + infinitivo" em vez do gerúndio progressivo, artigo antes do possessivo ("agende a sua visita"), registo profissional sem "você".

Regras invioláveis: não reescreves nem reordenas frases; não acrescentas nem removes informação; não alteras números, tipologia, áreas, preços, classe energética, nomes de localidades, ruas, agências ou pessoas; mantém a divisão em parágrafos. Se o texto já estiver correto, devolve-o igual. Não comentes, não expliques, não uses aspas nem blocos de código. Devolve apenas o texto revisto.`;

/** Separates the text to edit from any appended instructions in the user message. */
export const EDIT_MESSAGE_SEPARATOR = "\n\n---\n";

export const EDIT_STRICT_INSTRUCTION =
  "Na revisão anterior alteraste demasiado ou factos. Repete a revisão alterando apenas palavras isoladas e pontuação; mantém todas as frases e todos os valores.";

export const EDIT_HINTS_LABEL = "Corrige obrigatoriamente:";

/**
 * User message: the text itself, plus (after a separator) the strict-retry instruction and the
 * mandatory hints ("termo → sugestão") when given.
 */
export function buildEditUserMessage(
  text: string,
  opts: Pick<EditOptions, "strict" | "hints"> = {},
): string {
  const hints = (opts.hints ?? []).map((h) => h.trim()).filter(Boolean);
  const parts: string[] = [];
  if (opts.strict) parts.push(EDIT_STRICT_INSTRUCTION);
  if (hints.length) parts.push(`${EDIT_HINTS_LABEL} ${hints.join("; ")}.`);
  return parts.length ? `${text}${EDIT_MESSAGE_SEPARATOR}${parts.join(" ")}` : text;
}

/** Inverse of `buildEditUserMessage`; used by the fake client and by output cleaning. */
export function splitEditUserMessage(content: string): { text: string; instructions: string | null } {
  const at = content.lastIndexOf(EDIT_MESSAGE_SEPARATOR);
  if (at === -1) return { text: content, instructions: null };
  return {
    text: content.slice(0, at),
    instructions: content.slice(at + EDIT_MESSAGE_SEPARATOR.length),
  };
}
