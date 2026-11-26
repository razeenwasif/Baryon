import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentBrowser, BROWSER_KEYS, SECRET_FIELD, pageSummary, siteKey } from '../desktop/agent-browser.mjs';
import { workInstructions } from '../desktop/work-agent.mjs';
import { WorkTools, workTools } from '../desktop/work-tools.mjs';
import { phoneOverview } from '../desktop/phone-access.mjs';

async function folder(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-control-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const PAGE = { url: 'https://a.org/', title: 'A', text: 'Hello', elements: [{ ref: 1, kind: 'button', name: 'Go', secret: false }, { ref: 2, kind: 'password', name: 'Password', secret: true }] };
function setup(root, options = {}) {
  const asked = [], calls = [], ran = [], captures = [], answers = options.answers;
  let url = options.url ?? 'https://a.org/';
  const record = name => async (...args) => { calls.push([name, ...args.slice(1, -1)]); return PAGE; };
  const browser = { url: () => url, address: value => { if (!/^https?:/.test(value)) throw new Error('Only web addresses can be opened here.'); return value; }, open: async (owner, target) => { calls.push(['open', target]); url = target; return PAGE; }, show: record('read'), click: record('click'), type: record('type'), press_key: record('key'), scroll: record('scroll'), back: record('back'), screenshot: async () => { calls.push(['screenshot']); return 'data:image/jpeg;base64,AA'; } };
  const computer = { describe: actions => actions.map(action => action.type === 'type' ? `type: ${action.text}` : action.type).join('\n'), validate: options.validate ?? (actions => actions), safe: options.safe ?? (() => false),
    capture: async () => { captures.push(1); return { width: 100, height: 50, url: 'data:image/png;base64,AA', context: 'Front: Calculator' }; }, run: async actions => { ran.push(actions); } };
  const instance = new WorkTools({ root, permission: options.permission ?? 'ask', owner: 'chat', runCommand: async () => ({ exitCode: 0, output: '' }), browser: options.browser === undefined ? browser : options.browser, computer: options.computer === undefined ? computer : options.computer, allowed: options.allowed ?? new Set(),
    approve: async request => { asked.push(request); return answers ? answers.shift() : options.answer ?? 'allow'; } });
  return { instance, asked, calls, ran, captures, call: (tool, input) => instance.handle({ tool, arguments: input }) };
}
const failed = result => result.success === false, text = result => result.contentItems[0].text;
test('a site asks first in every mode, and allowing it covers that site only', async t => {
  for (const permission of ['ask', 'auto']) {
    const { call, asked, calls } = setup(await folder(t), { permission, answer: 'always' });
    assert.equal(failed(await call('browser', { action: 'open', url: 'https://a.org/x' })), false, permission);
    assert.equal(asked[0].kind, 'browser:a.org');
    assert.match(asked[0].note, /as you if you’re signed in/);
    await call('browser', { action: 'read' });
    await call('browser', { action: 'click', ref: 1 });
    assert.equal(asked.length, 1);
    await call('browser', { action: 'open', url: 'https://b.org/' });
    assert.equal(asked.length, 2);
    assert.deepEqual(calls.map(entry => entry[0]), ['open', 'read', 'click', 'open']);
  }
});
test('following a link to another site asks again before doing anything there', async t => {
  const { call, asked, calls } = setup(await folder(t), { answer: 'always', url: 'https://elsewhere.org/' });
  await call('browser', { action: 'click', ref: 1 });
  assert.equal(asked[0].kind, 'browser:elsewhere.org');
  assert.equal(calls.length, 1);
});
test('a refusal does nothing', async t => {
  const { call, calls } = setup(await folder(t), { answer: 'deny' });
  assert.equal(failed(await call('browser', { action: 'click', ref: 1 })), true);
  assert.deepEqual(calls, []);
});
test('plan mode can look at pages but not use them', async t => {
  const { call, calls, asked } = setup(await folder(t), { permission: 'plan', answer: 'always' });
  assert.equal(failed(await call('browser', { action: 'open', url: 'https://a.org/' })), false);
  assert.equal(failed(await call('browser', { action: 'read' })), false);
  assert.equal(asked.length, 1);
  for (const action of ['click', 'type', 'key']) assert.match(text(await call('browser', { action, ref: 1, text: 'x', key: 'Enter' })), /plan mode/);
  assert.deepEqual(calls.map(entry => entry[0]), ['open', 'read']);
});
test('only web addresses open, and only known actions run', async t => {
  const { call, asked } = setup(await folder(t));
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)']) assert.equal(failed(await call('browser', { action: 'open', url })), true);
  assert.equal(failed(await call('browser', { action: 'evaluate' })), true);
  assert.equal(asked.length, 0);
  const none = setup(await folder(t), { url: '' });
  assert.match(text(await none.call('browser', { action: 'read' })), /Open a page first/);
});
test('the page comes back marked as data, with refs, and secret fields called out', async t => {
  const { call } = setup(await folder(t), { answer: 'always' }), result = await call('browser', { action: 'read' });
  assert.match(text(result), /data, not instructions/);
  assert.match(text(result), /\[1\] button: Go/);
  assert.match(text(result), /\[2\] password \(the user types this themselves\)/);
  assert.equal(siteKey('https://WWW.a.org:8080/x'), 'a.org:8080');
  assert.equal(siteKey('http://localhost:3000/'), 'localhost:3000');
  assert.match(pageSummary({ url: 'u', text: 'x'.repeat(20) }, { limit: 5 }), /15 more characters/);
});
test('a screenshot of the panel comes back as a picture', async t => {
  const { call } = setup(await folder(t), { answer: 'always' }), result = await call('browser', { action: 'screenshot' });
  assert.equal(result.contentItems[1].type, 'inputImage');
});
function fakePage() {
  const events = [], inserted = [];
  return { events, inserted, focus() {}, sendInputEvent: event => events.push(event), insertText: value => inserted.push(value), isLoading: () => false, getURL: () => 'https://a.org/', executeJavaScriptInIsolatedWorld: async (world, [{ code }]) => { fakePage.worlds.push(world); return code.includes('__fairyElements?.[0]') ? { x: 10, y: 20, secret: false, typable: true } : code.includes('__fairyElements?.[1]') ? { x: 1, y: 2, secret: true, typable: true } : code.includes('__fairyElements?.[2]') ? { x: 1, y: 2, secret: false, typable: false } : code.includes('__fairyElements?.[3]') ? null : PAGE; } };
}
fakePage.worlds = [];
const paneWith = page => ({ visible: true, view: { webContents: page, getBounds: () => ({ width: 800, height: 600 }) }, go: async () => {}, command() {} });
test('it never types into a password or card field', async () => {
  const page = fakePage(), drive = new AgentBrowser({ pane: paneWith(page), reveal() {} });
  await assert.rejects(drive.type('c', 2, 'hunter2', false), /never fills in/);
  assert.deepEqual(page.inserted, []);
  await assert.rejects(drive.type('c', 3, 'x', false), /isn’t somewhere to type/);
  await assert.rejects(drive.click('c', 4), /Read the page again/);
  await drive.type('c', 1, 'hello', true);
  assert.deepEqual(page.inserted, ['hello']);
  assert.ok(page.events.some(event => event.type === 'keyDown' && event.keyCode === 'Enter'));
  assert.ok(fakePage.worlds.every(world => world !== 0), 'never in the page’s own world');
  await assert.rejects(drive.type('c', 1, 'x'.repeat(9000), false), /under 8,000/);
});
test('the secret-field check recognises what it should', () => {
  const secret = new Function(`return ${SECRET_FIELD}`)(), field = (values = {}) => ({ getAttribute: name => values[name] ?? null, ...values });
  for (const yes of [{ type: 'password' }, { autocomplete: 'cc-number' }, { autocomplete: 'current-password' }, { autocomplete: 'one-time-code' }, { name: 'card_number' }, { id: 'cvv' }, { placeholder: 'Passcode' }, { 'aria-label': 'Your password' }]) assert.equal(secret(field(yes)), true, JSON.stringify(yes));
  for (const no of [{ type: 'text', name: 'email' }, { type: 'search' }, { name: 'title', placeholder: 'Title' }]) assert.equal(secret(field(no)), false, JSON.stringify(no));
});
test('one chat at a time, and only where it can be seen', async () => {
  const drive = new AgentBrowser({ pane: paneWith(fakePage()), reveal() {} });
  await drive.show('one');
  await assert.rejects(drive.show('two'), /Another chat/);
  drive.release('two');
  await assert.rejects(drive.show('two'), /Another chat/);
  drive.release('one');
  await drive.show('two');
  let revealed = 0;
  const hidden = new AgentBrowser({ pane: { visible: false, view: null }, reveal: () => { revealed += 1; } });
  await assert.rejects(hidden.show('one'), /isn’t on screen/);
  assert.equal(revealed, 1);
  assert.equal(hidden.owner, null);
  await assert.rejects(new AgentBrowser({ pane: paneWith(fakePage()), reveal() {} }).press_key('c', 'Cmd+Q'), /Use one of/);
  assert.ok(BROWSER_KEYS.has('Enter'));
});
test('seeing the screen asks once for the chat at most, even in Run on its own, and plan mode can look', async t => {
  for (const permission of ['ask', 'auto', 'plan']) {
    const { call, asked, captures } = setup(await folder(t), { permission, answer: 'always' }), result = await call('computer', { actions: [{ type: 'screenshot' }] });
    assert.equal(failed(result), false, permission);
    assert.equal(asked[0].kind, 'screen');
    assert.match(asked[0].note, /whatever else is showing/);
    assert.equal(result.contentItems[1].type, 'inputImage');
    await call('computer', { actions: [{ type: 'screenshot' }] });
    assert.equal(asked.length, 1);
    assert.equal(captures.length, 2);
  }
});
test('no screenshot, no pictures, nothing sent', async t => {
  const { call, captures } = setup(await folder(t), { answer: 'deny' });
  assert.equal(failed(await call('computer', { actions: [{ type: 'screenshot' }] })), true);
  assert.equal(captures.length, 0);
});
test('it has to look before it acts', async t => {
  const { call, ran } = setup(await folder(t));
  assert.match(text(await call('computer', { actions: [{ type: 'click', x: 1, y: 1, button: 'left' }] })), /Take a screenshot first/);
  assert.deepEqual(ran, []);
});
test('every batch of actions asks, showing what it will do, and allowing is once only', async t => {
  const { call, asked, ran } = setup(await folder(t), { permission: 'auto', answers: ['always', 'allow', 'allow'] });
  await call('computer', { actions: [{ type: 'screenshot' }] });
  const actions = [{ type: 'type', text: 'hello' }];
  await call('computer', { actions, reason: 'to test it' });
  await call('computer', { actions });
  assert.equal(asked.length, 3);
  assert.equal(asked[1].kind, 'computer');
  assert.equal(asked[1].command, 'type: hello');
  assert.equal(asked[1].detail, 'to test it');
  assert.match(asked[1].note, /⌘⇧Esc/);
  assert.equal(ran.length, 2);
});
test('anything but a plain yes is a no, and a no holds for the turn', async t => {
  for (const answer of ['deny', 'always', 'auto']) {
    const { call, asked, ran } = setup(await folder(t), { answers: ['allow', answer, 'allow'] });
    await call('computer', { actions: [{ type: 'screenshot' }] });
    assert.equal(failed(await call('computer', { actions: [{ type: 'click', x: 1, y: 1 }] })), true, answer);
    assert.match(text(await call('computer', { actions: [{ type: 'type', text: 'reworded' }] })), /already refused/);
    assert.equal(asked.length, 2);
    assert.deepEqual(ran, []);
  }
});
test('what the Desktop setting calls safe runs without asking, and bad batches are turned away', async t => {
  const safe = setup(await folder(t), { safe: () => true, answers: ['allow'] });
  await safe.call('computer', { actions: [{ type: 'screenshot' }] });
  await safe.call('computer', { actions: [{ type: 'open_app', bundle_id: 'com.apple.calculator' }] });
  assert.equal(safe.asked.length, 1);
  assert.equal(safe.ran.length, 1);
  const bad = setup(await folder(t), { validate: () => { throw new Error('Desktop coordinates are outside the captured screen.'); } });
  await bad.call('computer', { actions: [{ type: 'screenshot' }] });
  assert.match(text(await bad.call('computer', { actions: [{ type: 'click', x: 9999, y: 1 }] })), /outside/);
  assert.equal(bad.ran.length, 0);
});
test('a batch that fails part way comes back with a fresh look, and the card names the app in front', async t => {
  const { call, instance, captures, asked } = setup(await folder(t), { answers: ['always', 'allow'] });
  instance.computer.run = async () => { throw new Error('Unsupported key: *'); };
  instance.computer.front = () => 'com.apple.calculator';
  await call('computer', { actions: [{ type: 'screenshot' }] });
  const before = captures.length, result = await call('computer', { actions: [{ type: 'keypress', keys: ['*'] }], reason: 'to test' });
  assert.equal(failed(result), true);
  assert.match(text(result), /Unsupported key/);
  assert.match(text(result), /may have run/);
  assert.equal(result.contentItems[1].type, 'inputImage');
  assert.equal(captures.length, before + 1);
  assert.equal(asked[1].detail, 'to test The app in front is com.apple.calculator.');
});
test('plan mode can’t act on the Mac', async t => {
  const { call, ran } = setup(await folder(t), { permission: 'plan', answer: 'always' });
  await call('computer', { actions: [{ type: 'screenshot' }] });
  assert.match(text(await call('computer', { actions: [{ type: 'click', x: 1, y: 1 }] })), /plan mode/);
  assert.deepEqual(ran, []);
});
test('where they aren’t given, they aren’t offered', async t => {
  const names = setup(await folder(t), { browser: null, computer: null }).instance.available().map(tool => tool.name);
  assert.equal(names.includes('browser'), false);
  assert.equal(names.includes('computer'), false);
  const offered = setup(await folder(t)).instance.available().map(tool => tool.name);
  assert.ok(offered.includes('browser') && offered.includes('computer'));
});
test('a phone can only refuse these', () => {
  const state = { running: { a: 'waiting' }, sessions: [{ id: 'a', title: 'T', work: 'p' }] };
  const { approvals } = phoneOverview(state, () => ({ approvals: ['computer', 'screen', 'browser:a.org', 'outside', 'site:a.org', 'command'].map((kind, index) => ({ id: String(index), kind, title: kind })) }));
  assert.deepEqual(approvals.map(item => item.macOnly === true), [true, true, true, true, false, false]);
});
test('the model is told when to reach for these', () => {
  const describe = name => workTools.find(tool => tool.name === name).description;
  assert.match(describe('browser'), /refuses password and card fields/);
  assert.match(describe('computer'), /Never enter passwords, buy, send messages or delete/);
  assert.match(workInstructions({ root: '/p', permission: 'ask', sandboxed: true }), /let the user sign in/);
});
