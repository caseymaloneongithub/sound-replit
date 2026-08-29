// Generate client/public/favicon.png: teal rounded square with a white raindrop. Pure Node (hand-rolled PNG encoder) — no deps.
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

// white raindrop: convex hull of a tip point and a circle, 2x2 supersampled
const TIP = { x: 64, y: 26 };
const C = { x: 64, y: 80 }, R = 27;
const d = C.y - TIP.y;
const beta = Math.acos(R / d);
const A = { x: C.x - R * Math.sin(beta), y: C.y - R * Math.cos(beta) };
const B = { x: C.x + R * Math.sin(beta), y: C.y - R * Math.cos(beta) };
const sign = (p, a, b) => (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
const inTriangle = (p) => {
  const d1 = sign(p, TIP, A), d2 = sign(p, A, B), d3 = sign(p, B, TIP);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};
const inDrop = (x, y) => (x - C.x) ** 2 + (y - C.y) ** 2 <= R * R || inTriangle({ x, y });
for (let y = 0; y < S; y++)
  for (let x = 0; x < S; x++) {
    let hits = 0;
    for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]])
      if (inDrop(x + dx, y + dy)) hits++;
    if (hits && inRounded(x, y)) put(x, y, 255, 255, 255, Math.round((hits / 4) * 255));
  }

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
