/**
 * In-process `JobQueue` with pg-boss-like semantics for tests, the CLI smoke and CI:
 * FIFO per queue, `singletonKey` de-duplication of pending jobs, `retryLimit` /
 * `retryDelaySeconds` / `retryBackoff`, dead-letter forwarding on final failure, and
 * `drain()` which resolves once every worked queue is idle.
 *
 * Retry delays go through an injectable timer. The default timer fires immediately so
 * offline runs never wait; pass `realTimer` to honour the delays.
 */
import { newId, type JobQueue, type SendOptions } from "@imovel/core";

export type Timer = (ms: number, fn: () => void) => void;

export const immediateTimer: Timer = (_ms, fn) => {
  setTimeout(fn, 0);
};

export const realTimer: Timer = (ms, fn) => {
  setTimeout(fn, ms);
};

export interface QueueDefaults {
  retryLimit?: number;
  retryDelaySeconds?: number;
  retryBackoff?: boolean;
  deadLetter?: string;
}

export interface MemoryQueueOptions {
  timer?: Timer;
  /** Called when a handler throws; defaults to silence. */
  onError?: (err: unknown, info: { queue: string; id: string; retryCount: number; willRetry: boolean }) => void;
}

type Handler = (data: unknown, meta: { id: string; retryCount: number }) => Promise<void>;

interface MemoryJob {
  id: string;
  data: unknown;
  singletonKey: string | null;
  retryLimit: number;
  retryDelaySeconds: number;
  retryBackoff: boolean;
  deadLetter: string | null;
  retryCount: number;
}

interface QueueState {
  name: string;
  pending: MemoryJob[];
  active: MemoryJob | null;
  /** Jobs waiting on a retry/startAfter timer. */
  waiting: number;
  handler: Handler | null;
  running: boolean;
  defaults: QueueDefaults;
}

export interface CompletedJob {
  queue: string;
  id: string;
  status: "completed" | "failed" | "dead_letter";
  retryCount: number;
}

export class MemoryQueue implements JobQueue {
  private readonly queues = new Map<string, QueueState>();
  private readonly schedules = new Map<string, { cron: string; data: unknown }>();
  private readonly waiters: Array<() => void> = [];
  private readonly timer: Timer;
  private readonly onError: MemoryQueueOptions["onError"];
  private stopped = false;
  /** Terminal outcomes, in order; handy for assertions. */
  readonly history: CompletedJob[] = [];

  constructor(opts: MemoryQueueOptions = {}) {
    this.timer = opts.timer ?? immediateTimer;
    this.onError = opts.onError;
  }

  async start(): Promise<this> {
    this.stopped = false;
    return this;
  }

  async ensureQueue(name: string, defaults: QueueDefaults = {}): Promise<void> {
    const q = this.queue(name);
    q.defaults = { ...q.defaults, ...defaults };
  }

  async send(queue: string, data: unknown, opts: SendOptions = {}): Promise<string | null> {
    const q = this.queue(queue);
    const singletonKey = opts.singletonKey ?? null;
    if (singletonKey && q.pending.some((j) => j.singletonKey === singletonKey)) return null;
    const job: MemoryJob = {
      id: newId(),
      data,
      singletonKey,
      retryLimit: opts.retryLimit ?? q.defaults.retryLimit ?? 0,
      retryDelaySeconds: opts.retryDelaySeconds ?? q.defaults.retryDelaySeconds ?? 0,
      retryBackoff: opts.retryBackoff ?? q.defaults.retryBackoff ?? false,
      deadLetter: opts.deadLetter ?? q.defaults.deadLetter ?? null,
      retryCount: 0,
    };
    if (opts.startAfterSeconds && opts.startAfterSeconds > 0) {
      q.waiting += 1;
      this.timer(opts.startAfterSeconds * 1000, () => {
        q.waiting -= 1;
        q.pending.push(job);
        this.kick(q);
      });
    } else {
      q.pending.push(job);
      this.kick(q);
    }
    return job.id;
  }

  async work<T>(queue: string, handler: (data: T, meta: { id: string; retryCount: number }) => Promise<void>): Promise<void> {
    const q = this.queue(queue);
    q.handler = handler as Handler;
    this.kick(q);
  }

  async schedule(queue: string, cron: string, data?: unknown): Promise<void> {
    this.schedules.set(queue, { cron, data });
  }

  async unschedule(queue: string): Promise<void> {
    this.schedules.delete(queue);
  }

  /** Recorded cron schedules (no cron is evaluated in memory). */
  getSchedules(): Array<{ queue: string; cron: string; data: unknown }> {
    return [...this.schedules.entries()].map(([queue, s]) => ({ queue, cron: s.cron, data: s.data }));
  }

  async size(queue: string): Promise<number> {
    const q = this.queues.get(queue);
    return q ? q.pending.length + q.waiting : 0;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.notify();
  }

  /**
   * Resolves once no job is active, no retry timer is pending and every queue that has a
   * handler has an empty backlog. Queues without a handler are ignored (nobody will process
   * them), so register workers before calling this.
   */
  drain(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private isIdle(): boolean {
    for (const q of this.queues.values()) {
      if (q.active) return false;
      if (q.waiting > 0) return false;
      if (q.handler && q.pending.length > 0 && !this.stopped) return false;
    }
    return true;
  }

  private notify(): void {
    if (!this.isIdle()) return;
    const ws = this.waiters.splice(0);
    for (const w of ws) w();
  }

  private queue(name: string): QueueState {
    let q = this.queues.get(name);
    if (!q) {
      q = { name, pending: [], active: null, waiting: 0, handler: null, running: false, defaults: {} };
      this.queues.set(name, q);
    }
    return q;
  }

  private kick(q: QueueState): void {
    if (q.running || !q.handler || this.stopped) return;
    q.running = true;
    void this.run(q).finally(() => {
      q.running = false;
      this.notify();
    });
  }

  private async run(q: QueueState): Promise<void> {
    while (!this.stopped && q.handler && q.pending.length > 0) {
      const job = q.pending.shift()!;
      q.active = job;
      try {
        await q.handler(job.data, { id: job.id, retryCount: job.retryCount });
        this.history.push({ queue: q.name, id: job.id, status: "completed", retryCount: job.retryCount });
      } catch (err) {
        const willRetry = job.retryCount < job.retryLimit;
        this.onError?.(err, { queue: q.name, id: job.id, retryCount: job.retryCount, willRetry });
        if (willRetry) {
          const delay = job.retryDelaySeconds * 1000 * (job.retryBackoff ? 2 ** job.retryCount : 1);
          job.retryCount += 1;
          q.waiting += 1;
          this.timer(delay, () => {
            q.waiting -= 1;
            q.pending.push(job);
            this.kick(q);
            this.notify();
          });
        } else if (job.deadLetter) {
          this.history.push({ queue: q.name, id: job.id, status: "dead_letter", retryCount: job.retryCount });
          await this.send(job.deadLetter, job.data);
        } else {
          this.history.push({ queue: q.name, id: job.id, status: "failed", retryCount: job.retryCount });
        }
      } finally {
        q.active = null;
      }
    }
  }
}
