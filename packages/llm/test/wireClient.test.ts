import { BillingError, RateLimitError, RequestError, TimeoutError, UpstreamError } from "@imovel/core";
import { describe, expect, it } from "vitest";
import { OpenAIWireClient, combineSignals, parseRetryAfter } from "../src/openaiWireClient";

type Call = { url: string; init: RequestInit };
type Handler = (call: Call) => Response | Promise<Response>;

/** Sequential fake fetch: the n-th call uses the n-th handler; the last handler repeats. */
function fakeFetch(handlers: Handler[]) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    const handler = handlers[Math.min(calls.length - 1, handlers.length - 1)];
    if (!handler) throw new Error("no fake handler");
    return handler(call);
  };
  return { calls, fetchImpl };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function completion(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: "chatcmpl-1",
    model: "gemini-2.5-pro",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 7, completion_tokens_details: { reasoning_tokens: 3 } },
    ...overrides,
  };
}

function makeClient(
  fetchImpl: typeof fetch,
  overrides: Partial<ConstructorParameters<typeof OpenAIWireClient>[0]> = {},
) {
  const sleeps: number[] = [];
  const client = new OpenAIWireClient({
    provider: "test",
    baseUrl: "https://llm.example/v1/",
    apiKey: "sk-test",
    defaultModel: "gemini-2.5-pro",
    capabilities: { jsonSchema: false, seed: true, reasoningEffort: true },
    fetch: fetchImpl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    retryBaseMs: 10,
    ...overrides,
  });
  return { client, sleeps };
}

function sentBody(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function sentHeaders(call: Call): Record<string, string> {
  return call.init.headers as Record<string, string>;
}

const messages = [
  { role: "system" as const, content: "És um assistente." },
  { role: "user" as const, content: "Olá" },
];

describe("OpenAIWireClient.chat", () => {
  it("posts the wire body and parses content, usage and finish_reason", async () => {
    const { calls, fetchImpl } = fakeFetch([() => jsonResponse(completion("Bom dia."))]);
    const { client } = makeClient(fetchImpl);

    const res = await client.chat({
      messages,
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 100,
      seed: 7,
      stop: ["FIM"],
      response_format: { type: "json_object" },
      extra: { reasoning_effort: "low", repetition_penalty: 1.05, purpose: "generate", not_allowed: 1 },
    });

    expect(res.content).toBe("Bom dia.");
    expect(res.finish_reason).toBe("stop");
    expect(res.model).toBe("gemini-2.5-pro");
    expect(res.usage).toEqual({ input_tokens: 12, output_tokens: 7, reasoning_tokens: 3 });
    expect(res.latency_ms).toBeGreaterThanOrEqual(0);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://llm.example/v1/chat/completions");
    expect(calls[0].init.method).toBe("POST");
    expect(sentHeaders(calls[0]).Authorization).toBe("Bearer sk-test");
    expect(sentHeaders(calls[0])["Content-Type"]).toBe("application/json");

    const body = sentBody(calls[0]);
    expect(body).toMatchObject({
      model: "gemini-2.5-pro",
      messages,
      temperature: 0.7,
      top_p: 0.95,
      max_tokens: 100,
      seed: 7,
      stop: ["FIM"],
      stream: false,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      repetition_penalty: 1.05,
    });
    expect(body).not.toHaveProperty("purpose");
    expect(body).not.toHaveProperty("not_allowed");
  });

  it("retries a 429 after the Retry-After floor, then succeeds", async () => {
    const { calls, fetchImpl } = fakeFetch([
      () => new Response("slow down", { status: 429, headers: { "retry-after": "1" } }),
      () => jsonResponse(completion("ok")),
    ]);
    const { client, sleeps } = makeClient(fetchImpl);
    const onRetryErrors: unknown[] = [];
    const clientWithHook = new OpenAIWireClient({
      provider: "test",
      baseUrl: "https://llm.example/v1",
      apiKey: "k",
      defaultModel: "m",
      capabilities: client.capabilities,
      fetch: fetchImpl,
      retryBaseMs: 10,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      onRetry: ({ error }) => onRetryErrors.push(error),
    });

    const res = await clientWithHook.chat({ messages });
    expect(res.content).toBe("ok");
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBeGreaterThanOrEqual(1000);
    expect(onRetryErrors[0]).toBeInstanceOf(RateLimitError);
    expect((onRetryErrors[0] as RateLimitError).retryAfterMs).toBe(1000);
  });

  it("maps 402 to BillingError without retrying", async () => {
    const { calls, fetchImpl } = fakeFetch([() => new Response('{"error":"no credits"}', { status: 402 })]);
    const { client, sleeps } = makeClient(fetchImpl);

    const err = await client.chat({ messages }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BillingError);
    expect((err as BillingError).retryable).toBe(false);
    expect((err as BillingError).details).toMatchObject({ provider: "test", body: '{"error":"no credits"}' });
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("retries 5xx twice then succeeds", async () => {
    const { calls, fetchImpl } = fakeFetch([
      () => new Response("bad gateway", { status: 502 }),
      () => new Response("unavailable", { status: 503 }),
      () => jsonResponse(completion("finalmente")),
    ]);
    const { client, sleeps } = makeClient(fetchImpl);

    const res = await client.chat({ messages });
    expect(res.content).toBe("finalmente");
    expect(calls).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it("maps 400 to RequestError without retrying and keeps a body snippet", async () => {
    const longBody = "x".repeat(500);
    const { calls, fetchImpl } = fakeFetch([() => new Response(longBody, { status: 400 })]);
    const { client } = makeClient(fetchImpl);

    const err = await client.chat({ messages }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RequestError);
    expect((err as RequestError).status).toBe(400);
    expect(String((err as RequestError).details.body)).toHaveLength(301);
    expect(calls).toHaveLength(1);
  });

  it("gives up after maxRetries on persistent 5xx", async () => {
    const { calls, fetchImpl } = fakeFetch([() => new Response("down", { status: 500 })]);
    const { client } = makeClient(fetchImpl, { maxRetries: 2 });

    const err = await client.chat({ messages }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamError);
    expect(calls).toHaveLength(3);
  });

  it("maps a timeout to a retryable TimeoutError", async () => {
    const fetchImpl: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    const { client } = makeClient(fetchImpl, { maxRetries: 0 });

    const err = await client.chat({ messages }, { timeoutMs: 20 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).retryable).toBe(true);
    expect((err as TimeoutError).details).toMatchObject({ provider: "test", reason: "timeout", timeoutMs: 20 });
  });

  it("maps a caller abort to a non-retryable TimeoutError and does not retry", async () => {
    const { calls, fetchImpl } = fakeFetch([
      (call) => {
        const reason = call.init.signal?.reason as unknown;
        throw reason instanceof Error ? reason : new Error("aborted");
      },
    ]);
    const { client, sleeps } = makeClient(fetchImpl);
    const controller = new AbortController();
    controller.abort();

    const err = await client.chat({ messages }, { signal: controller.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).retryable).toBe(false);
    expect(calls).toHaveLength(1);
    expect(sleeps).toHaveLength(0);
  });

  it("maps network failures to a retryable TimeoutError and retries them", async () => {
    const { calls, fetchImpl } = fakeFetch([
      () => {
        throw new TypeError("fetch failed");
      },
      () => jsonResponse(completion("ok")),
    ]);
    const { client } = makeClient(fetchImpl);

    const res = await client.chat({ messages });
    expect(res.content).toBe("ok");
    expect(calls).toHaveLength(2);
  });

  it("downgrades json_schema to json_object when the capability is off, keeps it when on", async () => {
    const schemaFormat = {
      type: "json_schema" as const,
      json_schema: { name: "x", schema: { type: "object" } },
    };
    const off = fakeFetch([() => jsonResponse(completion("{}"))]);
    await makeClient(off.fetchImpl).client.chat({ messages, response_format: schemaFormat });
    expect(sentBody(off.calls[0]).response_format).toEqual({ type: "json_object" });

    const on = fakeFetch([() => jsonResponse(completion("{}"))]);
    await makeClient(on.fetchImpl, {
      capabilities: { jsonSchema: true, seed: true, reasoningEffort: true },
    }).client.chat({ messages, response_format: schemaFormat });
    expect(sentBody(on.calls[0]).response_format).toEqual(schemaFormat);
  });

  it("drops seed and reasoning_effort when the capabilities are off", async () => {
    const { calls, fetchImpl } = fakeFetch([() => jsonResponse(completion("x"))]);
    await makeClient(fetchImpl, {
      capabilities: { jsonSchema: false, seed: false, reasoningEffort: false },
    }).client.chat({ messages, seed: 1, extra: { reasoning_effort: "low", top_k: 40 } });
    const body = sentBody(calls[0]);
    expect(body).not.toHaveProperty("seed");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.top_k).toBe(40);
  });

  it("forwards extraPassthrough keys but never purpose", async () => {
    const { calls, fetchImpl } = fakeFetch([() => jsonResponse(completion("x"))]);
    await makeClient(fetchImpl, { extraPassthrough: ["guided_json", "purpose"] }).client.chat({
      messages,
      extra: { guided_json: { type: "object" }, purpose: "edit" },
    });
    const body = sentBody(calls[0]);
    expect(body.guided_json).toEqual({ type: "object" });
    expect(body).not.toHaveProperty("purpose");
  });

  it("applies modelPrefix once", async () => {
    const { calls, fetchImpl } = fakeFetch([() => jsonResponse(completion("x"))]);
    const { client } = makeClient(fetchImpl, { modelPrefix: "google/" });
    await client.chat({ messages });
    await client.chat({ messages, model: "gemini-2.5-flash" });
    await client.chat({ messages, model: "google/gemini-2.5-flash" });
    expect(sentBody(calls[0]).model).toBe("google/gemini-2.5-pro");
    expect(sentBody(calls[1]).model).toBe("google/gemini-2.5-flash");
    expect(sentBody(calls[2]).model).toBe("google/gemini-2.5-flash");
  });

  it("sends Authorization only when a key is configured", async () => {
    const withKey = fakeFetch([() => jsonResponse(completion("x"))]);
    await makeClient(withKey.fetchImpl).client.chat({ messages });
    expect(sentHeaders(withKey.calls[0]).Authorization).toBe("Bearer sk-test");

    const noKey = fakeFetch([() => jsonResponse(completion("x"))]);
    await makeClient(noKey.fetchImpl, { apiKey: undefined, headers: { "X-Test": "1" } }).client.chat({
      messages,
    });
    expect(sentHeaders(noKey.calls[0])).not.toHaveProperty("Authorization");
    expect(sentHeaders(noKey.calls[0])["X-Test"]).toBe("1");
  });

  it("joins content parts and defaults usage to zero", async () => {
    const { fetchImpl } = fakeFetch([
      () =>
        jsonResponse(
          completion([{ type: "text", text: "Olá " }, { type: "image_url" }, { type: "text", text: "mundo" }], {
            usage: undefined,
            model: undefined,
          }),
        ),
    ]);
    const res = await makeClient(fetchImpl).client.chat({ messages, model: "m2" });
    expect(res.content).toBe("Olá mundo");
    expect(res.model).toBe("m2");
    expect(res.usage).toEqual({ input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 });
  });

  it("throws UpstreamError on malformed bodies", async () => {
    const noChoices = fakeFetch([() => jsonResponse({ id: "x", choices: [] })]);
    const err1 = await makeClient(noChoices.fetchImpl, { maxRetries: 0 }).client.chat({ messages }).catch((e: unknown) => e);
    expect(err1).toBeInstanceOf(UpstreamError);

    const notJson = fakeFetch([() => new Response("<html>oops</html>", { status: 200 })]);
    const err2 = await makeClient(notJson.fetchImpl, { maxRetries: 0 }).client.chat({ messages }).catch((e: unknown) => e);
    expect(err2).toBeInstanceOf(UpstreamError);
  });

  it("passes the idempotency key as a header", async () => {
    const { calls, fetchImpl } = fakeFetch([() => jsonResponse(completion("x"))]);
    await makeClient(fetchImpl).client.chat({ messages }, { idempotencyKey: "abc" });
    expect(sentHeaders(calls[0])["Idempotency-Key"]).toBe("abc");
  });
});

describe("OpenAIWireClient.stream", () => {
  it("posts stream: true and yields SSE deltas", async () => {
    const encoder = new TextEncoder();
    const sse = [
      'data: {"choices":[{"delta":{"content":"Olá"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" mundo"}}]}\n\n',
      "data: [DONE]\n\n",
    ];
    const { calls, fetchImpl } = fakeFetch([
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              for (const chunk of sse) controller.enqueue(encoder.encode(chunk));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        ),
    ]);
    const { client } = makeClient(fetchImpl);

    const parts: string[] = [];
    for await (const delta of client.stream({ messages })) parts.push(delta);
    expect(parts).toEqual(["Olá", " mundo"]);
    expect(sentBody(calls[0]).stream).toBe(true);
  });

  it("maps HTTP errors before the first byte", async () => {
    const { fetchImpl } = fakeFetch([() => new Response("nope", { status: 402 })]);
    const { client } = makeClient(fetchImpl);
    const err = await (async () => {
      for await (const _ of client.stream({ messages })) {
        // never reached
      }
    })().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BillingError);
  });
});

describe("OpenAIWireClient.health", () => {
  it("reports ok on 2xx and never throws", async () => {
    const ok = fakeFetch([() => jsonResponse({ data: [] })]);
    const h1 = await makeClient(ok.fetchImpl).client.health();
    expect(h1.ok).toBe(true);
    expect(ok.calls[0].url).toBe("https://llm.example/v1/models");
    expect(ok.calls[0].init.method).toBe("GET");

    const down = fakeFetch([() => new Response("down", { status: 503 })]);
    expect((await makeClient(down.fetchImpl).client.health()).ok).toBe(false);

    const thrown = fakeFetch([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    expect((await makeClient(thrown.fetchImpl).client.health()).ok).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("parses delta-seconds and HTTP dates", () => {
    expect(parseRetryAfter("2")).toBe(2000);
    expect(parseRetryAfter("0.5")).toBe(500);
    const now = Date.parse("2026-09-11T10:00:00Z");
    expect(parseRetryAfter("Fri, 11 Sep 2026 10:00:03 GMT", now)).toBe(3000);
    expect(parseRetryAfter("Fri, 11 Sep 2026 09:59:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("combineSignals", () => {
  it("aborts when any input aborts", () => {
    const a = new AbortController();
    const b = new AbortController();
    const combined = combineSignals([a.signal, undefined, b.signal]);
    expect(combined.aborted).toBe(false);
    b.abort(new Error("stop"));
    expect(combined.aborted).toBe(true);
  });
});
