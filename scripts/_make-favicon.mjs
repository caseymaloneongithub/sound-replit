// Generate client/public/favicon.png: teal rounded square, white Puget Sound
// waves, a few kombucha bubbles. Pure Node (hand-rolled PNG encoder) — no deps.
import { writeFileSync } from "fs";
import zlib from "zlib";

const S = 128;
const TEAL = [30, 96, 107]; // Fog & Cedar primary
const px = new Uint8Array(S * S * 4);

const put = (x, y, r, g, b, a = 255) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  // simple over-composite for anti-aliased edges
  const na = a / 255, oa = px[i + 3] / 255;
  const outA = na + oa * (1 - na);
  if (outA === 0) return;
  px[i] = Math.round((r * na + px[i] * oa * (1 - na)) / outA);
  px[i + 1] = Math.round((g * na + px[i + 1] * oa * (1 - na)) / outA);
  px[i + 2] = Math.round((b * na + px[i + 2] * oa * (1 - na)) / outA);
  px[i + 3] = Math.round(outA * 255);
};

// rounded-rect background
const RAD = 26;
const inRounded = (x, y) => {
  const cx = x < RAD ? RAD : x >= S - RAD ? S - 1 - RAD : x;
  const cy = y < RAD ? RAD : y >= S - RAD ? S - 1 - RAD : y;
  return (x - cx) ** 2 + (y - cy) ** 2 <= RAD * RAD;
};
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++)
    if (inRounded(x, y)) put(x, y, ...TEAL);

// two white sine waves (Puget Sound)
const wave = (baseY, amp, thick, phase) => {
  for (let x = 10; x < S - 10; x++) {
    const cy = baseY + amp * Math.sin((x / S) * Math.PI * 2.2 + phase);
    for (let y = Math.floor(cy - thick); y <= Math.ceil(cy + thick); y++) {
      const d = Math.abs(y - cy);
      const a = d <= thick - 1 ? 255 : Math.max(0, Math.round(255 * (thick - d)));
      if (inRounded(x, y)) put(x, y, 255, 255, 255, a);
    }
  }
};
wave(78, 6, 4.5, 0.3);
wave(100, 6, 4.5, 0.9);

// kombucha bubbles rising above the waves
const bubble = (cx, cy, r) => {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x - cx, y - cy);
      const a = d <= r - 0.5 ? 255 : d <= r + 0.5 ? Math.round(255 * (r + 0.5 - d)) : 0;
      if (a && inRounded(x, y)) put(x, y, 255, 255, 255, a);
    }
};
bubble(44, 46, 7);
bubble(68, 30, 5);
bubble(86, 48, 9);

// ---- PNG encode ----
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  crcTable[n] = c >>> 0;
}
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const scanlines = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) {
  scanlines[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(scanlines, y * (S * 4 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(scanlines, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);
writeFileSync("client/public/favicon.png", png);
console.log("favicon.png written,", png.length, "bytes");
