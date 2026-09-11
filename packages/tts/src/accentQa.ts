import type { AccentQa } from "@imovel/core";
import { stripDiacritics, tokenize } from "@imovel/core";

/** Anything that can transcribe a narration and judge whether it sounds European (vs. Brazilian) Portuguese. */
export interface AccentJudge {
  /** `null` when transcription is unavailable (e.g. the judge could not be reached). */
  transcribe(wav: Buffer): Promise<string | null>;
  /** 0..100 confidence that the audio is European Portuguese, or `null` when no judge answered. */
  europeanConfidence(wav: Buffer, transcript: string): Promise<number | null>;
}

function normalizeTokens(s: string): string[] {
  return tokenize(stripDiacritics(s.toLowerCase()));
}

/**
 * Word-level Levenshtein edit distance between `reference` and `hypothesis`, divided by the
 * reference's word count, over lower-cased, accent-stripped, punctuation-free tokens.
 */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = normalizeTokens(reference);
  const hyp = normalizeTokens(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;

  const rows = ref.length + 1;
  const cols = hyp.length + 1;
  const dp = new Array<number>(rows * cols);
  const at = (i: number, j: number): number => dp[i * cols + j];
  const set = (i: number, j: number, v: number): void => {
    dp[i * cols + j] = v;
  };

  for (let i = 0; i < rows; i++) set(i, 0, i);
  for (let j = 0; j < cols; j++) set(0, j, j);
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      if (ref[i - 1] === hyp[j - 1]) set(i, j, at(i - 1, j - 1));
      else set(i, j, 1 + Math.min(at(i - 1, j), at(i, j - 1), at(i - 1, j - 1)));
    }
  }
  return at(rows - 1, cols - 1) / ref.length;
}

export interface AccentQaOptions {
  /** Maximum acceptable word error rate against the normalised narration text. Default 0.08. */
  maxWer?: number;
  /** Minimum acceptable European-Portuguese confidence, 0..100. Default 90. */
  minEuropean?: number;
}

/** Transcribes the narration and scores it for word accuracy and European-accent confidence. */
export async function runAccentQa(
  wav: Buffer,
  normalizedText: string,
  judge: AccentJudge,
  opts: AccentQaOptions = {},
): Promise<AccentQa> {
  const maxWer = opts.maxWer ?? 0.08;
  const minEuropean = opts.minEuropean ?? 90;

  const transcript = await judge.transcribe(wav);
  if (transcript === null) {
    return { wer: null, european_confidence: null, ok: false, notes: "transcription unavailable" };
  }

  const wer = wordErrorRate(normalizedText, transcript);
  const europeanConfidence = await judge.europeanConfidence(wav, transcript);
  const werOk = wer <= maxWer;
  const confidenceOk = europeanConfidence === null ? true : europeanConfidence >= minEuropean;
  const notes = !werOk
    ? `word error rate ${wer.toFixed(3)} exceeds ${maxWer}`
    : !confidenceOk
      ? `European-Portuguese confidence ${String(europeanConfidence)} below ${minEuropean}`
      : null;

  return { wer, european_confidence: europeanConfidence, ok: werOk && confidenceOk, notes };
}

/** Offline fake: echoes back whatever text it is constructed with and always scores 95% European. */
export class FakeAccentJudge implements AccentJudge {
  constructor(private readonly text: string = "") {}

  async transcribe(_wav: Buffer): Promise<string | null> {
    return this.text;
  }

  async europeanConfidence(_wav: Buffer, _transcript: string): Promise<number | null> {
    return 95;
  }
}

/** Minimal shape of `VoxCpm2RunpodProvider` needed for transcription, kept separate to avoid a cycle. */
export interface Transcriber {
  transcribe(wav: Buffer): Promise<string>;
}

/** Whisper large-v3 (`op:'transcribe'`) via the RunPod VoxCPM2 worker. No accent-confidence judge yet. */
export class RunpodWhisperJudge implements AccentJudge {
  constructor(private readonly transcriber: Transcriber) {}

  async transcribe(wav: Buffer): Promise<string | null> {
    return this.transcriber.transcribe(wav);
  }

  async europeanConfidence(_wav: Buffer, _transcript: string): Promise<number | null> {
    return null;
  }
}
