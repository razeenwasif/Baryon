// Diffusion's background (src/diffusion-ridge.js): the user's topographic ridge animation in Diffusion's colours.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS, SPEED, frameDue, NX, NZ, RIDGE_MODES, RIDGE_PALETTE, drawRidge, elevation, makeGrid, makeNoise, ridgeModeIndex } from '../src/diffusion-ridge.js';
import { ridgeShaderSources } from '../src/diffusion-ridge-gl.js';

// A 2D context that only remembers what was asked of it.
function recorder() {
  const log = { strokes: [], fills: [], rects: 0 };
  let path = 0, style = '', fill = '';
  const ctx = {
    lineCap: '', lineJoin: '', lineWidth: 1,
    set strokeStyle(v) { style = v; }, get strokeStyle() { return style; },
    set fillStyle(v) { fill = v; }, get fillStyle() { return fill; },
    beginPath() { path = 0; }, moveTo() { path++; }, lineTo() { path++; }, closePath() {},
    stroke() { log.strokes.push({ style, path }); }, fill() { log.fills.push(fill); }, fillRect() { log.rects++; },
  };
  return { ctx, log };
}
const frame = (mode, ribs = true) => { const { ctx, log } = recorder(); drawRidge(ctx, makeGrid(), makeNoise(), { width: 1200, height: 800, t: 10, mode, ribs }); return log; };
const colour = list => new RegExp(`^rgba\\(${list.join(',')},`);

test('four views, found by id or index, the first for anything else', () => {
  assert.deepEqual(RIDGE_MODES.map(m => m.id), ['hybrid', 'survey', 'alpine', 'saddle']);
  assert.equal(ridgeModeIndex('alpine'), 2);
  assert.equal(ridgeModeIndex(3), 3);
  for (const odd of [undefined, null, 'mars', 4, -1, '__proto__']) assert.equal(ridgeModeIndex(odd), 0, String(odd));
});

test('the land is the same for the same seed, within 0.02–0.98, and moves with time', () => {
  const a = makeNoise(), b = makeNoise();
  for (let mode = 0; mode < 4; mode++) for (let i = 0; i < 50; i++) {
    const h = elevation(a, i * 0.13, i * 0.07, 5, mode);
    assert.ok(h >= 0.02 && h <= 0.98);
    assert.equal(h, elevation(b, i * 0.13, i * 0.07, 5, mode));
  }
  assert.notEqual(elevation(a, 0.3, 0.4, 0, 3), elevation(a, 0.3, 0.4, 9, 3));
});

test('Diffusion’s colours: straw and greens, never the original’s white or copper', () => {
  const lines = Object.entries(RIDGE_PALETTE).filter(([, v]) => Array.isArray(v)).map(([, v]) => v);
  for (const [r, g, b] of lines) {
    assert.ok(g >= r - 6 && g > b, `${r},${g},${b} leans green or straw`);
    assert.ok(!(r > 245 && g > 245 && b > 245), 'no white');
  }
  const log = frame(0);
  assert.ok(log.strokes.every(s => !/rgba\((224|232|246),(122|132|162)/.test(s.style)), 'no copper');
});

test('each view draws what it should, and slope ribs switch off', () => {
  const hybrid = frame(0), survey = frame(1), alpine = frame(2), noRibs = frame(0, false);
  const has = (log, c) => log.strokes.some(s => colour(c).test(s.style));
  assert.ok(has(hybrid, RIDGE_PALETTE.paleMinor) && has(hybrid, RIDGE_PALETTE.ribDim), 'contours and ribs');
  assert.ok(has(survey, RIDGE_PALETTE.paleMinor) && !has(survey, RIDGE_PALETTE.ribDim), 'contours only');
  assert.ok(!has(alpine, RIDGE_PALETTE.paleMinor) && !has(alpine, RIDGE_PALETTE.greenMajor) && has(alpine, RIDGE_PALETTE.ribDim), 'ribs only');
  assert.ok(!has(noRibs, RIDGE_PALETTE.ribDim) && !has(noRibs, RIDGE_PALETTE.ribBright) && has(noRibs, RIDGE_PALETTE.paleMinor), 'ribs off, contours stay');
  assert.equal(hybrid.fills.filter(f => f === RIDGE_PALETTE.ground).length, 95, 'a ground skirt for every row but the last');
  assert.ok(survey.fills.includes(RIDGE_PALETTE.plate), 'the survey plate has its lighter ground');
  assert.equal(LEVELS, 22);
});

test('the land goes by slowly: 0.2 of terrain time a second, under half the original’s 0.5', () => {
  assert.equal(SPEED, 0.2);
});

test('30 frames a second on a 60 Hz or 120 Hz screen, even with a jittery clock', () => {
  for (const [hz, jitter] of [[60, 0], [60, 0.4], [120, 0], [120, 0.3]]) {
    let last = -1e9, drawn = 0;
    for (let k = 0; k < hz * 10; k++) {
      const now = k * (1000 / hz) + (k % 2 ? jitter : -jitter);
      if (frameDue(now, last, 30)) { drawn++; last = now; }
    }
    assert.ok(Math.abs(drawn / 10 - 30) <= 0.2, `${hz} Hz: ${drawn / 10} a second`);
  }
  let last = -1e9, drawn = 0;
  for (let k = 0; k < 600; k++) { const now = k * 1000 / 60; if (frameDue(now, last, 12)) { drawn++; last = now; } }
  assert.ok(drawn / 10 >= 11.5 && drawn / 10 <= 15.5, `the canvas fallback, ${drawn / 10} a second`);
});

test('the GPU shaders draw the same land: the same grid, levels and noise as the canvas', () => {
  const sources = ridgeShaderSources({ NX, NZ, LEVELS });
  assert.deepEqual(Object.keys(sources), ['height', 'skirt', 'contour', 'line', 'point']);
  for (const [vs, fs] of Object.values(sources)) {
    for (const src of [vs, fs]) {
      assert.ok(src.startsWith('#version 300 es'));
      assert.match(src, new RegExp(`const int NX = ${NX}, NZ = ${NZ}, LEVELS = ${LEVELS};`));
    }
  }
  // The canvas's land, term for term: the same warp, octaves and mixes, and the permutation table passed in.
  const common = sources.height[0];
  for (const term of ['wx * 0.65 + 17.3, wz * 0.65 + 31.7', 'px * 1.75 + 9.2, pz * 1.75 - 4.1', 'px * 3.4 + 12.1, pz * 3.4 + 21.4', 'u_mode == 1 ? 0.32 : u_mode == 2 ? 0.82 : 0.65', 'texelFetch(u_perm']) assert.ok(common.includes(term), term);
  assert.match(sources.skirt[0], /if \(k == 0\)/, 'the nearest row’s skirt, then one band per row');
});
