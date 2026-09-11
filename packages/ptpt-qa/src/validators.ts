import type { GateContext, LexiconHit, Validator, ValidatorReport } from "@imovel/core";
import { GATE_THRESHOLDS, SECTION_KEYS, sectionsToText } from "@imovel/core";
import { checkClaims } from "./claimsCheck";
import { editRatio } from "./editRatio";
import { diffFacts } from "./facts/diff";
import { extractFacts } from "./facts/extract";
import { scanGrammar } from "./grammarPatterns";
import { blockHits, hitsPer1kWords, scanSections, sectionText, warnHits } from "./lexicon/scan";
import { checkShape } from "./shape";

/** `GATE_THRESHOLDS` with widened numeric types so tenants can override values. */
export interface GateThresholds {
  judgePass: number;
  judgeHardFail: number;
  maxEditRatio: number;
  maxSentenceDelta: number;
  lengthRatio: { min: number; max: number };
  maxLoops: number;
  maxAmaliaAttemptsPerLoop: number;
}

function describe(h: LexiconHit): string {
  return `${h.field}: "${h.term}" → ${h.suggestion}`;
}

/** Numbers, money, typology, energy and places must survive the editor untouched. */
export function factsValidator(): Validator {
  return {
    name: "facts",
    async run(ctx: GateContext): Promise<ValidatorReport> {
      const before = extractFacts(sectionsToText(ctx.before), ctx.listing);
      const after = extractFacts(sectionsToText(ctx.after), ctx.listing);
      const diff = diffFacts(before, after);
      const issues = [
        ...diff.missing.map((x) => `missing ${x}`),
        ...diff.added.map((x) => `added ${x}`),
        ...diff.changed.map((x) => `changed ${x}`),
      ];
      return { name: "facts", ok: diff.ok, severity: "hard", issues, details: { missing: diff.missing, added: diff.added, changed: diff.changed } };
    },
  };
}

/** Zero `block` hits allowed after the editor; `warn` hits are reported. */
export function lexiconValidator(): Validator {
  return {
    name: "lexicon",
    async run(ctx: GateContext): Promise<ValidatorReport> {
      const hits = scanSections(ctx.after);
      const blocks = blockHits(hits);
      const warns = warnHits(hits);
      return {
        name: "lexicon",
        ok: blocks.length === 0,
        severity: "hard",
        issues: blocks.map(describe),
        details: {
          hits,
          block_count: blocks.length,
          warn_count: warns.length,
          warnings: warns.map(describe),
          hits_per_1k_words: Math.round(hitsPer1kWords(hits, sectionsToText(ctx.after)) * 10) / 10,
        },
      };
    },
  };
}

/** Progressive gerund, initial proclisis, «a gente», «pra/pro», possessive without article, «próximo ao». */
export function grammarValidator(): Validator {
  return {
    name: "grammar",
    async run(ctx: GateContext): Promise<ValidatorReport> {
      const hits: LexiconHit[] = [];
      for (const field of SECTION_KEYS) hits.push(...scanGrammar(sectionText(ctx.after, field), field));
      const blocks = blockHits(hits);
      const warns = warnHits(hits);
      return {
        name: "grammar",
        ok: blocks.length === 0,
        severity: "hard",
        issues: blocks.map(describe),
        details: { hits, block_count: blocks.length, warn_count: warns.length, warnings: warns.map(describe) },
      };
    },
  };
}

/**
 * Over-editing guard (soft): word-level change ratio and sentence delta over the whole text,
 * character length ratio per field.
 */
export function editRatioValidator(thresholds: GateThresholds = GATE_THRESHOLDS): Validator {
  return {
    name: "edit_ratio",
    async run(ctx: GateContext): Promise<ValidatorReport> {
      const whole = editRatio(sectionsToText(ctx.before), sectionsToText(ctx.after));
      const issues: string[] = [];
      if (whole.token_change_ratio > thresholds.maxEditRatio) {
        issues.push(`token change ratio ${whole.token_change_ratio.toFixed(2)} > ${thresholds.maxEditRatio}`);
      }
      if (Math.abs(whole.sentence_delta) > thresholds.maxSentenceDelta) {
        issues.push(`sentence count changed by ${whole.sentence_delta}`);
      }
      const perField: Record<string, ReturnType<typeof editRatio>> = {};
      for (const field of SECTION_KEYS) {
        const r = editRatio(sectionText(ctx.before, field), sectionText(ctx.after, field));
        perField[field] = r;
        if (r.length_ratio < thresholds.lengthRatio.min || r.length_ratio > thresholds.lengthRatio.max) {
          issues.push(`${field} length ratio ${r.length_ratio.toFixed(2)} outside ${thresholds.lengthRatio.min}–${thresholds.lengthRatio.max}`);
        }
      }
      return { name: "edit_ratio", ok: issues.length === 0, severity: "soft", issues, details: { whole, per_field: perField } };
    },
  };
}

export function shapeValidator(thresholds: GateThresholds = GATE_THRESHOLDS): Validator {
  return {
    name: "shape",
    async run(ctx: GateContext): Promise<ValidatorReport> {
      return checkShape(ctx.before, ctx.after, { lengthRatio: thresholds.lengthRatio });
    },
  };
}

export function claimsValidator(forbidden: readonly string[] = []): Validator {
  return {
    name: "claims",
    async run(ctx: GateContext): Promise<ValidatorReport> {
      return checkClaims(ctx.after, forbidden);
    },
  };
}

export interface DefaultValidatorOptions {
  forbiddenClaims?: string[];
  thresholds?: GateThresholds;
}

/** The six deterministic validators in the order the report lists them. */
export function defaultValidators(opts: DefaultValidatorOptions = {}): Validator[] {
  const thresholds = opts.thresholds ?? GATE_THRESHOLDS;
  return [
    factsValidator(),
    lexiconValidator(),
    grammarValidator(),
    editRatioValidator(thresholds),
    shapeValidator(thresholds),
    claimsValidator(opts.forbiddenClaims ?? []),
  ];
}
