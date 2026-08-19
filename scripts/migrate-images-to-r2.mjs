/**
 * Migrate legacy Replit object-storage images (stored as "/public/...") into the
 * configured S3-compatible bucket (Cloudflare R2), then repoint the database at
 * the new public CDN URLs.
 *
 * Your local server cannot read Replit's object storage, so image bytes come from
 * one of two sources:
 *
 *   A) The RUNNING Repl over HTTP (dev webview URL works, while the Repl is awake):
 *        node --env-file=.env scripts/migrate-images-to-r2.mjs --source=https://xxxx.replit.dev
 *        node --env-file=.env scripts/migrate-images-to-r2.mjs --source=https://xxxx.replit.dev --apply
 *
 *   B) A LOCAL FOLDER of files downloaded out of Replit's Object Storage pane —
 *      use this if the dev URL is asleep or owner-gated. Nesting doesn't matter;
 *      files are matched by filename:
 *        node --env-file=.env scripts/migrate-images-to-r2.mjs --from-dir=./replit-images
 *        node --env-file=.env scripts/migrate-images-to-r2.mjs --from-dir=./replit-images --apply
 *
 * Dry run is the default; --apply performs the copy and updates the database.
 *
 * Safe to re-run: images already pointing at the R2 public base URL are skipped,
 * and keys are deterministic, so a repeat run overwrites rather than duplicates.
 *
 * NOTE: "/products/*.jpg" URLs are static files in client/public and are left alone.
 */
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";

neonConfig.webSocketConstructor = ws;

const APPLY = process.argv.includes("--apply");
const sourceArg = process.argv.find((a) => a.startsWith("--source="));
const fromDirArg = process.argv.find((a) => a.startsWith("--from-dir="));
const SOURCE_BASE = (sourceArg?.split("=")[1] || process.env.LEGACY_IMAGE_BASE_URL || "").replace(/\/+$/, "");
const FROM_DIR = fromDirArg?.split("=")[1] || "";

/**
 * Offline fallback: index a local folder of downloaded images by basename, so the
 * migration works even when the Replit dev URL isn't reachable (sleeping Repl,
 * owner-gated dev URL, etc.). Just download the files out of Replit's Object
 * Storage pane into one folder — nesting doesn't matter.
 */
function indexLocalDir(dir) {
  const byBasename = new Map();
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else byBasename.set(entry.name, full);
    }
  };
  walk(dir);
  return byBasename;
}

const {
  DATABASE_URL,
  S3_ENDPOINT, S3_REGION = "auto", S3_BUCKET,
  S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL,
} = process.env;

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY || !S3_PUBLIC_BASE_URL) {
  console.error("✗ S3/R2 is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_PUBLIC_BASE_URL in .env");
  process.exit(1);
}
if (!SOURCE_BASE && !FROM_DIR) {
  console.error("✗ Need an image source. Either:");
  console.error("    --source=https://<your-repl>.replit.dev     (fetch from the running Repl)");
  console.error("    --from-dir=./replit-images                  (upload from a local folder)");
  process.exit(1);
}
if (FROM_DIR && !fs.existsSync(FROM_DIR)) {
  console.error(`✗ --from-dir path does not exist: ${FROM_DIR}`);
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });
const s3 = new S3Client({
  region: S3_REGION,
  ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT, forcePathStyle: true } : {}),
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
});

const PUBLIC_BASE = S3_PUBLIC_BASE_URL.replace(/\/+$/, "");

const CONTENT_TYPES = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  webp: "image/webp", gif: "image/gif", avif: "image/avif", svg: "image/svg+xml",
};
const contentTypeFor = (key) =>
  CONTENT_TYPES[key.split(".").pop()?.toLowerCase()] || "application/octet-stream";

/** Only legacy object-storage paths need migrating. */
function needsMigration(url) {
  if (!url || typeof url !== "string") return false;
  if (url.startsWith(PUBLIC_BASE)) return false;   // already on R2
  return url.startsWith("/public/");               // leaves /products/* static assets alone
}

/** "/public/product-images/x.webp" -> "images/product-images/x.webp" (deterministic) */
const keyFor = (url) => `images/${url.replace(/^\/public\//, "")}`;

async function migrateOne(url, cache, localIndex) {
  if (cache.has(url)) return cache.get(url);

  const key = keyFor(url);
  const publicUrl = `${PUBLIC_BASE}/${key}`;
  const basename = url.split("/").pop();

  if (!APPLY) {
    const found = localIndex ? (localIndex.has(basename) ? "found locally" : "MISSING LOCALLY") : "";
    console.log(`   would copy  ${url} ${found}\n            -> ${publicUrl}`);
    cache.set(url, publicUrl);
    return publicUrl;
  }

  let body;
  let sourceContentType = null;

  if (localIndex) {
    const localPath = localIndex.get(basename);
    if (!localPath) throw new Error(`not found in --from-dir: ${basename}`);
    body = fs.readFileSync(localPath);
  } else {
    const src = `${SOURCE_BASE}${url}`;
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download failed ${res.status} for ${src}`);
    body = Buffer.from(await res.arrayBuffer());
    sourceContentType = res.headers.get("content-type");
  }

  if (body.length === 0) throw new Error(`empty file for ${url}`);

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    Body: body,
    ContentType: sourceContentType || contentTypeFor(key),
  }));

  console.log(`   ✓ ${url}  (${(body.length / 1024).toFixed(0)} KB) -> ${publicUrl}`);
  cache.set(url, publicUrl);
  return publicUrl;
}

async function main() {
  console.log(APPLY ? "MIGRATING images -> R2\n" : "DRY RUN (no downloads, no writes) — add --apply to execute\n");
  console.log(FROM_DIR ? `source : local dir ${FROM_DIR}` : `source : ${SOURCE_BASE}`);
  console.log(`bucket : ${S3_BUCKET}`);
  console.log(`public : ${PUBLIC_BASE}\n`);

  const localIndex = FROM_DIR ? indexLocalDir(FROM_DIR) : null;
  if (localIndex) console.log(`indexed ${localIndex.size} local file(s)\n`);
  const cache = new Map();
  const stats = { migrated: 0, skipped: 0, failed: 0, rowsUpdated: 0 };

  // ---- flavors.primary_image_url / secondary_image_url ----
  const flavors = (await pool.query(
    `SELECT id, name, primary_image_url, secondary_image_url FROM flavors
     WHERE primary_image_url IS NOT NULL OR secondary_image_url IS NOT NULL`
  )).rows;

  console.log(`flavors (${flavors.length}):`);
  for (const f of flavors) {
    const updates = {};
    for (const [col, url] of [["primary_image_url", f.primary_image_url], ["secondary_image_url", f.secondary_image_url]]) {
      if (!needsMigration(url)) { if (url) stats.skipped++; continue; }
      try {
        updates[col] = await migrateOne(url, cache, localIndex);
        stats.migrated++;
      } catch (e) {
        stats.failed++;
        console.error(`   ✗ ${f.name} ${col}: ${e.message}`);
      }
    }
    if (APPLY && Object.keys(updates).length) {
      const sets = Object.keys(updates).map((c, i) => `${c} = $${i + 1}`).join(", ");
      await pool.query(`UPDATE flavors SET ${sets} WHERE id = $${Object.keys(updates).length + 1}`,
        [...Object.values(updates), f.id]);
      stats.rowsUpdated++;
    }
  }

  // ---- products.image_url / image_urls[] ----
  // Currently these hold "/products/*.jpg" static assets, which needsMigration()
  // filters out. Handled anyway so nothing is missed if an object-storage image
  // lands here before cutover.
  const prods = (await pool.query(
    `SELECT id, name, image_url, image_urls FROM products
     WHERE (image_url IS NOT NULL AND image_url <> '') OR array_length(image_urls, 1) > 0`
  )).rows;

  console.log(`\nproducts (${prods.length}):`);
  for (const p of prods) {
    let newImageUrl = p.image_url;
    const newImageUrls = [];
    let changed = false;

    if (needsMigration(p.image_url)) {
      try {
        newImageUrl = await migrateOne(p.image_url, cache, localIndex);
        stats.migrated++; changed = true;
      } catch (e) { stats.failed++; console.error(`   ✗ ${p.name} image_url: ${e.message}`); }
    } else if (p.image_url) stats.skipped++;

    for (const u of p.image_urls ?? []) {
      if (needsMigration(u)) {
        try {
          newImageUrls.push(await migrateOne(u, cache, localIndex));
          stats.migrated++; changed = true;
        } catch (e) { stats.failed++; console.error(`   ✗ ${p.name} image_urls: ${e.message}`); newImageUrls.push(u); }
      } else { newImageUrls.push(u); stats.skipped++; }
    }

    if (APPLY && changed) {
      await pool.query(`UPDATE products SET image_url = $1, image_urls = $2 WHERE id = $3`,
        [newImageUrl, newImageUrls, p.id]);
      stats.rowsUpdated++;
    }
  }

  // ---- retail_products.product_image_url ----
  const rps = (await pool.query(
    `SELECT id, product_name, product_image_url FROM retail_products
     WHERE product_image_url IS NOT NULL AND product_image_url <> ''`
  )).rows;

  console.log(`\nretail_products (${rps.length}):`);
  for (const p of rps) {
    if (!needsMigration(p.product_image_url)) { stats.skipped++; continue; }
    try {
      const newUrl = await migrateOne(p.product_image_url, cache, localIndex);
      stats.migrated++;
      if (APPLY) {
        await pool.query(`UPDATE retail_products SET product_image_url = $1 WHERE id = $2`, [newUrl, p.id]);
        stats.rowsUpdated++;
      }
    } catch (e) {
      stats.failed++;
      console.error(`   ✗ ${p.product_name}: ${e.message}`);
    }
  }

  console.log(`\n--- ${APPLY ? "done" : "dry run"} ---`);
  console.log(`  images ${APPLY ? "migrated" : "to migrate"}: ${stats.migrated}`);
  console.log(`  skipped (already migrated / static asset): ${stats.skipped}`);
  console.log(`  failed: ${stats.failed}`);
  if (APPLY) console.log(`  db rows updated: ${stats.rowsUpdated}`);
  if (stats.failed) console.log("\n  Re-run to retry failures — successful images are skipped automatically.");

  await pool.end();
}

main().catch((e) => { console.error("Migration failed:", e); process.exit(1); });
