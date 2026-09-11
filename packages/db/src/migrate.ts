import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import postgres from "postgres";

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies every `migrations/*.sql` file in filename order that is not yet recorded in
 * `public.schema_migrations`. Each file runs in its own transaction together with the
 * bookkeeping insert, so a failed file leaves nothing half-applied.
 */
export async function runMigrations(
  databaseUrl: string,
  dir: string = DEFAULT_MIGRATIONS_DIR,
  opts: { log?: (msg: string) => void } = {},
): Promise<MigrationResult> {
  const log = opts.log ?? (() => {});
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await sql`
      create table if not exists public.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `;
    const done = new Set(
      (await sql<{ name: string }[]>`select name from public.schema_migrations`).map((r) => r.name),
    );
    const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) {
        result.skipped.push(file);
        continue;
      }
      const body = await readFile(join(dir, file), "utf8");
      log(`applying ${file}`);
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`insert into public.schema_migrations (name) values (${file})`;
      });
      result.applied.push(file);
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
  return result;
}

/** Names of migrations recorded as applied, in order. */
export async function appliedMigrations(databaseUrl: string): Promise<string[]> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false, onnotice: () => {} });
  try {
    const rows = await sql<{ name: string }[]>`
      select name from public.schema_migrations order by name
    `;
    return rows.map((r) => r.name);
  } catch {
    return [];
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isMain =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set");
    process.exit(2);
  }
  runMigrations(url, process.argv[2] ?? DEFAULT_MIGRATIONS_DIR, { log: (m) => console.log(m) })
    .then((r) => {
      console.log(`applied ${r.applied.length} migration(s), skipped ${r.skipped.length}`);
    })
    .catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
}
