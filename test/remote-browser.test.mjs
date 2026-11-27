// Fairy away from the mini: the browser in Fairy's window on the face's Mac (desktop/remote-browser.mjs), her steps sent
// there over the real link (face-link.mjs browserStep) for turns started in that window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { call, events, setup, until } from './helpers/face-pair.mjs';
import { BROWSER_GONE } from '../desktop/face-link.mjs';
import { FaceWindow } from '../desktop/face-window.mjs';
import { kindOf } from '../desktop/remote-channels.mjs';
import { cleanPage, RemoteBrowser, runBrowserStep } from '../desktop/remote-browser.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const PAGE = { url: 'https://example.com/', title: 'Example', text: 'Hello', elements: [{ ref: 1, kind: 'a', name: 'More', secret: false }] };
const SHOT = 'data:image/jpeg;base64,AAAA';

test('the browser pane is the face’s own; running a preview stays on the other Mac', () => {
  for (const channel of ['browser-state', 'browser-go', 'browser-command', 'browser-place', 'browser-show']) assert.equal(kindOf(channel), 'local', channel);
  for (const channel of ['preview-start', 'preview-state', 'preview-detect']) assert.equal(kindOf(channel), 'mini-only', channel);
});

test('this Mac’s side sends each step with its chat and whether it’s on screen, and checks what comes back', async () => {
  const steps = [];
  let answer = PAGE;
  const browser = new RemoteBrowser({ step: async (tool, args) => { steps.push({ tool, args }); return typeof answer === 'function' ? answer(tool) : answer; }, shown: owner => owner === 'chat-1' });
  const page = await browser.open('chat-1', 'example.com', null);
  assert.deepEqual(steps[0], { tool: 'open', args: { address: 'https://example.com/', owner: 'chat-1', reveal: true } });
  assert.deepEqual(page, PAGE);
  await assert.rejects(browser.click('chat-2', 1, null), /Another chat is using the browser/);
  answer = { ...PAGE, text: 'x'.repeat(50000), elements: [{ ref: 0, kind: 'a', name: 'bad' }, { ref: 2, kind: 'button', name: 'Go', secret: 'yes', extra: 1 }], script: 'no' };
  const typed = await browser.type('chat-1', 2, 'hi', true, null);
  assert.equal(typed.text.length, 40000);
  assert.deepEqual(typed.elements, [{ ref: 2, kind: 'button', name: 'Go', secret: false }]);
  assert.equal(typed.script, undefined);
  assert.deepEqual(steps[1].args, { ref: 2, text: 'hi', submit: true, owner: 'chat-1', reveal: true });
  answer = SHOT;
  assert.equal(await browser.screenshot('chat-1', null), SHOT);
  answer = 'data:text/html;base64,AAAA';
  await assert.rejects(browser.screenshot('chat-1', null), /picture that wasn’t understood/);
  answer = 'not a page';
  await assert.rejects(browser.show('chat-1', null), /page that wasn’t understood/);
  // The address is asked for, as the user may have opened a page there themselves.
  answer = 'https://example.org/mine';
  assert.equal(await browser.url(), 'https://example.org/mine');
  browser.release('chat-2');
  assert.equal(browser.owner, 'chat-1', 'only its own chat lets go');
  browser.release('chat-1');
  await until(() => steps.some(step => step.tool === 'release'));
  assert.equal(browser.owner, null);
  assert.throws(() => cleanPage(null));
});

test('the face runs each step on its own AgentBrowser, and opens the panel only for the chat on screen', async () => {
  const ran = [], revealed = [];
  const drive = { owner: null, url: () => 'https://here/', release: owner => ran.push(['release', owner]) };
  for (const name of ['open', 'show', 'click', 'type', 'press_key', 'scroll', 'back', 'screenshot']) drive[name] = async (...args) => { ran.push([name, ...args.slice(0, -1)]); return name === 'screenshot' ? SHOT : PAGE; };
  const reveal = owner => revealed.push(owner);
  assert.equal(await runBrowserStep(drive, { tool: 'url' }), 'https://here/');
  assert.deepEqual(await runBrowserStep(drive, { tool: 'open', args: { owner: 'c', address: 'example.com', reveal: true } }, { reveal }), PAGE);
  await runBrowserStep(drive, { tool: 'type', args: { owner: 'c', ref: '3', text: 'hi', submit: true } }, { reveal });
  await runBrowserStep(drive, { tool: 'press_key', args: { owner: 'c', key: 'Enter' } }, { reveal });
  await runBrowserStep(drive, { tool: 'release', args: { owner: 'c' } });
  assert.deepEqual(ran, [['open', 'c', 'https://example.com/'], ['type', 'c', 3, 'hi', true], ['press_key', 'c', 'Enter'], ['release', 'c']]);
  assert.deepEqual(revealed, ['c'], 'only the step that said its chat is on screen');
  await assert.rejects(runBrowserStep(drive, { tool: 'evaluate', args: { owner: 'c' } }), /isn’t a browser step/);
  await assert.rejects(runBrowserStep(drive, { tool: 'show', args: {} }), /which chat/);
  await assert.rejects(runBrowserStep(drive, { tool: 'press_key', args: { owner: 'c', key: 'F12' } }), /Use one of/);
  await assert.rejects(runBrowserStep(drive, { tool: 'open', args: { owner: 'c', address: 'file:///etc/passwd' } }), /Only web addresses/);
});

test('a step goes down the face’s stream and its answer comes back, only while its window is open', async () => {
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async () => null;
  const heard = events(s.link, s.key);
  try {
    await until(() => s.face.connected());
    await assert.rejects(s.face.browserStep('show', { owner: 'c' }), new RegExp(BROWSER_GONE.slice(0, 30)), 'no window open');
    const token = (await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: { approveKey: s.approveKey } })).json.token;
    const asked = s.face.browserStep('open', { owner: 'c', address: 'https://example.com/' });
    await until(() => heard.some(event => event.type === 'browser-step'));
    const step = heard.find(event => event.type === 'browser-step').data;
    assert.equal(step.tool, 'open');
    assert.deepEqual(step.args, { owner: 'c', address: 'https://example.com/' });
    const answer = body => call(s.link, '/v1/face/window/browser', { method: 'POST', key: s.key, body, headers: token ? { 'X-Fairy-Window': token } : {} });
    assert.equal((await call(s.link, '/v1/face/window/browser', { method: 'POST', key: s.key, body: { id: step.id, result: PAGE } })).status, 401, 'needs the window’s token');
    assert.equal((await answer({ id: step.id, result: PAGE })).status, 200);
    assert.deepEqual(await asked, PAGE);
    assert.equal((await answer({ id: step.id, result: PAGE })).status, 409, 'answered once');
    // An error comes back as the face's words.
    const failing = assert.rejects(s.face.browserStep('click', { owner: 'c', ref: 9 }), /Nothing is at ref 9/);
    await until(() => heard.filter(event => event.type === 'browser-step').length === 2);
    await answer({ id: heard.filter(event => event.type === 'browser-step')[1].data.id, error: 'Nothing is at ref 9 now.' });
    await failing;
    // Stopping the turn tells the face to stop that step.
    const controller = new AbortController(), stopped = s.face.browserStep('show', { owner: 'c' }, { signal: controller.signal });
    await until(() => heard.filter(event => event.type === 'browser-step').length === 3);
    controller.abort();
    await assert.rejects(stopped, /Stopped/);
    await until(() => heard.some(event => event.type === 'browser-step-stop'));
    // The window closing ends a step still waiting.
    const waiting = assert.rejects(s.face.browserStep('show', { owner: 'c' }), new RegExp(BROWSER_GONE.slice(0, 30)));
    await until(() => heard.filter(event => event.type === 'browser-step').length === 4);
    await call(s.link, '/v1/face/window/close', { method: 'POST', key: s.key, body: {}, headers: { 'X-Fairy-Window': token } });
    await waiting;
  } finally { heard.stop(); await s.done(); }
});

test('the face’s window skips her own browser opening on the other Mac, and answers a step with its token', async () => {
  const sent = [], delivered = [];
  const client = { async call(method, path, options = {}) { sent.push({ path, ...options }); return path === '/v1/face/window' ? { token: 'tok', expires: new Date(Date.now() + 3_600_000).toISOString() } : { ok: true }; } };
  const window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => 'k', deliver: (channel, value) => delivered.push([channel, value]) });
  await window.session();
  window.events({ seq: 1, events: [['work', { type: 'browser-open', session: 'c' }], ['work', { type: 'text', session: 'c' }]] });
  assert.deepEqual(delivered, [['work', { type: 'text', session: 'c' }]]);
  await window.answerBrowser({ id: 's1', result: PAGE });
  const answer = sent.find(request => request.path === '/v1/face/window/browser');
  assert.deepEqual(answer.body, { id: 's1', result: PAGE });
  assert.equal(answer.headers['X-Fairy-Window'], 'tok');
});

test('work tools ask the browser for its address, so a page opened by hand there can be used', async () => {
  const tools = new WorkTools({ root: process.cwd(), permission: 'auto', sandboxed: false, owner: 'c', approve: async () => 'allow',
    browser: { address: value => value, url: async () => 'https://example.com/', show: async () => PAGE } });
  tools.mayProceed = async () => {};
  const result = await tools.useBrowser({ action: 'read' });
  assert.match(JSON.stringify(result), /Example/);
});

test('the face builds its own pane in its window, routes steps to it, and turns from there use it on the other Mac', async () => {
  const face = await read('../desktop/face-main.cjs'), main = await read('../desktop/main.cjs');
  assert.match(face, /new BrowserPane\(\{ getWindow: \(\) => fullWin/);
  assert.match(face, /if \(type === 'browser-step'\) return void answerBrowserStep\(data\);/);
  assert.match(face, /fullWin\.on\('close', \(\) => \{[^\n]*if \(browserPane\) \{ browserPane\.close\(\);/);
  assert.match(main, /const fromFace = fromRemote\(\), browser = fromFace \? remoteBrowser : agentBrowser;/);
  // Never this Mac's screen for a turn from the face's window, until Desktop works on that Mac's own screen.
  assert.match(main, /computer: \(fromFace \? macbookComputer : workComputer\)\(/, 'the MacBook’s screen, never this Mac’s (remote-screen.mjs)');
  assert.match(main, /owner: id,[^\n]*browser, simulators/);
  assert.match(main, /browser\.release\(id\);/);
});

test('the desktop helper never acts on Fairy herself, by either of her app ids or as the app that started it', async () => {
  const swift = await read('../native/Desktop.swift');
  assert.match(swift, /let fairyBundles: Set<String> = \["dev\.razeen\.stella", "dev\.razeen\.lyra"\]/);
  assert.match(swift, /app\.processIdentifier == getppid\(\)/);
  assert.equal((swift.match(/!isFairy\(/g) || []).length, 4, 'the front app handed back, the context read and the focus check');
  assert.doesNotMatch(swift, /bundle != "dev\.razeen\.stella"/);
});
