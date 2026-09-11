import { ValidationError } from "@imovel/core";
import { describe, expect, it } from "vitest";
import {
  concatWav,
  encodeWav,
  float32ToPcm16,
  parseWav,
  pcm16ToWavFromBase64,
  silence,
  sineWav,
  wavDurationSeconds,
} from "../src/wav";

describe("encodeWav / parseWav round trip", () => {
  it("round-trips PCM16 mono", () => {
    const pcm = Buffer.from(new Int16Array([0, 1000, -1000, 32767, -32768]).buffer);
    const wav = encodeWav(pcm, 16000, 1, 16);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(16000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("round-trips stereo", () => {
    const pcm = Buffer.alloc(16, 7);
    const wav = encodeWav(pcm, 44100, 2, 16);
    const parsed = parseWav(wav);
    expect(parsed.channels).toBe(2);
    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("tolerates extra chunks (e.g. LIST) before the data chunk", () => {
    const pcm = Buffer.from([1, 2, 3, 4]);
    const wav = encodeWav(pcm, 8000, 1, 16);
    const listChunk = Buffer.concat([Buffer.from("LIST", "ascii"), Buffer.from([4, 0, 0, 0]), Buffer.from([9, 9, 9, 9])]);
    // Splice the extra chunk in right after the fmt chunk (before data).
    const fmtEnd = 12 + 8 + 16;
    const withExtra = Buffer.concat([wav.subarray(0, fmtEnd), listChunk, wav.subarray(fmtEnd)]);
    // Fix up the RIFF size for the inserted bytes.
    withExtra.writeUInt32LE(withExtra.length - 8, 4);
    const parsed = parseWav(withExtra);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });

  it("rejects a non-RIFF buffer", () => {
    expect(() => parseWav(Buffer.from("not a wav file at all"))).toThrow(ValidationError);
  });

  it("rejects a WAV without a data chunk", () => {
    const wav = encodeWav(Buffer.from([1, 2]), 8000, 1, 16);
    const noData = wav.subarray(0, 36); // header only, no data chunk id/size/bytes
    expect(() => parseWav(Buffer.concat([noData]))).toThrow(ValidationError);
  });
});

describe("silence", () => {
  it("produces zeroed PCM of the right byte length", () => {
    const s = silence(1000, 16000, 1, 16);
    expect(s.length).toBe(16000 * 2);
    expect(s.every((b) => b === 0)).toBe(true);
  });

  it("scales with channels and bit depth", () => {
    expect(silence(500, 8000, 2, 16).length).toBe(8000 * 0.5 * 2 * 2);
  });
});

describe("concatWav", () => {
  function tone(seconds: number, sampleRate = 8000): Buffer {
    return sineWav({ seconds, sampleRate, freq: 440 });
  }

  it("joins parts with the base gap, and rejects a mismatched format", () => {
    const a = tone(0.1);
    const b = tone(0.1);
    const joined = concatWav([a, b], { gapMs: 50 });
    const parsedA = parseWav(a);
    const parsedB = parseWav(b);
    const parsedJoined = parseWav(joined);
    const gapSamples = Math.round((50 / 1000) * 8000) * 2; // mono, 16-bit
    expect(parsedJoined.pcm.length).toBe(parsedA.pcm.length + gapSamples + parsedB.pcm.length);

    const mismatched = encodeWav(Buffer.alloc(4), 16000, 1, 16);
    expect(() => concatWav([a, mismatched], { gapMs: 50 })).toThrow(ValidationError);
  });

  it("uses a longer gap at a paragraph break", () => {
    const parts = [tone(0.1), tone(0.1), tone(0.1)];
    const joined = concatWav(parts, { gapMs: 50, paragraphGapMs: 200, paragraphBreaks: [false, true, false] });
    const parsedParts = parts.map(parseWav);
    const parsedJoined = parseWav(joined);
    const gap1 = Math.round((200 / 1000) * 8000) * 2; // paragraph break before part 1
    const gap2 = Math.round((50 / 1000) * 8000) * 2; // ordinary gap before part 2
    const expected = parsedParts.reduce((sum, p) => sum + p.pcm.length, 0) + gap1 + gap2;
    expect(parsedJoined.pcm.length).toBe(expected);
  });

  it("throws on an empty part list", () => {
    expect(() => concatWav([], { gapMs: 50 })).toThrow(ValidationError);
  });

  it("passes a single part through with no gap inserted", () => {
    const a = tone(0.05);
    const joined = concatWav([a], { gapMs: 999 });
    expect(parseWav(joined).pcm.equals(parseWav(a).pcm)).toBe(true);
  });
});

describe("wavDurationSeconds", () => {
  it("matches the requested tone length within rounding", () => {
    const wav = sineWav({ seconds: 1.5, sampleRate: 16000, freq: 300 });
    expect(wavDurationSeconds(wav)).toBeCloseTo(1.5, 2);
  });
});

describe("float32ToPcm16", () => {
  it("maps -1..1 to the full int16 range and clamps beyond it", () => {
    const pcm = float32ToPcm16(new Float32Array([0, 1, -1, 2, -2]));
    const view = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length / 2);
    expect(view[0]).toBe(0);
    expect(view[1]).toBe(32767);
    expect(view[2]).toBe(-32768);
    expect(view[3]).toBe(32767);
    expect(view[4]).toBe(-32768);
  });
});

describe("pcm16ToWavFromBase64", () => {
  it("decodes base64 PCM16 into a valid WAV at the given sample rate", () => {
    const pcm = Buffer.from(new Int16Array([1, 2, 3, 4]).buffer);
    const wav = pcm16ToWavFromBase64(pcm.toString("base64"), 48000);
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(48000);
    expect(parsed.channels).toBe(1);
    expect(parsed.pcm.equals(pcm)).toBe(true);
  });
});

describe("sineWav", () => {
  it("produces a mono 16-bit WAV of the requested duration and sample rate", () => {
    const wav = sineWav({ seconds: 0.25, sampleRate: 24000, freq: 220 });
    const parsed = parseWav(wav);
    expect(parsed.sampleRate).toBe(24000);
    expect(parsed.channels).toBe(1);
    expect(parsed.bitsPerSample).toBe(16);
    expect(wavDurationSeconds(wav)).toBeCloseTo(0.25, 2);
  });

  it("fades in and out so successive tones concatenate without clicks", () => {
    const wav = sineWav({ seconds: 0.2, sampleRate: 24000, freq: 220 });
    const { pcm } = parseWav(wav);
    const first = pcm.readInt16LE(0);
    const last = pcm.readInt16LE(pcm.length - 2);
    expect(Math.abs(first)).toBeLessThan(500);
    expect(Math.abs(last)).toBeLessThan(500);
  });
});
