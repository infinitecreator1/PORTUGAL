import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "../src/breaker";

describe("CircuitBreaker", () => {
  it("stays closed while calls succeed", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 5 });
    const fn = vi.fn().mockResolvedValue("ok");
    for (let i = 0; i < 10; i++) {
      await expect(breaker.exec(fn)).resolves.toBe("ok");
    }
    expect(breaker.state()).toBe("closed");
  });

  it("opens after 5 consecutive failures and rejects further calls without calling fn", async () => {
    const now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 5, resetMs: 10_000, now: () => now });
    const failing = vi.fn().mockRejectedValue(new Error("boom"));

    for (let i = 0; i < 5; i++) {
      await expect(breaker.exec(failing)).rejects.toThrow("boom");
    }
    expect(breaker.state()).toBe("open");
    expect(failing).toHaveBeenCalledTimes(5);

    const fn = vi.fn().mockResolvedValue("should not run");
    await expect(breaker.exec(fn)).rejects.toMatchObject({ name: "UpstreamError", retryable: true });
    expect(fn).not.toHaveBeenCalled();
  });

  it("goes half-open after resetMs and closes on a successful trial call", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 2, resetMs: 1000, now: () => now });
    const failing = vi.fn().mockRejectedValue(new Error("boom"));

    await expect(breaker.exec(failing)).rejects.toThrow();
    await expect(breaker.exec(failing)).rejects.toThrow();
    expect(breaker.state()).toBe("open");

    now += 500;
    expect(breaker.state()).toBe("open"); // not yet reset
    await expect(breaker.exec(vi.fn().mockResolvedValue("x"))).rejects.toMatchObject({ name: "UpstreamError" });

    now += 600; // total 1100ms elapsed since it opened
    expect(breaker.state()).toBe("half_open");

    const succeed = vi.fn().mockResolvedValue("recovered");
    await expect(breaker.exec(succeed)).resolves.toBe("recovered");
    expect(breaker.state()).toBe("closed");
  });

  it("reopens with a fresh timer when the half-open trial call fails", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({ failureThreshold: 1, resetMs: 1000, now: () => now });
    await expect(breaker.exec(vi.fn().mockRejectedValue(new Error("boom")))).rejects.toThrow();
    expect(breaker.state()).toBe("open");

    now += 1000;
    expect(breaker.state()).toBe("half_open");

    await expect(breaker.exec(vi.fn().mockRejectedValue(new Error("still down")))).rejects.toThrow();
    expect(breaker.state()).toBe("open");

    now += 999;
    expect(breaker.state()).toBe("open"); // fresh window, not yet elapsed
    now += 1;
    expect(breaker.state()).toBe("half_open");
  });
});
