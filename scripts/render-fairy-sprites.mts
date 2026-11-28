// Renders Fairy's eye into sprite sheets for the iPhone app, from the same painter the desktop uses, so there's only
// one drawing of it to keep up to date. The expressions match target() in src/fairy-avatar.js.
// Run: node scripts/render-fairy-sprites.mjs
import zlib from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { paintFairy, FAIRY_GRID as N, OPEN_EXPRESSION as O, type FairyExpression, type FairyExtra } from '../src/fairy-pixels.js';
import { resolveRepoRoot } from './repo-root.mjs';

type SpriteFrame = readonly [FairyExpression] | readonly [FairyExpression, readonly FairyExtra[]];

const assets = `${join(resolveRepoRoot(import.meta.url), 'ios', 'Fairy', 'Assets.xcassets')}/`;
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes: Uint8Array): number => { let x = -1; for (const v of bytes) x = table[(x ^ v) & 255] ^ (x >>> 8); return (x ^ -1) >>> 0; };
const chunk = (type: string, data: Uint8Array): Buffer => { const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]), sum = Buffer.alloc(4); sum.writeUInt32BE(crc(body)); return Buffer.concat([length, body, sum]); };

function sheet(name: string, frames: readonly SpriteFrame[]): void {
  const width = N * frames.length, raw = Buffer.alloc((width * 4 + 1) * N);
  frames.forEach(([expression, extras], index) => {
    const data = new Uint8ClampedArray(N * N * 4);
    paintFairy(data, { ...O, ...expression }, extras ?? []);
    for (let y = 0; y < N; y++) Buffer.from(data.buffer, y * N * 4, N * 4).copy(raw, y * (width * 4 + 1) + 1 + index * N * 4);
  });
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(N, 4); header[8] = 8; header[9] = 6;
  const dir = `${assets}eye-${name}.imageset/`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}eye-${name}.png`, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
  writeFileSync(`${dir}Contents.json`, `${JSON.stringify({ images: [{ filename: `eye-${name}.png`, idiom: 'universal' }], info: { author: 'xcode', version: 1 }, properties: { 'preserves-vector-representation': false } }, null, 2)}\n`);
}
const tau = Math.PI * 2, range = (n: number): number[] => Array.from({ length: n }, (_, i) => i);
const gaze: ReadonlyArray<readonly [number, number]> = [[0, 0], [0, 0], [0, 0], [-1.4, .6], [-1.4, .6], [-1.4, .6], [-1.4, .6], [-1.4, .6], [1.2, -.5], [1.2, -.5], [1.2, -.5], [1.2, -.5], [1.2, -.5], [0, 0], [0, 0], [0, 0]];
const lids: Record<number, number> = { 5: -.2, 6: 1.1, 7: -.2 };
sheet('idle', range(16).map(i => [{ gx: gaze[i][0], gy: gaze[i][1], lid: lids[i] ?? -1.2, glow: .42 + Math.sin(i / 16 * tau) * .08 }]));
sheet('listening', range(8).map(i => [{ pupil: 1.12 + Math.sin(i / 8 * tau) * .06, glow: .8 + Math.sin(i / 8 * tau) * .2 }]));
sheet('thinking', range(12).map(i => [{ lid: -.2, gx: 2 + Math.sin(i / 12 * tau) * .9, gy: -2.2, dashed: 1, spin: i / 12 * Math.PI / 2 * 3, glow: .5 }]));
const mouth = [.2, .6, .9, .5, .25, .7, 1, .4];
sheet('speaking', mouth.map((m, i) => [{ lid: -.8, pupil: 1 + m * .28, glow: .55 + m * .45, gx: Math.sin(i / 8 * tau) * .8 }]));
sheet('sleeping', range(12).map(i => [{ lid: 1.15, glow: .12 }, range(3).map(k => { const p = (i / 12 + k / 3) % 1; return { glyph: 'z' as const, x: 62 + p * 10, y: 16 - p * 14, alpha: 1 - p }; })]));
sheet('happy', [[{ squint: 1, glow: .85 }, [{ glyph: 'spark' as const, x: 10, y: 14 }, { glyph: 'spark' as const, x: 70, y: 14 }]]]);
console.log('Rendered Fairy’s eye for iOS.');
