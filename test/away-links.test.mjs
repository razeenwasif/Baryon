// Fairy away from the mini, Away 5: work sessions from the MacBook's window, and Fairy's window over a slow or dropped
// link, through a proxy that stalls and cuts the connection (test/helpers/flaky-proxy.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { connect as tlsConnect } from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, until } from './helpers/face-pair.mjs';
import { flakyProxy } from './helpers/flaky-proxy.mjs';
import { FaceClient } from '../desktop/face-client.mjs';
import { FaceLink } from '../desktop/face-link.mjs';
import { FaceStore } from '../desktop/face-store.mjs';
import { FaceWindow, LINK_DOWN_MESSAGE } from '../desktop/face-window.mjs';
import { isLong, kindOf, NEEDS_APPROVAL, READS, WINDOW_EVENTS } from '../desktop/remote-channels.mjs';
import { decode } from '../desktop/remote-codec.mjs';
import { tailscaleOffline } from '../desktop/presence.mjs';
import { applyLink, linkLine, watchLink } from '../src/remote-window.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const seal = text => `sealed:${Buffer.from(text).toString('hex')}`, unseal = text => Buffer.from(text.slice(7), 'hex').toString();

// A face paired with a full Fairy's link, connected through the flaky proxy, with Fairy's window on it.
async function throughProxy({ answer, limits = { plain: 400, bytes: 800, wait: 100 } }) {
  const s = await setup(async () => ({ text: '' }));
  s.face.call = answer;
  const dir = await mkdtemp(join(tmpdir(), 'fairy-away-links-'));
  const store = new FaceStore({ path: join(dir, 'face', 'face.json'), seal, unseal });
  await store.load();
  const pairing = new FaceClient({ store, resolve: () => '127.0.0.1' });
  await pairing.pair(s.link.pair({ kind: 'mac' }).url);
  pairing.stop();
  // The face still asks for the link's own address (its Host is checked there); only the connection goes by the proxy.
  const proxy = await flakyProxy(s.link.server.address().port);
  const statuses = [], delivered = [];
  let window = null;
  const client = new FaceClient({ store, resolve: () => '127.0.0.1', connect: options => tlsConnect({ ...options, port: proxy.port }), onState: state => window?.linkChanged(state) });
  window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => store.approveKey(), limits,
    status: value => statuses.push(value), deliver: (channel, value) => delivered.push([channel, value]) });
  client.start();
  await until(() => client.state() === 'connected');
  return { s, proxy, client, window, statuses, delivered,
    done: async () => { client.stop(); await proxy.close(); await s.done(); await rm(dir, { recursive: true, force: true }); } };
}

test('work sessions are the other Mac’s to run, validated safely against project folders; allowing a step asks for Touch ID', async () => {
  for (const channel of ['session-new-work', 'session-to-work', 'work-send', 'work-stop', 'work-answer', 'work-rewind', 'work-permission', 'work-isolate', 'session-message', 'side-proposal-start']) assert.equal(kindOf(channel), 'remote', channel);
  assert.equal(kindOf('mini-browse-dir'), 'local');
  assert.ok(READS.includes('session-directory'));
  assert.ok(NEEDS_APPROVAL['work-answer'](['q', 'allow']));
  assert.ok(!NEEDS_APPROVAL['work-answer'](['q', 'deny']));
  for (const event of ['work', 'promises']) assert.ok(WINDOW_EVENTS.includes(event), event);
  assert.equal(kindOf('work-folder-choose'), 'mini-only', 'the default work folder is still chosen on the other Mac');
  const main = await read('../desktop/main.cjs');
  // Fairy Scratch is the one other place: its own fixed folder, before remote folder validation.
  assert.match(main, /handle\('session-new-work', async wanted => \{\n[^\n]*\n[^\n]*\n\s+if \(wanted === 'scratch'\) \{\n[^\n]*\n[^\n]*\n\s+return showing\(\(\) => sessions\.createWork\(checkWorkFolder\(scratchRoot\(\), \{ dataDir \}\)\)\);\n\s+\}\n\s+if \(fromRemote\(\)\) \{\n\s+const asked = String\(wanted \?\? ''\);\n\s+const \{ validateRemoteWorkFolder \} = await import\('\.\/work-folders\.mjs'\);\n\s+return showing\(\(\) => sessions\.createWork\(validateRemoteWorkFolder\(asked, \{ dataDir \}\)\)\);/);
  assert.match(main, /remoteWorkFolders = workFolders;/);
  assert.match(main, /workFolders: remoteWorkFolders\(\) \} : result;/);
  assert.match(main, /approvals\.answer\(String\(id\), decision, via === 'window' && fromRemote\(\) \? 'face' : via\)/);
});

test('the folder for a work session is picked on the MacBook; closing the menu sends nothing', async () => {
  const sent = [];
  const client = { async call(method, path, options) { sent.push({ path, ...options }); return path === '/v1/face/window' ? { token: 't', expires: new Date(Date.now() + 3_600_000).toISOString() } : { result: { ok: true } }; } };
  let pick = null;
  const window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => 'k', choose: {
    'session-new-work': async () => pick,
    'session-to-work': async args => (pick ? [args?.[0] ?? null, pick[0]] : null),
  } });
  assert.equal(await window.call('session-new-work'), null);
  assert.equal(await window.call('session-to-work', ['chat-1']), null);
  assert.equal(sent.filter(item => item.path === '/v1/face/call').length, 0);
  pick = ['/Users/me/Projects/site'];
  assert.deepEqual(await window.call('session-new-work'), { ok: true });
  assert.deepEqual(sent.find(item => item.path === '/v1/face/call').body.args, ['/Users/me/Projects/site']);
  assert.deepEqual(await window.call('session-to-work', ['chat-1']), { ok: true });
  assert.deepEqual(sent.filter(item => item.path === '/v1/face/call').at(-1).body.args, ['chat-1', '/Users/me/Projects/site']);
  const face = await read('../desktop/face-main.cjs');
  // A scratch session or an absolute path picked in the Obsidian SSH modal passes straight through; otherwise popup fallback runs.
  assert.match(face, /'session-new-work': args => \(args\?\.\[0\] === 'scratch' \|\| \(typeof args\?\.\[0\] === 'string' && args\[0\]\.startsWith\('\/'\)\) \? args : chooseWorkFolder\(\)\)/);
  assert.match(face, /'session-to-work': async args => \{\s*if \(args\?\.\[1\] === 'scratch' \|\| \(typeof args\?\.\[1\] === 'string' && args\[1\]\.startsWith\('\/'\)\)\) return args;\s*const picked = await chooseWorkFolder\(\);\s*return picked \? \[args\?\.\[0\] \?\? null, picked\[0\]\] : null;\s*\}/);
  assert.match(face, /throw new Error\('Start your first work session on your other Mac; after that you can start one here in the same folder\.'\);/);
});

test('a call that stalls gives up at its limit and says so; after 2 seconds the page is told it’s waiting', async () => {
  const t = await throughProxy({ answer: async () => ({ chats: 1 }) });
  try {
    assert.deepEqual(await t.window.call('memory-state'), { chats: 1 });
    t.proxy.stall();
    const started = Date.now();
    await assert.rejects(t.window.call('memory-state'), /took too long/);
    assert.ok(Date.now() - started < 2000, 'gave up at its limit');
    assert.ok(t.statuses.some(value => value.waiting && !value.down), 'waiting was shown');
    assert.deepEqual(t.statuses.at(-1), { down: false, waiting: false }, 'and cleared');
    t.proxy.stall(false);
  } finally { await t.done(); }
});

test('a long call (a chat turn) shows no waiting line and isn’t cut short by the limit', () => {
  for (const channel of ['chat', 'work-send', 'notebook-ask', 'session-compact']) assert.ok(isLong(channel), channel);
  for (const channel of ['state', 'memory-state', 'session-open']) assert.ok(!isLong(channel), channel);
});

test('a cut during a reply: the window dims, new calls are refused at once, and on return the finished reply is shown', async () => {
  let finish, active = '';
  const turn = new Promise(resolve => { finish = resolve; });
  const t = await throughProxy({ answer: async channel => {
    if (channel === 'chat') { await turn; active = 'chat-1'; return { text: 'done' }; }
    if (channel === 'state') return { dataDir: '/x', sessions: { active, sessions: [{ id: 'chat-1' }] } };
    return null;
  } });
  try {
    await t.window.session();
    const replying = t.window.call('chat', ['hello', 'chat', [], 'r1']);
    await new Promise(resolve => setTimeout(resolve, 100));
    t.proxy.cut();
    await assert.rejects(replying, new RegExp(LINK_DOWN_MESSAGE.slice(0, 20)));
    await until(() => t.statuses.some(value => value.down));
    await assert.rejects(t.window.call('memory-state'), error => error.linkDown === true, 'refused at once while down');
    // The turn carries on at the other Mac and finishes there.
    finish();
    await new Promise(resolve => setTimeout(resolve, 50));
    t.proxy.pass();
    await until(() => t.client.state() === 'connected', 6000);
    await until(() => t.delivered.some(([channel, value]) => channel === 'session-show' && value === 'chat-1'), 4000);
    assert.ok(t.delivered.some(([channel]) => channel === 'sessions'));
    assert.deepEqual(t.statuses.at(-1), { down: false, waiting: false });
  } finally { await t.done(); }
});

test('a missed batch: the other Mac skips a number while the link is down, and the face fetches the state once', async () => {
  const face = new FaceLink({ ask: async () => ({ text: '' }) });
  const written = [];
  face.window = { token: 't', device: 'd', expires: Date.now() + 60_000, seq: 0, queue: [], timer: null };
  face.stream = { response: { write: chunk => written.push(chunk) } };
  face.windowEvent('reply', { text: 'a' });
  await until(() => written.length === 1);
  face.stream = null;
  face.windowEvent('reply', { text: 'lost' });
  face.windowEvent('reply', { text: 'lost too' });
  face.stream = { response: { write: chunk => written.push(chunk) } };
  face.windowEvent('reply', { text: 'b' });
  await until(() => written.length === 2);
  assert.match(written[0], /"seq":1/);
  assert.match(written[1], /"seq":3/, 'one number skipped for what was lost');

  const asked = [], delivered = [];
  const client = { async call(method, path, options) {
    if (path === '/v1/face/window') return { token: 't', expires: new Date(Date.now() + 3_600_000).toISOString() };
    asked.push(options.body.channel); return { result: { dataDir: '/x', sessions: { active: 'c1', sessions: [] } } };
  } };
  const window = new FaceWindow({ client, confirm: async () => {}, approveKey: () => 'k', deliver: (channel, value) => delivered.push([channel, value]) });
  await window.session();
  window.events({ seq: 1, events: [['reply', { text: 'a' }]] });
  window.events({ seq: 3, events: [['reply', { text: 'b' }]] });
  await until(() => delivered.some(([channel]) => channel === 'session-show'));
  assert.deepEqual(asked, ['state'], 'one refetch');
  assert.deepEqual(delivered.map(([channel]) => channel), ['reply', 'sessions', 'session-show'], 'the batch after the gap isn’t guessed at');
});

test('nothing typed is lost: while the link is down, Enter and the send button do nothing, and the line says why', () => {
  assert.equal(linkLine({ down: true }), 'Can’t reach your other Mac. Trying again…');
  assert.match(linkLine({ down: true, tailscale: true }), /^No connection to Tailscale\./);
  assert.equal(linkLine({ waiting: true }), 'Waiting for your other Mac…');
  assert.equal(linkLine({}), '');
  const classes = new Set(), listeners = {}, appended = [];
  const banner = { hidden: true, textContent: '', setAttribute() {} };
  const root = { documentElement: { classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) } },
    getElementById: () => (appended.length ? banner : null), createElement: () => banner, body: { append: node => appended.push(node) },
    addEventListener: (type, listener) => { listeners[type] = listener; } };
  let push;
  watchLink({ onRemoteLink: callback => { push = callback; return () => {}; } }, root);
  const press = (type, event) => { let held = false; listeners[type]({ ...event, preventDefault: () => { held = true; }, stopImmediatePropagation() {} }); return held; };
  const enter = { key: 'Enter', shiftKey: false, target: { id: 'message' } }, sendClick = { target: { closest: selector => (selector.includes('#send') ? {} : null) } };
  assert.equal(press('keydown', enter), false);
  push({ down: true, waiting: false });
  assert.ok(classes.has('remote-down'));
  assert.equal(banner.textContent, 'Can’t reach your other Mac. Trying again…');
  assert.equal(press('keydown', enter), true);
  assert.equal(press('click', sendClick), true);
  assert.equal(press('keydown', { ...enter, shiftKey: true }), false, 'a new line in the draft is still fine');
  push({ down: false, waiting: false });
  assert.ok(!classes.has('remote-down'));
  assert.equal(banner.hidden, true);
  assert.equal(press('keydown', enter), false);
  assert.equal(applyLink({ waiting: true }, root), 'Waiting for your other Mac…');
});

test('Tailscale without a connection is told apart from the other Mac being away', async () => {
  assert.equal(tailscaleOffline(JSON.stringify({ BackendState: 'Running', Self: { Online: true } })), false);
  assert.equal(tailscaleOffline(JSON.stringify({ BackendState: 'Running', Self: { Online: false } })), true);
  assert.equal(tailscaleOffline(JSON.stringify({ BackendState: 'Stopped' })), true);
  assert.equal(tailscaleOffline(JSON.stringify({ BackendState: 'NeedsLogin' })), true);
  assert.equal(tailscaleOffline('Tailscale is stopped.', 1), true);
  assert.equal(tailscaleOffline('', 1), false, 'unsure: the other Mac is named');
  const face = await read('../desktop/face-main.cjs');
  assert.match(face, /if \(faceWindow\) \{ if \(link !== 'connected' && fullWin\) void checkTailscale\(\)\.catch\(\(\) => \{\}\)\.then\(\(\) => faceWindow\.linkChanged\(link\)\); else faceWindow\.linkChanged\(link\); \}/);
  assert.match(face, /fullWin\.webContents\.send\('fairy:remote-link', \{ \.\.\.value, tailscale: value\.down && tailscaleDown \}\)/);
});

test('a terminal on the other Mac: opened with Touch ID (the window’s, if just given), typed in order, ended with the window session', async () => {
  for (const channel of ['terminal-start', 'terminal-write', 'terminal-resize', 'terminal-stop']) { assert.equal(kindOf(channel), 'remote', channel); assert.ok(READS.includes(channel), channel); }
  assert.ok(NEEDS_APPROVAL['terminal-start']([]));
  for (const event of ['terminal-data', 'terminal-exit']) assert.ok(WINDOW_EVENTS.includes(event), event);
  const sent = [], asked = [], delivered = [];
  let time = 0, release;
  const client = { async call(method, path, options) {
    if (path === '/v1/face/window') return { token: 't', expires: new Date(Date.now() + 3_600_000).toISOString() };
    if (path === '/v1/face/window/close') return { ok: true };
    const { channel, args } = options.body;
    sent.push([channel, decode(args), Boolean(options.body.approveKey)]);
    if (channel === 'terminal-start') return { result: { id: 'term-1', cwd: '/Users/me' } };
    if (channel === 'terminal-write' && sent.filter(([name]) => name === 'terminal-write').length === 1) await new Promise(resolve => { release = resolve; });
    return { result: null };
  } };
  const window = new FaceWindow({ client, confirm: async reason => asked.push(reason), approveKey: () => 'k', now: () => time, deliver: (channel, value) => delivered.push([channel, value]) });
  await window.session();
  assert.deepEqual(await window.call('terminal-start', [{ cols: 80, rows: 24 }]), { id: 'term-1', cwd: '/Users/me' });
  assert.deepEqual(asked, ['open Fairy’s window on this Mac'], 'the window’s Touch ID, moments ago, covers it');
  assert.equal(sent[0][2], true, 'with the approve key');
  time = 60_000;
  await window.call('terminal-start', [{}]);
  assert.deepEqual(asked.at(-1), 'open a terminal on your other Mac');
  // Typing: the first key goes at once, the rest wait for it and go together, in order.
  const first = window.call('terminal-write', ['term-1', 'l']);
  await new Promise(resolve => setTimeout(resolve, 10));
  window.call('terminal-write', ['term-1', 's']); const last = window.call('terminal-write', ['term-1', '\r']);
  release(); await first; await last;
  assert.deepEqual(sent.filter(([name]) => name === 'terminal-write').map(([, args]) => args), [['term-1', 'l'], ['term-1', 's\r']]);
  // The window session ends: the page is told its shells ended.
  await window.end();
  assert.deepEqual(delivered.filter(([channel]) => channel === 'terminal-exit').map(([, value]) => value.id).sort(), ['term-1']);
  const main = await read('../desktop/main.cjs');
  assert.match(main, /if \(fromRemote\(\)\) remoteTerminals\.add\(started\.id\);/);
  assert.match(main, /windowClosed: \(\) => \{ for \(const id of remoteTerminals\) terminals\?\.stop\(id\); remoteTerminals\.clear\(\); stopRemoteSimulator\(\); \},/);
});

test('the other Mac ends a window session’s terminals with it, and sends a busy shell’s output as one string per batch', async () => {
  let closed = 0;
  const face = new FaceLink({ ask: async () => ({ text: '' }), windowClosed: () => { closed++; } });
  const written = [];
  face.window = { token: 't', device: 'd', expires: Date.now() + 60_000, seq: 0, queue: [], timer: null };
  face.stream = { response: { write: chunk => written.push(chunk) } };
  for (const data of ['a', 'b', 'c']) face.windowEvent('terminal-data', { id: 'x', data });
  face.windowEvent('terminal-data', { id: 'y', data: 'z' });
  await until(() => written.length === 1);
  assert.match(written[0], /\["terminal-data",\{"id":"x","data":"abc"\}\],\["terminal-data",\{"id":"y","data":"z"\}\]/);
  face.closeWindow();
  assert.equal(closed, 1);
  face.closeWindow();
  assert.equal(closed, 1, 'only when there was one');
});

test('the window’s background can be switched from the MacBook (Velvet, or back to Aurora), and the terminal is see-through', async () => {
  assert.equal(kindOf('set-wallpaper'), 'remote');
  const main = await read('../desktop/main.cjs');
  const handler = main.slice(main.indexOf("handle('set-wallpaper'"), main.indexOf("handle('window-position'"));
  assert.doesNotMatch(handler, /dialog\.|shell\.|BrowserWindow|keys\./, 'it only saves the setting');
  const pane = await read('../src/terminal-pane.js'), css = await read('../src/workspace.css');
  assert.match(pane, /background: 'rgba\(0, 0, 0, 0\)'/);
  assert.match(pane, /allowTransparency: true/);
  assert.match(css, /\.terminal-host\{[^}]*background:transparent;/);
  const wallpaper = await read('../src/wallpaper.css');
  assert.match(wallpaper, /\n  #side-pane\{background:transparent;border-left-color:transparent\}/, 'the side panel and every pane in it are see-through');
});

test('the Simulator on the other Mac: its screen streamed here with fewer, smaller frames, only the newest per batch, none while the link is behind', async () => {
  for (const channel of ['simulator-state', 'simulator-boot', 'simulator-watch', 'simulator-touch', 'simulator-key', 'simulator-type', 'simulator-unwatch']) { assert.equal(kindOf(channel), 'remote', channel); assert.ok(READS.includes(channel), channel); }
  for (const channel of ['simulator-boot', 'simulator-watch']) assert.ok(isLong(channel), channel);
  assert.ok(!isLong('simulator-touch'), 'a tap is held to the ordinary limit');
  for (const event of ['simulator', 'simulator-frame']) assert.ok(WINDOW_EVENTS.includes(event), event);
  const main = await read('../desktop/main.cjs');
  // Smaller and slower unless this Mac's own window watches the same device; ending the face's watch leaves this Mac's.
  assert.match(main, /localSimulator === id \? \{\} : \{ fps: 15, maxWidth: 400 \}/);
  assert.match(main, /stopRemoteSimulator = \(\) => \{ const id = remoteSimulator; remoteSimulator = null; if \(id\) void \(localSimulator === id \? watchSimulator\(id\) : simulators\.unwatch\(id\)\)/);
  const face = new FaceLink({ ask: async () => ({ text: '' }) });
  const written = [];
  let backlog = 0;
  face.window = { token: 't', device: 'd', expires: Date.now() + 60_000, seq: 0, queue: [], timer: null };
  face.stream = { response: { write: chunk => written.push(chunk), get writableLength() { return backlog; } } };
  for (const n of [1, 2, 3]) face.windowEvent('simulator-frame', { udid: 'u', frame: `f${n}` });
  face.windowEvent('simulator', { current: 'u' });
  await until(() => written.length === 1);
  assert.doesNotMatch(written[0], /"f1"|"f2"/);
  assert.match(written[0], /\["simulator-frame",\{"udid":"u","frame":"f3"\}\],\["simulator",\{"current":"u"\}\]/);
  backlog = 1024 * 1024;
  face.windowEvent('simulator-frame', { udid: 'u', frame: 'f4' });
  face.windowEvent('simulator', { current: 'u' });
  await until(() => written.length === 2);
  assert.doesNotMatch(written[1], /f4/, 'a frame is skipped while the link is behind');
  assert.match(written[1], /"simulator"/, 'other events still go');
  const pane = await read('../src/remote-window.js');
  assert.doesNotMatch(pane, /data-pane="simulator"/, 'the Simulator pane isn’t dimmed on the MacBook');
});
