// The companion's shortcuts (floating mode is gone, 16 Nov 2026): ⌘⇧R hides and shows Fairy, the companion with her,
// ⌘⇧F makes the companion tiny or full, kept across restarts, and ⌘⇧S puts her out or away.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
function fixture(registered = true) {
  const keys: Record<string, () => void> = {}, calls: string[] = [], warnings: string[] = [];
  const context: Record<string, any> = { quitting: false, suspended: false, locked: false,
    companionVisibility: { hidden: false }, powerMonitor: { getSystemIdleState: () => 'active' },
    window: { isDestroyed: () => false, webContents: { send: () => {} } },
    hideWindow: () => { context.companionVisibility.hidden = true; calls.push('hide'); },
    showWindow: () => { context.companionVisibility.hidden = false; calls.push('show'); },
    toggleCompanionSize: () => calls.push('size'),
    globalShortcut: { register: (key: string, callback: () => void) => { keys[key] = callback; return registered; } },
    console: { warn: (message: string) => warnings.push(message) } };
  vm.runInNewContext(main.slice(main.indexOf('        const companionShortcutReady ='), main.indexOf('        const quizShortcutReady =')), context);
  return { context, keys, calls, warnings };
}

test('hide/show and tiny/full shortcuts work the window and the companion', () => {
  const f = fixture();
  f.keys['CommandOrControl+Shift+R']();
  assert(f.context.companionVisibility.hidden);
  f.keys['CommandOrControl+Shift+F']();
  assert(f.context.companionVisibility.hidden, 'resizing must not show a hidden companion');
  f.keys['CommandOrControl+Shift+R']();
  assert.deepEqual(f.calls, ['hide', 'size', 'show']);
});

test('companion shortcuts ignore sleep, lock, shutdown and destroyed or missing windows', () => {
  const f = fixture();
  const invoke = () => Object.values(f.keys).forEach(callback => callback());
  for (const guard of ['quitting', 'suspended', 'locked']) { f.context[guard] = true; invoke(); f.context[guard] = false; }
  f.context.powerMonitor.getSystemIdleState = () => 'locked'; invoke();
  f.context.powerMonitor.getSystemIdleState = () => 'active';
  f.context.window.isDestroyed = () => true; invoke();
  f.context.window = null; invoke();
  assert.deepEqual(f.calls, []);
});

test('companion shortcut registration conflicts are surfaced', () => {
  const f = fixture(false);
  assert.equal(f.warnings.length, 2);
  assert.match(f.warnings[0], /hide\/show/);
  assert.match(f.warnings[1], /tiny\/full/);
});

test('the companion’s size is two thirds when tiny, kept to its corner, and remembered with whether she was out', () => {
  assert.match(main, /const COMPANION_WIDTH = 290, COMPANION_IDLE = 296, COMPANION_TALLEST = 620, TINY = 2 \/ 3;/);
  assert.match(main, /const width = Math\.round\(COMPANION_WIDTH \* scale\), height = Math\.round\(companionHeight \* scale\);/);
  assert.match(main, /companionWindow\.setBounds\(\{ x: now\.x \+ now\.width - width, y: now\.y \+ now\.height - height, width, height \}\);\n\s*companionWindow\.webContents\.setZoomFactor\(scale\);/);
  assert.match(main, /core\.writeJSON\(file\('window\.json'\), \{ companion: open, tiny: companionTiny \}\)/);
  assert.match(main, /companionTiny = layout\.tiny === true;\n\s*if \(layout\.companion \|\| layout\.floating\)\s*await setCompanion\(true\)/);
  assert.match(main, /globalShortcut\.register\('CommandOrControl\+Shift\+S', \(\) => \{ if \(desktopPresence\?\.active \|\| companionPresence\?\.active\)\s*return; setCompanion\(!\(companionWindow && !companionWindow\.isDestroyed\(\)\)\)/);
});

test('her window is only as big as what shows, growing upward for a reply or a question and back', async () => {
  const page = readFileSync(new URL('../src/companion.ts', import.meta.url), 'utf8'), face = readFileSync(new URL('../desktop/face-main.cts', import.meta.url), 'utf8');
  assert.match(page, /const RING_TOP = 283, IDLE_HEIGHT = 296;/);
  assert.match(page, /if \(!reply\.hidden\) height = Math\.max\(height, 12 \+ Math\.min\(reply\.scrollHeight, 240\) \+ 16 \+ RING_TOP\);/);
  assert.match(page, /if \(!ask\.hidden\) height = Math\.max\(height, 300 \+ ask\.scrollHeight \+ 12\);/);
  assert.match(main, /fromCompanion\('fit', height => \{\n\s*const next = Math\.max\(COMPANION_IDLE, Math\.min\(COMPANION_TALLEST,/);
  assert.match(face, /if \(next !== now\.height\) win\.setBounds\(\{ x: now\.x, y: now\.y \+ now\.height - next, width: now\.width, height: next \}\);/);
  assert.match(face, /const WIDTH = 290, HEIGHT = 296, TALLEST = 620,/);
});
