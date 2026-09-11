import type { Config, ObjectStore } from "@imovel/core";
import { ValidationError } from "@imovel/core";
import { FsObjectStore } from "./fsStore";
import { S3ObjectStore } from "./s3Store";

/** Builds the `ObjectStore` selected by `cfg.STORAGE_PROVIDER`. Throws `ValidationError` when a required key is missing. */
export function createObjectStore(cfg: Config): ObjectStore {
  switch (cfg.STORAGE_PROVIDER) {
    case "fs":
      return new FsObjectStore(cfg.FS_STORAGE_DIR);

    case "supabase-s3": {
      if (!cfg.SUPABASE_S3_ENDPOINT || !cfg.SUPABASE_S3_ACCESS_KEY_ID || !cfg.SUPABASE_S3_SECRET_ACCESS_KEY) {
        throw new ValidationError(
          "SUPABASE_S3_ENDPOINT, SUPABASE_S3_ACCESS_KEY_ID and SUPABASE_S3_SECRET_ACCESS_KEY are required for STORAGE_PROVIDER=supabase-s3",
        );
      }
      return new S3ObjectStore({
        endpoint: cfg.SUPABASE_S3_ENDPOINT,
        region: cfg.SUPABASE_S3_REGION,
        bucket: cfg.SUPABASE_S3_BUCKET,
        accessKeyId: cfg.SUPABASE_S3_ACCESS_KEY_ID,
        secretAccessKey: cfg.SUPABASE_S3_SECRET_ACCESS_KEY,
      });
    }

    default:
      throw new ValidationError(`no ObjectStore adapter registered for '${cfg.STORAGE_PROVIDER as string}'`);
  }
}
