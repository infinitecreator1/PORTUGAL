import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import { S3ObjectStore } from "../src/s3Store";

function makeStore(send: ReturnType<typeof vi.fn> = vi.fn()) {
  const client = { send };
  const store = new S3ObjectStore({
    endpoint: "https://s3.example.org",
    region: "eu-west-1",
    bucket: "test-bucket",
    accessKeyId: "AKIA_TEST",
    secretAccessKey: "secret",
    client,
  });
  return { store, send };
}

describe("S3ObjectStore", () => {
  it("put() sends a PutObjectCommand with the body and content type", async () => {
    const { store, send } = makeStore(vi.fn().mockResolvedValue({}));
    const body = Buffer.from("hi");
    const result = await store.put("k.txt", body, { contentType: "text/plain" });

    expect(result.bytes).toBe(2);
    expect(result.sha256).toHaveLength(64);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "k.txt",
      ContentType: "text/plain",
    });
  });

  it("get() drains the response body into a Buffer", async () => {
    const body = { transformToByteArray: async () => new TextEncoder().encode("hello") };
    const { store } = makeStore(vi.fn().mockResolvedValue({ Body: body }));
    const read = await store.get("k.txt");
    expect(read.toString("utf-8")).toBe("hello");
  });

  it("get() throws NotFoundError when the SDK reports NoSuchKey", async () => {
    const err = Object.assign(new Error("nope"), { name: "NoSuchKey" });
    const { store } = makeStore(vi.fn().mockRejectedValue(err));
    await expect(store.get("missing")).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("exists() is true on a successful head and false on NotFound", async () => {
    const notFound = Object.assign(new Error("nope"), { name: "NotFound" });
    const send = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(notFound);
    const { store } = makeStore(send);
    expect(await store.exists("a")).toBe(true);
    expect(await store.exists("b")).toBe(false);
  });

  it("exists() rethrows an unrelated error", async () => {
    const err = Object.assign(new Error("boom"), { name: "InternalError" });
    const { store } = makeStore(vi.fn().mockRejectedValue(err));
    await expect(store.exists("a")).rejects.toThrow("boom");
  });

  it("delete() sends a DeleteObjectCommand", async () => {
    const { store, send } = makeStore(vi.fn().mockResolvedValue({}));
    await store.delete("k.txt");
    expect(send.mock.calls[0][0].input).toMatchObject({ Bucket: "test-bucket", Key: "k.txt" });
  });

  it("rejects '..' and absolute keys before ever calling the client", async () => {
    const { store, send } = makeStore();
    await expect(store.get("../x")).rejects.toMatchObject({ name: "ValidationError" });
    await expect(
      store.put("/etc/passwd", Buffer.from("x"), { contentType: "text/plain" }),
    ).rejects.toMatchObject({ name: "ValidationError" });
    expect(send).not.toHaveBeenCalled();
  });

  it("signedUrl() presigns a GET locally, with no network call", async () => {
    // Presigning is pure local SigV4 computation; a real S3Client (no requests ever sent) is
    // needed only because the presigner reads the client's resolved region/credentials/endpoint.
    const client = new S3Client({
      endpoint: "https://s3.example.org",
      region: "eu-west-1",
      forcePathStyle: true,
      credentials: { accessKeyId: "AKIA_TEST", secretAccessKey: "secret" },
    });
    const store = new S3ObjectStore({
      endpoint: "https://s3.example.org",
      region: "eu-west-1",
      bucket: "test-bucket",
      accessKeyId: "AKIA_TEST",
      secretAccessKey: "secret",
      client,
    });
    const url = await store.signedUrl("k.txt", 60);
    expect(url).toContain("test-bucket");
    expect(url).toContain("k.txt");
    expect(url).toMatch(/X-Amz-Signature=/);
  });
});
