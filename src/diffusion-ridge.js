// Diffusion's background: a terrain flown over slowly, seen from low above it, drawn as lines. Ported from the user's
// "3D Topographic Ridge & Iso-Contour Animation" (Desktop, 18 Nov), in Diffusion's colours: its crisp whites become
// pale straw and its copper and amber become greens.
//
// Four views of the same land:
//   hybrid   ridged terrain with its iso-contours and slope ribs
//   survey   a higher, flatter look, contours only, on a slightly lighter ground, like a survey plate
//   alpine   steeper, sharper ridges drawn by their slope ribs alone
//   saddle   rolling saddles and basins that slowly breathe
// Slope ribs (the short strokes along each row that model the slope) can be switched off; survey marks (dashed
// geodesics, registration crosses, small telemetry squares, fixed to the land) are drawn with them.
//
// A 150 × 96 grid of heights is worked out each frame, projected with perspective (near rows at the bottom of the view,
// the far horizon near its top) and drawn back to front, each row first filling a skirt of the ground's colour below it
// so nearer land hides what's behind. This canvas renderer is the fallback (12 frames a second) for a Mac without WebGL2;
// diffusionRidge draws on the GPU otherwise (src/diffusion-ridge-gl.js, 30 a second). Only while started and the window is seen; with
// reduced motion it draws one still frame and doesn't follow the pointer.

import { createRidgeGL, ridgeGLSupported } from './diffusion-ridge-gl.js';

export const RIDGE_MODES = Object.freeze([
  Object.freeze({ id: 'hybrid', name: 'Hybrid ridge & iso-map' }),
  Object.freeze({ id: 'survey', name: 'Cartographic survey plate' }),
  Object.freeze({ id: 'alpine', name: 'Sculpted alpine relief' }),
  Object.freeze({ id: 'saddle', name: 'Saddle & basin flow' }),
]);
export const NX = 150, NZ = 96, LEVELS = 22;
// How fast the land goes by and breathes: terrain time per second. The original ran at 0.5; 0.2 is the user's slower
// pace (18 Nov).
export const SPEED = 0.2;

// A mode by its id or index; the first for anything else.
export function ridgeModeIndex(which) {
  if (Number.isInteger(which) && which >= 0 && which < RIDGE_MODES.length) return which;
  const found = RIDGE_MODES.findIndex(mode => mode.id === which);
  return found < 0 ? 0 : found;
}

// Diffusion's palette for what the original drew white ("pale", the lit and alpine land) and copper ("green", the warm
// zones), and the ground behind. r, g, b.
export const RIDGE_PALETTE = Object.freeze({
  ground: '#0a0c09', plate: '#11140f',
  paleMinor: [206, 214, 172], paleMajor: [242, 238, 196],
  greenMinor: [134, 197, 140], greenMajor: [190, 222, 140],
  ribDim: [172, 190, 150], ribBright: [238, 236, 194], ribGreen: [120, 180, 122], ribGreenPeak: [196, 223, 142],
  mark: [176, 190, 160], markGreen: [150, 206, 140],
});
const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

// Smooth gradient noise on a seeded 256 table, as the original's.
export function makeNoise(seed = 133742) {
  const perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { p[i] = i; const a = (i / 256) * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
  let s = seed;
  for (let i = 255; i > 0; i--) { s = (s * 1664525 + 1013904223) >>> 0; const j = s % (i + 1); const t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10), v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const d00 = gx[aa] * xf + gy[aa] * yf, d10 = gx[ba] * (xf - 1) + gy[ba] * yf;
    const d01 = gx[ab] * xf + gy[ab] * (yf - 1), d11 = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const x1 = d00 + u * (d10 - d00), x2 = d01 + u * (d11 - d01);
    return x1 + v * (x2 - x1);
  };
  noise.perm = perm;
  return noise;
}

// The land's height at world (wx, wz) at time t in a mode, 0.02 to 0.98.
export function elevation(noise, wx, wz, t, mode = 0) {
  if (mode === 3) {
    const s1 = Math.sin(wx * 1.35 + t * 0.35) * Math.cos(wz * 1.25 - t * 0.28);
    const s2 = 0.55 * Math.cos((wx - wz) * 1.95 - t * 0.42);
    const n1 = noise(wx * 1.1 + s1 * 0.35, wz * 1.1 + s2 * 0.35), n2 = 0.45 * noise(wx * 2.2, wz * 2.2);
    return Math.max(0.02, Math.min(0.98, 0.48 + 0.30 * s1 + 0.26 * n1 + 0.14 * n2));
  }
  // Warped, so contours meander and spurs branch.
  const px = wx + noise(wx * 0.65, wz * 0.65) * 0.52, pz = wz + noise(wx * 0.65 + 17.3, wz * 0.65 + 31.7) * 0.52;
  const n1 = noise(px * 0.80, pz * 0.80), r1 = 1 - Math.abs(n1);
  const n2 = noise(px * 1.75 + 9.2, pz * 1.75 - 4.1), r2 = 1 - Math.abs(n2);
  const n3 = noise(px * 3.4 + 12.1, pz * 3.4 + 21.4);
  const mix = mode === 1 ? 0.32 : mode === 2 ? 0.82 : 0.65;
  const smooth = 0.48 + 0.42 * n1 + 0.22 * n2 + 0.08 * n3;
  const ridged = 0.50 * r1 * r1 + 0.30 * r2 * r2 + 0.14 * (0.5 + 0.5 * n1) + 0.06 * n3;
  const h = smooth * (1 - mix) + ridged * mix + 0.04 * Math.sin(wx * 0.9 + t * 0.6) * Math.cos(wz * 0.9 - t * 0.4);
  return Math.max(0.02, Math.min(0.98, h));
}

// Grids reused frame to frame.
export function makeGrid() {
  const n = NX * NZ, f = () => new Float32Array(n);
  return { H: f(), WX: f(), WZ: f(), SX: f(), SY: f(), WARM: f(), LIT: f(), RIDGE: f(), segs: { minorPale: [], majorPale: [], minorGreen: [], majorGreen: [], ribDim: [], ribBright: [], ribGreen: [], ribGreenPeak: [] } };
}

function strokeSegments(ctx, list, style, width) {
  if (!list.length) return;
  ctx.strokeStyle = style; ctx.lineWidth = width; ctx.beginPath();
  for (let k = 0; k < list.length; k += 4) { ctx.moveTo(list[k], list[k + 1]); ctx.lineTo(list[k + 2], list[k + 3]); }
  ctx.stroke();
}

// One frame onto a 2D context of width × height (css pixels).
export function drawRidge(ctx, grid, noise, { width, height, t, mode = 0, ribs = true, marks = true, cam = { yaw: 0, pitch: 0, light: 0 } }) {
  const { H, WX, WZ, SX, SY, WARM, LIT, RIDGE, segs } = grid, P = RIDGE_PALETTE, perm = noise.perm;
  const ground = mode === 1 ? P.plate : P.ground;
  ctx.fillStyle = ground; ctx.fillRect(0, 0, width, height);
  const high = mode === 1;
  const relief = high ? height * 0.20 : mode === 2 ? height * 0.48 : height * 0.42;
  const horizon = high ? height * 0.10 : height * 0.28, bottom = high ? height * 1.05 : height * 1.08, span = bottom - horizon;
  const fov = high ? 2.1 : 1.55, pMin = fov / (fov + 1.85), pRange = 1 - pMin;
  const cosY = Math.cos(cam.yaw * 0.5), sinY = Math.sin(cam.yaw * 0.5), driftX = t * 0.42, driftZ = t * 0.28;

  for (let j = 0; j < NZ; j++) {
    const wzBase = ((j / (NZ - 1)) * 2.8 - 1) * 1.65 + driftZ;
    for (let i = 0; i < NX; i++) {
      const idx = j * NX + i, wxBase = ((i / (NX - 1)) * 2 - 1) * 2.85 + driftX;
      const wx = wxBase * cosY - wzBase * sinY, wz = wxBase * sinY + wzBase * cosY;
      WX[idx] = wx; WZ[idx] = wz; H[idx] = elevation(noise, wx, wz, t, mode);
    }
  }
  for (let j = 0; j < NZ; j++) {
    const depth = j / (NZ - 1), persp = fov / (fov + depth * 1.85), pNorm = (persp - pMin) / pRange;
    const baseY = horizon + pNorm * span + cam.pitch * 85 * (depth - 0.5), half = width * 0.64 * (0.58 + 0.58 * persp);
    for (let i = 0; i < NX; i++) {
      const idx = j * NX + i, ux = (i / (NX - 1)) * 2 - 1, h = H[idx];
      SX[idx] = width * 0.5 + ux * half; SY[idx] = baseY - h * relief * persp;
      const hL = i > 0 ? H[idx - 1] : h, hR = i < NX - 1 ? H[idx + 1] : h, hD = j > 0 ? H[idx - NX] : h, hU = j < NZ - 1 ? H[idx + NX] : h;
      const dx = (hR - hL) * 26, dz = (hU - hD) * 26;
      const crest = Math.max(0, Math.min(1, (h * 4 - (hL + hR + hD + hU)) * 42 * 1.35 + Math.max(0, h - 0.52) * 0.65));
      RIDGE[idx] = crest;
      const zone1 = Math.exp(-((ux - 0.15 + depth * 0.35) ** 2) * 2.4 - ((depth - 0.25) ** 2) * 5.5);
      const zone2 = Math.exp(-((ux + 0.65) ** 2) * 3.8 - ((depth - 0.50) ** 2) * 7.0);
      WARM[idx] = Math.min(1, (zone1 * 1.25 + zone2 * 1.05) * (0.45 + 0.55 * Math.max(0, -dx * 0.50 - dz * 0.40 + 0.38)));
      const key = Math.max(0, -dx * (0.60 + cam.light * 0.3) - dz * 0.45 + 0.36);
      const shade = high ? 0.62 + 0.38 * key : Math.min(1, Math.max(0.05, Math.pow(key, 1.15) * 1.2 + crest * 0.45));
      LIT[idx] = shade * (1 - Math.pow(depth, 2.4) * 0.70);
    }
  }

  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const inv = 1 / LEVELS;
  for (let j = NZ - 2; j >= 0; j--) {
    const depth = j / (NZ - 1), persp = fov / (fov + depth * 1.85), row = j * NX, next = (j + 1) * NX;
    // The ground below this row's line, hiding the land behind it.
    ctx.fillStyle = ground; ctx.beginPath(); ctx.moveTo(SX[row], SY[row]);
    for (let i = 1; i < NX; i++) ctx.lineTo(SX[row + i], SY[row + i]);
    ctx.lineTo(SX[row + NX - 1] + 40, height + 40); ctx.lineTo(SX[row] - 40, height + 40); ctx.closePath(); ctx.fill();

    if (mode !== 2) { // contours, by marching squares through each cell between this row and the next
      const lit = 0.80 * (1 - Math.pow(depth, 2.2) * 0.68);
      segs.minorPale.length = segs.majorPale.length = segs.minorGreen.length = segs.majorGreen.length = 0;
      for (let i = 0; i < NX - 1; i++) {
        const a = row + i, b = a + 1, c = next + i, d = c + 1;
        if ((LIT[a] + LIT[b]) * 0.5 < 0.14) continue;
        const h00 = H[a], h10 = H[b], h01 = H[c], h11 = H[d];
        const m0 = Math.max(1, Math.ceil(Math.min(h00, h10, h01, h11) * LEVELS)), m1 = Math.min(LEVELS - 1, Math.floor(Math.max(h00, h10, h01, h11) * LEVELS));
        if (m0 > m1) continue;
        const x00 = SX[a], y00 = SY[a], x10 = SX[b], y10 = SY[b], x01 = SX[c], y01 = SY[c], x11 = SX[d], y11 = SY[d];
        const green = (WARM[a] + WARM[b]) * 0.5 > 0.28;
        for (let m = m0; m <= m1; m++) {
          const iso = m * inv, mask = (h00 >= iso ? 1 : 0) | (h10 >= iso ? 2 : 0) | (h11 >= iso ? 4 : 0) | (h01 >= iso ? 8 : 0);
          if (mask === 0 || mask === 15) continue;
          let e0x = 0, e0y = 0, e1x = 0, e1y = 0, e2x = 0, e2y = 0, e3x = 0, e3y = 0, f;
          if ((mask & 1) !== ((mask >> 1) & 1)) { f = (iso - h00) / (h10 - h00 || 1e-5); e0x = x00 + (x10 - x00) * f; e0y = y00 + (y10 - y00) * f; }
          if (((mask >> 1) & 1) !== ((mask >> 2) & 1)) { f = (iso - h10) / (h11 - h10 || 1e-5); e1x = x10 + (x11 - x10) * f; e1y = y10 + (y11 - y10) * f; }
          if (((mask >> 2) & 1) !== ((mask >> 3) & 1)) { f = (iso - h01) / (h11 - h01 || 1e-5); e2x = x01 + (x11 - x01) * f; e2y = y01 + (y11 - y01) * f; }
          if (((mask >> 3) & 1) !== (mask & 1)) { f = (iso - h00) / (h01 - h00 || 1e-5); e3x = x00 + (x01 - x00) * f; e3y = y00 + (y01 - y00) * f; }
          const major = m % 4 === 0, out = green ? (major ? segs.majorGreen : segs.minorGreen) : (major ? segs.majorPale : segs.minorPale);
          if (mask === 1 || mask === 14) out.push(e3x, e3y, e0x, e0y);
          else if (mask === 2 || mask === 13) out.push(e0x, e0y, e1x, e1y);
          else if (mask === 4 || mask === 11) out.push(e1x, e1y, e2x, e2y);
          else if (mask === 8 || mask === 7) out.push(e2x, e2y, e3x, e3y);
          else if (mask === 3 || mask === 12) out.push(e3x, e3y, e1x, e1y);
          else if (mask === 6 || mask === 9) out.push(e0x, e0y, e2x, e2y);
          else if (mask === 5) out.push(e3x, e3y, e2x, e2y, e0x, e0y, e1x, e1y);
          else if (mask === 10) out.push(e3x, e3y, e0x, e0y, e2x, e2y, e1x, e1y);
        }
      }
      strokeSegments(ctx, segs.minorPale, rgba(P.paleMinor, lit * 0.45), Math.max(0.55, 0.90 * persp));
      strokeSegments(ctx, segs.majorPale, rgba(P.paleMajor, lit * 0.92), Math.max(1.1, 2.2 * persp));
      strokeSegments(ctx, segs.minorGreen, rgba(P.greenMinor, lit * 0.65), Math.max(0.65, 1.05 * persp));
      strokeSegments(ctx, segs.majorGreen, rgba(P.greenMajor, lit * 0.96), Math.max(1.2, 2.5 * persp));
    }

    if (ribs && mode !== 1) { // slope ribs: each row's edge, sorted by how lit and how green it is
      segs.ribDim.length = segs.ribBright.length = segs.ribGreen.length = segs.ribGreenPeak.length = 0;
      for (let i = 0; i < NX - 1; i++) {
        const idx = row + i, lit = LIT[idx];
        if (lit < 0.16) continue;
        const seg = [SX[idx], SY[idx], SX[idx + 1], SY[idx + 1]];
        if (WARM[idx] > 0.34) (RIDGE[idx] > 0.42 || lit > 0.68 ? segs.ribGreenPeak : segs.ribGreen).push(...seg);
        else (RIDGE[idx] > 0.45 || lit > 0.70 ? segs.ribBright : segs.ribDim).push(...seg);
      }
      const fade = 1 - Math.pow(depth, 2.3) * 0.72;
      strokeSegments(ctx, segs.ribDim, rgba(P.ribDim, 0.36 * fade), Math.max(0.55, 0.85 * persp));
      strokeSegments(ctx, segs.ribBright, rgba(P.ribBright, 0.88 * fade), Math.max(0.95, 1.85 * persp));
      strokeSegments(ctx, segs.ribGreen, rgba(P.ribGreen, 0.58 * fade), Math.max(0.7, 1.15 * persp));
      strokeSegments(ctx, segs.ribGreenPeak, rgba(P.ribGreenPeak, 0.95 * fade), Math.max(1.1, 2.25 * persp));
    }

    if (marks) { // survey marks, fixed to the land
      for (let i = 0; i < NX - 1; i++) {
        const idx = row + i, lit = LIT[idx];
        if (lit < 0.22) continue;
        const wx = WX[idx], wz = WZ[idx];
        if (((wz % 1.4) + 1.4) % 1.4 < 0.055 && (Math.floor(wx * 6) & 1) === 0) {
          ctx.strokeStyle = rgba(P.mark, 0.42 * lit); ctx.lineWidth = Math.max(0.65, 0.95 * persp);
          ctx.beginPath(); ctx.moveTo(SX[idx], SY[idx]); ctx.lineTo(SX[idx + 1], SY[idx + 1]); ctx.stroke();
        }
        const fx = wx * 1.15 - Math.floor(wx * 1.15), fz = wz * 1.15 - Math.floor(wz * 1.15);
        if (fx > 0.46 && fx < 0.54 && fz > 0.45 && fz < 0.55) {
          const cx = SX[idx], cy = SY[idx], arm = Math.max(3, 5.5 * persp);
          ctx.strokeStyle = rgba(P.mark, 0.58 * lit); ctx.lineWidth = Math.max(0.8, 1.1 * persp);
          ctx.beginPath(); ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy); ctx.moveTo(cx, cy - arm * 0.65); ctx.lineTo(cx, cy + arm * 0.65); ctx.stroke();
        }
        const mx = Math.floor(wx * 4.5), mz = Math.floor(wz * 4.5), hash = perm[(mx * 17 + mz * 31) & 255];
        if (hash > 249 && wx * 4.5 - mx < 0.25 && wz * 4.5 - mz < 0.28) {
          const w = (hash === 255 ? 6 : 3) * persp, h = (hash === 255 ? 3.8 : 2.2) * persp;
          ctx.fillStyle = WARM[idx] > 0.35 ? rgba(P.markGreen, 0.55 * lit) : rgba(P.mark, 0.45 * lit);
          ctx.fillRect(SX[idx] - w * 0.5, SY[idx] - h * 0.5, w, h);
        }
      }
    }
  }
}

// Whether a display frame at now (ms) is due for drawing at fps, the last drawn at last. A few milliseconds' grace keeps
// a frame that arrives a hair early from being skipped: at 30 on a 60 Hz screen that's every other frame, on a 120 Hz
// one every fourth, never dropping to 20.
export const frameDue = (now, last, fps) => now - last >= 1000 / fps - 4;

// The renderer Diffusion runs: on the GPU (src/diffusion-ridge-gl.js) at 30 frames a second where WebGL2 with float
// render targets is there, otherwise this file's canvas renderer at 12. Both draw the same land the same way.
export function diffusionRidge(canvas, { mode = 0, ribs = true, fps = 30, fallbackFps = 12, gpu = true } = {}) {
  const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const noise = makeNoise(), cam = { yaw: 0, pitch: 0, light: 0, toYaw: 0, toPitch: 0 };
  let glr = null;
  if (gpu && ridgeGLSupported()) {
    try { glr = createRidgeGL(canvas, { NX, NZ, LEVELS, perm: noise.perm, palette: RIDGE_PALETTE }); }
    catch (error) {
      // A canvas that gave out a WebGL context can't give a 2D one: draw on a fresh one in its place.
      console.warn(`Diffusion's background is drawn without the GPU: ${error.message}`);
      const fresh = canvas.cloneNode(false); canvas.replaceWith(fresh); canvas = fresh; glr = null;
    }
  }
  const grid = glr ? null : makeGrid(), rate = glr ? fps : fallbackFps, maxScale = glr ? 2 : 1.5;
  let ctx = null, width = 0, height = 0, scale = 1, current = ridgeModeIndex(mode), ribsOn = ribs !== false;
  let frameId = 0, last = 0, on = false, clock = 0, lastNow = 0;

  function fit() {
    const cw = canvas.clientWidth, ch = canvas.clientHeight;
    if (!cw || !ch) return false;
    if (!glr) { ctx ??= canvas.getContext('2d', { alpha: false }); if (!ctx) return false; }
    const s = Math.min(globalThis.devicePixelRatio || 1, maxScale);
    if (cw !== width || ch !== height || s !== scale) { width = cw; height = ch; scale = s; canvas.width = Math.floor(cw * s); canvas.height = Math.floor(ch * s); }
    if (ctx) ctx.setTransform(scale, 0, 0, scale, 0, 0);
    return true;
  }
  function draw(now) {
    if (!fit()) return;
    clock += lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0; lastNow = now;
    cam.yaw += (cam.toYaw - cam.yaw) * 0.06; cam.pitch += (cam.toPitch - cam.pitch) * 0.06;
    const frame = { width, height, scale, t: 8 + clock * SPEED, mode: current, ribs: ribsOn, cam };
    if (glr) glr.draw(frame);
    else drawRidge(ctx, grid, noise, frame);
  }
  const still = () => reduced.matches;
  const redrawStill = () => { if (on && still()) { lastNow = 0; draw(performance.now()); } };
  // The pointer turns the view a little and swings the light, as in the original (no dragging: the page is on top).
  const onMove = event => {
    const box = canvas.getBoundingClientRect(); if (!box.width || !box.height) return;
    const nx = ((event.clientX - box.left) / box.width) * 2 - 1, ny = ((event.clientY - box.top) / box.height) * 2 - 1;
    cam.toYaw = nx * 0.14; cam.toPitch = ny * 0.08; cam.light = nx * 0.45;
  };
  const loop = now => {
    frameId = requestAnimationFrame(loop);
    if (document.hidden || !frameDue(now, last, rate)) return;
    last = now; draw(now);
  };
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (on) draw(performance.now()); }) : null;
  resize?.observe(canvas);
  const motionChanged = () => { if (!on) return; api.stop(); api.start(); };
  reduced.addEventListener?.('change', motionChanged);

  const api = {
    start() {
      if (on) return;
      on = true; lastNow = 0;
      draw(performance.now());
      if (still()) return;
      window.addEventListener('pointermove', onMove, { passive: true });
      frameId = requestAnimationFrame(loop);
    },
    stop() { on = false; cancelAnimationFrame(frameId); frameId = 0; window.removeEventListener('pointermove', onMove); },
    renderer: () => (glr ? 'gpu' : 'canvas'),
    fps: () => rate,
    canvas: () => canvas,
    mode: () => RIDGE_MODES[current].id,
    setMode(which) { current = ridgeModeIndex(which); redrawStill(); },
    ribs: () => ribsOn,
    setRibs(value) { ribsOn = Boolean(value); redrawStill(); },
    destroy() { api.stop(); resize?.disconnect(); reduced.removeEventListener?.('change', motionChanged); },
  };
  return api;
}
