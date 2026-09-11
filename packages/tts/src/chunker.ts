import type { TTSChunk } from "@imovel/core";
import { splitSentences } from "@imovel/core";

export interface SpeechChunk extends TTSChunk {
  /** True when a paragraph break ("\n\n") precedes this chunk; the concat step inserts a longer gap. */
  paragraphBreakBefore: boolean;
}

/** Splits one over-long sentence at the last comma/semicolon before the limit, else the last space. */
function splitLongSentence(sentence: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = sentence.trim();
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars + 1);
    let cut = Math.max(window.lastIndexOf(","), window.lastIndexOf(";"));
    if (cut > 0) cut += 1; // keep the punctuation with the first piece
    else {
      cut = window.lastIndexOf(" ");
      if (cut <= 0) cut = maxChars; // a single token longer than the limit: hard cut
    }
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

/**
 * Packs sentences greedily into chunks of at most `maxChars`, never splitting a sentence
 * unless it alone exceeds the limit. Paragraph breaks always start a new chunk.
 */
export function chunkForSpeech(text: string, maxChars = 300): SpeechChunk[] {
  if (maxChars < 1) throw new RangeError("maxChars must be >= 1");
  const chunks: SpeechChunk[] = [];
  const paragraphs = text
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  paragraphs.forEach((paragraph, pIndex) => {
    const units = splitSentences(paragraph).flatMap((s) =>
      s.length > maxChars ? splitLongSentence(s, maxChars) : [s],
    );
    let current = "";
    let first = true;
    const flush = () => {
      if (!current) return;
      chunks.push({ index: chunks.length, text: current, paragraphBreakBefore: first && pIndex > 0 });
      first = false;
      current = "";
    };
    for (const unit of units) {
      if (!current) current = unit;
      else if (current.length + 1 + unit.length <= maxChars) current = `${current} ${unit}`;
      else {
        flush();
        current = unit;
      }
    }
    flush();
  });

  return chunks;
}
