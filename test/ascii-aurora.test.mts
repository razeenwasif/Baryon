// Velvet's aurora grid (src/aurora-grid.js, from the aurora's shape in src/ascii-aurora.js), and Research having only its
// lattice (src/wallpaper-state.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { wallpaperState } from '../src/wallpaper-state.js';
import { WINDOW_WALLPAPERS } from '../src/defaults.js';
import { cleanSettings } from '../desktop/core.mjs';
import { ARCS, ASCII_AURORA, auroraAt, cellAt, cellOf, gridThumbnail } from '../src/ascii-aurora.js';

(globalThis as any).window ??= { addEventListener() {}, devicePixelRatio: 2 };
const { AURORA_GRID, auroraGLSL, fragmentSource } = await import('../src/aurora-grid.js');

test('Research, Diffusion, and open chats fade Velvet’s animated grid out cleanly', () => {
  const velvet = { windowWallpaper: 'velvet' } as any;
  assert.equal(wallpaperState({ settings: velvet, research: true }).dots, 'off');
  assert.equal(wallpaperState({ settings: velvet, chatOpen: true }).dots, 'off');
  assert.equal(wallpaperState({ settings: velvet }).dots, 'live', 'home screen keeps it live');
  const css = readFileSync(new URL('../src/wallpaper.css', import.meta.url), 'utf8');
  assert.match(css, /&:is\(\.wallpaper-dots-off,\.wallpaper-quiet,\.research-open,\.diffusion-open,\.analytics-open\) #wallpaper>\.wp-dots\{opacity:0\}/);
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /const research = \['research-open', 'diffusion-open', 'runs-open', 'goals-open', 'boards-open', 'analytics-open', 'academy-open'\]\.some\(name => classes\.contains\(name\)\)/);
  assert.match(app, /onShow: \(\) => requestBackgroundSync\(\), onHide: \(\) => requestBackgroundSync\(\)/);
  assert.match(app, /sidebarButton: \$\('#sidebar-diffusion'\), onShow: \(\) => requestBackgroundSync\(\), onHide: \(\) => requestBackgroundSync\(\)/, 'and Diffusion');
});

test('Aurora in ASCII became Velvet’s aurora grid: the toggle’s lighter side, moving only while seen', () => {
  assert.equal((WINDOW_WALLPAPERS as readonly string[]).includes('ascii'), false);
  assert.equal(cleanSettings({ windowWallpaper: 'ascii' } as any).windowWallpaper, 'velvet', 'a window that chose it keeps it, as Velvet');
  const velvet = { windowWallpaper: 'velvet', wallpaperMotion: 'flowing', wallpaperReactive: 'on' } as any;
  for (const quiet of [{ hidden: true }, { focused: false }, { settingsOpen: true }, { dialogOpen: true }]) assert.equal(wallpaperState({ settings: velvet, ...quiet }).dots, 'paused', JSON.stringify(quiet));
  for (const calm of [{ reducedMotion: true }, { lowPower: true }]) assert.equal(wallpaperState({ settings: velvet, ...calm }).dots, 'still', JSON.stringify(calm));
  assert.equal(wallpaperState({ settings: { ...velvet, wallpaperMotion: 'still' } }).dots, 'still');
  assert.equal((wallpaperState({ settings: { ...velvet, wallpaperMotion: 'gentle' } }) as any).dotsSpeed, 0.6);
  assert.equal((wallpaperState({ settings: velvet, busy: true }) as any).dotsSpeed, 1.6, 'a little quicker while Fairy works');
  assert.equal(AURORA_GRID.fps, 30, 'smooth, on the GPU');
  const wallpaper = readFileSync(new URL('../src/wallpaper.ts', import.meta.url), 'utf8');
  assert.match(wallpaper, /if \(!field\) \{ try \{ field = auroraGrid\(canvas\); \} catch \{ field = null; \} field \?\?= dotField\(canvas\); \}/, 'the plain dot field where there’s no WebGL');
  assert.doesNotMatch(wallpaper, /wp-ascii/);
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /'Turn off background animations across all modes \(pure black\)'/);
});

test('the shader draws the aurora from the same arcs as the plain one, with the grid and pointer of Velvet’s dots', () => {
  const glsl = auroraGLSL(), shader = fragmentSource();
  for (const arc of ARCS) for (const key of ['base', 'lift', 'bow', 'width', 'strength', 'sway', 'speed'] as const) assert.ok(glsl.includes(Number.isInteger(arc[key]) ? `${arc[key]}.0` : String(arc[key])), `${key} ${arc[key]}`);
  assert.equal(glsl.match(/crest = max\(crest, glow \* curtain\);/g)!.length, ARCS.filter(a => a.accent).length, 'the crest is the accent arc’s');
  assert.match(glsl, /float curtain = 0\.86 \+ 0\.14 \* sin\(u \* 19\.0 \+ 2\.0 \* sin\(u \* 5\.0 \+ t \* 0\.35\) - t \* 0\.6\);/);
  assert.match(glsl, /light \*= 0\.88 \+ 0\.12 \* sin\(t \* 0\.35\);/);
  assert.match(shader, /floor\(\(px - offset\) \/ 14\.0 \+ 0\.5\)/, 'Velvet’s spacing');
  assert.match(shader, /\/ 230\.0\)/, 'Velvet’s pointer radius');
  assert.match(shader, /if \(pointer\.z > 0\.001 && length\(px - pointer\.xy\) < /, 'neighbours looked at only near the pointer');
  assert.equal(ASCII_AURORA.ramp.length, 11);
});

test('the aurora is arcs rising to the right, grey by brightness and blue only on the brightest crest', () => {
  assert.ok(auroraAt(0.5, 0.48, 0).light > 0.5, 'on the main arc');
  assert.ok(auroraAt(0.1, 0.05, 0).light < 0.05, 'top left is dark');
  const brightest = (u: number) => { let best = 0, at = 0; for (let v = 0; v <= 1; v += 0.01) { const l = auroraAt(u, v, 3).light; if (l > best) { best = l; at = v; } } return at; };
  assert.ok(brightest(0.85) < brightest(0.15) - 0.2);
  assert.deepEqual(cellOf(0, 0, 0, 0, 0), { ch: ' ', shade: 0 });
  assert.equal(cellOf(3, 4, 0.9, 0.97, 0).shade, 5);
  let blue = 0, grey = 0;
  for (let row = 0; row < 40; row++) for (let col = 0; col < 120; col++) { const { ch, shade } = cellAt(col, row, 120, 40, 5); if (ch !== ' ') shade >= 4 ? blue++ : grey++; }
  assert.ok(grey > blue * 6 && blue > 20, `${grey} grey, ${blue} blue`);
  const thumb = decodeURIComponent(gridThumbnail());
  assert.match(thumb, /^data:image\/svg\+xml,<svg/);
  assert.ok(thumb.includes('<circle') && thumb.includes('<text'), 'the card shows the grid’s dots and the aurora’s characters');
});
