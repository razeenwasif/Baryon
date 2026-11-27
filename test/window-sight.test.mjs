// Efficiency audit, fix 4: nothing is drawn while nobody can see Fairy's window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { SETTLE_MS, WindowSight } from '../desktop/window-sight.cjs';

// A window as Electron reports it on macOS: covering it or moving to another Space emits 'hide' and 'show', but
// isVisible() stays true. The test turns the settle timer by hand.
function fixture({ visible = true } = {}) {
  const window = new EventEmitter();
  const state = { visible, minimized: false, destroyed: false, closed: false };
  Object.assign(window, { isVisible: () => state.visible, isMinimized: () => state.minimized, isDestroyed: () => state.destroyed });
  const timers = [], changes = [];
  const sight = new WindowSight({ window, changed: visible => changes.push(visible), hidden: () => state.closed,
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clear: id => { timers[id - 1] = null; } });
  const pending = () => timers.filter(Boolean);
  const settle = () => { const due = pending(); assert.equal(due.length, 1, 'one settle timer at a time'); timers[timers.indexOf(due[0])] = null; due[0].fn(); };
  return { window, state, sight, changes, pending, settle };
}

test('a covered window stops drawing once the cover has settled, and draws again the moment it is uncovered', () => {
  const f = fixture();
  assert.equal(f.sight.visible, true);
  f.window.emit('hide');
  assert.deepEqual(f.changes, [], 'not at once: a covering window fading in flaps hide and show');
  assert.equal(f.pending()[0].ms, SETTLE_MS);
  f.settle();
  assert.deepEqual(f.changes, [false], 'covered, though isVisible() still says true');
  f.window.emit('show');
  assert.deepEqual(f.changes, [false, true], 'uncovered: at once');
  assert.equal(f.pending().length, 0);
});

test('the flapping while a window fades in over Fairy changes nothing until a hide stands', () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) { f.window.emit('hide'); f.window.emit('show'); }
  assert.deepEqual(f.changes, [], 'eight flaps, no change published');
  assert.equal(f.pending().length, 0, 'each show cancels the settle timer');
  f.window.emit('hide');
  f.settle();
  assert.deepEqual(f.changes, [false]);
});

test('hidden, minimized or closed counts at once', () => {
  const f = fixture();
  f.state.visible = false; f.window.emit('hide');
  assert.deepEqual(f.changes, [false], 'hide() needs no settling');
  f.state.visible = true; f.window.emit('show');
  f.state.minimized = true; f.window.emit('minimize');
  f.state.minimized = false; f.window.emit('restore');
  assert.deepEqual(f.changes, [false, true, false, true]);
  f.state.closed = true; f.sight.sync();
  assert.deepEqual(f.changes.at(-1), false, 'closing only makes the window see-through, but nobody sees it');
  f.state.closed = false; f.sight.sync();
  assert.deepEqual(f.changes.at(-1), true);
});

test('disposing stops listening and drops a pending settle', () => {
  const f = fixture();
  f.window.emit('hide');
  f.sight.dispose();
  assert.equal(f.pending().length, 0);
  assert.equal(f.window.eventNames().length, 0);
  f.window.emit('show');
  assert.deepEqual(f.changes, []);
});

test('the app wires it in: the policy hears it, and the renderer stops everything that moves', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /new WindowSight\(\{window,hidden:\(\)=>Boolean\(companionVisibility\?\.hidden\),changed:visible=>\{powerAwareness\?\.setVisible\(visible\);stallWatch\?\.sync\(\);\}\}\)/);
  assert.match(main, /powerAwareness\?\.setVisible\(windowSight\.visible\)/, 'and the state it starts in');
  assert.doesNotMatch(main, /setVisible\([^)]*isVisible\(\)/, 'isVisible() never sees a cover');
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /function unseen\(\) \{ return ambient\.power\?\.visible === false; \}/);
  assert.match(app, /hidden: document\.hidden \|\| unseen\(\)/, 'the wallpaper and Velvet’s dots pause');
  assert.match(app, /playbackMs !== 0 && !unseen\(\)/, 'no music checks for an animation nobody sees');
  assert.match(app, /ambient = value; syncUnseen\(\);/);
  const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.match(css, /html\.unseen \*, html\.unseen \*::before, html\.unseen \*::after \{ animation-play-state: paused !important; \}/);
});
