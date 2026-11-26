// Runs' background, the Zen Pool (src/runs-water.js): its modes and themes, the camera, and how the panel wires it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CELL, DROPS, GLYPHS, MODES, SHADES, THEMES, camera, cellsFor, modeIndex, poolShaderSources, seeded, shadeColour, themeIndex, toWater } from '../src/runs-water.js';

test('three modes and four themes, found by id, the first when unknown', () => {
  assert.deepEqual(MODES.map(m => m.id), ['ripple', 'density', 'splash']);
  assert.deepEqual(THEMES.map(t => t.name), ['Obsidian Silver', 'Midnight Steel', 'Phosphor Jade', 'Monochrome Bone']);
  assert.equal(modeIndex('splash'), 2);
  assert.equal(modeIndex('nonsense'), 0);
  assert.equal(themeIndex('jade'), 2);
  assert.equal(themeIndex(undefined), 0);
});

test('shades run along the theme’s cool stops, then its warm rim, brighter as they go', () => {
  const theme = THEMES[0];
  assert.deepEqual(shadeColour(theme, 0), theme.cool[0]);
  assert.deepEqual(shadeColour(theme, 15), theme.cool.at(-1));
  const lum = c => c[0] + c[1] + c[2];
  for (let i = 1; i < 16; i++) assert.ok(lum(shadeColour(theme, i)) >= lum(shadeColour(theme, i - 1)), `shade ${i}`);
  assert.deepEqual(shadeColour(theme, 19), theme.rim);
  assert.ok(lum(shadeColour(theme, 16)) < lum(shadeColour(theme, 19)));
  assert.equal(SHADES, 20);
  assert.equal(GLYPHS.length, 16);
});

test('the camera looks down at the pool’s centre, and the pointer sways it', () => {
  const still = camera();
  assert.ok(still.ww[1] < 0 && still.ww[2] < 0, 'looking down and in');
  const swayed = camera({ x: 0.35, y: 0 });
  assert.ok(swayed.ro[0] > still.ro[0]);
});

test('a point of the panel lands on the water: the centre near the pool’s centre, the top edge far off', () => {
  const [x, z] = toWater(700, 450, 1400, 900);
  assert.ok(Math.abs(x) < 0.05 && Math.abs(z) < 0.2, `${x}, ${z}`);
  const left = toWater(200, 600, 1400, 900), right = toWater(1200, 600, 1400, 900);
  assert.ok(left[0] < 0 && right[0] > 0);
  assert.ok(toWater(700, 0, 1400, 900)[1] < -3, 'the top of the panel is the far water');
});

test('cells are the original’s Ultra-Fine grain, and the shaders work per cell, then per pixel', () => {
  assert.deepEqual(CELL, { w: 4.5, h: 7.2 });
  assert.deepEqual(cellsFor(1440, 900), { cols: 320, rows: 125 });
  assert.match(poolShaderSources.cells, /#version 300 es/);
  assert.match(poolShaderSources.cells, new RegExp(`uDrops\\[${DROPS}\\]`));
  assert.match(poolShaderSources.cells, /evalWaterGrad/);
  assert.match(poolShaderSources.cells, /uMode == 2/, 'the splash column');
  assert.match(poolShaderSources.glyphs, /texelFetch\(uCells/);
  assert.match(poolShaderSources.glyphs, /texture\(uAtlas/);
});

test('the seeded generator repeats', () => {
  const a = seeded(9), b = seeded(9);
  for (let i = 0; i < 5; i++) assert.equal(a(), b());
});

test('the Runs panel shows the pool with its pill, remembers it, and sends the pointer to it', () => {
  const view = readFileSync(new URL('../src/runs-view.js', import.meta.url), 'utf8');
  assert.match(view, /import \{ MODES, THEMES, runsWater \} from '\.\/runs-water\.js'/);
  assert.match(view, /'fairy-runs-pool'/);
  assert.match(view, /root\.addEventListener\('pointermove', event => \{ if \(view === 'projects'\) water\?\.pointer\(/);
  assert.match(view, /water\?\.dropAt\(/);
  assert.match(view, /water\?\.start\(\);[\s\S]*water\?\.stop\(\)/, 'it runs only while Runs home shows and stops smoothly elsewhere');
  const css = readFileSync(new URL('../src/runs-view.css', import.meta.url), 'utf8');
  assert.match(css, /#runs-view \.rv-water\{position:absolute;inset:0[^}]*transition:opacity \.75s/);
  assert.match(css, /#runs-view \.rv-pool\[hidden\]\{display:none\}/);
});
