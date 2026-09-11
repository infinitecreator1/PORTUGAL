import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/rateLimiter";

describe("createRateLimiter", () => {
  it("sets minTime from requests-per-minute and serialises with maxConcurrent 1", () => {
    const limiter = createRateLimiter(60); // 1 request/second
    expect(limiter.jobStatus).toBeDefined();
    const settings = limiter as unknown as { _store: { storeOptions: { minTime: number; maxConcurrent: number } } };
    expect(settings._store.storeOptions.minTime).toBe(1000);
    expect(settings._store.storeOptions.maxConcurrent).toBe(1);
  });

  it("rounds minTime up for a non-integral gap", () => {
    const limiter = createRateLimiter(10_000); // as used by the always-available feed sources
    const settings = limiter as unknown as { _store: { storeOptions: { minTime: number } } };
    expect(settings._store.storeOptions.minTime).toBe(Math.ceil(60_000 / 10_000));
  });

  it("actually spaces two scheduled jobs apart by roughly minTime", async () => {
    const limiter = createRateLimiter(600); // minTime = 100ms
    const timestamps: number[] = [];
    await Promise.all([
      limiter.schedule(async () => { timestamps.push(Date.now()); }),
      limiter.schedule(async () => { timestamps.push(Date.now()); }),
    ]);
    expect(timestamps).toHaveLength(2);
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(90);
  });
});
