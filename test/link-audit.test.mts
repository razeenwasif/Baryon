// The link security audit's fixes (findings 3 to 13 of the Fairy link security plan), one test or more per fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import type { AddressInfo } from 'node:net';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
import { call, events, NAME, setup, until, type FacePairSetup } from './helpers/face-pair.mjs';
import { FaceClient, IDLE_MS } from '../desktop/face-client.mjs';
import { HOLD_MS, shownError } from '../desktop/face-link.mjs';
import { FaceWindow, WORK_MS } from '../desktop/face-window.mjs';
import { NEEDS_APPROVAL } from '../desktop/remote-channels.mjs';
import { decode, encode, MAX_DEPTH } from '../desktop/remote-codec.mjs';
import { runDesktopStep } from '../desktop/remote-screen.mjs';
import { REMOTE_APP, checkBuild } from '../scripts/fairy-to-mini.mjs';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const pinOf = (link: FacePairSetup['link']) => new URL(link.pair({ kind: 'mac' }).url).searchParams.get('pin')!;
const opened = async (s: FacePairSetup) => (await call(s.link, '/v1/face/window', { method: 'POST', key: s.key, body: { approveKey: s.approveKey } })).json.token as string;
const windowCall = (s: FacePairSetup, token: string, body: unknown, headers: Record<string, string> = {}) => call(s.link, '/v1/face/call', { method: 'POST', key: s.key, body, headers: { 'X-Fairy-Window': token, ...headers } });

// Finding 4: the link marked unreachable while connected.
function strandedClient() {
  const asked: Array<{ resolve: (value: any) => void; reject: (err: any) => void } | null> = [];
  const client = new FaceClient({ store: { pairing: () => ({ host: NAME, port: 1, pin: 'a'.repeat(64) }), readKey: () => 'key' } as any });
  client.call = (() => new Promise((resolve, reject) => asked.push({ resolve, reject }))) as any;
  const stream = () => Object.assign(new EventEmitter(), { statusCode: 200, destroyed: false, setEncoding() {}, destroy() { this.destroyed = true; }, resume() {} });
  return { client, asked, stream };
}
test('finding 4: one connection attempt at a time, and a failed attempt never marks a live link', async () => {
  const { client, asked, stream } = strandedClient();
  try {
    client.start();
    assert.equal(asked.length, 1);
    // The Mac woke and the screen unlocked together: neither starts a second attempt.
    client.retryNow(); client.retryNow(); void client.connectStream();
    assert.equal(asked.length, 1, 'still one attempt');
    asked[0]!.resolve(stream());
    await until(() => client.state() === 'connected');
    client.later();
    assert.equal(client.state(), 'connected', 'a late failure changes nothing');
    assert.equal(client.retryTimer, null);
  } finally { client.stop(); }
});
test('finding 4: an attempt from before a stop is dropped when it lands', async () => {
  const { client, asked, stream } = strandedClient();
  try {
    client.start(); client.stop(); client.start();
    assert.equal(asked.length, 2);
    const old = stream();
    asked[0]!.resolve(old);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(old.destroyed, true);
    assert.notEqual(client.state(), 'connected');
    asked[0] = null; asked[1]!.reject(Object.assign(new Error('no'), { code: 'ECONNREFUSED' }));
    await until(() => client.state() === 'unreachable');
  } finally { client.stop(); }
});

// Findings 10 and 11: a connection per call, and TLS 1.2.
test('finding 10: calls share a checked connection, an idle one is closed, and a wrong pin still gets nothing', async () => {
  const s = await setup(async () => ({ text: '' }));
  let connections = 0, requests = 0;
  s.link.server!.on('secureConnection', () => { connections += 1; });
  s.link.server!.on('request', () => { requests += 1; });
  const port = (s.link.server!.address() as AddressInfo).port, pin = pinOf(s.link);
  // The idle limit, shortened for the test.
  const timers = { setTimeout: (run: (...args: any[]) => void, ms?: number) => setTimeout(run, ms === IDLE_MS ? 60 : ms), clearTimeout, setInterval, clearInterval } as any;
  const client = new FaceClient({ store: { pairing: () => ({ host: NAME, port, pin }), readKey: () => s.key } as any, resolve: () => '127.0.0.1', timers });
  client.key = s.key;
  try {
    for (let i = 0; i < 3; i++) assert.deepEqual((await client.history()).history, []);
    assert.equal(connections, 1, 'three calls, one connection');
    await new Promise(resolve => setTimeout(resolve, 200));
    await client.history();
    assert.equal(connections, 2, 'an idle connection was closed, so the next call made a new one');
    const before = requests;
    const wrong = new FaceClient({ store: { pairing: () => ({ host: NAME, port, pin: 'b'.repeat(64) }), readKey: () => s.key } as any, resolve: () => '127.0.0.1', timers });
    wrong.key = s.key;
    await assert.rejects(wrong.history(), (error: any) => error.code === 'PIN');
    assert.equal(requests, before, 'no request reached the other Mac');
    wrong.closeKept();
  } finally { client.stop(); await s.done(); }
});
test('finding 11: the link refuses TLS 1.2', async () => {
  const s = await setup(async () => ({ text: '' }));
  try {
    const port = (s.link.server!.address() as AddressInfo).port;
    const outcome = await new Promise<string>(resolve => {
      const socket = tlsConnect({ host: '127.0.0.1', port, servername: NAME, rejectUnauthorized: false, maxVersion: 'TLSv1.2' });
      socket.once('secureConnect', () => { socket.destroy(); resolve('connected'); });
      socket.once('error', () => resolve('refused'));
    });
    assert.equal(outcome, 'refused');
  } finally { await s.done(); }
});

// Finding 7: built for one laptop.
test('finding 7: a second Mac can’t knock the first off, stop its turn or hear its voice; it takes over once the first has gone quiet', async () => {
  let release!: (value: { text: string }) => void;
  const s = await setup(() => new Promise(resolve => { release = resolve; }));
  s.face.call = async () => null;
  try {
    const { url } = s.link.pair({ kind: 'mac' });
    const second = (await call(s.link, '/v1/pair', { method: 'POST', body: { code: new URL(url).searchParams.get('code'), name: 'Other Mac', kind: 'mac' } })).json;
    const first = events(s.link, s.key);
    await until(() => first.some(event => event.type === 'hello'));
    assert.equal((await call(s.link, '/v1/face/events', { key: second.readKey })).status, 409, 'the second Mac’s stream is refused');
    assert.ok(s.face.connected(), 'the first is still connected');
    const { turn } = (await call(s.link, '/v1/face/ask', { method: 'POST', key: s.key, body: { text: 'hello' } })).json;
    assert.equal((await call(s.link, '/v1/face/ask', { method: 'POST', key: second.readKey, body: { text: 'me too' } })).status, 409);
    assert.equal((await call(s.link, '/v1/face/window', { method: 'POST', key: second.readKey, body: { approveKey: second.approveKey } })).status, 409);
    await call(s.link, '/v1/face/stop', { method: 'POST', key: second.readKey, body: {} });
    assert.equal(s.face.turn!.running, true, 'the first Mac’s turn wasn’t stopped by the second');
    s.face.turn!.parts.push({ bytes: Buffer.from('clip'), pauseBeforeMs: 0 });
    assert.equal((await call(s.link, `/v1/face/voice?turn=${turn}&part=0`, { key: second.readKey })).status, 404, 'nor is its voice the second’s to fetch');
    assert.equal((await call(s.link, `/v1/face/voice?turn=${turn}&part=0`, { key: s.key })).status, 200);
    release({ text: 'done' });
    // The first Mac goes quiet (asleep, or off the network): after HOLD_MS the second may take over.
    const realNow = s.face.now; s.face.now = () => realNow() + HOLD_MS + 1;
    const later = events(s.link, second.readKey);
    await until(() => later.some(event => event.type === 'hello'));
    assert.equal(s.face.stream!.device, second.device);
    first.stop(); later.stop();
  } finally { await s.done(); }
});

// Finding 12: small things on the mini's side.
test('finding 12: a big body must name a channel that carries bytes before it’s read, and can’t name one and send another', async () => {
  const s = await setup(async () => ({ text: '' }));
  let ran = 0;
  s.face.call = async () => { ran += 1; return 'ran'; };
  try {
    const token = await opened(s), big = encode(['a.txt', Buffer.alloc(2 * 1024 * 1024)]);
    // Refused before the body is read, so the request may end as a refusal or as a closed connection (0).
    const unread = async (headers: Record<string, string>) => { const { status } = await windowCall(s, token, { channel: 'attach-bytes', args: big }, headers); return status === 413 || status === 0; };
    assert.ok(await unread({ 'X-Fairy-Bytes': '1' }), 'no channel named');
    assert.ok(await unread({ 'X-Fairy-Bytes': '1', 'X-Fairy-Channel': 'state' }), 'a channel that carries none');
    assert.equal(ran, 0, 'neither ran');
    assert.equal((await windowCall(s, token, { channel: 'notebook-paste', args: big }, { 'X-Fairy-Bytes': '1', 'X-Fairy-Channel': 'attach-bytes' })).status, 413, 'named one, sent another');
    assert.equal((await windowCall(s, token, { channel: 'attach-bytes', args: big }, { 'X-Fairy-Bytes': '1', 'X-Fairy-Channel': 'attach-bytes' })).json.result, 'ran');
  } finally { await s.done(); }
});
test('finding 12: values nest 64 deep at most, in a call and in the codec', async () => {
  let deep: any = 'x';
  for (let i = 0; i < MAX_DEPTH + 5; i++) deep = [deep];
  assert.throws(() => encode(deep), /nested/);
  assert.throws(() => decode(deep), /nested/);
  let fine: any = 'x';
  for (let i = 0; i < 20; i++) fine = { a: [fine] };
  assert.deepEqual(decode(encode(fine)), fine);
  const s = await setup(async () => ({ text: '' }));
  let ran = 0;
  s.face.call = async () => { ran += 1; };
  try {
    const answered = await windowCall(s, await opened(s), { channel: 'state', args: [deep] });
    assert.equal(answered.status, 400);
    assert.equal(ran, 0);
  } finally { await s.done(); }
});
test('finding 12: a failed call says her own message with the home folder shortened, and a system error says nothing of this Mac', async () => {
  const home = homedir();
  assert.equal(shownError(new Error('That chat is gone.')), 'That chat is gone.');
  assert.equal(shownError(new Error(`Couldn’t read ${home}/Notes/a.md.`)), 'Couldn’t read ~/Notes/a.md.');
  const system = Object.assign(new Error(`ENOENT: no such file or directory, open '${home}/.ssh/id_ed25519'`), { code: 'ENOENT', errno: -2, syscall: 'open' });
  assert.equal(shownError(system), 'Fairy couldn’t do that on your other Mac.');
  const s = await setup(async () => ({ text: '' }));
  s.face.call = async () => { throw system; };
  try { assert.deepEqual((await windowCall(s, await opened(s), { channel: 'state', args: [] })).json, { error: 'Fairy couldn’t do that on your other Mac.' }); }
  finally { await s.done(); }
});

// Finding 9: running without asking, and deleting, from the MacBook's window.
test('finding 9: setting work to run without asking, and deleting memory or chats, need the approve key', async () => {
  assert.equal(NEEDS_APPROVAL['work-permission'](['auto']), true);
  assert.equal(NEEDS_APPROVAL['work-permission'](['ask']), false);
  assert.equal(NEEDS_APPROVAL['work-permission'](['plan']), false);
  const s = await setup(async () => ({ text: '' }));
  const ran: any[] = [];
  s.face.call = async (channel, args) => { ran.push([channel, ...args]); return 'ok'; };
  try {
    const token = await opened(s);
    for (const [channel, args] of [['work-permission', ['auto']], ['memory-clear', []], ['clear-memory', []], ['session-remove', ['chat-1']], ['sessions-remove', [['chat-1']]]] as Array<[string, any[]]>) {
      assert.equal((await windowCall(s, token, { channel, args })).status, 403, `${channel} without Touch ID`);
      assert.equal((await windowCall(s, token, { channel, args, approveKey: s.key })).status, 403, `${channel} with the read key`);
    }
    assert.equal(ran.length, 0);
    assert.equal((await windowCall(s, token, { channel: 'work-permission', args: ['ask'] })).json.result, 'ok', 'back to asking needs none');
    assert.equal((await windowCall(s, token, { channel: 'memory-clear', args: [], approveKey: s.approveKey })).json.result, 'ok');
  } finally { await s.done(); }
});

// A stand-in for the face's client, as in face-window.test.mjs.
function fakeClient(answer: (req: { method: string; path: string; [key: string]: any }) => any = () => ({ result: null })) {
  const sent: any[] = [];
  let tokens = 0;
  return { sent, async call(method: string, path: string, options: Record<string, any> = {}) {
    sent.push({ method, path, ...options });
    if (path === '/v1/face/window') return { token: `t${++tokens}`, expires: new Date(Date.now() + 3_600_000).toISOString() };
    if (path === '/v1/face/window/close') return { ok: true };
    return answer({ method, path, ...options });
  } };
}
test('finding 9: the MacBook asks for Touch ID for each of them, in words that say what', async () => {
  const asked: string[] = [], client = fakeClient();
  const window = new FaceWindow({ client: client as any, confirm: async reason => { asked.push(reason); }, approveKey: () => 'approve-key' });
  await window.call('work-permission', ['ask']);
  await window.call('work-permission', ['auto']);
  await window.call('memory-clear', []);
  await window.call('session-remove', ['chat-1']);
  assert.deepEqual(asked, ['open Fairy’s window on this Mac', 'let this work session run without asking', 'delete everything Fairy remembers', 'delete a chat']);
  const calls = client.sent.filter(request => request.path === '/v1/face/call');
  assert.deepEqual(calls.map(request => request.body.approveKey), [undefined, 'approve-key', 'approve-key', 'approve-key']);
  assert.equal(calls[0].headers['X-Fairy-Channel'], 'work-permission', 'each call names its channel in a header');
});

// Finding 5: old content after the screen locks.
test('finding 5: a later window session fetches the state afresh; the first doesn’t', async () => {
  const delivered: Array<[string, unknown]> = [];
  const client = fakeClient(({ body }) => (body.channel === 'state' ? { result: { sessions: { active: 'chat-2', list: [] } } } : { result: null }));
  const window = new FaceWindow({ client: client as any, confirm: async () => {}, approveKey: () => 'k', deliver: (channel, value) => delivered.push([channel, value]) });
  await window.call('session-rename', ['chat', 'name']);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(delivered, [], 'the first session: the page loads its own state');
  await window.end();
  // The Mac was locked; her events meanwhile weren't passed on. The next call opens a new session.
  await window.call('session-rename', ['chat', 'name']);
  await until(() => delivered.length === 2);
  assert.deepEqual(delivered, [['sessions', { active: 'chat-2', list: [] }], ['session-show', 'chat-2']]);
});

// Finding 12: any Touch ID covered a terminal for 15 seconds.
test('finding 12: only the Touch ID that opened the window covers a terminal, not one that allowed a step', async () => {
  let now = 1_000_000;
  const asked: string[] = [], client = fakeClient(({ body }) => (body.channel === 'terminal-start' ? { result: { id: 'term-1' } } : { result: null }));
  const window = new FaceWindow({ client: client as any, confirm: async reason => { asked.push(reason); }, approveKey: () => 'k', now: () => now });
  await window.session();
  await window.call('terminal-start', []);
  assert.deepEqual(asked, ['open Fairy’s window on this Mac'], 'just opened: the same Touch ID');
  now += 60_000;
  await window.call('approval-answer', ['a1', 'allow']);
  await window.call('terminal-start', []);
  assert.deepEqual(asked.slice(1), ['allow a step Fairy asked about', 'open a terminal on your other Mac'], 'allowing a step doesn’t cover a terminal');
});

// Finding 3: the MacBook does what the mini says without checking for itself.
test('finding 3: the window is acting only while a turn asked from it runs, or after work was started from it', async () => {
  let finish: (() => void) | undefined;
  const client = fakeClient(({ body }) => (body.channel === 'chat' ? new Promise(resolve => { finish = () => resolve({ result: { text: 'hi' } }); }) : { result: null }));
  const window = new FaceWindow({ client: client as any, confirm: async () => {}, approveKey: () => 'k' });
  assert.equal(window.acting(), false, 'no session yet');
  await window.call('state', []);
  assert.equal(window.acting(), false, 'a window that’s only open');
  const turn = window.call('chat', ['hello', 'chat']);
  await until(() => finish);
  assert.equal(window.acting(), true, 'while its turn runs');
  finish!(); await turn;
  assert.equal(window.acting(), false, 'and not after');
  await window.call('work-send', ['fix it']);
  assert.equal(window.acting(), true, 'work carries on after its call returns');
  await window.end();
  assert.equal(window.acting(), false, 'not while the session is ended (lock, sleep, close)');
  await window.session();
  assert.equal(window.acting(), true, 'the same work, once Touch ID has opened the next session');
  const realNow = window.now; window.now = () => realNow() + WORK_MS + 1;
  assert.equal(window.acting(), false, 'and for two hours at most');
});
test('finding 3: a batch of actions runs only once this Mac has allowed it itself', async () => {
  const ran: any[] = [], shot = { url: 'data:image/png;base64,AAAA', width: 100, height: 50, bounds: { x: 0, y: 0, width: 100, height: 50 } };
  let allow = false;
  const deps = { capture: async () => shot, helper: async (payload: any) => { if (payload.actions) ran.push(payload.actions); return '{}'; },
    allowRun: async ({ count }: { count: number }) => { if (!allow) throw new Error(`That wasn’t allowed on your MacBook (${count}).`); } };
  const last = { shot: null }, batch = { actions: [{ type: 'click', button: 'left', x: 10, y: 10 }], width: 100, height: 50, bounds: shot.bounds };
  await runDesktopStep({ tool: 'capture', args: { focus: false } }, deps as any, { last });
  await assert.rejects(runDesktopStep({ tool: 'run', args: batch }, deps as any, { last }), /wasn’t allowed on your MacBook \(1\)/);
  assert.equal(ran.length, 0, 'nothing was pressed');
  allow = true;
  assert.deepEqual(await runDesktopStep({ tool: 'run', args: batch }, deps as any, { last }), { ok: true });
  assert.equal(ran.length, 1);
});
test('finding 3: the face checks the switch, the lock, its own Touch ID and its own turn before a step (face-main.cjs)', async () => {
  const face = await read('../desktop/face-main.cts');
  const deps = face.slice(face.indexOf('function desktopDeps()'), face.indexOf('async function answerPicture'));
  // "Let Fairy see this screen" governs a Desktop task's pictures too.
  assert.match(deps, /check: async \(?signal(?:: [^)]+)?\)? => \{[^}]*?if \(!store!?\.state\(\)\.screen\) throw new Error\(SCREEN_OFF\);/s);
  assert.match(deps, /capture: async \(\{ fit, signal \}\) => \{\s*if \(!store!?\.state\(\)\.screen\) throw new Error\(SCREEN_OFF\);/);
  // Its own Touch ID for a batch, good for a while, ended when the task leaves.
  assert.match(deps, /allowRun: async \(\{ count \}\) => \{\s*if \(Date\.now\(\) < desktopOkUntil\) return;[\s\S]*?await touchId\(what\)/);
  assert.match(face, /desktopTask = null; desktopOkUntil = 0;/);
  // Steps only for a turn started here, and never while locked.
  const step = face.slice(face.indexOf('async function answerDesktopStep'), face.indexOf('function desktopHelper'));
  assert.match(step, /if \(forCompanion && !companionAsking\) throw/);
  assert.match(step, /if \(!forCompanion && !faceWindow!?\.acting\(\)\) throw/);
  assert.match(step, /if \(faceLocked && tool !== 'presence'\) throw/);
  const browser = face.slice(face.indexOf('async function answerBrowserStep'), face.indexOf('async function answerDesktopStep'));
  assert.match(browser, /if \(!faceWindow\.acting\(\)\) throw/);
});
test('finding 12: a second click while Touch ID is up waits for the first window (face-main.cjs)', async () => {
  const face = await read('../desktop/face-main.cts');
  assert.match(face, /function openFullWindow\(\)(?:: [^{]+)? \{ openingWindow \?\?= openFullWindowOnce\(\)\.finally\(\(\) => \{ openingWindow = null; \}\); return openingWindow; \}/);
});
test('finding 12: a turn from the face doesn’t bring this Mac’s window forward, and watching the Simulator there doesn’t shrink this Mac’s picture (main.cjs)', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /showWindow = asker \|\| fromRemote\(\) \? \(\) => \{\s*\} : showWindowNow/);
  assert.match(main, /const watchSimulator = \(?id\)? => simulators\.watch\(id, [^\n]*, localSimulator === id \? \{\} : \{ fps: 15, maxWidth: 400 \}\);/);
  assert.match(main, /return localSimulator === id \|\| remoteSimulator === id \? watchSimulator\(id\) : simulators\.unwatch\(id\);/);
});

// Finding 8: the update script.
async function miniHome() {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-update-')), home = join(dir, 'home'), build = join(dir, 'build', 'Baryon.app');
  await mkdir(join(home, 'Applications', 'Baryon.app', 'Contents'), { recursive: true });
  await writeFile(join(home, 'Applications', 'Baryon.app', 'Contents', 'old.txt'), 'old build');
  await mkdir(join(build, 'Contents'), { recursive: true });
  await writeFile(join(build, 'Contents', 'new.txt'), 'new build');
  const zip = spawnSync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', build, '-'], { maxBuffer: 64 * 1024 * 1024 }).stdout;
  // The stand-in mini runs no Fairy, whatever this Mac runs: the swap checks with pgrep, and this one finds nothing.
  const bin = join(dir, 'bin');
  await mkdir(bin); await writeFile(join(bin, 'pgrep'), '#!/bin/sh\nexit 1\n'); await chmod(join(bin, 'pgrep'), 0o755);
  const install = (input: Buffer, mode: string) => spawnSync('/bin/sh', ['-c', REMOTE_APP, 'sh', '20261116-120000', mode, 'any'], { input, env: { HOME: home, PATH: `${bin}:/usr/bin:/bin` }, encoding: 'utf8' });
  return { home, build, zip, install, apps: () => readdir(join(home, 'Applications')), done: () => rm(dir, { recursive: true, force: true }) };
}
test('finding 8: a copy cut short or a failed signature check stops the update and leaves the old app as it was', { skip: process.platform !== 'darwin' }, async () => {
  const s = await miniHome();
  try {
    const cut = s.install(s.zip.subarray(0, Math.floor(s.zip.length / 2)), 'skip');
    assert.notEqual(cut.status, 0);
    assert.doesNotMatch(cut.stdout, /app=installed/);
    assert.match(cut.stderr, /didn’t arrive whole|didn't arrive whole/);
    assert.deepEqual(await s.apps(), ['Baryon.app'], 'nothing renamed, nothing left behind');
    assert.equal(await readFile(join(s.home, 'Applications', 'Baryon.app', 'Contents', 'old.txt'), 'utf8'), 'old build');
    // The stand-in app isn't signed, so its check fails.
    const unsigned = s.install(s.zip, 'verify');
    assert.notEqual(unsigned.status, 0);
    assert.doesNotMatch(unsigned.stdout, /app=installed|signature=ok/);
    assert.match(unsigned.stderr, /signature didn.t check out/);
    assert.deepEqual(await s.apps(), ['Baryon.app']);
    assert.equal(await readFile(join(s.home, 'Applications', 'Baryon.app', 'Contents', 'old.txt'), 'utf8'), 'old build');
    // A good copy is swapped in, and the old app kept under a new name.
    const good = s.install(s.zip, 'skip');
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /kept=Baryon-before-move-20261116-120000\.app\napp=installed/);
    assert.deepEqual((await s.apps()).sort(), ['Baryon-before-move-20261116-120000.app', 'Baryon.app']);
    assert.equal(await readFile(join(s.home, 'Applications', 'Baryon.app', 'Contents', 'new.txt'), 'utf8'), 'new build');
  } finally { await s.done(); }
});
test('finding 8: a build whose signature doesn’t check out here is never sent, and a hardened one must have its fuses locked', async () => {
  const failing = () => ({ status: 1, stderr: 'Baryon.app: code object is not signed at all\n' });
  await assert.rejects(checkBuild('/nowhere/Baryon.app', { run: failing as any }), /signature doesn’t check out, so it wasn’t sent: Baryon\.app: code object is not signed at all/);
  const plain = (_command: string, args: string[]) => (args[0] === '--verify' ? { status: 0, stderr: '' } : { status: 0, stderr: 'CodeDirectory v=20400 size=1 flags=0x2(adhoc) hashes=1\n' });
  assert.deepEqual(await checkBuild('/nowhere/Fairy.app', { run: plain as any }), { hardened: false });
  // Hardened: the fuses are read from the app itself, so one that isn't there fails rather than passes.
  const hardened = (_command: string, args: string[]) => (args[0] === '--verify' ? { status: 0, stderr: '' } : { status: 0, stderr: 'CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1\n' });
  await assert.rejects(checkBuild('/nowhere/Fairy.app', { run: hardened as any }));
  const script = await read('../build-ts/scripts/fairy-to-mini.mjs');
  assert.match(script, /const build = verify && !options\.dryRun \? await checkBuild\(local\.appPath\)[^\n]*\n\s+const quit = parseLines/, 'checked before Fairy on the mini is quit');
});
