// One-time WebP migration for existing catalog images (2026-09-10).
// For every R2-hosted PNG/JPEG referenced in the DB: download, convert to WebP
// (same params as the upload pipeline: EXIF rotate, <=2400px, q85), upload as a
// sibling .webp object, and repoint the DB. Originals STAY in the bucket, so any
// cached page or old email that still references them keeps working.
// Usage: npx tsx --env-file=.env scripts/_migrate-images-webp.mjs [--prod]
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import sharp from 'sharp';
import { putObject } from '../server/s3-storage.ts';
neonConfig.webSocketConstructor = ws;

const PUBLIC_BASE = 'https://pub-fa09cd644b5c4f1985abd165027b2596.r2.dev/';
const url = process.argv.includes('--prod')
  ? (process.env.PROD_DATABASE_URL || process.env.DATABASE_URL_PROD)
  : process.env.DATABASE_URL;
const pool = new Pool({ connectionString: url });

const COLUMNS = [
  ['flavors', 'primary_image_url'],
  ['flavors', 'secondary_image_url'],
  ['retail_products', 'product_image_url'],
  ['products', 'image_url'],
  ['users', 'profile_image_url'],
];

// 1. Collect distinct candidate URLs
const urls = new Set();
for (const [table, col] of COLUMNS) {
  const { rows } = await pool.query(`SELECT DISTINCT ${col} AS u FROM ${table} WHERE ${col} IS NOT NULL AND ${col} <> ''`);
  rows.forEach(r => urls.add(r.u));
}
const { rows: arrRows } = await pool.query(`SELECT DISTINCT unnest(image_urls) AS u FROM products`);
arrRows.forEach(r => urls.add(r.u));

const candidates = [...urls].filter(u => u.startsWith(PUBLIC_BASE) && /\.(png|jpe?g)$/i.test(u));
const skipped = [...urls].filter(u => !candidates.includes(u));
console.log(`${urls.size} distinct URLs; ${candidates.length} convertible; ${skipped.length} skipped`);
for (const s of skipped) console.log(`  skip: ${s}`);

// 2. Convert + upload, building old->new mapping
const mapping = new Map();
for (const u of candidates) {
  try {
    const res = await fetch(u);
    if (!res.ok) { console.warn(`  FETCH ${res.status}: ${u}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const converted = await sharp(buf)
      .rotate()
      .resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
    if (converted.length >= buf.length) { console.log(`  no-gain (${buf.length}b): ${u}`); continue; }
    const key = decodeURIComponent(u.slice(PUBLIC_BASE.length)).replace(/\.(png|jpe?g)$/i, '') + '.webp';
    const { publicUrl } = await putObject(key, converted, 'image/webp');
    mapping.set(u, publicUrl);
    console.log(`  ${(buf.length/1024).toFixed(0)}KB -> ${(converted.length/1024).toFixed(0)}KB  ${key}`);
  } catch (e) {
    console.warn(`  ERROR ${u}: ${e.message}`);
  }
}

// 3. Repoint the DB
let updated = 0;
for (const [oldUrl, newUrl] of mapping) {
  for (const [table, col] of COLUMNS) {
    const { rowCount } = await pool.query(`UPDATE ${table} SET ${col} = $1 WHERE ${col} = $2`, [newUrl, oldUrl]);
    updated += rowCount;
  }
  const { rowCount } = await pool.query(
    `UPDATE products SET image_urls = array_replace(image_urls, $2, $1) WHERE $2 = ANY(image_urls)`, [newUrl, oldUrl]);
  updated += rowCount;
}
console.log(`converted ${mapping.size} images; updated ${updated} DB references`);
await pool.end();
