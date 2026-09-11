import { describe, expect, it } from "vitest";
import { MemoryQueue, type Timer } from "../src";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("MemoryQueue", () => {
  it("processes jobs FIFO and drain() resolves when idle", async () => {
    const q = new MemoryQueue();
    const seen: number[] = [];
    await q.send("gen", { n: 1 });
    await q.send("gen", { n: 2 });
    await q.send("gen", { n: 3 });
    expect(await q.size("gen")).toBe(3);
    await q.work<{ n: number }>("gen", async (data) => {
      await tick();
      seen.push(data.n);
    });
    await q.drain();
    expect(seen).toEqual([1, 2, 3]);
    expect(await q.size("gen")).toBe(0);
    expect(q.history.map((h) => h.status)).toEqual(["completed", "completed", "completed"]);
  });

  it("de-duplicates pending jobs by singletonKey", async () => {
    const q = new MemoryQueue();
    const a = await q.send("gen", { n: 1 }, { singletonKey: "k" });
    const b = await q.send("gen", { n: 2 }, { singletonKey: "k" });
    const c = await q.send("gen", { n: 3 }, { singletonKey: "other" });
    expect(a).not.toBeNull();
    expect(b).toBeNull();
    expect(c).not.toBeNull();
    expect(await q.size("gen")).toBe(2);
    const seen: number[] = [];
    await q.work<{ n: number }>("gen", async (d) => {
      seen.push(d.n);
    });
    await q.drain();
    expect(seen).toEqual([1, 3]);
    // Once processed the key is free again.
    expect(await q.send("gen", { n: 4 }, { singletonKey: "k" })).not.toBeNull();
    await q.drain();
    expect(seen).toEqual([1, 3, 4]);
  });

  it("retries a failing handler up to retryLimit and then succeeds", async () => {
    const delays: number[] = [];
    const timer: Timer = (ms, fn) => {
      delays.push(ms);
      setTimeout(fn, 0);
    };
    const q = new MemoryQueue({ timer });
    let calls = 0;
    const metas: number[] = [];
    await q.work("gen", async (_d, meta) => {
      calls += 1;
      metas.push(meta.retryCount);
      if (calls < 3) throw new Error("boom");
    });
    await q.send("gen", { n: 1 }, { retryLimit: 3, retryDelaySeconds: 5, retryBackoff: true });
    await q.drain();
    expect(calls).toBe(3);
    expect(metas).toEqual([0, 1, 2]);
    expect(delays).toEqual([5000, 10000]);
    expect(q.history.at(-1)).toMatchObject({ status: "completed", retryCount: 2 });
  });

  it("forwards to the dead-letter queue after retryLimit is exhausted", async () => {
    const errors: string[] = [];
    const q = new MemoryQueue({ onError: (err, info) => errors.push(`${info.retryCount}:${info.willRetry}:${(err as Error).message}`) });
    await q.ensureQueue("gen", { retryLimit: 1, retryDelaySeconds: 0, deadLetter: "dead" });
    const dead: unknown[] = [];
    let attempts = 0;
    await q.work("gen", async () => {
      attempts += 1;
      throw new Error("always");
    });
    await q.work("dead", async (data) => {
      dead.push(data);
    });
    await q.send("gen", { n: 7 });
    await q.drain();
    expect(attempts).toBe(2);
    expect(dead).toEqual([{ n: 7 }]);
    expect(errors).toEqual(["0:true:always", "1:false:always"]);
    expect(q.history.map((h) => `${h.queue}:${h.status}`)).toEqual(["gen:dead_letter", "dead:completed"]);
  });

  it("marks failed without dead letter and honours startAfterSeconds", async () => {
    const delays: number[] = [];
    const q = new MemoryQueue({
      timer: (ms, fn) => {
        delays.push(ms);
        setTimeout(fn, 0);
      },
    });
    await q.work("gen", async () => {
      throw new Error("no");
    });
    await q.send("gen", {}, { startAfterSeconds: 30 });
    expect(await q.size("gen")).toBe(1);
    await q.drain();
    expect(delays).toEqual([30000]);
    expect(q.history.map((h) => h.status)).toEqual(["failed"]);
  });

  it("records schedules and stops picking new work after stop()", async () => {
    const q = new MemoryQueue();
    await q.schedule("ingest", "0 6 * * *", { search: "x" });
    expect(q.getSchedules()).toEqual([{ queue: "ingest", cron: "0 6 * * *", data: { search: "x" } }]);
    await q.unschedule("ingest");
    expect(q.getSchedules()).toEqual([]);

    const seen: number[] = [];
    await q.work<{ n: number }>("gen", async (d) => {
      seen.push(d.n);
      if (d.n === 1) await q.stop();
    });
    await q.send("gen", { n: 1 });
    await q.send("gen", { n: 2 });
    await q.drain();
    expect(seen).toEqual([1]);
    expect(await q.size("gen")).toBe(1);
  });

  it("drain() resolves immediately with no work and ignores queues without a worker", async () => {
    const q = new MemoryQueue();
    await q.drain();
    await q.send("orphan", { n: 1 });
    await q.drain();
    expect(await q.size("orphan")).toBe(1);
  });
});
