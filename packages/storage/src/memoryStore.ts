import { createHash } from "node:crypto";
import type { ObjectStore, StoredObject } from "@imovel/core";
import { NotFoundError, ValidationError } from "@imovel/core";

interface StoredEntry {
  body: Buffer;
  contentType: string;
}

/** In-memory `ObjectStore`. Nothing persists past the process; used in tests and local dev. */
export class MemoryObjectStore implements ObjectStore {
  readonly id = "memory" as const;
  private readonly objects = new Map<string, StoredEntry>();

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<StoredObject> {
    assertKey(key);
    this.objects.set(key, { body: Buffer.from(body), contentType: opts.contentType });
    return { key, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    const entry = this.objects.get(key);
    if (!entry) throw new NotFoundError(`object not found: ${key}`, { details: { key } });
    return Buffer.from(entry.body);
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    return this.objects.has(key);
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertKey(key);
    const exp = Date.now() + ttlSeconds * 1000;
    return `memory://${key}?exp=${exp}`;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    this.objects.delete(key);
  }
}

function assertKey(key: string): void {
  if (!key || key.trim() === "") throw new ValidationError("object key must not be empty");
  if (key.includes("..")) throw new ValidationError(`object key must not contain '..': ${key}`, { details: { key } });
  if (key.startsWith("/")) throw new ValidationError(`object key must not be absolute: ${key}`, { details: { key } });
}
