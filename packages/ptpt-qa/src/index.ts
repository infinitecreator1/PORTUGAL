export { compileBounded, escapeRegex, matchAll, type RawMatch } from "./lexicon/boundary";
export { MARKERS, MARKER_BY_ID, type Marker } from "./lexicon/markers";
export { scanText, scanSections, sectionText, hitsPer1kWords, hitsToHints, blockHits, warnHits } from "./lexicon/scan";
export { GRAMMAR_RULES, GRAMMAR_SOURCES, scanGrammar, type GrammarRule } from "./grammarPatterns";
export {
  extractFacts,
  listingFacts,
  listingNumericValues,
  emptyFactSet,
  foldPlace,
  numberTokens,
  energyTokens,
  typologyTokens,
  capitalisedSpans,
  type FactSet,
  type NumberToken,
} from "./facts/extract";
export { diffFacts, preValidateFacts, type FactDiff, type PreValidateOptions } from "./facts/diff";
export { editRatio, type EditRatio } from "./editRatio";
export { checkShape, type ShapeOptions } from "./shape";
export { checkClaims, findClaims, FORBIDDEN_CLAIMS, type ClaimHit } from "./claimsCheck";
export {
  judgePtPt,
  buildJudgeRequest,
  parseJudgeResponse,
  extractJsonObject,
  sectionsToLabelledText,
  JUDGE_SYSTEM_PROMPT,
  type JudgeOptions,
  type JudgeOutput,
} from "./judge";
export {
  factsValidator,
  lexiconValidator,
  grammarValidator,
  editRatioValidator,
  shapeValidator,
  claimsValidator,
  defaultValidators,
  type DefaultValidatorOptions,
  type GateThresholds,
} from "./validators";
export { decide, runGate, RETRYABLE_VALIDATORS, type DecideInput, type Decision, type RunGateInput, type RunGateOutput } from "./gate";
