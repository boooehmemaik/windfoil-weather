// ============================================================================
// WindFoil — PWA-Icons aus favicon.svg erzeugen
// ----------------------------------------------------------------------------
// `node tools/make-icons.mjs` schreibt icon-192.png und icon-512.png.
//
// Auf dem LXC ist kein SVG-Rasterizer installiert (kein rsvg-convert,
// ImageMagick oder Inkscape), und iOS akzeptiert für das Home-Bildschirm-Icon
// kein SVG — ohne PNG bekäme die installierte App einen Screenshot als Icon.
// Darum werden die drei Pfade aus favicon.svg hier analytisch ausgewertet:
// jede Form hat eine Abstandsfunktion, 4×4-Supersampling glättet die Kanten.
// Die Geometrie ist eine direkte Übersetzung von favicon.svg (viewBox 32×32).
// ============================================================================
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const VIEWBOX = 32;
const SS = 4;                       // Subsamples je Achse
const BG = [0x0a, 0x0e, 0x14];
const ORANGE = [0xf0, 0x78, 0x20];
const STEEL = [0x5a, 0x7a, 0x96];

// favicon.svg: drei Strömungslinien, jede mit einem Locken-Bogen am Ende.
const SHAPES = [
  { color: ORANGE, w: 2.3, seg: [5, 11.5, 16.5, 11.5], arc: { cx: 16.5, cy: 8.8, r: 2.7, from: 90, to: -180 } },
  { color: ORANGE, w: 2.3, seg: [5, 20.5, 20, 20.5], arc: { cx: 20, cy: 23.2, r: 2.7, from: -90, to: 180 } },
  { color: STEEL, w: 2.1, seg: [5, 16, 11.6, 16], arc: { cx: 11.6, cy: 13.7, r: 2.3, from: 90, to: -180 } },
];

const clamp01 = x => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Abstand Punkt → Segment. */
function distSeg(px, py, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1;
  const t = clamp01(((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Abstand Punkt → Kreisbogen. Liegt der Punkt außerhalb des Winkelbereichs,
 *  zählt der Abstand zum näheren Bogenende — das ergibt runde Enden wie
 *  stroke-linecap="round". */
function distArc(px, py, a) {
  const dx = px - a.cx, dy = py - a.cy;
  const rad = Math.hypot(dx, dy);
  let deg = Math.atan2(dy, dx) * 180 / Math.PI;
  const lo = Math.min(a.from, a.to), hi = Math.max(a.from, a.to);
  while (deg < lo) deg += 360;
  if (deg <= hi) return Math.abs(rad - a.r);
  const end = t => [a.cx + a.r * Math.cos(t * Math.PI / 180), a.cy + a.r * Math.sin(t * Math.PI / 180)];
  const [ax, ay] = end(a.from), [bx, by] = end(a.to);
  return Math.min(Math.hypot(px - ax, py - ay), Math.hypot(px - bx, py - by));
}

/** Abgerundetes Quadrat (rx = 7 in der viewBox). */
function inBackground(px, py, r = 7) {
  const d = Math.min(px, py, VIEWBOX - px, VIEWBOX - py);
  if (d < 0) return false;
  const cx = Math.min(Math.max(px, r), VIEWBOX - r);
  const cy = Math.min(Math.max(py, r), VIEWBOX - r);
  return Math.hypot(px - cx, py - cy) <= r;
}

function renderRGBA(size) {
  const px = Buffer.alloc(size * size * 4);
  const step = VIEWBOX / size / SS;
  const off = step / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let bgHits = 0;
      const acc = SHAPES.map(() => 0);
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x * SS + sx) * step + off;
          const uy = (y * SS + sy) * step + off;
          if (inBackground(ux, uy)) bgHits++;
          SHAPES.forEach((s, i) => {
            const d = Math.min(distSeg(ux, uy, s.seg), distArc(ux, uy, s.arc));
            if (d <= s.w / 2) acc[i]++;
          });
        }
      }
      const total = SS * SS;
      let [r, g, b] = BG;
      SHAPES.forEach((s, i) => {
        const a = acc[i] / total;
        if (!a) return;
        r = r * (1 - a) + s.color[0] * a;
        g = g * (1 - a) + s.color[1] * a;
        b = b * (1 - a) + s.color[2] * a;
      });
      const o = (y * size + x) * 4;
      px[o] = Math.round(r); px[o + 1] = Math.round(g); px[o + 2] = Math.round(b);
      // Die Hintergrundform bestimmt die Deckkraft — maskable-Icons dürfen
      // außerhalb des Radius nicht schwarz überstehen.
      px[o + 3] = Math.round((bgHits / total) * 255);
    }
  }
  return px;
}

// ── PNG-Encoder (RGBA8, Filter 0) ───────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // colour type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;   // Filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [192, 512]) {
  const file = join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, encodePng(size, renderRGBA(size)));
  console.log(`${file} geschrieben`);
}
