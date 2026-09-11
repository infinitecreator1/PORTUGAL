import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "../src/memoryStore";

describe("MemoryObjectStore", () => {
  it("puts, gets, checks existence and deletes", async () => {
    const store = new MemoryObjectStore();
    const body = Buffer.from("hello world");
    const stored = await store.put("a/b/c.txt", body, { contentType: "text/plain" });

    expect(stored.key).toBe("a/b/c.txt");
    expect(stored.bytes).toBe(body.length);
    expect(stored.sha256).toHaveLength(64);

    expect(await store.exists("a/b/c.txt")).toBe(true);
    expect(await store.exists("nope")).toBe(false);

    const read = await store.get("a/b/c.txt");
    expect(read.toString("utf-8")).toBe("hello world");

    await store.delete("a/b/c.txt");
    expect(await store.exists("a/b/c.txt")).toBe(false);
  });

  it("get() throws NotFoundError for a missing key", async () => {
    const store = new MemoryObjectStore();
    await expect(store.get("missing")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("signedUrl() returns a memory:// URL carrying the expiry", async () => {
    const store = new MemoryObjectStore();
    const url = await store.signedUrl("k", 60);
    expect(url).toMatch(/^memory:\/\/k\?exp=\d+$/);
  });

  it("rejects '..' and absolute keys", async () => {
    const store = new MemoryObjectStore();
    const body = Buffer.from("x");
    await expect(store.put("../x", body, { contentType: "text/plain" })).rejects.toMatchObject({
      name: "ValidationError",
    });
    await expect(store.put("/etc/passwd", body, { contentType: "text/plain" })).rejects.toMatchObject({
      name: "ValidationError",
    });
    await expect(store.get("../x")).rejects.toMatchObject({ name: "ValidationError" });
  });
});
