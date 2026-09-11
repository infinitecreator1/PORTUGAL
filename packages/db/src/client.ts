import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  sql: postgres.Sql;
  close(): Promise<void>;
}

export interface CreateDbOptions {
  /** Connection pool size. Default 10. */
  max?: number;
  /**
   * Disable prepared statements. Default `true` because Supabase's transaction pooler
   * (port 6543) does not support them; direct connections work either way.
   */
  prepare?: boolean;
}

/**
 * Opens a postgres.js pool and wraps it in Drizzle with the full schema.
 * The connection uses the service role in production, which bypasses RLS: every repository
 * method filters by `tenant_id` explicitly.
 */
export function createDb(databaseUrl: string, opts: CreateDbOptions = {}): DbHandle {
  const sql = postgres(databaseUrl, {
    max: opts.max ?? 10,
    prepare: opts.prepare ?? false,
    onnotice: () => {},
  });
  const db = drizzle(sql, { schema });
  return {
    db,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
    },
  };
}
