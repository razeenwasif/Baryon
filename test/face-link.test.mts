import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FaceClient, RETRY_MS, eventParser, parsePairLink, type FaceStreamEvent } from '../desktop/face-client.mjs';
import { FaceLink, type FaceLinkOptions } from '../desktop/face-link.mjs';
import { FaceStore } from '../desktop/face-store.mjs';
import { PhoneLink, makeCertificate } from '../desktop/phone-link.mjs';

const NAME = 'mini.example.ts.net';
let shared: Awaited<ReturnType<typeof makeCertificate>> | undefined;
const certificate = async (options: Parameters<typeof makeCertificate>[0]) => { shared ??= await makeCertificate(options); return shared; };
const seal = (text: string) => `sealed:${Buffer.from(text).toString('hex')}`, unseal = (text: string) => Buffer.from(text.slice(7), 'hex').toString();
const until = async (check: () => unknown, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(resolve => setTimeout(resolve, 10)); } };

interface LocalSetupOptions {
  ask?: FaceLinkOptions['ask'];
  makeVoice?: FaceLinkOptions['makeVoice'];
  waiting?: FaceLinkOptions['waiting'];
  stop?: FaceLinkOptions['stop'];
  onPresence?: FaceLinkOptions['onPresence'];
}

async function setup({ ask, makeVoice = null, waiting = () => [], stop = () => {}, onPresence = () => {} }: LocalSetupOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-link-'));
  const face = new FaceLink({ ask: ask ?? (async (text, { onText }) => { onText('Hel'); onText('Hello'); return { text: `Hello, you said ${text}` }; }), stop, makeVoice, waiting, onPresence, history: async () => [{ role: 'user', content: 'hi' }], name: () => 'Fairy' });
  const answered: Array<[string, string]> = [];
  const link = new PhoneLink({ path: join(dir, 'phone-link.json'), port: 0, every: 1e7, certificate, accepts: () => true, address: () => '127.0.0.1', name: async () => NAME, reach: async () => 'open',
    overview: () => ({ chats: [], approvals: waiting() as any }), chat: async id => ({ id }), answer: (id, decision) => answered.push([id, decision]), face: face as any });
  await link.start(); await link.setEnabled(true);
  return { dir, link, face, answered, done: async () => { await link.stop(); await rm(dir, { recursive: true, force: true }); } };
}
function call(link: PhoneLink, path: string, { method = 'GET', key, body }: { method?: string; key?: string; body?: unknown } = {}): Promise<{ status: number | undefined; json: any; raw: Buffer; headers: IncomingHttpHeaders }> {
  const port = (link.server!.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ host: '127.0.0.1', port, path, method, agent: false, rejectUnauthorized: false,
      headers: { Host: `${NAME}:${port}`, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) } }, response => {
      const parts: Buffer[] = []; response.on('data', (part: Buffer) => parts.push(part));
      response.on('end', () => { const raw = Buffer.concat(parts); let json: any = null; try { json = JSON.parse(raw.toString()); } catch {} resolve({ status: response.statusCode, json, raw, headers: response.headers }); });
    });
    request.on('error', reject);
    request.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
// The face's event stream, as a growing list of events.
type FaceEvents = FaceStreamEvent[] & { status?: number; closed?: boolean; stop: () => void };
function events(link: PhoneLink, key: string): FaceEvents {
  const port = (link.server!.address() as AddressInfo).port, list = [] as unknown as FaceEvents, parser = eventParser();
  const request = httpsRequest({ host: '127.0.0.1', port, path: '/v1/face/events', agent: false, rejectUnauthorized: false, headers: { Host: `${NAME}:${port}`, Authorization: `Bearer ${key}` } }, response => {
    list.status = response.statusCode; response.setEncoding('utf8'); response.on('data', (chunk: string) => list.push(...parser.feed(chunk))); response.on('close', () => { list.closed = true; });
  });
  request.on('error', () => { list.closed = true; });
  request.end();
  list.stop = () => request.destroy();
  return list;
}
async function pairMac(link: PhoneLink) {
  const { url } = link.pair({ kind: 'mac' }), code = new URL(url).searchParams.get('code');
  const reply = await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'MacBook', kind: 'mac' } });
  assert.equal(reply.status, 200);
  return { ...reply.json, url } as { readKey: string; approveKey: string; url: string };
}
async function pairPhone(link: PhoneLink) {
  const { url } = link.pair(), code = new URL(url).searchParams.get('code');
  return (await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'iPhone' } })).json as { readKey: string; approveKey: string };
}

test('a phone’s code can’t pair a Mac nor a Mac’s a phone, and each device shows its kind', async () => {
  const s = await setup();
  try {
    let code = new URL(s.link.pair({ kind: 'mac' }).url).searchParams.get('code');
    assert.equal(new URL(s.link.pair({ kind: 'mac' }).url).searchParams.get('kind'), 'mac');
    code = new URL(s.link.pair({ kind: 'mac' }).url).searchParams.get('code');
    assert.equal((await call(s.link, '/v1/pair', { method: 'POST', body: { code, name: 'x' } })).status, 403);
    code = new URL(s.link.pair().url).searchParams.get('code');
    assert.equal((await call(s.link, '/v1/pair', { method: 'POST', body: { code, name: 'x', kind: 'mac' } })).status, 403);
    await pairMac(s.link); await pairPhone(s.link);
    assert.deepEqual(s.link.state().devices.map(device => [device.name, device.kind]), [['MacBook', 'mac'], ['iPhone', 'phone']]);
  } finally { await s.done(); }
});

test('only a Mac uses /v1/face/, and a Mac gets only the phone’s chat requests', async () => {
  const s = await setup();
  try {
    const mac = await pairMac(s.link), phone = await pairPhone(s.link);
    assert.equal((await call(s.link, '/v1/face/history', { key: phone.readKey })).status, 401);
    assert.equal((await call(s.link, '/v1/face/history', { key: 'nonsense' })).status, 401);
    const history = await call(s.link, '/v1/face/history', { key: mac.readKey });
    assert.deepEqual(history.json, { name: 'Fairy', history: [{ role: 'user', content: 'hi' }] });
    // Its chats window reads chats and the overview as a phone does, and AudioPulse on its Mac asks through it (face-sockets.mjs);
    // push, attachments and starting work stay the phone's.
    assert.equal((await call(s.link, '/v1/chats', { key: mac.readKey })).status, 200);
    assert.equal((await call(s.link, '/v1/overview', { key: mac.readKey })).status, 200);
    for (const path of ['/v1/push', '/v1/listening', '/v1/attach', '/v1/work', '/v1/task-done', '/v1/chat-delete', '/v1/memory']) {
      assert.equal((await call(s.link, path, { method: 'POST', key: mac.readKey, body: {} })).status, 403, path);
    }
    // Answer is allowed: here the question isn't waiting, so it's 409, not 403.
    assert.equal((await call(s.link, '/v1/answer', { method: 'POST', key: mac.readKey, body: { id: 'q', decision: 'deny' } })).status, 409);
    assert.equal((await call(s.link, '/v1/chats', { key: phone.readKey })).status, 200);
  } finally { await s.done(); }
});

test('a face asks, sees the reply grow and finish, then fetches her voice', async () => {
  let emitPart: (part: { sequence: number; bytes: Buffer; pauseBeforeMs: number }) => void;
  const makeVoice: FaceLinkOptions['makeVoice'] = ({ emit }) => { emitPart = emit; return { update() {}, cancel() {}, finish: async () => { emitPart({ sequence: 0, bytes: Buffer.from('mp3-one'), pauseBeforeMs: 0 }); emitPart({ sequence: 1, bytes: Buffer.from('mp3-two'), pauseBeforeMs: 160 }); return ''; } }; };
  const s = await setup({ makeVoice });
  try {
    const mac = await pairMac(s.link), stream = events(s.link, mac.readKey);
    await until(() => stream.length >= 1);
    assert.equal(stream[0].type, 'hello');
    assert.deepEqual(stream[0].data, { name: 'Fairy', turn: null, approvals: [], show: false });
    const asked = await call(s.link, '/v1/face/ask', { method: 'POST', key: mac.readKey, body: { text: 'hi' } });
    assert.equal(asked.status, 200);
    const turn = asked.json.turn;
    await until(() => stream.some(event => event.type === 'voice' && event.data.done));
    const types = stream.map(event => event.type);
    assert.ok(types.indexOf('text') < types.indexOf('done'), types.join());
    assert.deepEqual(stream.find(event => event.type === 'done')!.data, { turn, text: 'Hello, you said hi' });
    assert.ok(stream.filter(event => event.type === 'text').every(event => event.data.turn === turn));
    const first = await call(s.link, `/v1/face/voice?turn=${turn}&part=0`, { key: mac.readKey });
    assert.equal(first.raw.toString(), 'mp3-one');
    assert.equal(first.headers['content-type'], 'audio/mpeg');
    assert.equal((await call(s.link, `/v1/face/voice?turn=${turn}&part=1`, { key: mac.readKey })).headers['x-fairy-pause-before'], '160');
    assert.equal((await call(s.link, `/v1/face/voice?turn=${turn}&part=2`, { key: mac.readKey })).status, 404);
    assert.equal((await call(s.link, '/v1/face/voice?turn=other&part=0', { key: mac.readKey })).status, 404);
    stream.stop();
  } finally { await s.done(); }
});

test('a second ask waits for the first, and stop ends it as stopped', async () => {
  let stopped = 0;
  const ask: FaceLinkOptions['ask'] = (_text, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const s = await setup({ ask, stop: () => { stopped++; } });
  try {
    const mac = await pairMac(s.link), stream = events(s.link, mac.readKey);
    await until(() => stream.length >= 1);
    assert.equal((await call(s.link, '/v1/face/ask', { method: 'POST', key: mac.readKey, body: { text: 'one' } })).status, 200);
    const second = await call(s.link, '/v1/face/ask', { method: 'POST', key: mac.readKey, body: { text: 'two' } });
    assert.equal(second.status, 409);
    assert.equal((await call(s.link, '/v1/face/ask', { method: 'POST', key: mac.readKey, body: { text: '   ' } })).status, 400);
    assert.equal((await call(s.link, '/v1/face/stop', { method: 'POST', key: mac.readKey, body: {} })).status, 200);
    await until(() => stream.some(event => event.type === 'failed'));
    assert.equal(stream.find(event => event.type === 'failed')!.data.message, 'Stopped.');
    assert.equal(stopped, 1);
    stream.stop();
  } finally { await s.done(); }
});

test('only questions the phone link lists reach a face, with its word on Mac-only, and a closed one is withdrawn', async () => {
  const listed: Array<{ id: string; title: string; command?: string; detail?: string; macOnly?: boolean }> = [{ id: 'q1', title: 'Run the tests', command: 'npm test', macOnly: true }];
  const s = await setup({ waiting: () => listed });
  try {
    const mac = await pairMac(s.link), stream = events(s.link, mac.readKey);
    await until(() => stream.length >= 1);
    assert.deepEqual(stream[0].data.approvals, [{ id: 'q1', title: 'Run the tests', detail: 'npm test', macOnly: true }]);
    listed.push({ id: 'q2', title: 'Edit a file', detail: 'app.js' });
    s.face.approval({ id: 'q2', title: 'Edit a file', detail: 'app.js' });
    s.face.approval({ id: 'chat-only', title: 'Add an event' });
    await until(() => stream.some(event => event.type === 'approval'));
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.deepEqual(stream.filter(event => event.type === 'approval').map(event => event.data.id), ['q2']);
    s.face.approval({ id: 'q2', closed: true });
    s.face.approval({ id: 'chat-only', closed: true });
    await until(() => stream.some(event => event.type === 'approval-closed'));
    assert.deepEqual(stream.filter(event => event.type === 'approval-closed').map(event => event.data.id), ['q2']);
    stream.stop();
  } finally { await s.done(); }
});

test('a second stream replaces the first, and removing the Mac ends it', async () => {
  const s = await setup();
  try {
    const mac = await pairMac(s.link), first = events(s.link, mac.readKey);
    await until(() => first.length >= 1);
    const second = events(s.link, mac.readKey);
    await until(() => second.length >= 1 && first.closed);
    assert.equal(s.face.connected(), true);
    await s.link.forget(s.link.state().devices[0].id);
    await until(() => second.closed);
    assert.equal(s.face.connected(), false);
  } finally { await s.done(); }
});

// The face's side.
const storeIn = (dir: string) => new FaceStore({ path: join(dir, 'face', 'face.json'), seal, unseal });

test('a face pairs from the link, connects, asks and hears back', async () => {
  const s = await setup();
  try {
    const store = storeIn(s.dir), seen: FaceStreamEvent[] = [], states: string[] = [];
    await store.load();
    const client = new FaceClient({ store, name: 'MacBook', resolve: () => '127.0.0.1', onEvent: event => seen.push(event), onState: state => states.push(state) });
    await client.pair(s.link.pair({ kind: 'mac' }).url);
    await until(() => client.state() === 'connected');
    assert.equal(store.state().paired, true);
    assert.equal(store.state().host, NAME);
    const { turn } = await client.ask('hi');
    await until(() => seen.some(event => event.type === 'done' && event.data.turn === turn));
    assert.equal((await client.history()).name, 'Fairy');
    assert.deepEqual(states.slice(0, 2), ['connecting', 'connected']);
    client.stop();
  } finally { await s.done(); }
});

test('a certificate that doesn’t match the pin gets no request at all, and is never trusted by itself', async () => {
  const s = await setup();
  try {
    const store = storeIn(s.dir);
    await store.load();
    const client = new FaceClient({ store, resolve: () => '127.0.0.1' });
    await client.pair(s.link.pair({ kind: 'mac' }).url);
    await until(() => client.state() === 'connected');
    client.stop();
    // As if the other Mac's certificate were replaced: the saved pin no longer matches.
    await store.savePairing({ ...store.pairing()!, pin: 'ab'.repeat(32), readKey: store.readKey(), approveKey: store.approveKey() });
    let requests = 0;
    const receive = s.link.receive.bind(s.link);
    s.link.receive = (request, response) => { requests++; return receive(request, response); };
    const again = new FaceClient({ store, resolve: () => '127.0.0.1' });
    again.start();
    await until(() => again.state() === 'changed');
    assert.equal(requests, 0);
    await assert.rejects(again.ask('hi'), /certificate changed/);
    assert.equal(requests, 0);
    again.stop();
  } finally { await s.done(); }
});

test('a face removed on the other Mac is told so and deletes its keys', async () => {
  const s = await setup();
  try {
    const store = storeIn(s.dir);
    await store.load();
    const client = new FaceClient({ store, resolve: () => '127.0.0.1' });
    await client.pair(s.link.pair({ kind: 'mac' }).url);
    await until(() => client.state() === 'connected');
    await s.link.forget(s.link.state().devices[0].id);
    await until(() => client.state() === 'forgotten', 6000);
    assert.equal(store.state().paired, false);
  } finally { await s.done(); }
});

test('a face that can’t connect tries again after 1, 2, 5 and 10 seconds, then every 30', async () => {
  const store = { pairing: () => ({ host: NAME, port: 1, pin: 'ab'.repeat(32), device: 'd' }), readKey: () => 'k', forget: async () => {} };
  const delays: number[] = [], waiting: Array<() => void> = [];
  const timers = { setTimeout: (run: () => void, ms: number) => { delays.push(ms); waiting.push(run); return { unref() {} }; }, clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} };
  const connect = () => { const socket = Object.assign(new EventEmitter(), { setTimeout() {}, destroy() {}, getPeerCertificate: () => ({}) }); queueMicrotask(() => socket.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }))); return socket; };
  const client = new FaceClient({ store: store as any, connect: connect as any, timers });
  client.start();
  for (let i = 0; i < 6; i++) { await until(() => waiting.length > i); waiting[i](); }
  await until(() => delays.length >= 7);
  assert.deepEqual(delays.slice(0, 7), [...RETRY_MS, 30000, 30000]);
  assert.equal(client.state(), 'unreachable');
  client.stop();
});

test('pairing links are checked before anything is sent', () => {
  const good = `fairy://pair?host=${NAME}&port=47616&code=abcdefghijk_-12345&pin=${'ab'.repeat(32)}&kind=mac`;
  assert.deepEqual(parsePairLink(` ${good} `), { host: NAME, port: 47616, code: 'abcdefghijk_-12345', pin: 'ab'.repeat(32) });
  assert.throws(() => parsePairLink(good.replace('&kind=mac', '')), /for pairing an iPhone/);
  assert.throws(() => parsePairLink(good.replace('fairy:', 'https:')), /isn’t a pairing link/);
  assert.throws(() => parsePairLink(good.replace('ab'.repeat(32), 'ab')), /incomplete/);
  assert.throws(() => parsePairLink(good.replace('47616', '0')), /incomplete/);
  assert.throws(() => parsePairLink('not a link'), /isn’t a pairing link/);
});

test('events are read across chunks, and comments and others’ lines are skipped', () => {
  const parser = eventParser();
  assert.deepEqual(parser.feed(': still here\n\nevent: text\ndata: {"turn":"t","te'), []);
  assert.deepEqual(parser.feed('xt":"Hi"}\n\nevent: done\r\ndata: {"turn":"t"}\r\n\r\ndata: not json\n\n'), [{ type: 'text', data: { turn: 't', text: 'Hi' } }, { type: 'done', data: { turn: 't' } }]);
});

test('a face reports whether its Mac is in use, and hears when to show her', async () => {
  const reports: unknown[] = [];
  const s = await setup({ onPresence: report => reports.push(report) });
  try {
    const mac = await pairMac(s.link), stream = events(s.link, mac.readKey);
    await until(() => stream.length >= 1);
    assert.equal((await call(s.link, '/v1/face/presence', { method: 'POST', key: mac.readKey, body: { activeAgoMs: 120, locked: false, claim: true, follow: 'manual', extra: 'x' } })).status, 200);
    assert.deepEqual(reports, [{ activeAgoMs: 120, locked: false, claim: true, follow: 'manual' }]);
    assert.equal((await call(s.link, '/v1/face/presence', { method: 'POST', key: mac.readKey, body: { activeAgoMs: -1 } })).status, 400);
    assert.equal((await call(s.link, '/v1/face/presence', { method: 'POST', key: mac.readKey, body: { activeAgoMs: 9e12, follow: 'sometimes' } })).status, 200);
    assert.deepEqual(reports[1], { activeAgoMs: 3_600_000, locked: false, claim: false });
    s.face.show(true); s.face.show(true); s.face.show(false);
    await until(() => stream.filter(event => event.type === 'show').length >= 2);
    assert.deepEqual(stream.filter(event => event.type === 'show').map(event => event.data.on), [true, false]);
    // She says things unasked only while shown there.
    s.face.say('Look at this'); s.face.show(true); s.face.say('And this');
    await until(() => stream.some(event => event.type === 'say'));
    assert.deepEqual(stream.filter(event => event.type === 'say').map(event => event.data.text), ['And this']);
    stream.stop();
    await until(() => !s.face.connected());
    assert.equal(s.face.shownHere, false, 'a lost face no longer shows her');
  } finally { await s.done(); }
});
