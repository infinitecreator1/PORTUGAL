import { UpstreamError } from "@imovel/core";
import { describe, expect, it } from "vitest";
import type { Exec } from "../src/audio/ffmpeg";
import { encodeMp3, hasFfmpeg, loudnorm } from "../src/audio/ffmpeg";
import { sineWav } from "../src/wav";

const wav = sineWav({ seconds: 0.2, sampleRate: 8000, freq: 220 });

const LOUDNORM_JSON = JSON.stringify({
  input_i: "-23.71",
  input_tp: "-2.30",
  input_lra: "3.10",
  input_thresh: "-33.94",
  output_i: "-16.02",
  output_tp: "-1.50",
  output_lra: "3.00",
  output_thresh: "-26.28",
  normalization_type: "dynamic",
  target_offset: "0.02",
});

describe("hasFfmpeg", () => {
  it("is true when the executor reports exit code 0", async () => {
    const exec: Exec = async (file, args) => {
      expect(file).toBe("ffmpeg");
      expect(args).toEqual(["-version"]);
      return { stdout: "ffmpeg version 6.0", stderr: "", exitCode: 0 };
    };
    expect(await hasFfmpeg(exec)).toBe(true);
  });

  it("is false when the executor reports a non-zero exit code (ffmpeg not installed)", async () => {
    const exec: Exec = async () => ({ stdout: "", stderr: "command not found", exitCode: 127 });
    expect(await hasFfmpeg(exec)).toBe(false);
  });

  it("is false when the executor throws", async () => {
    const exec: Exec = async () => {
      throw new Error("ENOENT");
    };
    expect(await hasFfmpeg(exec)).toBe(false);
  });

  it("defaults to the real executor and does not throw in this ffmpeg-less environment", async () => {
    expect(await hasFfmpeg()).toBe(false);
  });
});

describe("loudnorm", () => {
  it("runs a measure pass then a linear normalize pass, feeding the measured values back", async () => {
    const calls: { args: string[]; input?: Buffer }[] = [];
    const exec: Exec = async (file, args, opts) => {
      expect(file).toBe("ffmpeg");
      calls.push({ args, input: opts?.input });
      if (calls.length === 1) {
        expect(args).toContain("-af");
        const af = args[args.indexOf("-af") + 1];
        expect(af).toBe("loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json");
        expect(args).toEqual(expect.arrayContaining(["-f", "null", "-"]));
        return { stdout: "", stderr: `[Parsed_loudnorm_0] \n${LOUDNORM_JSON}\n`, exitCode: 0 };
      }
      const af = args[args.indexOf("-af") + 1];
      expect(af).toContain("measured_I=-23.71");
      expect(af).toContain("measured_TP=-2.30");
      expect(af).toContain("measured_LRA=3.10");
      expect(af).toContain("measured_thresh=-33.94");
      expect(af).toContain("offset=0.02");
      expect(af).toContain("linear=true");
      expect(args).toEqual(expect.arrayContaining(["-f", "wav", "pipe:1"]));
      return { stdout: "", stderr: "", exitCode: 0, stdoutBuffer: wav };
    };

    const out = await loudnorm(wav, { exec });
    expect(calls).toHaveLength(2);
    expect(calls[0].input).toBe(wav);
    expect(out).toBe(wav);
  });

  it("uses the given I/TP/LRA targets in both passes", async () => {
    const seen: string[] = [];
    const exec: Exec = async (_file, args) => {
      seen.push(args[args.indexOf("-af") + 1]);
      return seen.length === 1
        ? { stdout: "", stderr: LOUDNORM_JSON, exitCode: 0 }
        : { stdout: "", stderr: "", exitCode: 0, stdoutBuffer: wav };
    };
    await loudnorm(wav, { I: -18, TP: -2, LRA: 9, exec });
    expect(seen[0]).toBe("loudnorm=I=-18:TP=-2:LRA=9:print_format=json");
    expect(seen[1]).toContain("I=-18:TP=-2:LRA=9");
  });

  it("throws UpstreamError when the measure pass exits non-zero", async () => {
    const exec: Exec = async () => ({ stdout: "", stderr: "boom", exitCode: 1 });
    await expect(loudnorm(wav, { exec })).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws UpstreamError when the normalize pass exits non-zero", async () => {
    let n = 0;
    const exec: Exec = async () => {
      n += 1;
      return n === 1
        ? { stdout: "", stderr: LOUDNORM_JSON, exitCode: 0 }
        : { stdout: "", stderr: "boom", exitCode: 1 };
    };
    await expect(loudnorm(wav, { exec })).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws UpstreamError when the measurement JSON cannot be found", async () => {
    const exec: Exec = async () => ({ stdout: "", stderr: "no json here", exitCode: 0 });
    await expect(loudnorm(wav, { exec })).rejects.toBeInstanceOf(UpstreamError);
  });
});

describe("encodeMp3", () => {
  it("pipes the WAV in and the MP3 bytes out through libmp3lame", async () => {
    const fakeMp3 = Buffer.from([0xff, 0xfb, 1, 2, 3]);
    let seenArgs: string[] = [];
    let seenInput: Buffer | undefined;
    const exec: Exec = async (file, args, opts) => {
      seenArgs = args;
      seenInput = opts?.input;
      return { stdout: "", stderr: "", exitCode: 0, stdoutBuffer: fakeMp3 };
    };
    const out = await encodeMp3(wav, { exec });
    expect(out).toBe(fakeMp3);
    expect(seenInput).toBe(wav);
    expect(seenArgs).toEqual(
      expect.arrayContaining(["-f", "mp3", "-codec:a", "libmp3lame", "-b:a", "128k", "pipe:1"]),
    );
  });

  it("honours a custom bitrate", async () => {
    let seenArgs: string[] = [];
    const exec: Exec = async (_file, args) => {
      seenArgs = args;
      return { stdout: "", stderr: "", exitCode: 0, stdoutBuffer: Buffer.alloc(0) };
    };
    await encodeMp3(wav, { bitrateK: 192, exec });
    expect(seenArgs).toEqual(expect.arrayContaining(["-b:a", "192k"]));
  });

  it("throws UpstreamError on a non-zero exit code", async () => {
    const exec: Exec = async () => ({ stdout: "", stderr: "no libmp3lame", exitCode: 1 });
    await expect(encodeMp3(wav, { exec })).rejects.toBeInstanceOf(UpstreamError);
  });
});
