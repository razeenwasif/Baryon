// Fairy is painted as true pixel art: one RGBA value per cell of an 80×80 grid,
// scaled up later with nearest-neighbour sampling. No DOM, so Node scripts can
// render the same artwork for the app and menu bar icons.
export const FAIRY_GRID = 80;
const CX = 40, CY = 41;
// Proportions follow the reference artwork: disc, notched casing, sclera,
// lavender ring, blue iris ring, dark pupil and a soft highlight dot.
export const FAIRY_SHAPE = { disc: 29, casing: 21.8, ear: 28, sclera: 18, lavender: 13.5, iris: 10.3, pupil: 7.6 };

export type RGB = readonly [number, number, number];

export const FAIRY_COLORS = {
  glow: [110, 160, 255] as RGB, rim: [234, 240, 255] as RGB, disc: [62, 90, 236] as RGB, discShade: [52, 76, 216] as RGB,
  casing: [22, 30, 146] as RGB, casingShade: [16, 22, 118] as RGB, sclera: [238, 239, 248] as RGB, scleraShade: [212, 216, 240] as RGB,
  lavender: [160, 169, 228] as RGB, iris: [58, 140, 232] as RGB, irisLight: [112, 182, 246] as RGB, pupil: [28, 36, 150] as RGB,
  spark: [250, 251, 255] as RGB, sparkGlow: [178, 202, 255] as RGB, heart: [255, 156, 206] as RGB, z: [226, 234, 255] as RGB, star: [255, 232, 140] as RGB,
};

export interface FairyExpression {
  lid?: number;
  low?: number;
  squint?: number;
  tilt?: number;
  gx?: number;
  gy?: number;
  pupil?: number;
  glow?: number;
  rot?: number;
  scale?: number;
  spin?: number;
  dashed?: number;
  heart?: number;
  rimHue?: number;
}

export type FairyGlyph = 'z' | 'star' | 'spark';

export interface FairyExtra {
  glyph: FairyGlyph;
  x: number;
  y: number;
  color?: RGB;
  alpha?: number;
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const dither = (x: number, y: number): number => BAYER[(y & 3) * 4 + (x & 3)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const OPEN_EXPRESSION: Readonly<Required<FairyExpression>> = Object.freeze({
  lid: -1.2, low: 1.2, squint: 0, tilt: 0, gx: 0, gy: 0, pupil: 1, glow: .45, rot: 0, scale: 1, spin: 0, dashed: 0, heart: 0, rimHue: 0,
});

// Small pixel glyphs drawn in the grid margin around the disc.
const GLYPHS: Record<FairyGlyph, readonly string[]> = {
  z: ['1111', '0010', '0100', '1111'],
  star: ['00100', '01110', '11111', '01110', '00100'],
  spark: ['010', '111', '010'],
};

/**
 * Paint one frame into `data` (Uint8ClampedArray, FAIRY_GRID² × 4).
 * Expression fields: lid/low are upper/lower lid positions in sclera radii
 * (-1.2 fully open, 1.1 closed), gx/gy gaze in grid pixels, pupil dilation,
 * glow 0–1, rot radians, scale, tilt (slanted lid), squint 0–1 (happy ^ eye), dashed/spin (scanning
 * iris), heart (highlight shape), rimHue 0–1 (lavender rim for music).
 * `extras` lists margin glyphs: {glyph:'z'|'star'|'spark', x, y, color?, alpha?}.
 */
export function paintFairy(data: Uint8ClampedArray, e: FairyExpression = OPEN_EXPRESSION, extras: readonly FairyExtra[] = []): Uint8ClampedArray {
  const N = FAIRY_GRID, S = FAIRY_SHAPE, C = FAIRY_COLORS;
  const cos = Math.cos(-(e.rot || 0)), sin = Math.sin(-(e.rot || 0)), inv = 1 / (e.scale || 1);
  const pupilR = Math.max(4.5, Math.min(9.4, S.pupil * (e.pupil ?? 1))), irisR = Math.max(pupilR + 2.2, S.iris), lavR = Math.max(irisR + 2.4, S.lavender);
  const gx = e.gx || 0, gy = e.gy || 0, glow = Math.max(0, Math.min(1, e.glow ?? .45));
  const rim = mix(C.rim, [196, 168, 255], e.rimHue || 0), sparkC = e.heart ? C.heart : C.spark;
  const lidY = (e.lid ?? -1.2) * S.sclera, lowY = (e.low ?? 1.2) * S.sclera, tilt = e.tilt || 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const px = (x + .5 - CX) * inv, py = (y + .5 - CY) * inv;
    const rx = cos * px - sin * py, ry = sin * px + cos * py, d = Math.hypot(rx, ry), th = dither(x, y);
    let color: RGB | null = null, alpha = 255;
    if (d >= S.disc + 1.4) {
      // Outer halo: a dithered glow that brightens with speech and music.
      const a = (1 - (d - S.disc - 1.4) / 4.2) * (.25 + .6 * glow);
      if (a > th) { color = C.glow; alpha = Math.round(90 + 110 * glow); }
    } else if (d >= S.disc) color = rim;
    else {
      color = (rx + ry) / (2 * S.disc) * .9 > th ? C.discShade : C.disc;
      // Faint CRT scanlines, as in the reference frames.
      if (y % 3 === 0) color = mix(color, [0, 0, 0], .06);
      const ax = Math.abs(rx), ay = Math.abs(ry), a = Math.atan2(ry, rx);
      const toDiagonal = Math.abs(((a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2) - Math.PI / 4);
      const square = ax ** 4 + ay ** 4 < S.casing ** 4, ear = toDiagonal * d < 3.2 && d < S.ear;
      if (square || ear) color = (ry > 6 && th < .35) || (ear && !square) ? C.casingShade : C.casing;
      const ex = rx, ey = ry - .5, de = Math.hypot(ex, ey);
      if (de < S.sclera) {
        // Lids are part of the casing; they cover the eye from above and below.
        const bulge = 1 - Math.min(1, (ex / S.sclera) ** 2), sq = Math.max(0, Math.min(1, e.squint || 0));
        let upper = lidY + bulge * 2.2 + tilt * ex, lower = lowY - bulge * 3.2;
        // Squint bends both lids into an upward arc: a happy ^ eye.
        if (sq) { upper = upper * (1 - sq) + (1.5 - 8 * bulge) * sq; lower = lower * (1 - sq) + (6 - 8 * bulge) * sq; }
        if (ey < upper || ey > lower) color = ey < upper && ey > upper - 1.2 && lidY > -S.sclera ? C.casingShade : C.casing;
        else if (sq > .5) color = ey - (1.5 - 8 * bulge) < 1.2 ? C.spark : C.sclera;
        else {
          const ix = ex - gx, iy = ey - gy, di = Math.hypot(ix, iy);
          if (di < pupilR) color = C.pupil;
          else if (di < irisR) {
            let ring = di < pupilR + 1.1 ? C.irisLight : C.iris;
            if (e.dashed) { const seg = ((Math.atan2(iy, ix) + (e.spin || 0)) / (Math.PI / 4) % 2 + 2) % 2; if (seg < .55 * e.dashed) ring = C.irisLight; }
            color = ring;
          } else if (di < lavR) color = C.lavender;
          else color = (ey + ex * .4) / S.sclera > .55 + th * .5 ? C.scleraShade : C.sclera;
          // Highlight dot (or a heart) at the lower right of the iris.
          const hx = ix - 4.2, hy = iy - 5.4, dh = Math.hypot(hx, hy);
          const heart = e.heart && Math.hypot(Math.abs(hx) - 1.5, hy + 1.2) < 1.9 || e.heart && hy > -1.2 && Math.abs(hx) + hy * .9 < 2.8;
          if (e.heart ? heart : dh < 3.4) color = sparkC;
          else if (!e.heart && dh < 4.6 && th < .55) color = mix(color, C.sparkGlow, .7);
        }
      }
    }
    const i = (y * N + x) * 4;
    if (color) { data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = alpha; }
    else data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
  }
  for (const item of extras) stamp(data, item);
  return data;
}

function stamp(data: Uint8ClampedArray, { glyph, x, y, color, alpha = 1 }: FairyExtra): void {
  const rows = GLYPHS[glyph]; if (!rows) return;
  const c = color || (glyph === 'z' ? FAIRY_COLORS.z : glyph === 'star' ? FAIRY_COLORS.star : FAIRY_COLORS.spark);
  const ox = Math.round(x - rows[0].length / 2), oy = Math.round(y - rows.length / 2);
  for (let r = 0; r < rows.length; r++) for (let q = 0; q < rows[r].length; q++) {
    if (rows[r][q] !== '1') continue;
    const gx = ox + q, gy = oy + r; if (gx < 0 || gy < 0 || gx >= FAIRY_GRID || gy >= FAIRY_GRID) continue;
    const i = (gy * FAIRY_GRID + gx) * 4, a = Math.max(0, Math.min(1, alpha));
    data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2]; data[i + 3] = Math.max(data[i + 3], Math.round(255 * a));
  }
}

// Hit area in grid units: the disc plus its rim.
export const fairyHit = (gx: number, gy: number): boolean => Math.hypot(gx - CX, gy - CY) <= FAIRY_SHAPE.disc + 1.4;
export const FAIRY_CENTER = { x: CX, y: CY };
