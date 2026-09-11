/**
 * OpenAI-style SSE delta parser, ported from the Chatbot.tsx reader loop: line buffering across
 * chunk boundaries, `:` comments and blank lines ignored, `data: [DONE]` ends the stream, JSON parse
 * failures re-buffer the line and wait for more data, and each `choices[0].delta.content` is yielded.
 */
export async function* parseSseDeltas(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  // Guards the re-buffer loop: a line that still fails after more data arrived is dropped.
  let lastFailedLine: string | null = null;

  try {
    read: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data:")) continue;

        const jsonStr = line.slice(5).trim();
        if (jsonStr === "[DONE]") return;

        const delta = deltaFromJson(jsonStr);
        if (delta === PARSE_FAILED) {
          if (lastFailedLine === line) {
            lastFailedLine = null;
            continue;
          }
          lastFailedLine = line;
          textBuffer = `${line}\n${textBuffer}`;
          continue read;
        }
        lastFailedLine = null;
        if (delta) yield delta;
      }
    }

    // Flush a trailing data line that arrived without a newline.
    textBuffer += decoder.decode();
    const tail = textBuffer.trim();
    if (tail.startsWith("data:")) {
      const jsonStr = tail.slice(5).trim();
      if (jsonStr !== "[DONE]") {
        const delta = deltaFromJson(jsonStr);
        if (delta && delta !== PARSE_FAILED) yield delta;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or errored; nothing to release.
    }
    reader.releaseLock();
  }
}

const PARSE_FAILED = Symbol("sse-parse-failed");

function deltaFromJson(jsonStr: string): string | undefined | typeof PARSE_FAILED {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return PARSE_FAILED;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const choices = (parsed as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0] as { delta?: { content?: unknown } } | null;
  const content = first?.delta?.content;
  return typeof content === "string" ? content : undefined;
}
