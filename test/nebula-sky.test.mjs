// Notebook's sky (src/nebula-sky.js): a nebula through Velvet while Notebook is open, its gas stirred by the pointer,
// and the wallpaper resting under it (src/wallpaper-state.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notebookSkyState, wallpaperState } from '../src/wallpaper-state.js';

globalThis.window ??= { addEventListener() {}, devicePixelRatio: 2 };
const { NEBULA, drawSource, settleWake, skySource, takeWake } = await import('../src/nebula-sky.js');
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the sky shows only on Notebooks Home, stopping smoothly in an open notebook chat', () => {
  assert.equal(notebookSkyState({}), 'off');
  assert.equal(notebookSkyState({ notebook: true }), 'live');
  assert.equal(notebookSkyState({ notebook: true, chatOpen: true }), 'off');
  for (const quiet of [{ hidden: true }, { focused: false }, { settingsOpen: true }, { dialogOpen: true }]) assert.equal(notebookSkyState({ notebook: true, ...quiet }), 'paused', JSON.stringify(quiet));
  for (const calm of [{ reducedMotion: true }, { lowPower: true }]) assert.equal(notebookSkyState({ notebook: true, ...calm }), 'still', JSON.stringify(calm));
  assert.equal(NEBULA.fps, 30);
});

test('under it the wallpaper rests and Velvet’s grid stands down, and both come back after', () => {
  const velvet = { windowWallpaper: 'velvet' }, aurora = { windowWallpaper: 'aurora', wallpaperMotion: 'flowing' };
  assert.equal(wallpaperState({ settings: velvet, notebook: true }).dots, 'off');
  assert.equal(wallpaperState({ settings: velvet }).dots, 'live');
  assert.equal(wallpaperState({ settings: aurora, notebook: true }).paused, true, 'the liquid aurora stops playing underneath');
  assert.equal(wallpaperState({ settings: aurora }).paused, false);
});

test('the pointer’s wake: a place at most every so often, with its velocity, capped, and only the newest kept', () => {
  const wake = [];
  let last = { x: -9, y: -9, at: -1 };
  last = takeWake(wake, last, 0.5, 0.5, 10);
  assert.deepEqual(wake[0], { x: 0.5, y: 0.5, vx: 0, vy: 0, a: 1 }, 'the first place has no velocity');
  assert.equal(takeWake(wake, last, 0.6, 0.5, 10 + NEBULA.every / 2), last, 'too soon: nothing taken');
  last = takeWake(wake, last, 0.6, 0.5, 10.1);
  assert.ok(Math.abs(wake[1].vx - 1) < 1e-9 && wake[1].vy === 0, 'a tenth of a height in a tenth of a second');
  last = takeWake(wake, last, 5, 0.5, 10.2);
  assert.ok(Math.abs(Math.hypot(wake[2].vx, wake[2].vy) - 3) < 1e-9, 'a flick is capped at 3 heights a second');
  for (let i = 0; i < 20; i++) last = takeWake(wake, last, 0.5, 0.5, 11 + i * 0.1);
  assert.equal(wake.length, NEBULA.wake, 'never more than the shader holds');
});

test('the wake settles to a third in NEBULA.settle seconds, and settled stirs go', () => {
  const wake = [{ x: 0, y: 0, vx: 0, vy: 0, a: 1 }];
  settleWake(wake, NEBULA.settle);
  assert.ok(Math.abs(wake[0].a - Math.exp(-1)) < 1e-9);
  settleWake(wake, NEBULA.settle * 5);
  assert.equal(wake.length, 0);
});

test('the shaders stir the gas from the wake, with no constellations left', () => {
  const sky = skySource(), draw = drawSource();
  assert.match(sky, new RegExp(`uniform vec4 stir\\[${NEBULA.wake}\\];`));
  assert.match(sky, new RegExp(`uniform float stirA\\[${NEBULA.wake}\\];`));
  assert.match(sky, /vec2 s = g0 \* 1\.7;/, 'the nebula is read from where the gas was pushed from');
  assert.match(sky, /g0 = turn\(g0, stir\[i\]\.xy, -sign\(side\)/, 'eddies turning either way of the path');
  assert.doesNotMatch(sky, /stars\[|segs\[|segA|lineGlyph/);
  assert.doesNotMatch(sky + draw, /\bflat\b/, 'a word GLSL keeps for itself');
  assert.match(draw, /g < 0\.5 \? 1\.0 : 0\.0/, 'Velvet’s dots give way to characters');
  assert.ok(NEBULA.dots.base < 0.035 && NEBULA.dots.peak < 0.62, 'the grid quieter than Velvet’s own');
  assert.equal(NEBULA.glyphs.length, 14);
});

test('the window hosts it under Notebook, with Notebook’s green on what you press', () => {
  const app = read('../src/app.js'), wallpaper = read('../src/wallpaper.js'), css = read('../src/wallpaper.css'), notebook = read('../src/notebook.css');
  assert.match(app, /\$\{wallpaperLayers\}\n  \$\{notebookSkyLayers\}/);
  assert.match(app, /applyNotebookSky\(document\.documentElement, notebookSkyState\(\{ notebook, chatOpen: notebookChatOpen, \.\.\.seen \}\)\)/);
  assert.match(wallpaper, /notebook-sky-off/);
  assert.match(app, /onPaper: paperSidebar,\n[^\n]*\n  onShow: \(\) => requestBackgroundSync\(\), onHide: \(\) => requestBackgroundSync\(\),/);
  assert.match(wallpaper, /try \{ notebookSky = nebulaSky\(canvas\); \} catch \{ notebookSky = null; \}/);
  assert.match(css, /#notebook-sky\{display:none\}/);
  assert.match(css, /html\.notebook-open:not\(\.floating\)\{[\s\S]*#notebook-sky\{display:block;/);
  const sky = css.slice(css.indexOf('#notebook-sky{display:none}'));
  assert.match(sky, /:is\(#notebook-view \.nb-centre,#notebook-view \.nb-panel,#notebook-view \.nb-courses\)\{background:transparent;border-color:transparent;-webkit-backdrop-filter:none;backdrop-filter:none\}/, 'clear over the sky, no outlines');
  assert.match(sky, /#notebook-view\{--nb-glass:transparent;--nb-deep:transparent\}/, 'Notebook’s darker glass goes clear too');
  assert.doesNotMatch(sky, /rgba\(3,3,4,\.5\)/, 'no black behind the panels');
  assert.doesNotMatch(sky, /blur\(/, 'never frosted: a blur would redraw with every frame of the sky');
  assert.match(notebook, /--w-accent:#5fe39a;--nb-accent-ink:#04170c;/);
  assert.match(notebook, /\.panel-button\.primary\{background:var\(--w-accent,#3e5aec\);color:var\(--nb-accent-ink,#fff\)\}/);
});
