import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function listJson(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

export function repoRoot(): string {
  // apps/cli/src → repo root
  return join(dirname(new URL(import.meta.url).pathname), "..", "..", "..");
}

export function table(rows: Array<Record<string, string | number | boolean | null | undefined>>): string {
  if (!rows.length) return "(no rows)";
  const cols = Object.keys(rows[0]!);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  const line = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i]!)).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map((r) => line(cols.map((c) => String(r[c] ?? ""))))].join("\n");
}

export function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 1000) / 10}%`;
}
