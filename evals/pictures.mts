// Pictures for the vision eval tasks (evals/kind-tasks.mjs), drawn here so each has an exact answer: shapes, bars and
// numbers on a plain ground, as PNG. A tiny encoder (zlib from Node, no packages) and a 5×7 pixel font for digits and
// the letters the tasks use.
import { deflateSync } from 'node:zlib';

export type RgbColour = readonly [number, number, number];
export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

export interface PictureScreenshot {
  url: string;
  width: number;
  height: number;
}

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (bytes: Uint8Array): number => { let c = 0xffffffff; for (const byte of bytes) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

export const COLOURS = {
  white: [255, 255, 255],
  black: [20, 20, 20],
  red: [220, 40, 40],
  blue: [40, 90, 220],
  green: [30, 160, 70],
  yellow: [235, 200, 30],
  grey: [150, 150, 150],
} as const satisfies Record<string, RgbColour>;

export class Picture {
  width: number;
  height: number;
  pixels: Buffer;

  constructor(width: number, height: number, ground: RgbColour = COLOURS.white) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 3);
    this.rect(0, 0, width, height, ground);
  }
  dot(x: number, y: number, colour: RgbColour): void { if (x < 0 || y < 0 || x >= this.width || y >= this.height) return; const at = (y * this.width + x) * 3; this.pixels[at] = colour[0]; this.pixels[at + 1] = colour[1]; this.pixels[at + 2] = colour[2]; }
  rect(x: number, y: number, w: number, h: number, colour: RgbColour): this { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.dot(i, j, colour); return this; }
  frame(x: number, y: number, w: number, h: number, colour: RgbColour, thick = 3): this { this.rect(x, y, w, thick, colour).rect(x, y + h - thick, w, thick, colour).rect(x, y, thick, h, colour).rect(x + w - thick, y, thick, h, colour); return this; }
  circle(cx: number, cy: number, r: number, colour: RgbColour): this { for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r) this.dot(cx + i, cy + j, colour); return this; }
  // A triangle pointing up, down, left or right, centred on (cx, cy).
  arrow(cx: number, cy: number, size: number, way: ArrowDirection, colour: RgbColour): this {
    for (let j = 0; j < size; j++) for (let i = -j; i <= j; i++) {
      const [dx, dy] = ({ up: [i, j - size / 2], down: [i, size / 2 - j], left: [j - size / 2, i], right: [size / 2 - j, i] } as const)[way];
      this.dot(Math.round(cx + dx), Math.round(cy + dy), colour);
    }
    return this;
  }
  // Text in the 5×7 font, each pixel a square of scale.
  text(x: number, y: number, words: unknown, colour: RgbColour = COLOURS.black, scale = 6): this {
    let at = x;
    for (const letter of String(words).toUpperCase()) {
      const rows = FONT[letter];
      if (rows) rows.forEach((row, j) => [...row].forEach((on, i) => { if (on === '1') this.rect(at + i * scale, y + j * scale, scale, scale, colour); }));
      at += 6 * scale;
    }
    return this;
  }
  png(): Buffer {
    const rows = Buffer.alloc((this.width * 3 + 1) * this.height);
    for (let y = 0; y < this.height; y++) { rows[y * (this.width * 3 + 1)] = 0; this.pixels.copy(rows, y * (this.width * 3 + 1) + 1, y * this.width * 3, (y + 1) * this.width * 3); }
    const header = Buffer.alloc(13); header.writeUInt32BE(this.width, 0); header.writeUInt32BE(this.height, 4); header[8] = 8; header[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
  }
  // As Fairy hands a picture to a chat turn: a data URL with its size.
  screenshot(): PictureScreenshot { return { url: `data:image/png;base64,${this.png().toString('base64')}`, width: this.width, height: this.height }; }
}

const FONT: Record<string, readonly string[]> = {
  0: ['01110', '10001', '10011', '10101', '11001', '10001', '01110'], 1: ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  2: ['01110', '10001', '00001', '00010', '00100', '01000', '11111'], 3: ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  4: ['00010', '00110', '01010', '10010', '11111', '00010', '00010'], 5: ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  6: ['00110', '01000', '10000', '11110', '10001', '10001', '01110'], 7: ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  8: ['01110', '10001', '10001', '01110', '10001', '10001', '01110'], 9: ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'], B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'], D: ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'], ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
