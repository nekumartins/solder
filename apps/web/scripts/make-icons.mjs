/**
 * Draws the Solder mark and writes it out as PNGs (and an SVG).
 *
 * Hand-rolled rather than pulling in a rasteriser: the mark is a few circles
 * and rounded rectangles, so pixel math with 3x supersampling is enough and
 * the build stays dependency-free.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const INK = [11, 13, 16, 255];
const MINT = [91, 228, 155, 255];
const DEEP = [6, 35, 26, 255];
const SAMPLES = 3;

/** The mark in a 1024-unit design space, drawn at `scale` around the centre. */
function markAt(x, y, scale) {
  const u = (value) => 512 + (value - 512) * scale;
  const s = (value) => value * scale;
  const px = x, py = y;

  // Speech bubble body + tail.
  const bubble = roundedRect(u(198), u(186), s(628), s(500), s(150));
  const tail = triangle(
    [u(300), u(640)], [u(232), u(824)], [u(430), u(664)],
  );
  if (bubble(px, py) || tail(px, py)) {
    // Dollar mark punched out of the bubble.
    if (dollar(px, py, u, s)) return DEEP;
    return MINT;
  }
  return null;
}

function dollar(x, y, u, s) {
  const cx = u(512), cy = u(430);
  const r = s(86), stroke = s(44);
  const bar = Math.abs(x - cx) <= s(17) && y >= u(276) && y <= u(590);
  if (bar) return true;

  const top = Math.hypot(x - cx, y - (cy - r));
  const bottom = Math.hypot(x - cx, y - (cy + r));
  const onTop = Math.abs(top - r) <= stroke / 2 && !(y > cy - r && x > cx);
  const onBottom = Math.abs(bottom - r) <= stroke / 2 && !(y < cy + r && x < cx);
  return onTop || onBottom;
}

function roundedRect(x0, y0, w, h, r) {
  const x1 = x0 + w, y1 = y0 + h;
  return (x, y) => {
    if (x < x0 || x > x1 || y < y0 || y > y1) return false;
    const cx = Math.min(Math.max(x, x0 + r), x1 - r);
    const cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return Math.hypot(x - cx, y - cy) <= r;
  };
}

function triangle(a, b, c) {
  const sign = (p, q, r) => (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1]);
  return (x, y) => {
    const p = [x, y];
    const d1 = sign(p, a, b), d2 = sign(p, b, c), d3 = sign(p, c, a);
    const neg = d1 < 0 || d2 < 0 || d3 < 0;
    const pos = d1 > 0 || d2 > 0 || d3 > 0;
    return !(neg && pos);
  };
}

function render(size, { maskable }) {
  const pixels = Buffer.alloc(size * size * 4);
  const scale = size / 1024;
  // A maskable icon must survive a circular crop, so the mark sits smaller.
  const markScale = maskable ? 0.7 : 1;
  const plate = maskable ? null : roundedRect(0, 0, 1024, 1024, 224);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = ((px + (sx + 0.5) / SAMPLES) / scale);
          const y = ((py + (sy + 0.5) / SAMPLES) / scale);
          const inPlate = maskable || plate(x, y);
          const colour = inPlate ? (markAt(x, y, markScale) ?? INK) : [0, 0, 0, 0];
          r += colour[0] * colour[3] / 255;
          g += colour[1] * colour[3] / 255;
          b += colour[2] * colour[3] / 255;
          a += colour[3];
        }
      }
      const n = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      const alpha = a / n;
      // Un-premultiply so edges stay clean against any background.
      const scaleBack = alpha > 0 ? 255 / alpha : 0;
      pixels[offset] = Math.round((r / n) * scaleBack);
      pixels[offset + 1] = Math.round((g / n) * scaleBack);
      pixels[offset + 2] = Math.round((b / n) * scaleBack);
      pixels[offset + 3] = Math.round(alpha);
    }
  }
  return pixels;
}

function png(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect width="1024" height="1024" rx="224" fill="#0B0D10"/>
  <path d="M348 186h328a150 150 0 0 1 150 150v200a150 150 0 0 1-150 150H430l-198 138 68-140A150 150 0 0 1 198 536V336a150 150 0 0 1 150-150z" fill="#5BE49B"/>
  <path d="M512 276v314" stroke="#06231A" stroke-width="34" stroke-linecap="round"/>
  <path d="M598 366a86 86 0 1 0-86 86 86 86 0 1 1-86 86" fill="none" stroke="#06231A" stroke-width="44" stroke-linecap="round"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), SVG);
for (const [name, size, options] of [
  ['icon-192.png', 192, { maskable: false }],
  ['icon-512.png', 512, { maskable: false }],
  ['icon-maskable.png', 512, { maskable: true }],
]) {
  writeFileSync(join(OUT, name), png(size, render(size, options)));
  console.log(`wrote ${name} (${size}x${size})`);
}
