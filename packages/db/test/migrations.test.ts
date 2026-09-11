import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Table, getTableName, is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { TABLE_NAMES, schema } from "../src";
import { DEFAULT_MIGRATIONS_DIR } from "../src";

const SCHEMA_PATH = join(import.meta.dirname, "..", "src", "schema.ts");

async function allSql(): Promise<string> {
  const files = (await readdir(DEFAULT_MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const parts = await Promise.all(files.map((f) => readFile(join(DEFAULT_MIGRATIONS_DIR, f), "utf8")));
  return parts.join("\n");
}

function tablesInSql(sql: string): Set<string> {
  const out = new Set<string>();
  for (const m of sql.matchAll(/create table(?: if not exists)?\s+(?:public\.)?"?([a-z_]+)"?/gi)) out.add(m[1]!);
  return out;
}

function tablesInSchema(src: string): Set<string> {
  const out = new Set<string>();
  for (const m of src.matchAll(/pgTable\(\s*"([a-z_]+)"/g)) out.add(m[1]!);
  return out;
}

describe("migrations ↔ schema.ts", () => {
  it("every pgTable has a create table statement and vice versa", async () => {
    const sql = await allSql();
    const src = await readFile(SCHEMA_PATH, "utf8");
    const inSql = tablesInSql(sql);
    const inTs = tablesInSchema(src);
    inSql.delete("schema_migrations");
    expect([...inTs].sort()).toEqual([...inSql].sort());
    expect([...inTs].sort()).toEqual([...TABLE_NAMES].sort());
    expect(inTs.size).toBeGreaterThanOrEqual(23);
  });

  it("TABLE_NAMES matches the Drizzle table objects exported from schema.ts", () => {
    const exported = (Object.values(schema) as unknown[])
      .filter((v): v is Table => is(v, Table))
      .map((t) => getTableName(t));
    expect(exported.sort()).toEqual([...TABLE_NAMES].sort());
  });

  it("enables row level security on every table and defines has_tenant_role", async () => {
    const sql = await allSql();
    for (const t of TABLE_NAMES) {
      expect(sql, `RLS for ${t}`).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, "i"));
    }
    expect(sql).toMatch(/create type public\.tenant_role as enum \('owner', 'admin', 'editor', 'viewer'\)/i);
    expect(sql).toMatch(/create or replace function public\.has_tenant_role\(_user_id uuid, _tenant_id uuid, _min_role public\.tenant_role\)/i);
    expect(sql).toMatch(/security definer/i);
    expect(sql).toMatch(/set search_path = public/i);
    // Policies exist only for authenticated; anon has none.
    expect(sql).not.toMatch(/create policy[^;]*\bto anon\b/i);
    expect(sql).toMatch(/to authenticated/i);
    expect(sql).toMatch(/service role/i);
  });

  it("every tenant-scoped table declares tenant_id uuid not null", async () => {
    const sql = await allSql();
    for (const t of TABLE_NAMES) {
      if (t === "tenants" || t === "voice_profiles") continue;
      const block = new RegExp(`create table if not exists public\\.${t} \\(([^;]*)\\);`, "i").exec(sql);
      expect(block, `table ${t}`).not.toBeNull();
      expect(block![1], `tenant_id on ${t}`).toMatch(/tenant_id uuid not null/);
    }
  });
});
