/**
 * S3-compatible object storage (Cloudflare R2, AWS S3, Backblaze B2, MinIO…).
 *
 * Replaces the Replit/GCS object storage for product & flavor images. Uploads go
 * straight from the browser to the bucket via a presigned PUT (the server never
 * proxies file bytes), and the stored URL points at the bucket's public base URL
 * or CDN domain.
 *
 * Configure via .env — see .env.example. When these are unset the app falls back
 * to the legacy object-storage path, so this is safe to leave unconfigured.
 */
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const S3_ENDPOINT = process.env.S3_ENDPOINT;               // R2: https://<account-id>.r2.cloudflarestorage.com
const S3_REGION = process.env.S3_REGION || "auto";          // R2 uses "auto"
const S3_BUCKET = process.env.S3_BUCKET;
const S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.S3_SECRET_ACCESS_KEY;
const S3_PUBLIC_BASE_URL = process.env.S3_PUBLIC_BASE_URL;  // e.g. https://pub-xxxx.r2.dev or https://images.yourdomain.com

/** True once the bucket + credentials + public base URL are all configured. */
export function isS3Configured(): boolean {
  return Boolean(S3_BUCKET && S3_ACCESS_KEY_ID && S3_SECRET_ACCESS_KEY && S3_PUBLIC_BASE_URL);
}

let client: S3Client | null = null;
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
      credentials: {
        accessKeyId: S3_ACCESS_KEY_ID!,
        secretAccessKey: S3_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

/** Namespaced, collision-resistant, URL-safe object key. */
export function buildObjectKey(filename: string, directory = "images"): string {
  const safe = filename.replace(/[^\w.\-]+/g, "_").slice(-120);
  const dir = (directory || "images").replace(/^\/+|\/+$/g, "");
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return `${dir}/${unique}-${safe}`;
}

/** Public (CDN) URL for a stored object. */
export function getPublicUrl(key: string): string {
  return `${S3_PUBLIC_BASE_URL!.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * Presigned PUT the browser uploads to directly.
 * Returns the URL to PUT to plus the final public URL to persist.
 */
export async function getPresignedUploadUrl(
  filename: string,
  opts: { directory?: string; contentType?: string } = {}
): Promise<{ uploadUrl: string; key: string; publicUrl: string }> {
  if (!isS3Configured()) {
    throw new Error("S3 storage is not configured");
  }
  const key = buildObjectKey(filename, opts.directory);
  const uploadUrl = await getSignedUrl(
    getClient(),
    new PutObjectCommand({
      Bucket: S3_BUCKET!,
      Key: key,
      ContentType: opts.contentType,
    }),
    { expiresIn: 15 * 60 }
  );
  return { uploadUrl, key, publicUrl: getPublicUrl(key) };
}

/**
 * Server-side upload: the browser PUTs the file to OUR server, and the server writes it
 * to the bucket here. This replaced direct browser→bucket presigned uploads, which need a
 * CORS policy on the bucket for every origin the site is ever served from (localhost, the
 * test subdomain, production…). Without it the browser's PUT dies with "Failed to fetch"
 * and the image silently never lands — exactly the bug that surfaced on the flavor page.
 * Proxying the bytes costs the app server a few hundred KB per image and removes the
 * configuration dependency entirely.
 */
export async function putObject(key: string, body: Buffer, contentType?: string): Promise<{ publicUrl: string }> {
  if (!isS3Configured()) {
    throw new Error("S3 storage is not configured");
  }
  await getClient().send(new PutObjectCommand({
    Bucket: S3_BUCKET!,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));
  return { publicUrl: getPublicUrl(key) };
}

export async function deleteObject(key: string): Promise<void> {
  if (!isS3Configured()) return;
  await getClient().send(new DeleteObjectCommand({ Bucket: S3_BUCKET!, Key: key }));
}
