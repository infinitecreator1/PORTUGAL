import { describe, expect, it } from "vitest";
import { parseSseDeltas } from "../src/sse";

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const delta of parseSseDeltas(stream)) out.push(delta);
  return out;
}

describe("parseSseDeltas", () => {
  it("yields deltas split across chunk boundaries and stops at [DONE]", async () => {
    const deltas = await collect(
      streamOf([
        'data: {"choices":[{"delta":{"content":"Olá"}}]}\n\ndata: {"choices":[{"delta":{"con',
        'tent":", "}}]}\n\n: keep-alive\n\n',
        'data: {"choices":[{"delta":{"content":"mundo"}}]}\r\n\r\ndata: [DONE]\n\n',
        'data: {"choices":[{"delta":{"content":"ignorado"}}]}\n\n',
      ]),
    );
    expect(deltas).toEqual(["Olá", ", ", "mundo"]);
  });

  it("splits a multi-byte character across chunks correctly", async () => {
    const encoded = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ção"}}]}\n');
    const cut = 40; // inside the UTF-8 bytes of "ç"
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, cut));
        controller.enqueue(encoded.slice(cut));
        controller.close();
      },
    });
    expect(await collect(stream)).toEqual(["ção"]);
  });

  it("ignores comments, blank lines, non-data lines, empty deltas and role-only chunks", async () => {
    const deltas = await collect(
      streamOf([
        ": ping\n",
        "event: message\n",
        "\n",
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n',
        'data: {"choices":[{"delta":{"content":""}}]}\n',
        'data: {"choices":[]}\n',
        'data: {"choices":[{"delta":{"content":"x"}}]}\n',
      ]),
    );
    expect(deltas).toEqual(["x"]);
  });

  it("drops a line that still fails to parse after more data arrives", async () => {
    const deltas = await collect(
      streamOf(['data: {not json\n', 'data: {"choices":[{"delta":{"content":"ok"}}]}\n', "data: [DONE]\n"]),
    );
    expect(deltas).toEqual(["ok"]);
  });

  it("flushes a final data line without a trailing newline", async () => {
    const deltas = await collect(streamOf(['data: {"choices":[{"delta":{"content":"fim"}}]}']));
    expect(deltas).toEqual(["fim"]);
  });

  it("releases the reader when the consumer stops early", async () => {
    const stream = streamOf([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n',
    ]);
    for await (const delta of parseSseDeltas(stream)) {
      expect(delta).toBe("a");
      break;
    }
    expect(stream.locked).toBe(false);
  });
});
