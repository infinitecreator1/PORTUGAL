/**
 * Runs the shared repo suite and the pg-boss wrapper against a real database.
 * Skipped unless DATABASE_URL is set (there is no Postgres in CI's unit stage).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "@imovel/core";
import { PgBossQueue, createDb, createPostgresRepos, runMigrations, type DbHandle } from "../src";
import { runRepoSuite } from "./repoSuite";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("postgres", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    const result = await runMigrations(url!);
    expect(result.applied.length + result.skipped.length).toBeGreaterThan(0);
    handle = createDb(url!, { max: 4 });
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
  });

  it("records migrations once", async () => {
    const again = await runMigrations(url!);
    expect(again.applied).toEqual([]);
    expect(again.skipped.length).toBeGreaterThan(0);
  });

  runRepoSuite("postgres", async () => ({ repos: createPostgresRepos(handle.db) }));

  describe("PgBossQueue", () => {
    let queue: PgBossQueue;
    const name = `test.pgboss.${newId().slice(0, 8)}`;

    beforeAll(async () => {
      queue = new PgBossQueue(url!, { schema: "pgboss_test" });
      await queue.start();
    }, 60_000);

    afterAll(async () => {
      await queue.stop();
    });

    it("creates queues, sends, works, sizes and dead-letters", async () => {
      await queue.ensureQueue(name, { retryLimit: 1, retryDelaySeconds: 0, deadLetter: `${name}.dead` });
      const id = await queue.send(name, { hello: "world" }, { singletonKey: "one" });
      expect(id).not.toBeNull();
      expect(await queue.send(name, { hello: "dup" }, { singletonKey: "one" })).toBeNull();
      expect(await queue.size(name)).toBe(1);

      const seen: unknown[] = [];
      await queue.work<{ hello: string }>(name, async (data, meta) => {
        seen.push({ data, retryCount: meta.retryCount });
        if (data.hello === "fail") throw new Error("boom");
      });
      const dead: unknown[] = [];
      await queue.work(`${name}.dead`, async (data) => {
        dead.push(data);
      });
      await queue.send(name, { hello: "fail" });

      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline && dead.length === 0) await new Promise((r) => setTimeout(r, 250));
      expect(seen).toEqual(
        expect.arrayContaining([
          { data: { hello: "world" }, retryCount: 0 },
          { data: { hello: "fail" }, retryCount: 0 },
          { data: { hello: "fail" }, retryCount: 1 },
        ]),
      );
      expect(dead).toEqual([{ hello: "fail" }]);
      expect(await queue.size(name)).toBe(0);
    }, 30_000);

    it("schedules and unschedules", async () => {
      await queue.ensureQueue(`${name}.cron`);
      await queue.schedule(`${name}.cron`, "0 6 * * *", { tick: true });
      expect((await queue.boss.getSchedules()).some((s) => s.name === `${name}.cron`)).toBe(true);
      await queue.unschedule(`${name}.cron`);
      expect((await queue.boss.getSchedules()).some((s) => s.name === `${name}.cron`)).toBe(false);
    });
  });
});
