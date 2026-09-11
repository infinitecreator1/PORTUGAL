import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FsObjectStore } from "../src/fsStore";

describe("FsObjectStore", () => {
  let dir: string;
  let store: FsObjectStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "imovel-fsstore-"));
    store = new FsObjectStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("puts, gets, checks existence and deletes, creating parent directories", async () => {
    const body = Buffer.from("some bytes");
    const stored = await store.put("tenant/listing/job/output.json", body, { contentType: "application/json" });

    expect(stored.bytes).toBe(body.length);
    expect(stored.sha256).toHaveLength(64);
    expect(await store.exists("tenant/listing/job/output.json")).toBe(true);

    const read = await store.get("tenant/listing/job/output.json");
    expect(read.equals(body)).toBe(true);

    await store.delete("tenant/listing/job/output.json");
    expect(await store.exists("tenant/listing/job/output.json")).toBe(false);
  });

  it("delete() on a missing key is a no-op", async () => {
    await expect(store.delete("missing")).resolves.toBeUndefined();
  });

  it("get() throws NotFoundError for a missing key", async () => {
    await expect(store.get("missing")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("signedUrl() returns a file:// URL carrying the expiry", async () => {
    await store.put("k.txt", Buffer.from("x"), { contentType: "text/plain" });
    const url = await store.signedUrl("k.txt", 60);
    expect(url.startsWith("file://")).toBe(true);
    expect(url).toContain("exp=");
  });

  it("rejects '..' and absolute keys", async () => {
    const body = Buffer.from("x");
    await expect(store.put("../x", body, { contentType: "text/plain" })).rejects.toMatchObject({
      name: "ValidationError",
    });
    await expect(store.put("a/../../x", body, { contentType: "text/plain" })).rejects.toMatchObject({
      name: "ValidationError",
    });
    await expect(store.put("/etc/passwd", body, { contentType: "text/plain" })).rejects.toMatchObject({
      name: "ValidationError",
    });
  });

  it("writes atomically: no partial file left behind on read after put", async () => {
    // A write that completes leaves exactly the final content readable; no .tmp- files remain
    // visible under the store's own key namespace.
    await store.put("atomic.bin", Buffer.from("v1"), { contentType: "application/octet-stream" });
    await store.put("atomic.bin", Buffer.from("v2-longer"), { contentType: "application/octet-stream" });
    const read = await store.get("atomic.bin");
    expect(read.toString("utf-8")).toBe("v2-longer");
  });
});
