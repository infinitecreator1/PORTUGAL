import type { GenerationResult as GenerationResultType, SectionKey, ValidatorReport } from "@imovel/core";
import { GATE_THRESHOLDS, GenerationResult, SECTION_KEYS } from "@imovel/core";

const MARKDOWN_RE = /\*\*|`|^\s*#/mu;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const URL_RE = /https?:\/\/|www\.[\p{L}\p{N}-]+|[\p{L}\p{N}-]+\.(?:pt|com|org|net|eu|io)(?![\p{L}\p{N}])/iu;
const PHONE_RE = /\+?\d[\d ]{8,}\d/gu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/u;
const BULLET_LINE_RE = /^\s*(?:[-•*]|\d+[.)])\s/mu;
const NARRACAO_SYMBOL_RE = /[|#*]/u;

function paragraphs(s: string): string[] {
  return s
    .split(/\n\s*\n/u)
    .map((p) => p.trim())
    .filter(Boolean);
}

function sectionText(r: GenerationResultType, field: SectionKey): string {
  return field === "destaques" ? r.destaques.join("\n") : r[field];
}

/** Phone-like digit runs that are not prices ("12 500 000 €" is money, not a phone). */
function phoneMatches(text: string): string[] {
  const out: string[] = [];
  PHONE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PHONE_RE.exec(text)) !== null) {
    const tail = text.slice(m.index + m[0].length);
    if (/^\s*(?:€|euros?)/iu.test(tail)) continue;
    out.push(m[0]);
  }
  return out;
}

export interface ShapeOptions {
  lengthRatio?: { min: number; max: number };
}

/**
 * Structural checks on the edited result: schema, paragraph and bullet counts, per-field length
 * drift, and forbidden content (markdown, emoji, URLs, phones, e-mails, lists in `narracao`).
 */
export function checkShape(before: GenerationResultType, after: GenerationResultType, opts: ShapeOptions = {}): ValidatorReport {
  const ratio = opts.lengthRatio ?? GATE_THRESHOLDS.lengthRatio;
  const issues: string[] = [];
  const lengthRatios: Record<string, number> = {};

  const parsed = GenerationResult.safeParse(after);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) issues.push(`schema ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }

  const pBefore = paragraphs(before.descricao).length;
  const pAfter = paragraphs(after.descricao).length;
  if (pBefore !== pAfter) issues.push(`descricao paragraph count changed (${pBefore} → ${pAfter})`);

  if (Array.isArray(after.destaques) && before.destaques.length !== after.destaques.length) {
    issues.push(`destaques count changed (${before.destaques.length} → ${after.destaques.length})`);
  }

  for (const field of SECTION_KEYS) {
    const b = sectionText(before, field);
    const a = typeof after[field] === "string" || Array.isArray(after[field]) ? sectionText(after, field) : "";
    const r = a.length / Math.max(b.length, 1);
    lengthRatios[field] = Math.round(r * 1000) / 1000;
    if (b.length > 0 && (r < ratio.min || r > ratio.max)) {
      issues.push(`${field} length ratio ${r.toFixed(2)} outside ${ratio.min}–${ratio.max}`);
    }
    if (MARKDOWN_RE.test(a)) issues.push(`${field} contains markdown`);
    if (EMOJI_RE.test(a)) issues.push(`${field} contains an emoji`);
    if (URL_RE.test(a)) issues.push(`${field} contains a URL`);
    const phones = phoneMatches(a);
    if (phones.length > 0) issues.push(`${field} contains a phone number (${phones[0]})`);
    if (EMAIL_RE.test(a)) issues.push(`${field} contains an e-mail address`);
  }

  const narracao = typeof after.narracao === "string" ? after.narracao : "";
  if (BULLET_LINE_RE.test(narracao)) issues.push("narracao contains a list bullet");
  if (NARRACAO_SYMBOL_RE.test(narracao)) issues.push("narracao contains a symbol (|, # or *)");

  return { name: "shape", ok: issues.length === 0, severity: "hard", issues, details: { length_ratios: lengthRatios } };
}
