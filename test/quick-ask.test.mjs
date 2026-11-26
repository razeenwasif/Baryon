import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { circledArea, QuickAsk } from '../desktop/quick-ask.mjs';
import { focusInShot } from '../desktop/screen-ink.mjs';
import { inkInstructions } from '../desktop/ink-sketch.mjs';

const ring = (cx, cy, rx, ry, turns = 1, n = 40) => Array.from({ length: n + 1 }, (_, i) => ({ x: cx + Math.cos(i / n * turns * 2 * Math.PI) * rx, y: cy + Math.sin(i / n * turns * 2 * Math.PI) * ry }));

test('going round something circles it', () => {
  const area = circledArea(ring(500, 300, 120, 60));
  assert.ok(area);
  assert.ok(Math.abs(area.x - 380) < 1 && Math.abs(area.y - 240) < 1 && Math.abs(area.w - 240) < 1 && Math.abs(area.h - 120) < 1);
  // Most of the way round, without quite closing, still counts.
  assert.ok(circledArea(ring(500, 300, 120, 60, 0.85)));
});

test('a line, a wiggle or a tiny loop is not a circle', () => {
  assert.equal(circledArea(Array.from({ length: 30 }, (_, i) => ({ x: i * 20, y: 100 }))), null);
  assert.equal(circledArea(Array.from({ length: 30 }, (_, i) => ({ x: i * 20, y: 100 + (i % 2) * 30 }))), null);
  assert.equal(circledArea(ring(500, 300, 8, 8)), null);
  assert.equal(circledArea(ring(500, 300, 100, 100).slice(0, 5)), null);
});

test('the area becomes screenshot pixels and the instructions say what "this" is', () => {
  const focus = { rect: { x: 100, y: 50, w: 200, h: 80 }, how: 'circled', size: { width: 1000, height: 500 } };
  const inShot = focusInShot(focus, { width: 2000, height: 1000 });
  assert.deepEqual(inShot, { x: 200, y: 100, w: 400, h: 160, how: 'circled' });
  const text = inkInstructions({ width: 2000, height: 1000, lines: [] }, '', inShot);
  assert.match(text, /The user circled the area \[200,100,400,160\]/);
  assert.doesNotMatch(inkInstructions({ width: 2000, height: 1000, lines: [] }, ''), /The user circled/);
  assert.equal(focusInShot(null, { width: 1, height: 1 }), null);
});

function harness({ allowed = () => true } = {}) {
  const ipcMain = new EventEmitter(), sent = [], inked = [];
  const voice = { isDestroyed: () => false, webContents: { send: (channel, value) => sent.push(['voice', channel, value]) } };
  let cursor = { x: 10, y: 10 };
  const screen = { getCursorScreenPoint: () => cursor, getDisplayNearestPoint: () => ({ id: 1, bounds: { x: 0, y: 0, width: 1000, height: 600 }, workArea: { x: 0, y: 25, width: 1000, height: 575 } }) };
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough() });
  const quick = new QuickAsk({ electron: { BrowserWindow: class {}, screen, ipcMain }, ink: { quick: (state) => { inked.push(state); } }, voice: () => voice, allowed, spawnProcess: () => child });
  return { quick, ipcMain, voice, sent, inked, child, move: point => { cursor = point; } };
}

test('holding the keys listens, and circling meanwhile asks about what was circled', async t => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const h = harness();
  h.quick.start();
  h.child.stdout.write('{"ready":true}\n{"hold":"start"}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.sent[0], ['voice', 'fairy:quick-talk', { phase: 'start' }]);
  assert.equal(h.inked.at(-1).listening, true);
  // The pointer goes round something while the keys are held.
  h.quick.trail = ring(400, 300, 90, 50);
  h.child.stdout.write('{"hold":"end"}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.sent[1], ['voice', 'fairy:quick-talk', { phase: 'stop' }]);
  assert.ok(h.inked.at(-1).circle);
  // What was heard comes back from the main window and is asked as an Explain about the circle.
  h.ipcMain.emit('fairy:quick-heard', { sender: h.voice.webContents }, 'what is this?');
  assert.deepEqual(h.sent[2], ['voice', 'fairy:quick-ask', { text: 'what is this?', mode: 'explain' }]);
  const focus = h.quick.takeFocus({ bounds: { x: 0, y: 0, width: 1000, height: 600 } });
  assert.equal(focus.how, 'circled'); assert.ok(Math.abs(focus.rect.x - 310) < 1);
  assert.equal(h.quick.takeFocus({ bounds: { x: 0, y: 0, width: 1000, height: 600 } }), null, 'used once');
  // Anyone else claiming to be the main window is ignored.
  h.ipcMain.emit('fairy:quick-heard', { sender: {} }, 'sneaky');
  assert.equal(h.sent.length, 3);
  h.quick.stop();
});

test('a hold that turns into a shortcut, or one while the Mac is locked, asks nothing', async t => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const h = harness();
  h.quick.start();
  h.child.stdout.write('{"hold":"start"}\n{"hold":"cancel"}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.sent.map(s => s[2].phase), ['start', 'cancel']);
  h.ipcMain.emit('fairy:quick-heard', { sender: h.voice.webContents }, 'hello');
  assert.deepEqual(h.sent.at(-1), ['voice', 'fairy:quick-ask', { text: 'hello', mode: null }]);
  h.quick.stop();
  const locked = harness({ allowed: () => false });
  locked.quick.start();
  locked.child.stdout.write('{"hold":"start"}\n');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(locked.sent.length, 0);
  locked.quick.stop();
});

test('a watcher that stops (Accessibility not granted yet) is tried again, and says why once', async t => {
  if (process.platform !== 'darwin') return t.skip('macOS only');
  const { EventEmitter } = await import('node:events'), { PassThrough } = await import('node:stream');
  const spawned = [], warned = [], warn = console.warn; console.warn = text => warned.push(text);
  t.after(() => { console.warn = warn; });
  const quick = new QuickAsk({ electron: { ipcMain: new EventEmitter(), screen: {}, BrowserWindow: class {} }, ink: {}, voice: () => null,
    spawnProcess: () => { const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stdin: new PassThrough(), stderr: new PassThrough() }); spawned.push(child); return child; } });
  quick.start();
  spawned[0].stderr.write('Enable Accessibility for Fairy in System Settings, then retry.');
  await new Promise(resolve => setImmediate(resolve));
  spawned[0].emit('exit', 1, null);
  assert.equal(quick.child, null);
  assert.match(warned[0], /exit 1\): Enable Accessibility/);
  assert.ok(quick.retry, 'it will try again');
  quick.stop();
  assert.equal(quick.stopped, true);
});
