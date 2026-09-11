import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit is used to diff `src/schema.ts` against a database (`drizzle-kit generate`,
 * `drizzle-kit check`). Migrations are hand-written in `migrations/*.sql` because they carry
 * the `tenant_role` enum, `has_tenant_role()` and the RLS policies, which drizzle-kit cannot
 * express. Review any generated file and fold it into a new numbered migration.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:54322/postgres" },
  verbose: true,
  strict: true,
});
