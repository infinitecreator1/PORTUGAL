import { diffWords } from "diff";
import { splitSentences, tokenize } from "@imovel/core";

export interface EditRatio {
  /** Changed word tokens divided by the number of tokens before (max of removed and added, so a substitution counts once). */
  token_change_ratio: number;
  /** after.length / before.length in characters. */
  length_ratio: number;
  /** Sentence count after minus before. */
  sentence_delta: number;
}

/** How much the editor changed: word-level change ratio, character length ratio and sentence delta. */
export function editRatio(before: string, after: string): EditRatio {
  const parts = diffWords(before, after);
  let removed = 0;
  let added = 0;
  for (const part of parts) {
    if (part.removed) removed += tokenize(part.value).length;
    else if (part.added) added += tokenize(part.value).length;
  }
  const beforeTokens = tokenize(before).length;
  return {
    token_change_ratio: Math.max(removed, added) / Math.max(beforeTokens, 1),
    length_ratio: after.length / Math.max(before.length, 1),
    sentence_delta: splitSentences(after).length - splitSentences(before).length,
  };
}
