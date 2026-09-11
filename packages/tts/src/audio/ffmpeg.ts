import { execa } from "execa";
import { UpstreamError } from "@imovel/core";

/**
 * Minimal process-execution contract so ffmpeg calls can be faked in tests (this environment
 * has no `ffmpeg` binary installed). `stdoutBuffer` carries raw bytes for binary stdout
 * (a WAV or MP3 piped out); `stdout`/`stderr` are always decoded as UTF-8 text.
 */
export type Exec = (
  file: string,
  args: string[],
  opts?: { input?: Buffer },
) => Promise<{ stdout: string; stderr: string; exitCode: number; stdoutBuffer?: Buffer }>;

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value, "utf8");
  return Buffer.alloc(0);
}

/** Real executor, via `execa`. Never throws: a missing binary or non-zero exit is reported in the result. */
export const defaultExec: Exec = async (file, args, opts) => {
  try {
    const result = await execa(file, args, {
      input: opts?.input,
      encoding: "buffer",
      reject: false,
    });
    const stdoutBuffer = toBuffer(result.stdout);
    const stderrBuffer = toBuffer(result.stderr);
    return {
      stdout: stdoutBuffer.toString("utf8"),
      stderr: stderrBuffer.toString("utf8"),
      exitCode: result.exitCode ?? 1,
      stdoutBuffer,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { stdout: "", stderr: message, exitCode: 127, stdoutBuffer: Buffer.alloc(0) };
  }
};

/** True when `ffmpeg -version` runs successfully. Never throws. */
export async function hasFfmpeg(exec: Exec = defaultExec): Promise<boolean> {
  try {
    const result = await exec("ffmpeg", ["-version"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function fail(step: string, result: { stderr: string; exitCode: number }): never {
  throw new UpstreamError(`ffmpeg ${step} exited with code ${result.exitCode}`, {
    details: { step, exitCode: result.exitCode, stderr: result.stderr.slice(-2000) },
  });
}

/** Extracts the loudnorm filter's trailing JSON block from ffmpeg's stderr. */
function parseLoudnormJson(stderr: string): Record<string, string> {
  const open = stderr.lastIndexOf("{");
  const close = stderr.indexOf("}", open);
  if (open === -1 || close === -1) {
    throw new UpstreamError("ffmpeg loudnorm: no measurement JSON found in stderr", {
      details: { stderr: stderr.slice(-2000) },
    });
  }
  try {
    return JSON.parse(stderr.slice(open, close + 1)) as Record<string, string>;
  } catch (err) {
    throw new UpstreamError("ffmpeg loudnorm: could not parse measurement JSON", {
      cause: err,
      details: { stderr: stderr.slice(-2000) },
    });
  }
}

export interface LoudnormOptions {
  /** Target integrated loudness, LUFS. */
  I?: number;
  /** Target true peak, dBTP. */
  TP?: number;
  /** Target loudness range, LU. */
  LRA?: number;
  exec?: Exec;
}

/**
 * Two-pass EBU R128 loudness normalisation. First pass measures on a `pipe:0` → `-f null -`
 * run; the second pass feeds the measured values back in linear mode and pipes out a WAV.
 */
export async function loudnorm(wav: Buffer, opts: LoudnormOptions = {}): Promise<Buffer> {
  const I = opts.I ?? -16;
  const TP = opts.TP ?? -1.5;
  const LRA = opts.LRA ?? 11;
  const exec = opts.exec ?? defaultExec;

  const measurePass = await exec(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      "pipe:0",
      "-af",
      `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`,
      "-f",
      "null",
      "-",
    ],
    { input: wav },
  );
  if (measurePass.exitCode !== 0) fail("loudnorm (measure pass)", measurePass);
  const measured = parseLoudnormJson(measurePass.stderr);

  const normalizePass = await exec(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      "pipe:0",
      "-af",
      [
        "loudnorm=",
        `I=${I}:TP=${TP}:LRA=${LRA}`,
        `:measured_I=${measured.input_i}`,
        `:measured_TP=${measured.input_tp}`,
        `:measured_LRA=${measured.input_lra}`,
        `:measured_thresh=${measured.input_thresh}`,
        `:offset=${measured.target_offset}`,
        ":linear=true:print_format=summary",
      ].join(""),
      "-f",
      "wav",
      "pipe:1",
    ],
    { input: wav },
  );
  if (normalizePass.exitCode !== 0) fail("loudnorm (normalize pass)", normalizePass);
  return normalizePass.stdoutBuffer ?? Buffer.from(normalizePass.stdout, "binary");
}

export interface EncodeMp3Options {
  bitrateK?: number;
  exec?: Exec;
}

/** Encodes a WAV buffer to MP3 (libmp3lame) via a `pipe:0` → `pipe:1` ffmpeg run. */
export async function encodeMp3(wav: Buffer, opts: EncodeMp3Options = {}): Promise<Buffer> {
  const bitrateK = opts.bitrateK ?? 128;
  const exec = opts.exec ?? defaultExec;
  const result = await exec(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      "pipe:0",
      "-f",
      "mp3",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      `${bitrateK}k`,
      "pipe:1",
    ],
    { input: wav },
  );
  if (result.exitCode !== 0) fail("mp3 encode", result);
  return result.stdoutBuffer ?? Buffer.from(result.stdout, "binary");
}
