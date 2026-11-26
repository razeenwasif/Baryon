// A Desktop task on the MacBook's own screen (desktop/remote-screen.mjs): the model and loop on the Mac Fairy lives on,
// pictures, questions and actions on the MacBook, over the real link (face-link.mjs desktopStep).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { call, events, setup, until } from './helpers/face-pair.mjs';
import { DESKTOP_GONE } from '../desktop/face-link.mjs';
import { cleanFit, cleanShot, cleanSummary, pictureSize, remoteScreen, runDesktopStep } from '../desktop/remote-screen.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const PNG = `data:image/png;base64,${Buffer.from('a picture').toString('base64')}`;
const BOUNDS = { x: 0, y: 0, width: 1512, height: 982 };
const FOCUS = { pid: 42, bundleId: 'com.apple.calculator', bundlePath: '/System/Applications/Calculator.app', window: { x: 10, y: 10, width: 300, height: 400, title: 'Calculator', standard: true, hasSheet: false } };

function deps() {
  const calls = [];
  return { calls, last: { shot: null }, value: {
    helper: async (payload) => { calls.push(['helper', payload]); return payload.check ? 'ready' : payload.context ? JSON.stringify(FOCUS) : ''; },
    check: async () => { calls.push(['check']); },
    capture: async ({ fit }) => { calls.push(['capture', fit]); return { url: PNG, width: 1456, height: 945, bounds: BOUNDS }; },
    apps: async () => 'Flux: dev.flux.browser',
    ask: async ({ message, allow }) => { calls.push(['ask', message, allow]); return message.includes('Review'); },
    presence: async state => { calls.push(['presence', state]); },
  } };
}

test('a picture is sized for the model and checked before use; the front app comes with it unless only the picture is wanted', async () => {
  assert.deepEqual(pictureSize({ size: { width: 1512, height: 982 } }), { width: 1512, height: 982 });
  assert.deepEqual(pictureSize({ size: { width: 3024, height: 1964 } }), { width: 1920, height: 1247 }, 'at most 1920 wide');
  const fitted = pictureSize({ size: { width: 1512, height: 982 } }, { edge: 1568, area: 1150000 });
  assert.ok(fitted.width * fitted.height <= 1150000 && Math.max(fitted.width, fitted.height) <= 1568);
  assert.equal(cleanFit({ edge: 'x', area: 1 }), null);
  assert.throws(() => cleanShot({ url: 'data:text/html;base64,AAAA', width: 10, height: 10, bounds: BOUNDS }), /wasn’t understood/);
  assert.throws(() => cleanShot({ url: PNG, width: 10, height: 10 }), /wasn’t understood/, 'no bounds, no picture');
  const shot = cleanShot({ url: PNG, width: 10, height: 10, bounds: BOUNDS, focus: FOCUS, extra: 'no' });
  assert.deepEqual(Object.keys(shot).sort(), ['bounds', 'excludedFairy', 'focus', 'height', 'url', 'width']);

  const d = deps();
  const got = await runDesktopStep({ tool: 'capture', args: { fit: { edge: 1568, area: 1150000 } } }, d.value, { last: d.last });
  assert.deepEqual(got.focus, FOCUS);
  assert.deepEqual(d.calls[0], ['capture', { edge: 1568, area: 1150000 }]);
  assert.deepEqual(d.last.shot, { width: 1456, height: 945, bounds: BOUNDS });
  const plain = await runDesktopStep({ tool: 'capture', args: { focus: false } }, d.value, { last: d.last });
  assert.equal(plain.focus, undefined);
  assert.equal(d.calls.filter(([kind, payload]) => kind === 'helper' && payload.context).length, 1, 'no Accessibility needed for a picture alone');
});

test('the MacBook runs a batch only on the picture it was placed on, and only valid actions', async () => {
  const d = deps(), opts = { last: d.last };
  const batch = { actions: [{ type: 'click', button: 'left', x: 100, y: 120 }], width: 1456, height: 945, bounds: BOUNDS, focus: FOCUS, restoreFocus: false };
  await assert.rejects(runDesktopStep({ tool: 'run', args: batch }, d.value, opts), /different picture/, 'no picture taken yet');
  await runDesktopStep({ tool: 'capture' }, d.value, opts);
  assert.deepEqual(await runDesktopStep({ tool: 'run', args: batch }, d.value, opts), { ok: true });
  const ran = d.calls.find(([kind, payload]) => kind === 'helper' && payload.actions);
  assert.deepEqual(ran[1], { actions: batch.actions, width: 1456, height: 945, bounds: BOUNDS, focus: FOCUS, restoreFocus: false });
  await assert.rejects(runDesktopStep({ tool: 'run', args: { ...batch, width: 1000 } }, d.value, opts), /different picture/);
  await assert.rejects(runDesktopStep({ tool: 'run', args: { ...batch, actions: [{ type: 'click', button: 'left', x: 5000, y: 1 }] } }, d.value, opts), /outside the captured/);
  await assert.rejects(runDesktopStep({ tool: 'run', args: { ...batch, actions: [] } }, d.value, opts), /Invalid desktop action batch/);
  await assert.rejects(runDesktopStep({ tool: 'shell', args: {} }, d.value, opts), /isn’t a desktop step/);
});

test('questions, the app list, presence and the readiness check go to the MacBook’s own', async () => {
  const d = deps();
  assert.deepEqual(await runDesktopStep({ tool: 'check' }, d.value), { ready: true });
  assert.equal(await runDesktopStep({ tool: 'apps' }, d.value), 'Flux: dev.flux.browser');
  assert.deepEqual(await runDesktopStep({ tool: 'ask', args: { message: 'Review the next desktop actions', allow: 'Run these actions' } }, d.value), { allowed: true });
  assert.deepEqual(await runDesktopStep({ tool: 'ask', args: { message: 'Let Fairy work here?' } }, d.value), { allowed: false });
  await runDesktopStep({ tool: 'presence', args: { state: 'enter' } }, d.value);
  await assert.rejects(runDesktopStep({ tool: 'presence', args: { state: 'vanish' } }, d.value), /presence state/);
  assert.deepEqual(d.calls.filter(([kind]) => kind === 'presence'), [['presence', 'enter']]);
});

test('this Mac’s side sends each step and checks what comes back', async () => {
  const sent = [];
  let answer = null;
  const screen = remoteScreen(async (tool, args) => { sent.push({ tool, args }); return typeof answer === 'function' ? answer(tool) : answer; });
  answer = { url: PNG, width: 10, height: 10, bounds: BOUNDS, focus: FOCUS };
  assert.equal((await screen.capture(null, { edge: 1568, area: 1150000 })).focus.bundleId, 'com.apple.calculator');
  await screen.capture(null, null, { focus: false });
  assert.deepEqual(sent.map(s => s.args), [{ fit: { edge: 1568, area: 1150000 } }, { fit: null, focus: false }]);
  answer = { allowed: true };
  assert.equal(await screen.ask({ message: 'Review', detail: 'x', allow: 'Run these actions' }), true);
  answer = { allowed: 'yes' };
  assert.equal(await screen.ask({ message: 'Review' }), false, 'only a plain yes counts');
  answer = 'not a picture';
  await assert.rejects(screen.capture(null), /wasn’t understood/);
  answer = () => { throw new Error('offline'); };
  assert.equal(await screen.apps(), '', 'no app list is fine');
  await screen.presence('enter'); await screen.presence('nope');
  assert.deepEqual(sent.filter(s => s.tool === 'presence').map(s => s.args.state), ['enter']);
});

test('a desktop step goes down the face’s stream and its answer comes back with the window’s token, or ends with the window', async () => {
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async () => null;
  const heard = events(s.link, s.key);
  try {
    await until(() => s.face.connected());
    await assert.rejects(s.face.desktopStep('check'), new RegExp(DESKTOP_GONE.slice(0, 30)));
    const token = (await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: { approveKey: s.approveKey } })).json.token;
    const answer = body => call(s.link, '/v1/face/window/desktop', { method: 'POST', key: s.key, body, headers: { 'X-Fairy-Window': token } });
    const asked = s.face.desktopStep('capture', { fit: null });
    await until(() => heard.some(event => event.type === 'desktop-step'));
    const step = heard.find(event => event.type === 'desktop-step').data;
    assert.equal(step.tool, 'capture');
    const big = `data:image/png;base64,${Buffer.alloc(9 * 1024 * 1024, 1).toString('base64')}`;
    assert.equal((await answer({ id: step.id, result: { url: big, width: 10, height: 10, bounds: BOUNDS } })).status, 200, 'a picture bigger than a browser answer is taken');
    assert.equal((await asked).url.length, big.length);
    // Stopping the turn tells the face to stop that step; the window closing ends one still waiting.
    const controller = new AbortController(), stopped = assert.rejects(s.face.desktopStep('ask', {}, { signal: controller.signal }), /Stopped/);
    await until(() => heard.filter(event => event.type === 'desktop-step').length === 2);
    controller.abort(); await stopped;
    await until(() => heard.some(event => event.type === 'desktop-step-stop'));
    const waiting = assert.rejects(s.face.desktopStep('presence', { state: 'enter' }), new RegExp(DESKTOP_GONE.slice(0, 30)));
    await until(() => heard.filter(event => event.type === 'desktop-step').length === 3);
    await call(s.link, '/v1/face/window/close', { method: 'POST', key: s.key, body: {}, headers: { 'X-Fairy-Window': token } });
    await waiting;
  } finally { heard.stop(); await s.done(); }
});

test('a task from the companion’s Task mode on the MacBook sends its steps with no window open, and only while it runs', async () => {
  let asked = null, release;
  const s = await setup(async (text, options) => {
    asked = { text, task: options.task === true };
    if (!options.task) return { text: 'a plain answer' };
    const ready = await s.face.desktopStep('check');
    await new Promise(resolve => { release = resolve; });
    return { text: `done ${JSON.stringify(ready)}` };
  });
  const heard = events(s.link, s.key);
  try {
    await until(() => s.face.connected());
    const answer = body => call(s.link, '/v1/face/desktop', { method: 'POST', key: s.key, body });
    assert.equal((await answer({ id: 'x', result: {} })).status, 409, 'no task running: nothing is taken');
    // A plain question's turn can't reach the MacBook's screen without the window.
    await assert.rejects(s.face.desktopStep('check'), new RegExp(DESKTOP_GONE.slice(0, 30)));
    const { turn } = (await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'open Calculator', task: true } })).json;
    assert.ok(turn);
    await until(() => heard.some(event => event.type === 'desktop-step'));
    assert.deepEqual(asked, { text: 'open Calculator', task: true });
    const step = heard.find(event => event.type === 'desktop-step').data;
    assert.equal(step.tool, 'check');
    assert.equal((await answer({ id: step.id, result: { ready: true } })).status, 200);
    await until(() => typeof release === 'function');
    release();
    await until(() => heard.some(event => event.type === 'done'));
    assert.equal(heard.find(event => event.type === 'done').data.text, 'done {"ready":true}');
    assert.equal((await answer({ id: step.id, result: {} })).status, 409, 'after the task, its route is closed again');
  } finally { heard.stop(); await s.done(); }
});

test('the MacBook steps Fairy out of the way before the task looks, and its companion does tasks from Chat', async () => {
  const main = await read('../desktop/main.cjs'), face = await read('../desktop/face-main.cjs'), companion = await read('../src/companion.js');
  assert.match(main, /await presence\.enter\(\);/);
  assert.match(main, /enter\(\) \{ this\.active = true; return screen\.presence\('enter'\); \}/);
  assert.match(main, /: task \? faceCompanionTask\(text, \{ onText, onProgress, becomeTask \}\)/);
  assert.match(face, /await desktopHelper\(\{ yield: true \}\)/, 'the helper hands the front back to your app');
  assert.match(face, /else if \(state === 'passive' && desktopTask\) \{ await stepAside\(\); companionClicks\(false\); \}/);
  assert.match(face, /fromPage\('companion-task', text => companionTask\(text\)\);/);
  assert.match(face, /await \(forCompanion \? client\?\.desktopAnswer\(answer\) : faceWindow\?\.answerDesktop\(answer\)\)/);
  assert.match(companion, /\$\('#floating-mode'\)\.hidden = true;/, 'Chat does tasks too, so the companion has no switch');
});

test('a question from the MacBook’s companion that turns into a task sends its steps marked for the turn, with no window', async () => {
  let release;
  const s = await setup(async (text, options) => {
    if (text !== 'open Calculator') return { text: 'a plain answer' };
    options.becomeTask();
    const ready = await s.face.desktopStep('check');
    await new Promise(resolve => { release = resolve; });
    return { text: `done ${JSON.stringify(ready)}` };
  });
  const heard = events(s.link, s.key);
  try {
    await until(() => s.face.connected());
    await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'open Calculator' } });
    await until(() => heard.some(event => event.type === 'desktop-step'));
    const step = heard.find(event => event.type === 'desktop-step').data;
    assert.equal(step.via, 'turn');
    assert.equal((await call(s.link, '/v1/face/desktop', { method: 'POST', key: s.key, body: { id: step.id, result: { ready: true } } })).status, 200);
    await until(() => typeof release === 'function'); release();
    await until(() => heard.some(event => event.type === 'done'));
    assert.equal(heard.find(event => event.type === 'done').data.text, 'done {"ready":true}');
  } finally { heard.stop(); await s.done(); }
});

test('Touch ID on the MacBook says what it allows, in a few words', () => {
  assert.equal(cleanSummary('  run 3 actions\n in Calculator '), 'run 3 actions in Calculator');
  assert.equal(cleanSummary('x'.repeat(300)).length, 100);
});

test('the mini runs a task or the computer tool on the MacBook’s screen for a turn from its window; the face answers steps with its own helpers', async () => {
  const main = await read('../desktop/main.cjs'), face = await read('../desktop/face-main.cjs'), remoteWindow = await read('../src/remote-window.js');
  assert.match(main, /async function runDesktopTask\(\{ text, signal, progress, parent, presence, beforeStart = async \(\) => \{\}, screen: remote = null \}\)/);
  assert.match(main, /capture: \(\) => remote \? remote\.capture\(signal, desktop\.fit\) : capture\(signal, null, true, false, desktop\.fit\),/);
  assert.match(main, /try \{ await \(remote \? remote\.run\(batch, signal\) : helper\(batch, signal\)\); \}/);
  assert.match(main, /const apps = remote \? await remote\.apps\(\) : await appLauncher\?\.catalog\(\)/);
  assert.match(main, /const macbookComputer = fit => \{/);
  assert.match(face, /if \(type === 'desktop-step'\) return void answerDesktopStep\(data\);/);
  assert.match(face, /excludePID: process\.pid, foregroundOnly: 0, width, height/);
  assert.match(face, /globalShortcut\.register\('CommandOrControl\+Shift\+Escape', stopDesktopTask\)/);
  assert.match(face, /try \{ await touchId\(what\); desktopOkUntil = Date.now\(\) \+ DESKTOP_OK_MS; return true; \} catch \{ return false; \}/, 'Touch ID alone, no dialog first');
  assert.ok(!/dialog\.showMessageBox\(\{ type: 'question', buttons: \['Stop task'/.test(face));
  assert.match(face, /const anchor = desktopVia !== 'turn' && fullWin && !fullWin\.isDestroyed\(\) \? fullWin : win && !win\.isDestroyed\(\) \? win : null;/, 'the display Fairy’s window is on, or the companion’s');
  assert.match(face, /screen\.getDisplayMatching\(anchor\.getBounds\(\)\)/);
  assert.ok(!remoteWindow.includes('[data-mode="desktop"]') && !remoteWindow.includes('[data-mode="screen"]'), 'Desktop and Screen work from the MacBook now');
});
