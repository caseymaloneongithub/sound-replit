// Home-screen icons for the installable driver app, from the invoice logo.
//   node scripts/make-app-icons.mjs
// Writes client/public/icons/{icon-192,icon-512,icon-512-maskable,apple-touch-icon}.png.
// The maskable one keeps the logo inside the 80% safe zone Android may crop to.
import sharp from "sharp";
import { mkdirSync } from "fs";

const SOURCE = "attached_assets/invoice-logo.png";
const OUT = "client/public/icons";
const BACKGROUND = { r: 244, g: 246, b: 246, alpha: 1 }; // the site's page ground

mkdirSync(OUT, { recursive: true });

async function icon(size, padFraction, file) {
  const inner = Math.round(size * (1 - 2 * padFraction));
  const logo = await sharp(SOURCE).resize(inner, inner, { fit: "contain", background: BACKGROUND }).png().toBuffer();
  const pad = Math.round((size - inner) / 2);
  await sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } })
    .composite([{ input: logo, left: pad, top: pad }])
    .png()
    .toFile(`${OUT}/${file}`);
  console.log(`wrote ${OUT}/${file}`);
}

await icon(192, 0.1, "icon-192.png");
await icon(512, 0.1, "icon-512.png");
await icon(512, 0.2, "icon-512-maskable.png");
await icon(180, 0.1, "apple-touch-icon.png");
