import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStore, StoredObject } from "@imovel/core";
import { NotFoundError, ValidationError } from "@imovel/core";

export interface S3ObjectStoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Injectable for tests: `{ send: vi.fn() }`. Defaults to a real `S3Client`. */
  client?: Pick<S3Client, "send">;
}

/**
 * `ObjectStore` over Supabase Storage's S3-compatible protocol (also plain S3/R2 by endpoint
 * change): `forcePathStyle: true` so a custom endpoint addresses buckets as `/bucket/key`.
 */
export class S3ObjectStore implements ObjectStore {
  readonly id = "supabase-s3" as const;
  private readonly client: Pick<S3Client, "send">;
  private readonly bucket: string;

  constructor(opts: S3ObjectStoreOptions) {
    this.bucket = opts.bucket;
    this.client =
      opts.client ??
      new S3Client({
        endpoint: opts.endpoint,
        region: opts.region,
        forcePathStyle: true,
        credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
      });
  }

  async put(key: string, body: Buffer, opts: { contentType: string }): Promise<StoredObject> {
    assertKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: opts.contentType }),
    );
    return { key, bytes: body.length, sha256: createHash("sha256").update(body).digest("hex") };
  }

  async get(key: string): Promise<Buffer> {
    assertKey(key);
    let res;
    try {
      res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch (cause) {
      if (isNotFound(cause)) throw new NotFoundError(`object not found: ${key}`, { cause, details: { key } });
      throw cause;
    }
    return bodyToBuffer(res.Body);
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch (cause) {
      if (isNotFound(cause)) return false;
      throw cause;
    }
  }

  async signedUrl(key: string, ttlSeconds: number): Promise<string> {
    assertKey(key);
    return getSignedUrl(this.client as S3Client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function assertKey(key: string): void {
  if (!key || key.trim() === "") throw new ValidationError("object key must not be empty");
  if (key.includes("..")) throw new ValidationError(`object key must not contain '..': ${key}`, { details: { key } });
  if (key.startsWith("/")) throw new ValidationError(`object key must not be absolute: ${key}`, { details: { key } });
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  const statusCode =
    (err as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode ??
    (err as { statusCode?: unknown }).statusCode;
  return name === "NotFound" || name === "NoSuchKey" || statusCode === 404;
}

/** The S3 SDK's `Body` is a Node `Readable` (or a web stream) depending on runtime; either way, drain it into a `Buffer`. */
async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer | Uint8Array | string>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
