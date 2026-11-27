// Floating mode removed (16 Nov 2026): the companion does everything floating Fairy did. Its chat runs through the
// window's own handler, kept in Quick chat; what the window says reaches her while you're looking at her; window tasks
// step aside with her out; and she has the animated eye, walks, tiny/full, the shortcuts, menus and restore.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the companion’s chat is the window’s chat handler, run for Quick chat and shown in the companion', async () => {
  const main = await read('../desktop/main.cjs');
  assert.match(main, /const companionCalls = new \(require\('node:async_hooks'\)\.AsyncLocalStorage\)\(\);/);
  assert.match(main, /const asker = companionCalls\.getStore\(\) \?\? null;\n\s*let history = asker \? await quickChat\.history\(\) : windowChat\.get\(\);\n\s*const chatId = asker \? asker\.id : sessions\.active;/);
  assert.match(main, /history = await sessions\.append\(asker\.id, \[\{ role: 'user', content: said, at, mode: turnMode, from: 'companion'/);
  assert.match(main, /if \(asker\) \{ if \(!signal\.aborted\) asker\.onText\(value\); \}/);
  assert.match(main, /if \(!asker && sessions\.work\(\)\) throw/);
  // Drawing and Show me how answer from the companion, beside it.
  assert.match(main, /if \(asker && process\.platform === 'darwin' && !files\.length/);
  assert.match(main, /reply = await guideRun\(\{ owner: asker \? 'companion' : null,/);
  assert.match(main, /inkOverlay\.owner = near \? 'companion' : null; const home = near \? await eyeOnDisplay\('companion', display\) : null;/);
});

test('a turn the window started answers in the companion while she’s the one in view', async () => {
  const main = await read('../desktop/main.cjs'), page = await read('../src/companion.js');
  assert.match(main, /const companionWatching = \(\) => Boolean\(companionWindow && !companionWindow\.isDestroyed\(\) && companionWindow\.isVisible\(\) && \(!window \|\| window\.isDestroyed\(\) \|\| !window\.isVisible\(\) \|\| !window\.isFocused\(\)\)\);/);
  assert.match(main, /if \(companionWatching\(\)\) toCompanion\('fairy:companion-say', reply\.speechText && reply\.clipboardCopied \? reply\.speechText : reply\.text\);/);
  assert.match(main, /catch \(error\) \{ if \(companionWatching\(\)\) toCompanion\('fairy:companion-say'/);
  assert.match(page, /api\.onCompanionTextOut\?\.\(text => \{ if \(busy \|\| typeof text !== 'string' \|\| !text\) return; showReply\(text\);/);
  assert.match(page, /paintStatus\(\$\('#floating-status'\), !text \|\| text === 'Ready' \? idleWords\(\) : text\);/);
});

test('a window task hides the window with the companion out showing it, and puts both back', async () => {
  const main = await read('../desktop/main.cjs');
  assert.match(main, /restoreWorkspace = \{ window: window\.isVisible\(\), companion: Boolean\(companionWindow && !companionWindow\.isDestroyed\(\)\) \};\n\s*await setCompanion\(true\); window\.hide\(\);/);
  assert.match(main, /if \(restoreWorkspace && !restoreWorkspace\.companion\) await setCompanion\(false\);/);
  assert.match(main, /enter\(\) \{ if \(!companionWindow \|\| companionWindow\.isDestroyed\(\)\) return; inner = companionPresence = new DesktopPresence\(\{ app, window: companionWindow \}\); inner\.enter\(\); \},/);
});

test('she draws with the animated eye, follows the pointer, walks, and sits above her own ink', async () => {
  const main = await read('../desktop/main.cjs'), page = await read('../src/companion.js'), css = await read('../src/companion.css');
  assert.match(page, /const avatar = new Avatar\(box\); avatar\.setCharacter\('fairy'\); void avatar\.setMode\('sprite'\);/);
  assert.match(page, /eyeAvatar\?\.setActivity\(ACTIVITY\[value\] \|\| 'idle'\)/);
  assert.match(page, /new CursorSampler\(\{ interval: \(\) => 0\.1, read: \(\) => api\.companionCursor\(\)/);
  assert.match(page, /if \(!face && api\.companionWalkStart\) walker = new WalkingAnimation\(/);
  assert.match(css, /#eye\.animated\{background:none!important;animation:none!important\}/);
  assert.match(main, /fromCompanion\('walk-start', \(\) => walkOfCompanion\(\)\?\.start\(\) \?\? null\);/);
  assert.match(main, /companionWindow\.setAlwaysOnTop\(true, 'screen-saver', 1\);/);
});

test('floating mode is gone: no switch, no IPC, no menu or tray item, no window walks', async () => {
  const main = await read('../desktop/main.cjs'), app = await read('../src/app.js'), preload = await read('../desktop/preload.cjs'), tray = await read('../desktop/presence.mjs');
  for (const gone of ['async function setFloating', 'floatingChat', "handle('floating'", "handle('pointer-passthrough'", "handle('walk-start'", 'workspaceBounds', "'Float avatar'"]) assert.ok(!main.includes(gone), gone);
  for (const gone of ['id="float-window"', 'function applyFloating', 'api.onFloating', 'Float Fairy on the desktop']) assert.ok(!app.includes(gone), gone);
  for (const gone of ['setFloating:', 'onFloating:', 'walkStart:', 'setPointerPassthrough:']) assert.ok(!preload.includes(gone), gone);
  assert.ok(!tray.includes("id: 'floating'"));
  assert.match(main, /\{ label: 'Companion', accelerator: 'Cmd\+Shift\+S', click: \(\) => void setCompanion\(/);
  assert.match(app, /\{ group: 'Commands', label: 'Show or put away the companion', run: \(\) => api\.companionToggle\(\) \}/);
});
