import type { Config, JobQueue } from "@imovel/core";
import { createDb } from "./client";
import { MemoryQueue } from "./queue/memoryQueue";
import { PgBossQueue } from "./queue/pgBossQueue";
import { createMemoryRepos } from "./repos/memory";
import { createPostgresRepos } from "./repos/postgres";
import type { Repos } from "./repos/types";

export interface Persistence {
  repos: Repos;
  queue: JobQueue;
  /** `'postgres'` when `DATABASE_URL` is set, else `'memory'`. */
  kind: "postgres" | "memory";
  close(): Promise<void>;
}

export interface CreateReposOptions {
  /** pg-boss schema. Default `pgboss`. */
  queueSchema?: string;
  /** Receives pg-boss error events. */
  onQueueError?: (err: Error) => void;
}

/**
 * Wires persistence from config: Postgres repos + a started `PgBossQueue` when `DATABASE_URL`
 * is set, otherwise in-memory repos + `MemoryQueue` (tests, CLI smoke, CI). The default tenant
 * is ensured in both cases so the single-tenant MVP can start writing immediately.
 * Migrations are not run here; use `pnpm db:migrate`.
 */
export async function createRepos(cfg: Config, opts: CreateReposOptions = {}): Promise<Persistence> {
  if (cfg.DATABASE_URL) {
    const handle = createDb(cfg.DATABASE_URL);
    const repos = createPostgresRepos(handle.db);
    const queue = new PgBossQueue(cfg.DATABASE_URL, { schema: opts.queueSchema, onError: opts.onQueueError });
    await queue.start();
    await repos.tenants.ensureDefault(cfg.DEFAULT_TENANT_ID);
    return {
      repos,
      queue,
      kind: "postgres",
      close: async () => {
        await queue.stop();
        await handle.close();
      },
    };
  }
  const repos = createMemoryRepos();
  const queue = new MemoryQueue();
  await repos.tenants.ensureDefault(cfg.DEFAULT_TENANT_ID);
  return {
    repos,
    queue,
    kind: "memory",
    close: async () => {
      await queue.stop();
    },
  };
}

export { createMemoryRepos, MemoryQueue };
