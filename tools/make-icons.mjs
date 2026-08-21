/* Generates the home-screen icons. No dependencies — hand-rolled PNG encoder,
 * because pulling in a graphics library for four flat rectangles is silly.
 * Motif: the face wall. Four tiles, one lit up — the one you just recognised. */

import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
};

const png = (w, h, rgb) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit, truecolour
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0, o = 0; y < h; y++) {
    raw[o++] = 0;                                  // filter: none
    for (let x = 0; x < w; x++) {
      const [r, g, b] = rgb(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const BG = [0x1c, 0x3a, 0x2c], TILE = [0xe8, 0xe4, 0xd9], LIT = [0xe4, 0xa8, 0x53];

/** Signed distance to a rounded rect, for cheap antialiasing. */
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const dx = Math.abs(x - cx) - (hw - r), dy = Math.abs(y - cy) - (hh - r);
  const ox = Math.max(dx, 0), oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - r;
};

const draw = (S) => (x, y) => {
  const pad = S * 0.17, gap = S * 0.055;
  const cell = (S - pad * 2 - gap) / 2, hw = cell / 2, r = cell * 0.28;
  let out = BG;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
    const cx = pad + hw + i * (cell + gap), cy = pad + hw + j * (cell + gap);
    const d = roundRect(x + 0.5, y + 0.5, cx, cy, hw, hw, r);
    if (d < 0.5) {
      const colour = (i === 1 && j === 0) ? LIT : TILE;   // top-right is "recognised"
      const a = Math.min(1, 0.5 - d);                     // soft edge
      out = out.map((c, k) => Math.round(c * (1 - a) + colour[k] * a));
    }
  }
  return out;
};

for (const size of [180, 192, 512]) {
  writeFileSync(`app/icon-${size}.png`, png(size, size, draw(size)));
}
console.log('wrote app/icon-{180,192,512}.png');
