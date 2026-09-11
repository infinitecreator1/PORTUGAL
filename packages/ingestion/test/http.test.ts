import { describe, expect, it, vi } from "vitest";
import { fetchJson } from "../src/http";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

describe("fetchJson", () => {
  it("returns the parsed JSON body on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const result = await fetchJson<{ ok: boolean }>("https://api.example.org/x", {}, { provider: "test", fetch: fetchImpl });
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 and honours Retry-After, then succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { error: "slow down" }, { "retry-after": "1" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchJson<{ ok: boolean }>(
      "https://api.example.org/x",
      {},
      { provider: "test", fetch: fetchImpl, sleep, retries: 3, random: () => 0 },
    );

    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(1000); // Retry-After floor honoured
  });

  it("throws RateLimitError when retries are exhausted on repeated 429s", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(429, { error: "slow down" }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchJson("https://api.example.org/x", {}, { provider: "test", fetch: fetchImpl, sleep, retries: 2, random: () => 0 }),
    ).rejects.toMatchObject({ name: "RateLimitError" });
    expect(fetchImpl).toHaveBeenCalledTimes(3); // first attempt + 2 retries
  });

  it("maps a 402 to a non-retryable BillingError and does not retry", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(402, { error: "payment required" }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchJson("https://api.example.org/x", {}, { provider: "test", fetch: fetchImpl, sleep, retries: 3 }),
    ).rejects.toMatchObject({ name: "BillingError" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("maps a 5xx to a retryable UpstreamError and retries", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { error: "boom" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    const result = await fetchJson<{ ok: boolean }>(
      "https://api.example.org/x",
      {},
      { provider: "test", fetch: fetchImpl, sleep, retries: 3, random: () => 0 },
    );
    expect(result).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("maps a network failure to a retryable TimeoutError", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      fetchJson("https://api.example.org/x", {}, { provider: "test", fetch: fetchImpl, sleep, retries: 1, random: () => 0 }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
