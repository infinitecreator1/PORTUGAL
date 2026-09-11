import type { NarrationResult, ObjectStore, TTSAudio, TTSProvider, VoiceProfile } from "@imovel/core";
import { ValidationError, isRetryable, sha256 } from "@imovel/core";
import type { AccentJudge } from "./accentQa";
import { runAccentQa } from "./accentQa";
import type { Exec } from "./audio/ffmpeg";
import { defaultExec, encodeMp3, hasFfmpeg, loudnorm } from "./audio/ffmpeg";
import type { SpeechChunk } from "./chunker";
import { chunkForSpeech } from "./chunker";
import { normalizeForSpeech } from "./normalize";
import { concatWav, wavDurationSeconds } from "./wav";

const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_LOUDNORM_I = -16;

export interface NarrateIds {
  narration_id: string;
  job_id: string;
  generation_id: string;
}

export interface NarrateFfmpegOptions {
  /** Try to loudnorm + encode MP3. Falls back to a warning when `ffmpeg` is unavailable. */
  enabled: boolean;
  exec?: Exec;
}

export interface NarrateOptions {
  text: string;
  profile: VoiceProfile;
  provider: TTSProvider;
  store: ObjectStore;
  /** Object-store prefix; the WAV lands at `${keyPrefix}/${ids.narration_id}.wav`. */
  keyPrefix: string;
  ids: NarrateIds;
  /** Default: `{ enabled: true }` — post-processing is attempted and degrades with a warning. */
  ffmpeg?: NarrateFfmpegOptions;
  /** `null` and `undefined` both mean "no accent QA" — accepting `null` too eases wiring from
   *  callers that model "no judge configured" that way. */
  accentJudge?: AccentJudge | null;
  /** Silence between chunks, ms. Default 350. */
  gapMs?: number;
  /** Silence at a paragraph break, ms. Default 700. */
  paragraphGapMs?: number;
  now?: () => Date;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export interface NarrateResult {
  narration: NarrationResult;
  warnings: string[];
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function synthesizeWithRetry(
  provider: TTSProvider,
  chunk: SpeechChunk,
  profile: VoiceProfile,
  sleep: (ms: number) => Promise<void>,
): Promise<TTSAudio> {
  const maxAttempts = RETRY_DELAYS_MS.length + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await provider.synthesize(chunk, profile);
    } catch (err) {
      lastError = err;
      if (!isRetryable(err) || attempt === maxAttempts - 1) throw err;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError;
}

/**
 * Normalises `text` for speech, chunks it to the provider's limit, synthesises every chunk
 * (retrying retryable errors), concatenates with inter-chunk silence, optionally runs the
 * ffmpeg loudness/MP3 post-pass, stores the result and runs accent QA when a judge is given.
 */
export async function narrate(opts: NarrateOptions): Promise<NarrateResult> {
  const {
    text,
    profile,
    provider,
    store,
    keyPrefix,
    ids,
    accentJudge,
    gapMs = 350,
    paragraphGapMs = 700,
    now = () => new Date(),
    sleep = defaultSleep,
  } = opts;
  const ffmpeg = opts.ffmpeg ?? { enabled: true };

  if (profile.consent_doc_ref === null && provider.id.startsWith("voxcpm2")) {
    throw new ValidationError(
      `narrate: voice profile "${profile.id}" has no consent_doc_ref, required before using provider "${provider.id}"`,
    );
  }

  const warnings: string[] = [];
  const normalized = normalizeForSpeech(text, { glossary: profile.glossary });
  const chunks = chunkForSpeech(normalized.text, provider.limits().maxChars);
  if (chunks.length === 0) {
    throw new ValidationError("narrate: normalised text produced no speech chunks");
  }

  const wavParts: Buffer[] = [];
  const paragraphBreaks: boolean[] = [];
  let sampleRate: number | null = null;
  let totalChars = 0;
  let totalGpuSeconds = 0;
  let anyGpuSeconds = false;

  for (const chunk of chunks) {
    const audio = await synthesizeWithRetry(provider, chunk, profile, sleep);
    if (sampleRate === null) sampleRate = audio.sampleRate;
    wavParts.push(audio.wav);
    paragraphBreaks.push(chunk.paragraphBreakBefore);
    totalChars += audio.usage.chars;
    if (audio.usage.gpu_seconds !== undefined) {
      totalGpuSeconds += audio.usage.gpu_seconds;
      anyGpuSeconds = true;
    }
  }

  let wav = concatWav(wavParts, { gapMs, paragraphGapMs, paragraphBreaks });
  let mp3: Buffer | null = null;
  let loudnessLufs: number | null = null;

  if (ffmpeg.enabled) {
    const exec = ffmpeg.exec ?? defaultExec;
    if (await hasFfmpeg(exec)) {
      wav = await loudnorm(wav, { I: DEFAULT_LOUDNORM_I, exec });
      mp3 = await encodeMp3(wav, { exec });
      loudnessLufs = DEFAULT_LOUDNORM_I;
    } else {
      warnings.push("ffmpeg is not available: skipped loudness normalisation and MP3 encoding");
    }
  } else {
    warnings.push("ffmpeg post-processing is disabled: skipped loudness normalisation and MP3 encoding");
  }

  const wavKey = `${keyPrefix}/${ids.narration_id}.wav`;
  const storedWav = await store.put(wavKey, wav, { contentType: "audio/wav" });
  let mp3Key: string | null = null;
  if (mp3) {
    mp3Key = `${keyPrefix}/${ids.narration_id}.mp3`;
    await store.put(mp3Key, mp3, { contentType: "audio/mpeg" });
  }

  const accentQa = accentJudge ? await runAccentQa(wav, normalized.text, accentJudge) : null;

  const narration: NarrationResult = {
    id: ids.narration_id,
    job_id: ids.job_id,
    generation_id: ids.generation_id,
    provider: provider.id,
    voice_profile_id: profile.id,
    text_normalized: normalized.text,
    text_hash: sha256(normalized.text),
    chunks: chunks.length,
    wav_key: wavKey,
    mp3_key: mp3Key,
    duration_s: wavDurationSeconds(wav),
    loudness_lufs: loudnessLufs,
    sample_rate: sampleRate ?? 0,
    sha256: storedWav.sha256,
    accent_qa: accentQa,
    ai_generated: true,
    usage: { chars: totalChars, gpu_seconds: anyGpuSeconds ? totalGpuSeconds : null },
    created_at: now().toISOString(),
  };

  return { narration, warnings };
}
