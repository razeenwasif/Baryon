import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { faceStatus, faceTrayTemplate, shortHost } from '../desktop/presence.mjs';

const source = await readFile(new URL('../desktop/face-main.cjs', import.meta.url), 'utf8');

test('a face loads none of the full Fairy’s data, model, sign-in or timer modules, and never names the data folder', () => {
  for (const name of ['core.mjs', 'sessions.mjs', 'claude.mjs', 'codex.mjs', 'antigravity.mjs', 'gmail.mjs', 'calendar.mjs', 'drive.mjs', 'check-ins.mjs', 'automation.mjs', 'phone-link.mjs', 'memory.mjs', 'long-term-memory.mjs', 'main.cjs']) {
    assert.ok(!source.includes(`./${name}`), name);
  }
  assert.ok(!/['"]lyra['"]/.test(source), 'no path to the lyra data folder');
  assert.ok(!/createServer|\.listen\(/.test(source), 'listens on nothing');
});

test('a face opens the companion page as a face, and answers only that page', () => {
  assert.match(source, /loadFile\(join\(__dirname, '\.\.\/dist\/companion\.html'\), \{ query: \{ role: 'face' \} \}\)/);
  assert.match(source, /event\.sender !== win\.webContents \|\| !isFacePage\(event\.senderFrame\?\.url\)/);
  assert.match(source, /requestSingleInstanceLock\(\)/);
});

test('the face’s menu says where its link stands, and offers Forget only once paired', () => {
  assert.equal(shortHost('home-mac.tail0000.ts.net'), 'home-mac');
  assert.equal(faceStatus('connected', 'home-mac.tail0000.ts.net'), 'Connected to home-mac');
  assert.equal(faceStatus('unpaired'), 'Not paired with your other Mac');
  assert.equal(faceStatus('something new'), 'Can’t reach your other Mac');
  const ids = template => template.filter(item => item.id).map(item => item.id);
  assert.deepEqual(ids(faceTrayTemplate()), ['status', 'show', 'mute', 'login', 'home', 'quit']);
  assert.deepEqual(ids(faceTrayTemplate({ link: 'connected', host: 'mini' })), ['status', 'check', 'restart', 'show', 'window', 'chats', 'mute', 'screen', 'login', 'forget', 'home', 'quit']);
  assert.equal(faceTrayTemplate({ visible: false })[2].label, 'Show Baryon');
  assert.equal(faceTrayTemplate()[0].enabled, false);
});

test('the companion page hides the full Fairy’s buttons when it is a face', async () => {
  const page = await readFile(new URL('../src/companion.js', import.meta.url), 'utf8');
  assert.match(page, /get\('role'\) === 'face'/);
  // The mode switch stays: Task mode runs a Desktop task on the face's own screen.
  assert.match(page, /'\[data-mirror\]:not\(#floating-mute\):not\(#floating-quiz-hints\):not\(#floating-quiz-auto\)'/);
  assert.ok(!page.includes("if (face) mode = 'chat';"));
});

test('a hidden ring segment stays hidden when the ring opens, so a face’s ring isn’t covered by the buttons it hides', async () => {
  const css = await readFile(new URL('../src/radial-menu.css', import.meta.url), 'utf8');
  const rule = css.indexOf('#floating-ui .radial-menu button.radial-segment[hidden]{display:none}');
  assert.ok(rule > 0);
  // It must come after the rule that gives every segment display:flex, or it loses.
  assert.ok(rule > css.indexOf('display:flex;align-items:center;justify-content:center;background:var(--ring)'));
});

test('a face works its own Mute and Ride along, and stops riding before it hides', () => {
  assert.match(source, /fromPage\('companion-action', name => \{ if \(name === 'floating-mute' \|\| name === 'mute'\) return toggleMute\(\); if \(name === 'floating-quiz-hints'\) return toggleQuiz\(\); if \(name === 'floating-quiz-auto'\) return toggleQuizAuto\(\); \}\);/);
  assert.match(source, /fromPage\('companion-mirror-request', \(\) => sendMirror\(\)\);/);
  assert.match(source, /fromPage\('companion-ride', on => setRide\(on === true\)\);/);
  assert.match(source, /if \(riding\) await setRide\(false, \{ hidden: glideBy \}\);\n\s+if \(glideBy && !rode\) await glide\.glideOut/);
  assert.match(source, /if \(id === 'mute'\) await toggleMute\(\);/);
});

test('the chats window: opened from the menu, its page calls only its own handlers, and links open outside', async () => {
  // ↗ opens Fairy's own window since Away 3; the chats window stays in the menu bar.
  assert.match(source, /fromPage\('companion-open-window', \(\) => openFullWindow\(\)\);/);
  assert.match(source, /if \(id === 'chats'\) openChats\(\);/);
  assert.match(source, /event\.sender !== chatsWin\.webContents \|\| !isChatsPage\(event\.senderFrame\?\.url\)/);
  assert.match(source, /setWindowOpenHandler\(\(\{ url \}\) => \{ if \(\/\^https\?:/);
  // It sends through the phone link's own /v1/send, so a message gets a phone's kind of reply.
  assert.match(source, /connected\(\)\.post\('\/v1\/send', \{ chat:/);
  const page = await readFile(new URL('../src/face-chats.js', import.meta.url), 'utf8');
  assert.match(page, /element\('p', '', detail\)/, 'what the other Mac sends is set as text');
  assert.ok(!/innerHTML\s*=\s*[^`]/.test(page.replace(/\$\('#chats'\)\.innerHTML = `/, '')), 'no innerHTML from the other Mac');
});
