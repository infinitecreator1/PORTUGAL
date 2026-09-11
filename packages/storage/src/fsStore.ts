import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { ObjectStore, StoredObject } from "@imovel/core";
import { NotFoundError, ValidationError } from "@imovel/core";

/**
 * Filesystem-backed `ObjectStore` rooted at `rootDir`. Keys are sanitised: no absolute paths, no
 * `..` segments — anything that would resolve outside `rootDir` throws `ValidationError`. Writes
 * are atomic (write to a temp file, then rename over the destination).
 */
export class FsObjectStore implements ObjectStore {
  readonly id = "fs" as const;
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = normalize(rootDir);
  }

  async put(key: string, body: Buffer, _opts: { contentType: string }): Promise<StoredObject> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    const tmpPath = join(dirname(path), `.tmp-${randomUUID()}`);
    const handle = await open(tmpPath, "w");
    try {
      await handle.writeFile(body);
    } finally {
      await handle.close();
    }
    await rename(tmpPath, path);
    return { key, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
  }

  async get(key: string): Promise<Buffer> {
    const path = this.resolve(key);
    try {
      return await readFile(path);
    } catch (cause) {
      if (isNoEnt(cause)) throw new NotFoundError(`object not found: ${key}`, { cause, details: { key } });
      throw cause;
    }
  }

  async exists(key: string): Promise<boolean> {
    const path = this.resolve(key);
    try {
      await stat(path);
      return true;
    } catch (cause) {
      if (isNoEnt(cause)) return false;
      throw cause;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    const path = this.resolve(key);
    const exp = Date.now() + ttlSeconds * 1000;
    const url = new URL(`file://${path}`);
    url.searchParams.set("exp", String(exp));
    return url.toString();
  }

  async delete(key: string): Promise<void> {
    const path = this.resolve(key);
    try {
      await unlink(path);
    } catch (cause) {
      if (!isNoEnt(cause)) throw cause;
    }
  }

  /** Removes the whole store directory. Test/dev convenience; not part of `ObjectStore`. */
  async clear(): Promise<void> {
    await rm(this.rootDir, { recursive: true, force: true });
  }

  private resolve(key: string): string {
    if (!key || key.trim() === "") throw new ValidationError("object key must not be empty");
    if (isAbsolute(key)) throw new ValidationError(`object key must not be absolute: ${key}`, { details: { key } });
    const path = normalize(join(this.rootDir, key));
    const rel = relative(this.rootDir, path);
    if (rel === "" || rel.startsWith("..") || rel.split(sep).includes("..") || isAbsolute(rel)) {
      throw new ValidationError(`object key must resolve inside the store root: ${key}`, { details: { key } });
    }
    return path;
  }
}

function isNoEnt(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT";
}
