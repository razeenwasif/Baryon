import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PhoneLink, isTailscale, makeCertificate, tailscaleAddress, tailscaleName, type PhoneCertificate, type PhoneLinkOptions, type PhoneSendPayload } from '../desktop/phone-link.mjs';
import type { PhoneApprovalView, PhoneEvent } from '../desktop/phone-access.mjs';

const NAME = 'mac.example.ts.net';
let shared: PhoneCertificate | undefined;
const certificate = async (options: { name: string; address: string; now?: () => number }): Promise<PhoneCertificate> => { shared ??= await makeCertificate(options); return shared; };

interface SetupOptions {
  approvals?: Array<Partial<PhoneApprovalView>>;
  answered?: Array<[string, 'allow' | 'deny']>;
  now?: () => number;
  accepts?: (address: unknown) => boolean;
  address?: () => string;
  enabled?: boolean;
  seal?: (text: string) => string;
  unseal?: (text: string) => string;
  send?: PhoneLinkOptions['send'];
  stopTurn?: PhoneLinkOptions['stopTurn'];
  chats?: PhoneLinkOptions['chats'];
  voicePart?: PhoneLinkOptions['voicePart'];
  pages?: PhoneLinkOptions['pages'];
  pageFile?: PhoneLinkOptions['pageFile'];
  memory?: PhoneLinkOptions['memory'];
  about?: PhoneLinkOptions['about'];
  assist?: PhoneLinkOptions['assist'];
  listening?: PhoneLinkOptions['listening'];
  thread?: PhoneLinkOptions['thread'];
  taskDone?: PhoneLinkOptions['taskDone'];
  startWork?: PhoneLinkOptions['startWork'];
  chatDelete?: PhoneLinkOptions['chatDelete'];
}

async function setup({ approvals = [], answered = [], now, accepts = () => true, address = () => '127.0.0.1', enabled = true, seal, unseal, send, stopTurn, chats, voicePart, pages, pageFile, memory, about, assist, listening, thread, taskDone, startWork, chatDelete }: SetupOptions = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-link-')), path = join(dir, 'phone-link.json'), events: Array<PhoneEvent | { type: 'work-started'; device: string }> = [], current = { approvals, address };
  const link = new PhoneLink({ path, port: 0, every: 1e7, now, accepts, certificate, seal, unseal, send, stopTurn, chats, voicePart, pages, pageFile, memory, about, assist, listening, thread, taskDone, startWork, chatDelete,
    address: () => current.address(), name: async () => NAME, reach: async () => 'open',
    overview: () => ({ chats: [], approvals: current.approvals as PhoneApprovalView[] }),
    chat: async id => ({ id }),
    answer: (id, decision) => answered.push([id, decision]),
    onEvent: event => events.push(event) });
  await link.start();
  if (enabled) await link.setEnabled(true);
  const done = async () => { await link.stop(); await rm(dir, { recursive: true, force: true }); };
  return { link, path, events, current, answered, done };
}

interface CallResponse {
  status: number;
  text: string;
  json: () => any;
}

function call(
  link: PhoneLink,
  path: string,
  { method = 'GET', key, body, host, headers = {} }: {
    method?: string;
    key?: string;
    body?: unknown;
    host?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<CallResponse> {
  const port = (link.server!.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const request = httpsRequest({ host: link.here, port, path, method, agent: false, rejectUnauthorized: false, headers: { Host: host ?? `${NAME}:${port}`, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', part => { text += part; });
      response.on('end', () => resolve({ status: response.statusCode!, text, json: () => JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}
const codeOf = (pairing: { url: string }): string | null => new URL(pairing.url).searchParams.get('code');
async function paired(link: PhoneLink): Promise<{ readKey: string; approveKey: string }> {
  const response = await call(link, '/v1/pair', { method: 'POST', body: { code: codeOf(link.pair()), name: 'Izanagi' } });
  assert.equal(response.status, 200);
  return response.json() as { readKey: string; approveKey: string };
}
const ASK = { id: 'a1', kind: 'run', title: 'Run a command', chat: 'Add compaction' };

test('knows Tailscale’s addresses and only trusts them on a utun interface', () => {
  assert.equal(isTailscale('100.64.0.1'), true);
  assert.equal(isTailscale('100.123.2.114'), true);
  assert.equal(isTailscale('::ffff:100.127.255.254'), true);
  for (const other of ['100.63.255.255', '100.128.0.1', '192.168.1.5', '127.0.0.1', 'fd7a::1', '']) assert.equal(isTailscale(other), false);
  const entry = (address: string) => [{ family: 'IPv4', address, internal: false }] as unknown as NetworkInterfaceInfo[];
  assert.equal(tailscaleAddress({ interfaces: () => ({ en0: entry('100.64.0.1') }) }), '');
  assert.equal(tailscaleAddress({ interfaces: () => ({ utun3: entry('10.0.0.2') }) }), '');
  assert.equal(tailscaleAddress({ interfaces: () => ({ en0: entry('192.168.1.5'), utun3: entry('100.64.0.9') }) }), '100.64.0.9');
});

test('reads this Mac’s Tailscale name, and copes when it can’t', async () => {
  assert.equal(await tailscaleName({ command: async () => JSON.stringify({ Self: { DNSName: `${NAME}.` } }) }), NAME);
  assert.equal(await tailscaleName({ command: async () => '' }), '');
});

test('the certificate is one iOS accepts', async () => {
  const made = await makeCertificate({ name: NAME, address: '100.64.0.1' }), parsed = new X509Certificate(made.cert);
  assert.match(parsed.subjectAltName!, new RegExp(`DNS:${NAME}`));
  assert.ok(parsed.keyUsage?.includes('1.3.6.1.5.5.7.3.1') || (parsed.toLegacyObject() as { ext_key_usage?: string[] }).ext_key_usage?.includes('1.3.6.1.5.5.7.3.1'));
  // Named, not written out in full, which is the difference iOS cares about.
  assert.equal(parsed.publicKey.asymmetricKeyDetails?.namedCurve, 'prime256v1');
  assert.ok(made.expires - Date.now() < 825 * 86400000);
  assert.match(made.pin, /^[0-9a-f]{64}$/);
});

test('stays closed until turned on', async () => {
  const { link, done } = await setup({ enabled: false });
  assert.equal(link.server, null);
  assert.throws(() => link.pair(), /Turn on/);
  await done();
});

test('closes when Tailscale goes away and reopens when it’s back', async () => {
  const { link, current, done } = await setup();
  assert.ok(link.server);
  assert.equal(link.state().name, NAME);
  current.address = () => '';
  await link.refresh();
  assert.equal(link.server, null);
  assert.equal(link.state().tailscale, false);
  current.address = () => '127.0.0.1';
  await link.refresh();
  assert.ok(link.server);
  await done();
});

// On the mini, Tailscale stopped while a connection was open, and when it came back the link never reopened until Fairy
// was restarted: closing waited for that connection to end, and a connection that never sends anything never does,
// so every later check queued behind it.
test('reopens when Tailscale comes back, even if a connection hung open when it went', async () => {
  const { link, current, done } = await setup();
  const { connect } = await import('node:net');
  let hung: Socket | undefined;
  try {
    const port = (link.server!.address() as AddressInfo).port;
    // Connected, and silent: no TLS greeting, so the HTTPS server doesn't count it among its connections.
    hung = connect(port, '127.0.0.1');
    await new Promise<void>(resolve => hung!.once('connect', resolve));
    current.address = () => '';
    const gone = await Promise.race([link.refresh().then(() => 'closed'), new Promise<string>(resolve => setTimeout(() => resolve('stuck'), 5000))]);
    assert.equal(gone, 'closed', 'closing must not wait on a silent connection');
    assert.equal(link.state().listening, false);
    current.address = () => '127.0.0.1';
    const back = await Promise.race([link.refresh().then(() => 'refreshed'), new Promise<string>(resolve => setTimeout(() => resolve('stuck'), 5000))]);
    assert.equal(back, 'refreshed');
    assert.equal(link.state().listening, true);
  } finally { hung?.destroy(); await done(); }
});

test('anything outside Tailscale gets nothing', async () => {
  const { link, done } = await setup({ accepts: isTailscale });
  await assert.rejects(call(link, '/v1/overview'));
  await done();
});

test('answers only to its own name, and not to web pages', async () => {
  const { link, done } = await setup(), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/overview', { key: readKey, host: `evil.example:${(link.server!.address() as AddressInfo).port}` })).status, 421);
  assert.equal((await call(link, '/v1/overview', { key: readKey, headers: { Origin: 'https://evil.example' } })).status, 403);
  await done();
});

test('a pairing code works once, and gives the phone two keys', async () => {
  const { link, path, events, done } = await setup(), pairing = link.pair(), url = new URL(pairing.url);
  assert.equal(url.protocol, 'fairy:');
  assert.equal(url.searchParams.get('host'), NAME);
  assert.equal(url.searchParams.get('pin'), shared!.pin);
  const code = url.searchParams.get('code'), first = await call(link, '/v1/pair', { method: 'POST', body: { code, name: 'Izanagi' } });
  assert.equal(first.status, 200);
  const { readKey, approveKey } = first.json() as { readKey: string; approveKey: string };
  assert.ok(readKey && approveKey && readKey !== approveKey);
  assert.equal((await call(link, '/v1/pair', { method: 'POST', body: { code } })).status, 403);
  const saved = await readFile(path, 'utf8');
  assert.ok(!saved.includes(readKey) && !saved.includes(approveKey));
  assert.deepEqual(link.state().devices.map(device => device.name), ['Izanagi']);
  assert.ok(events.some(event => event.type === 'paired'));
  await done();
});

test('too many wrong codes ends the pairing', async () => {
  const { link, done } = await setup(), pairing = link.pair();
  for (let tries = 0; tries < 5; tries += 1) assert.equal((await call(link, '/v1/pair', { method: 'POST', body: { code: 'wrong' } })).status, 403);
  assert.equal((await call(link, '/v1/pair', { method: 'POST', body: { code: codeOf(pairing) } })).status, 403);
  await done();
});

test('a code runs out', async () => {
  let at = 1000;
  const { link, done } = await setup({ now: () => at }), pairing = link.pair();
  at += 5 * 60 * 1000 + 1;
  assert.equal((await call(link, '/v1/pair', { method: 'POST', body: { code: codeOf(pairing) } })).status, 403);
  await done();
});

test('reading needs the read key', async () => {
  const { link, done } = await setup(), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/overview')).status, 401);
  assert.equal((await call(link, '/v1/overview', { key: 'wrong' })).status, 401);
  assert.equal((await call(link, '/v1/overview', { key: readKey })).status, 200);
  assert.deepEqual((await call(link, '/v1/chat?id=c1', { key: readKey })).json(), { id: 'c1' });
  await done();
});

test('allowing needs the approve key, and refusing doesn’t', async () => {
  const { link, answered, events, done } = await setup({ approvals: [ASK] }), { readKey, approveKey } = await paired(link);
  const answer = (body: unknown) => call(link, '/v1/answer', { method: 'POST', key: readKey, body });
  assert.equal((await answer({ id: 'a1', decision: 'allow' })).status, 403);
  assert.equal((await answer({ id: 'a1', decision: 'allow', approveKey: readKey })).status, 403);
  assert.deepEqual(answered, []);
  assert.equal((await answer({ id: 'a1', decision: 'allow', approveKey })).status, 200);
  assert.deepEqual(answered, [['a1', 'allow']]);
  assert.equal((await answer({ id: 'a1', decision: 'deny' })).status, 200);
  assert.deepEqual(answered[1], ['a1', 'deny']);
  assert.ok(events.some(event => event.type === 'answered' && event.decision === 'allow' && event.device === 'Izanagi'));
  await done();
});

test('a phone can’t widen what it allows', async () => {
  const { link, answered, done } = await setup({ approvals: [ASK] }), { readKey, approveKey } = await paired(link);
  for (const decision of ['always', 'auto', 'ALLOW', '']) assert.equal((await call(link, '/v1/answer', { method: 'POST', key: readKey, body: { id: 'a1', decision, approveKey } })).status, 400);
  assert.deepEqual(answered, []);
  await done();
});

// Starting work is allowed only with Face ID and only where the Mac wires it up (see the test of /v1/work below).
test('there’s no route for changing memory or settings, and none for work unless the Mac offers it', async () => {
  const { link, done } = await setup(), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/memory', { method: 'POST', key: readKey, body: { text: 'Remember this' } })).status, 405);
  for (const path of ['/v1/settings', '/v1/run', '/api/overview']) assert.equal((await call(link, path, { method: 'POST', key: readKey, body: {} })).status, 404);
  assert.equal((await call(link, '/v1/work', { method: 'POST', key: readKey, body: {} })).status, 405);
  assert.equal((await call(link, '/v1/chat?id=c1', { method: 'POST', key: readKey, body: { text: 'hello', mode: 'desktop' } })).status, 405);
  await done();
});

test('sending passes on only the chat and the words', async () => {
  const sent: PhoneSendPayload[] = [], { link, done } = await setup({ send: async message => { sent.push(message); return { chat: 'c1' }; } }), { readKey } = await paired(link);
  const response = await call(link, '/v1/send', { method: 'POST', key: readKey, body: { chat: 'c1', text: 'hi', mode: 'desktop', displayId: 1, work: true } });
  assert.equal(response.status, 200);
  assert.deepEqual(sent, [{ chat: 'c1', text: 'hi', voice: false, device: 'Izanagi' }]);
  assert.equal((await call(link, '/v1/send', { method: 'POST', body: { text: 'hi' } })).status, 401);
  assert.equal((await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'x'.repeat(70 * 1024) } }).catch(() => ({ status: 413 }))).status, 413);
  await done();
});

test('AudioPulse’s assist needs a paired phone and passes on only its instructions and request', async () => {
  const asked: Array<{ instructions: unknown; prompt: unknown }> = [];
  const assist = async (request: { instructions: unknown; prompt: unknown }): Promise<string> => {
    asked.push(request);
    if (request.prompt === 'slow') throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    if (request.prompt === 'down') throw new Error('Claude is unavailable.');
    if (request.prompt === 'bad') throw Object.assign(new Error('AudioPulse sends instructions and a request.'), { status: 400 });
    return '{"action":"play"}';
  };
  const { link, done } = await setup({ assist }), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/assist', { method: 'POST', body: { instructions: 'JSON', prompt: 'jazz' } })).status, 401);
  const ok = await call(link, '/v1/assist', { method: 'POST', key: readKey, body: { instructions: 'JSON', prompt: 'jazz', tools: ['shell'], chat: 'c1' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json(), { text: '{"action":"play"}' });
  assert.deepEqual(asked[0], { instructions: 'JSON', prompt: 'jazz' });
  const slow = await call(link, '/v1/assist', { method: 'POST', key: readKey, body: { instructions: 'JSON', prompt: 'slow' } });
  assert.equal(slow.status, 504);
  const down = await call(link, '/v1/assist', { method: 'POST', key: readKey, body: { instructions: 'JSON', prompt: 'down' } });
  assert.deepEqual([down.status, down.json().error], [502, 'Claude is unavailable.']);
  assert.equal((await call(link, '/v1/assist', { method: 'POST', key: readKey, body: { instructions: 'JSON', prompt: 'bad' } })).status, 400);
  assert.equal((await call(link, '/v1/assist', { method: 'GET', key: readKey })).status, 405);
  await done();
});

test('a voice reply is only asked for by a plain yes, and its clips need the read key', async () => {
  const sent: PhoneSendPayload[] = [], { link, done } = await setup({ send: async message => { sent.push(message); return { chat: 'c1' }; }, voicePart: (id, index) => id === 'c1' && index === 0 ? Buffer.from([1, 2, 3]) : null }), { readKey } = await paired(link);
  await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'a', voice: true } });
  await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'b', voice: 'yes' } });
  assert.deepEqual(sent.map(item => item.voice), [true, false]);
  assert.equal((await call(link, '/v1/voice?chat=c1&part=0')).status, 401);
  assert.equal((await call(link, '/v1/voice?chat=c1&part=0', { key: readKey })).status, 200);
  assert.equal((await call(link, '/v1/voice?chat=c1&part=1', { key: readKey })).status, 404);
  assert.equal((await call(link, '/v1/voice?chat=other&part=0', { key: readKey })).status, 404);
  await done();
});

test('a long message fits, and refusals from the chat side reach the phone', async () => {
  const { link, done } = await setup({ send: async ({ text }) => { if ((text as string).length > 12000) throw Object.assign(new Error('Too long for Fairy.'), { status: 400 }); return { chat: 'c1' }; } }), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'x'.repeat(12000) } })).status, 200);
  const refused = await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'x'.repeat(12001) } });
  assert.equal(refused.status, 400);
  assert.equal(refused.json().error, 'Too long for Fairy.');
  await done();
});

test('a reply can be stopped, and chats can be listed, with the read key only', async () => {
  const stopped: unknown[] = [], { link, done } = await setup({ stopTurn: id => { stopped.push(id); return { ok: true }; }, chats: () => [{ id: 'c1' }] }), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/chats')).status, 401);
  assert.deepEqual((await call(link, '/v1/chats', { key: readKey })).json(), { chats: [{ id: 'c1' }] });
  assert.equal((await call(link, '/v1/stop', { method: 'POST', body: { chat: 'c1' } })).status, 401);
  assert.equal((await call(link, '/v1/stop', { method: 'POST', key: readKey, body: { chat: 'c1' } })).status, 200);
  assert.deepEqual(stopped, ['c1']);
  await done();
});

test('without chat turned on, sending finds nothing', async () => {
  const { link, done } = await setup(), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/send', { method: 'POST', key: readKey, body: { text: 'hi' } })).status, 405);
  await done();
});

test('something too long can be refused but not allowed', async () => {
  const { link, answered, done } = await setup({ approvals: [{ ...ASK, tooBig: true }] }), { readKey, approveKey } = await paired(link);
  assert.equal((await call(link, '/v1/answer', { method: 'POST', key: readKey, body: { id: 'a1', decision: 'allow', approveKey } })).status, 409);
  assert.deepEqual(answered, []);
  assert.equal((await call(link, '/v1/answer', { method: 'POST', key: readKey, body: { id: 'a1', decision: 'deny' } })).status, 200);
  await done();
});

test('anything beyond the sandbox can be refused but never allowed', async () => {
  const { link, answered, done } = await setup({ approvals: [{ ...ASK, kind: 'outside', macOnly: true }] }), { readKey, approveKey } = await paired(link);
  assert.equal((await call(link, '/v1/answer', { method: 'POST', key: readKey, body: { id: 'a1', decision: 'allow', approveKey } })).status, 409);
  assert.deepEqual(answered, []);
  assert.equal((await call(link, '/v1/answer', { method: 'POST', key: readKey, body: { id: 'a1', decision: 'deny' } })).status, 200);
  assert.deepEqual(answered, [['a1', 'deny']]);
  await done();
});

test('a phone can remove itself, and only itself', async () => {
  const { link, done } = await setup(), one = await paired(link), two = await paired(link);
  assert.equal((await call(link, '/v1/leave', { method: 'POST', key: one.readKey, body: {} })).status, 200);
  assert.equal((await call(link, '/v1/overview', { key: one.readKey })).status, 401);
  assert.equal((await call(link, '/v1/overview', { key: two.readKey })).status, 200);
  assert.equal(link.state().devices.length, 1);
  await done();
});

test('an answered question can’t be answered again', async () => {
  const { link, done } = await setup({ approvals: [] }), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/answer', { method: 'POST', key: readKey, body: { id: 'gone', decision: 'deny' } })).status, 409);
  await done();
});

interface StreamHandle {
  frames: Array<Record<string, any>>;
  ended: Promise<void>;
  next: () => Promise<void>;
  close: () => void;
}

function openStream(link: PhoneLink, key: string): Promise<StreamHandle> {
  const port = (link.server!.address() as AddressInfo).port;
  return new Promise((resolve, reject) => {
    const frames: Array<Record<string, any>> = [], waiting: Array<() => void> = [];
    const request = httpsRequest({ host: link.here, port, path: '/v1/events', agent: false, rejectUnauthorized: false, headers: { Host: `${NAME}:${port}`, Authorization: `Bearer ${key}` } }, response => {
      response.setEncoding('utf8');
      response.on('data', text => { for (const line of text.split('\n')) if (line.startsWith('data: ')) { frames.push(JSON.parse(line.slice(6)) as Record<string, any>); waiting.shift()?.(); } });
      const ended = new Promise<void>(done => { response.on('close', done); });
      resolve({ frames, ended, next: () => frames.length ? Promise.resolve() : new Promise<void>(done => { waiting.push(done); }), close: () => request.destroy() });
    });
    request.on('error', () => {});
    request.on('error', reject);
    request.end();
  });
}

test('the stream sends changes as they happen', async () => {
  const { link, current, done } = await setup(), { readKey } = await paired(link), stream = await openStream(link, readKey);
  await stream.next();
  assert.deepEqual(stream.frames[0].overview.approvals, []);
  stream.frames.length = 0;
  current.approvals = [ASK];
  await stream.next();
  assert.equal(stream.frames[0].overview.approvals[0].id, 'a1');
  stream.close();
  await done();
});

test('removing a phone locks it out at once, stream included', async () => {
  const { link, done } = await setup({ approvals: [ASK] }), one = await paired(link), two = await paired(link), stream = await openStream(link, one.readKey);
  await stream.next();
  const { id } = link.state().devices[0];
  await link.forget(id);
  await stream.ended;
  assert.equal((await call(link, '/v1/overview', { key: one.readKey })).status, 401);
  assert.equal((await call(link, '/v1/answer', { method: 'POST', key: one.readKey, body: { id: 'a1', decision: 'allow', approveKey: one.approveKey } })).status, 401);
  assert.equal((await call(link, '/v1/overview', { key: two.readKey })).status, 200);
  await done();
});

test('keeps its certificate and phones across restarts, with the private key sealed', async () => {
  const seal = (text: string): string => `sealed:${Buffer.from(text).toString('base64')}`, unseal = (text: string): string => Buffer.from(text.slice(7), 'base64').toString();
  const first = await setup({ seal, unseal }), { readKey } = await paired(first.link);
  const saved = await readFile(first.path, 'utf8');
  assert.ok(!saved.includes('PRIVATE KEY'));
  await first.link.stop();
  const again = new PhoneLink({ path: first.path, port: 0, every: 1e7, accepts: () => true, seal, unseal, reach: async () => 'open', address: () => '127.0.0.1', name: async () => NAME,
    certificate: async () => { throw new Error('It shouldn’t make a new one.'); }, overview: () => ({ chats: [], approvals: [] }), chat: async () => ({}), answer: () => {} });
  await again.start();
  assert.equal(again.problem, '');
  assert.equal((await call(again, '/v1/overview', { key: readKey })).status, 200);
  await again.stop();
  await first.done();
});

test('a new Tailscale name means a new certificate and pairing again', async () => {
  const { link, current, done } = await setup(), { readKey } = await paired(link);
  await link.inTurn(() => link.close());
  link.name = async () => 'other.example.ts.net';
  await link.refresh();
  assert.equal(link.state().name, 'other.example.ts.net');
  assert.deepEqual(link.state().devices, []);
  assert.equal((await call(link, '/v1/overview', { key: readKey, host: `other.example.ts.net:${(link.server!.address() as AddressInfo).port}` })).status, 401);
  assert.ok(current);
  await done();
});

test('remembers whether to keep the Mac awake', async () => {
  const { link, path, done } = await setup();
  assert.equal(link.holdsAwake, true);
  await link.setKeepAwake(false);
  assert.equal(link.holdsAwake, false);
  assert.equal((JSON.parse(await readFile(path, 'utf8')) as { keepAwake: boolean }).keepAwake, false);
  await done();
});

test('a phone can read pages and memory, only once paired, and can’t change them', async () => {
  const asked: Array<{ id: string | null; seq: string | null; path: string | null; range?: string }> = [], { link, done } = await setup({ pages: () => [{ id: 'p1' }], memory: () => ({ notes: [] }), about: () => ({ notes: 0 }),
    pageFile: async request => { asked.push(request); return { status: 200, headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': "default-src 'none'" }, body: '<p>Hi</p>' }; } }), { readKey } = await paired(link);
  const routes = ['/v1/pages', '/v1/memory', '/v1/about', '/v1/page-file?id=p1&seq=2&path=a%2Fb%20c.html'];
  for (const route of routes) {
    assert.equal((await call(link, route)).status, 401);
    assert.equal((await call(link, route, { key: 'wrong' })).status, 401);
    assert.equal((await call(link, route, { key: readKey })).status, 200);
    assert.equal((await call(link, route, { key: readKey, method: 'POST', body: {} })).status, 405);
    assert.equal((await call(link, route, { key: readKey, method: 'DELETE' })).status, 405);
  }
  assert.deepEqual((await call(link, '/v1/pages', { key: readKey })).json(), { pages: [{ id: 'p1' }] });
  assert.deepEqual(asked[0], { id: 'p1', seq: '2', path: 'a/b c.html', range: undefined });
  await done();
});

test('a phone can say it is listening, with the read key only', async () => {
  const heard: Array<[boolean, string]> = [], { link, done } = await setup({ listening: (on, device) => heard.push([on, device]) }), { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/listening', { method: 'POST', body: { on: true } })).status, 401);
  assert.equal((await call(link, '/v1/listening', { method: 'POST', key: readKey, body: { on: true } })).status, 200);
  assert.equal((await call(link, '/v1/listening', { method: 'POST', key: readKey, body: { on: 'yes' } })).status, 200);
  assert.deepEqual(heard.map(([on]) => on), [true, false], 'only a real true counts');
  await done();
});

test('a phone registers for pushes with its token and its own key, which is kept sealed', async () => {
  const sealed: string[] = [], { link, done } = await setup({ seal: text => { sealed.push(text); return `sealed:${text}`; }, unseal: text => text.replace(/^sealed:/, '') }), { readKey } = await paired(link);
  const key = Buffer.alloc(32, 7).toString('base64'), token = 'ab'.repeat(32);
  assert.equal((await call(link, '/v1/push', { method: 'POST', body: { token, environment: 'development', key } })).status, 401);
  assert.equal((await call(link, '/v1/push', { method: 'POST', key: readKey, body: { token: 'nope', environment: 'development', key } })).status, 400);
  assert.equal((await call(link, '/v1/push', { method: 'POST', key: readKey, body: { token, environment: 'staging', key } })).status, 400);
  assert.equal((await call(link, '/v1/push', { method: 'POST', key: readKey, body: { token, environment: 'development', key: 'c2hvcnQ=' } })).status, 400);
  assert.equal((await call(link, '/v1/push', { method: 'POST', key: readKey, body: { token, environment: 'development', key } })).status, 200);
  assert.ok(sealed.includes(key), 'the key is sealed before it is saved');
  assert.deepEqual(link.pushTargets().map(({ token: t, environment, key: k }) => [t, environment, k]), [[token, 'development', key]]);
  assert.equal(link.state().devices[0].push, true);
  await link.dropPushToken(token);
  assert.deepEqual(link.pushTargets(), []);
  await done();
});

test('the Home thread, marking tasks done, and starting work from the phone', async () => {
  const done: Array<[string, boolean]> = [], started: Array<{ folder: string; prompt: string; device: string }> = [];
  const { link, done: close } = await setup({ thread: async () => 't1', taskDone: async (id, on) => { done.push([id, on]); }, startWork: async request => { started.push(request); return { chat: 'w9' }; } });
  const { readKey, approveKey } = await paired(link);
  assert.deepEqual((await call(link, '/v1/thread', { method: 'POST', key: readKey })).json(), { id: 't1' });
  assert.equal((await call(link, '/v1/task-done', { method: 'POST', key: readKey, body: { id: 'w1', done: true } })).status, 200);
  assert.deepEqual(done, [['w1', true]]);
  const noFace = await call(link, '/v1/work', { method: 'POST', key: readKey, body: { folder: '/Users/me/Fairy', prompt: 'Fix the tests' } });
  assert.equal(noFace.status, 403, 'starting work needs Face ID');
  assert.equal((await call(link, '/v1/work', { method: 'POST', key: readKey, body: { folder: '/Users/me/Fairy', prompt: '  ', approveKey } })).status, 400);
  const ok = await call(link, '/v1/work', { method: 'POST', key: readKey, body: { folder: '/Users/me/Fairy', prompt: ' Fix the tests ', approveKey } });
  assert.deepEqual(ok.json(), { chat: 'w9' });
  assert.deepEqual(started, [{ folder: '/Users/me/Fairy', prompt: 'Fix the tests', device: 'Izanagi' }]);
  await close();
});

test('deleting a chat from the phone', async () => {
  const deleted: string[] = [];
  const { link, done: close } = await setup({ chatDelete: async id => { if (id === 'busy') throw Object.assign(new Error('This chat is working. Stop it first.'), { status: 409 }); deleted.push(id); } });
  const { readKey } = await paired(link);
  assert.equal((await call(link, '/v1/chat-delete', { method: 'POST', key: readKey, body: { id: 'c1' } })).status, 200);
  assert.deepEqual(deleted, ['c1']);
  const busy = await call(link, '/v1/chat-delete', { method: 'POST', key: readKey, body: { id: 'busy' } });
  assert.equal(busy.status, 409);
  assert.match(busy.json().error, /Stop it first/);
  assert.equal((await call(link, '/v1/chat-delete', { method: 'POST', key: readKey, body: {} })).status, 400);
  assert.equal((await call(link, '/v1/chat-delete', { method: 'POST', body: { id: 'c1' } })).status >= 400, true, 'needs a paired phone');
  assert.deepEqual(deleted, ['c1']);
  await close();
});
