/**
 * `JobQueue` backed by pg-boss v10 (queues live in the `pgboss` schema of the same Postgres).
 * Cannot be exercised without a database; its tests skip when `DATABASE_URL` is unset.
 */
import PgBoss from "pg-boss";
import type { JobQueue, SendOptions } from "@imovel/core";
import type { QueueDefaults } from "./memoryQueue";

export interface PgBossQueueOptions {
  /** Postgres schema for pg-boss tables. Default `pgboss`. */
  schema?: string;
  /** Receives pg-boss `error` events (connection drops, maintenance failures). */
  onError?: (err: Error) => void;
  /** Extra pg-boss constructor options (polling interval, archive settings, ...). */
  boss?: Omit<PgBoss.ConstructorOptions, "connectionString" | "schema">;
}

export class PgBossQueue implements JobQueue {
  readonly boss: PgBoss;
  private started = false;

  constructor(connectionString: string, opts: PgBossQueueOptions = {}) {
    this.boss = new PgBoss({
      connectionString,
      schema: opts.schema ?? "pgboss",
      ...opts.boss,
    });
    this.boss.on("error", opts.onError ?? (() => {}));
  }

  async start(): Promise<this> {
    if (!this.started) {
      await this.boss.start();
      this.started = true;
    }
    return this;
  }

  /**
   * Creates the queue (idempotent in pg-boss v10) with retry and dead-letter defaults.
   * The dead-letter queue is created first because pg-boss enforces it by foreign key.
   */
  async ensureQueue(name: string, defaults: QueueDefaults = {}): Promise<void> {
    if (defaults.deadLetter) await this.boss.createQueue(defaults.deadLetter, { name: defaults.deadLetter });
    await this.boss.createQueue(name, {
      name,
      ...(defaults.retryLimit !== undefined ? { retryLimit: defaults.retryLimit } : {}),
      ...(defaults.retryDelaySeconds !== undefined ? { retryDelay: defaults.retryDelaySeconds } : {}),
      ...(defaults.retryBackoff !== undefined ? { retryBackoff: defaults.retryBackoff } : {}),
      ...(defaults.deadLetter ? { deadLetter: defaults.deadLetter } : {}),
    });
  }

  async send(queue: string, data: unknown, opts: SendOptions = {}): Promise<string | null> {
    const options: PgBoss.SendOptions = {};
    if (opts.singletonKey !== undefined) options.singletonKey = opts.singletonKey;
    if (opts.retryLimit !== undefined) options.retryLimit = opts.retryLimit;
    if (opts.retryDelaySeconds !== undefined) options.retryDelay = opts.retryDelaySeconds;
    if (opts.retryBackoff !== undefined) options.retryBackoff = opts.retryBackoff;
    if (opts.deadLetter !== undefined) options.deadLetter = opts.deadLetter;
    if (opts.startAfterSeconds !== undefined) options.startAfter = opts.startAfterSeconds;
    return this.boss.send(queue, (data ?? {}) as object, options);
  }

  async work<T>(queue: string, handler: (data: T, meta: { id: string; retryCount: number }) => Promise<void>): Promise<void> {
    await this.boss.work<T>(queue, { batchSize: 1, includeMetadata: true }, async (jobs) => {
      for (const j of jobs) await handler(j.data, { id: j.id, retryCount: j.retryCount });
    });
  }

  async schedule(queue: string, cron: string, data?: unknown): Promise<void> {
    await this.boss.schedule(queue, cron, (data ?? {}) as object);
  }

  async unschedule(queue: string): Promise<void> {
    await this.boss.unschedule(queue);
  }

  /** Jobs in `created` and `retry` state. */
  async size(queue: string): Promise<number> {
    return this.boss.getQueueSize(queue);
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    await this.boss.stop({ graceful: true, wait: true, timeout: 30_000 });
    this.started = false;
  }
}
