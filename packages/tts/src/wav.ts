import { ValidationError } from "@imovel/core";

export interface ParsedWav {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  /** Interleaved little-endian PCM samples. */
  pcm: Buffer;
}

const WAVE_FORMAT_PCM = 1;
const WAVE_FORMAT_EXTENSIBLE = 0xfffe;

/** Parses a RIFF/WAVE container with integer PCM data, skipping LIST and other chunks. */
export function parseWav(buf: Buffer): ParsedWav {
  if (buf.length < 12 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new ValidationError("Not a RIFF/WAVE buffer");
  }
  let fmt: { format: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let pcm: Buffer | null = null;
  let offset = 12;
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    let size = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    // Streamed WAVs (ffmpeg writing to a pipe) carry 0 or 0xFFFFFFFF sizes: take the rest.
    if (size === 0xffffffff || start + size > buf.length || (id === "data" && size === 0)) size = buf.length - start;
    if (id === "fmt ") {
      if (size < 16) throw new ValidationError("WAV fmt chunk too short");
      fmt = {
        format: buf.readUInt16LE(start),
        channels: buf.readUInt16LE(start + 2),
        sampleRate: buf.readUInt32LE(start + 4),
        bitsPerSample: buf.readUInt16LE(start + 14),
      };
      if (fmt.format === WAVE_FORMAT_EXTENSIBLE && size >= 40) {
        fmt.format = buf.readUInt16LE(start + 24); // sub-format GUID starts with the format tag
      }
    } else if (id === "data") {
      pcm = buf.subarray(start, start + size);
      if (fmt) break;
    }
    offset = start + size + (size & 1);
  }
  if (!fmt) throw new ValidationError("WAV without fmt chunk");
  if (!pcm) throw new ValidationError("WAV without data chunk");
  if (fmt.format !== WAVE_FORMAT_PCM) throw new ValidationError(`Unsupported WAV format tag ${fmt.format}; expected PCM`);
  if (![8, 16, 24, 32].includes(fmt.bitsPerSample)) throw new ValidationError(`Unsupported bits per sample ${fmt.bitsPerSample}`);
  if (fmt.channels < 1 || fmt.sampleRate < 1) throw new ValidationError("WAV with invalid channel count or sample rate");
  const frame = fmt.channels * (fmt.bitsPerSample / 8);
  const usable = pcm.length - (pcm.length % frame);
  return { sampleRate: fmt.sampleRate, channels: fmt.channels, bitsPerSample: fmt.bitsPerSample, pcm: pcm.subarray(0, usable) };
}

/** Wraps interleaved PCM in a 44-byte canonical WAV header. */
export function encodeWav(pcm: Buffer, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(WAVE_FORMAT_PCM, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Zeroed PCM for `ms` milliseconds. */
export function silence(ms: number, sampleRate: number, channels = 1, bitsPerSample = 16): Buffer {
  const frames = Math.round((ms / 1000) * sampleRate);
  return Buffer.alloc(Math.max(0, frames) * channels * (bitsPerSample / 8));
}

export interface ConcatOptions {
  gapMs: number;
  paragraphGapMs?: number;
  /** Per part: true when a paragraph break precedes it. Index 0 is ignored. */
  paragraphBreaks?: boolean[];
}

/** Joins WAV parts with silence between them. All parts must share sample rate, channels and bit depth. */
export function concatWav(parts: Buffer[], opts: ConcatOptions): Buffer {
  if (parts.length === 0) throw new ValidationError("concatWav: no parts");
  const parsed = parts.map(parseWav);
  const { sampleRate, channels, bitsPerSample } = parsed[0];
  parsed.forEach((p, i) => {
    if (p.sampleRate !== sampleRate || p.channels !== channels || p.bitsPerSample !== bitsPerSample) {
      throw new ValidationError(
        `concatWav: part ${i} is ${p.sampleRate} Hz/${p.channels} ch/${p.bitsPerSample} bit, expected ${sampleRate}/${channels}/${bitsPerSample}`,
      );
    }
  });
  const pieces: Buffer[] = [];
  parsed.forEach((p, i) => {
    if (i > 0) {
      const paragraph = opts.paragraphBreaks?.[i] === true;
      const ms = paragraph ? (opts.paragraphGapMs ?? opts.gapMs) : opts.gapMs;
      pieces.push(silence(ms, sampleRate, channels, bitsPerSample));
    }
    pieces.push(p.pcm);
  });
  return encodeWav(Buffer.concat(pieces), sampleRate, channels, bitsPerSample);
}

export function wavDurationSeconds(buf: Buffer): number {
  const { sampleRate, channels, bitsPerSample, pcm } = parseWav(buf);
  return pcm.length / (sampleRate * channels * (bitsPerSample / 8));
}

/** Float samples in [-1, 1] → 16-bit little-endian PCM. */
export function float32ToPcm16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), i * 2);
  }
  return out;
}

/** Base64 of raw 16-bit PCM → WAV. */
export function pcm16ToWavFromBase64(b64: string, sampleRate: number, channels = 1): Buffer {
  return encodeWav(Buffer.from(b64, "base64"), sampleRate, channels, 16);
}

export interface SineOptions {
  seconds: number;
  sampleRate: number;
  freq: number;
  amplitude?: number;
}

/** Mono sine tone with a short fade in/out, for fakes and tests. */
export function sineWav({ seconds, sampleRate, freq, amplitude = 0.3 }: SineOptions): Buffer {
  const n = Math.max(1, Math.round(seconds * sampleRate));
  const fade = Math.min(Math.floor(sampleRate * 0.01), Math.floor(n / 2));
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let env = 1;
    if (i < fade) env = i / fade;
    else if (i >= n - fade) env = (n - 1 - i) / fade;
    samples[i] = amplitude * env * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return encodeWav(float32ToPcm16(samples), sampleRate, 1, 16);
}
