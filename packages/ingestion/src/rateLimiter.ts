import Bottleneck from "bottleneck";

/**
 * Per-source token bucket: `rpm` requests per minute, one in flight at a time.
 * `minTime` is the minimum gap between job starts; `maxConcurrent: 1` serialises calls so the
 * gap is actually honoured (Bottleneck only enforces `minTime` between successive starts on the
 * same concurrency slot).
 */
export function createRateLimiter(rpm: number): Bottleneck {
  return new Bottleneck({
    minTime: Math.ceil(60_000 / rpm),
    maxConcurrent: 1,
  });
}
