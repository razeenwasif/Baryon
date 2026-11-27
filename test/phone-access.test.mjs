import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { createServer as createSocketServer } from 'node:net';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { PhoneAccess, currentNetworks, inSubnet, isPrivate, phoneChat, phoneOverview, reachable } from '../desktop/phone-access.mjs';

const HOME = { name: 'en0', address: '127.0.0.1', netmask: '255.0.0.0', gateway: '127.0.0.254' };

async function setup({ networks = [HOME], approvals = [], answered = [], now } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-phone-')), path = join(dir, 'phone.json'), events = [], current = { networks, approvals };
  const phone = new PhoneAccess({ path, port: 0, every: 1e7, now,
    networks: async () => current.networks,
    overview: () => ({ chats: [], approvals: current.approvals }),
    chat: async id => ({ id }),
    answer: (id, decision) => answered.push([id, decision]),
    onEvent: event => events.push(event) });
  const done = async () => { await phone.stop(); await rm(dir, { recursive: true, force: true }); };
  return { phone, path, events, current, done, dir };
}
function call(phone, path, { method = 'GET', headers = {}, body, host } = {}) {
  const port = phone.server.address().port, address = phone.here.address, name = host ?? `${address}:${port}`;
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: address, port, path, method, headers: { Host: name, ...(body !== undefined ? { 'Content-Type': 'application/json', Origin: `http://${name}` } : {}), ...headers } }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', part => { text += part; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text, json: () => JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(body !== undefined ? JSON.stringify(body) : undefined);
  });
}
const codeOf = pairing => new URL(pairing.url).hash.slice('#pair='.length);
async function paired(phone) {
  const response = await call(phone, '/api/pair', { method: 'POST', body: { code: codeOf(phone.pair()) }, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone)' } });
  assert.equal(response.status, 200);
  return response.headers['set-cookie'][0].split(';')[0];
}

test('stays closed until it is turned on', async () => {
  const { phone, done } = await setup();
  await phone.start();
  assert.equal(phone.server, null);
  assert.throws(() => phone.pair(), /Turn on/);
  await done();
});
test('only ever counts Wi-Fi or Ethernet on a private network with a router as home', async () => {
  const interfaces = () => ({
    lo0: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }],
    utun3: [{ family: 'IPv4', internal: false, address: '10.8.0.2', netmask: '255.255.255.0' }],
    en5: [{ family: 'IPv4', internal: false, address: '8.8.8.8', netmask: '255.255.255.0' }],
    en6: [{ family: 'IPv4', internal: false, address: '192.168.9.2', netmask: '255.255.255.0' }],
    en0: [{ family: 'IPv6', internal: false, address: 'fe80::1' }, { family: 'IPv4', internal: false, address: '192.168.68.52', netmask: '255.255.252.0' }],
  });
  const command = async (name, args) => args[1] === 'en0' ? '192.168.68.1\n' : '';
  assert.deepEqual(await currentNetworks({ interfaces, command }), [{ name: 'en0', address: '192.168.68.52', netmask: '255.255.252.0', gateway: '192.168.68.1' }]);
});
test('private addresses and subnets', () => {
  for (const address of ['10.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.1.1']) assert.equal(isPrivate(address), true);
  for (const address of ['8.8.8.8', '172.32.0.1', '100.64.0.1', '169.254.1.1', 'fe80::1']) assert.equal(isPrivate(address), false);
  const home = { address: '192.168.68.52', netmask: '255.255.252.0' };
  assert.equal(inSubnet('192.168.71.9', home), true);
  assert.equal(inSubnet('::ffff:192.168.69.1', home), true);
  assert.equal(inSubnet('192.168.72.1', home), false);
  assert.equal(inSubnet('8.8.8.8', home), false);
  assert.equal(inSubnet('fe80::1', home), false);
  assert.equal(inSubnet(undefined, home), false);
});
test('refuses to turn on with no home network to be found', async () => {
  const { phone, done } = await setup({ networks: [] });
  await assert.rejects(phone.setEnabled(true), /router/);
  assert.equal(phone.state().enabled, false);
  await done();
});
test('without pairing a phone gets the empty page and nothing else', async () => {
  const { phone, done } = await setup({ approvals: [{ id: 'a', title: 'Run rm' }] });
  await phone.setEnabled(true);
  const page = await call(phone, '/');
  assert.equal(page.status, 200);
  assert.match(page.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(page.headers['cache-control'], 'no-store');
  assert.doesNotMatch(page.text, /Run rm/);
  for (const file of ['/phone.js', '/phone.css']) assert.equal((await call(phone, file)).status, 200);
  assert.equal((await call(phone, '/api/overview')).status, 401);
  assert.equal((await call(phone, '/api/chat?id=x')).status, 401);
  assert.equal((await call(phone, '/api/overview', { headers: { Cookie: 'fairy_phone=guessed' } })).status, 401);
  assert.equal((await call(phone, '/api/answer', { method: 'POST', body: { id: 'a', decision: 'allow' } })).status, 401);
  assert.equal((await call(phone, '/../../phone.json')).status, 404);
  assert.equal((await call(phone, '/phone.json')).status, 404);
  await done();
});
test('another address pointing at this server is refused, even with a key', async () => {
  const { phone, done } = await setup();
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  assert.equal((await call(phone, '/api/overview', { host: 'evil.example', headers: { Cookie: cookie } })).status, 421);
  assert.equal((await call(phone, '/', { host: 'evil.example' })).status, 421);
  await done();
});
test('a request from outside the network gets no answer at all', async () => {
  const outside = { ...HOME, address: '127.0.0.1', netmask: '255.255.255.255' };
  const { phone, done } = await setup({ networks: [outside] });
  await phone.setEnabled(true);
  const real = phone.here;
  // This client is 127.0.0.1, so make the server's network one it isn't part of.
  phone.here = { ...real, address: '10.1.2.3', netmask: '255.255.255.0' };
  const port = phone.server.address().port;
  await assert.rejects(new Promise((resolve, reject) => { const request = httpRequest({ host: '127.0.0.1', port, path: '/', headers: { Host: `10.1.2.3:${port}` } }, resolve); request.on('error', reject); request.end(); }), /socket hang up|ECONNRESET/);
  phone.here = real;
  await done();
});
test('a form posted from another site is refused', async () => {
  const answered = [], { phone, done } = await setup({ approvals: [{ id: 'a', title: 't', chat: 'c' }], answered });
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  const post = headers => call(phone, '/api/answer', { method: 'POST', body: { id: 'a', decision: 'allow' }, headers: { Cookie: cookie, ...headers } });
  assert.equal((await post({ Origin: 'http://evil.example' })).status, 403);
  assert.equal((await post({ Origin: 'null' })).status, 403);
  assert.equal((await post({ 'Content-Type': 'text/plain' })).status, 403);
  assert.deepEqual(answered, []);
  await done();
});
test('a pairing code works once, runs out, and gives up after wrong tries', async () => {
  let clock = 1000;
  const { phone, events, done } = await setup({ now: () => clock });
  await phone.setEnabled(true);
  const pair = code => call(phone, '/api/pair', { method: 'POST', body: { code } });
  const first = codeOf(phone.pair());
  assert.equal((await pair(first)).status, 200);
  assert.equal((await pair(first)).status, 403);
  const late = codeOf(phone.pair());
  clock += 6 * 60 * 1000;
  assert.equal((await pair(late)).status, 403);
  const code = codeOf(phone.pair());
  for (let tries = 0; tries < 5; tries += 1) assert.equal((await pair('wrong')).status, 403);
  assert.equal((await pair(code)).status, 403);
  assert.equal((await call(phone, '/api/pair', { method: 'POST', body: { code: 7 } })).status, 403);
  assert.equal(phone.state().devices.length, 1);
  assert.equal(events.filter(event => event.type === 'wrong-code').length, 5);
  await done();
});
test('the pairing code isn’t sent in the part of the address a server sees', async () => {
  const { phone, done } = await setup();
  await phone.setEnabled(true);
  const url = new URL(phone.pair().url);
  assert.equal(url.pathname, '/');
  assert.equal(url.search, '');
  assert.match(url.hash, /^#pair=[\w-]{20,}$/);
  await done();
});
test('the key is kept out of reach: hashed on disk, private file, and hidden from page scripts', async () => {
  const { phone, path, done } = await setup();
  await phone.setEnabled(true);
  const response = await call(phone, '/api/pair', { method: 'POST', body: { code: codeOf(phone.pair()) } }), cookie = response.headers['set-cookie'][0];
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const key = cookie.split(';')[0].split('=')[1], saved = await readFile(path, 'utf8');
  assert.equal(saved.includes(key), false);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal(JSON.stringify(phone.state()).includes(JSON.parse(saved).devices[0].hash), false);
  await done();
});
test('a phone answers yes or no once, and nothing wider', async () => {
  const answered = [], { phone, events, done } = await setup({ approvals: [{ id: 'a', title: 'Run tests', chat: 'Build' }], answered });
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  const answer = (id, decision) => call(phone, '/api/answer', { method: 'POST', body: { id, decision }, headers: { Cookie: cookie } });
  for (const wider of ['always', 'auto', 'yes', '']) assert.equal((await answer('a', wider)).status, 400);
  assert.equal((await answer('other', 'allow')).status, 409);
  assert.deepEqual(answered, []);
  assert.equal((await answer('a', 'allow')).status, 200);
  assert.deepEqual(answered, [['a', 'allow']]);
  assert.deepEqual(events.at(-1), { type: 'answered', device: 'iPhone', decision: 'allow', title: 'Run tests', chat: 'Build' });
  await done();
});
test('a step too long to show can be refused from a phone but not allowed', async () => {
  const answered = [], { phone, done } = await setup({ approvals: [{ id: 'a', title: 't', chat: 'c', tooBig: true }], answered });
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  const answer = decision => call(phone, '/api/answer', { method: 'POST', body: { id: 'a', decision }, headers: { Cookie: cookie } });
  assert.equal((await answer('allow')).status, 409);
  assert.equal((await answer('deny')).status, 200);
  assert.deepEqual(answered, [['a', 'deny']]);
  await done();
});
test('an oversized or broken request is turned away', async () => {
  const { phone, done } = await setup();
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  const big = await call(phone, '/api/answer', { method: 'POST', body: { id: 'x'.repeat(4000), decision: 'y'.repeat(9000) }, headers: { Cookie: cookie } }).catch(() => ({ status: 413 }));
  assert.equal(big.status, 413);
  const port = phone.server.address().port, host = `127.0.0.1:${port}`;
  const broken = await new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path: '/api/answer', method: 'POST', headers: { Host: host, Origin: `http://${host}`, 'Content-Type': 'application/json', Cookie: cookie } }, resolve);
    request.on('error', reject); request.end('{not json');
  });
  assert.equal(broken.statusCode, 400);
  await done();
});
test('removing a phone stops its key straight away', async () => {
  const { phone, done } = await setup();
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  assert.equal((await call(phone, '/api/overview', { headers: { Cookie: cookie } })).status, 200);
  await phone.forget(phone.state().devices[0].id);
  assert.equal((await call(phone, '/api/overview', { headers: { Cookie: cookie } })).status, 401);
  await done();
});
test('closes on another network and reopens at home', async () => {
  const { phone, current, done } = await setup();
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  current.networks = [{ ...HOME, gateway: '127.0.0.253' }];
  await phone.refresh();
  assert.equal(phone.server, null);
  assert.equal(phone.state().onOtherNetwork, true);
  assert.equal(phone.state().listening, false);
  current.networks = [];
  await phone.refresh();
  assert.equal(phone.server, null);
  current.networks = [HOME];
  await phone.refresh();
  assert.equal(phone.state().onOtherNetwork, false);
  assert.equal((await call(phone, '/api/overview', { headers: { Cookie: cookie } })).status, 200);
  current.networks = [{ ...HOME, netmask: '255.255.0.0' }];
  await phone.refresh();
  assert.equal(phone.server, null);
  assert.equal(phone.state().onOtherNetwork, true);
  await done();
});
test('turning off closes it, and it comes back on its own only if it was on', async () => {
  const { phone, path, done } = await setup();
  await phone.setEnabled(true);
  const again = new PhoneAccess({ path, port: 0, every: 1e7, networks: async () => [HOME], overview: () => ({}), chat: async () => ({}), answer: () => {} });
  await phone.setEnabled(false);
  assert.equal(phone.server, null);
  await again.start();
  assert.equal(again.server, null);
  await phone.setEnabled(true);
  await phone.stop();
  await again.start();
  assert.ok(again.server);
  await again.stop();
  await done();
});
test('a bad pairing never leaves a code behind once turned off', async () => {
  const { phone, done } = await setup();
  await phone.setEnabled(true);
  phone.pair();
  assert.equal(phone.state().pairing, true);
  await phone.setEnabled(false);
  assert.equal(phone.state().pairing, false);
  await done();
});
test('a phone sees work sessions and what they’re waiting on', () => {
  const state = { running: { b: 'waiting', c: 'working' }, sessions: [
    { id: 'a', title: 'Old', updatedAt: '2026-01-01', work: 'proj' }, { id: 'b', title: 'Waiting', updatedAt: '2026-01-02', work: 'proj' },
    { id: 'c', title: 'Busy', updatedAt: '2026-01-03', work: 'proj' }, { id: 'd', title: 'Personal chat', updatedAt: '2026-01-04', work: '' }] };
  const long = { id: 'long', kind: 'command', title: 'Huge', command: 'x'.repeat(300 * 1024) };
  const { chats, approvals } = phoneOverview(state, id => id === 'b' ? { approvals: [{ id: 'q', kind: 'edit', title: 'Edit', detail: 'd', diff: { rows: [{ type: '+', text: 'x' }] }, secret: 'no', alwaysLabel: 'no' }, long] } : null);
  assert.deepEqual(chats.map(chat => [chat.id, chat.state]), [['c', 'working'], ['b', 'waiting'], ['a', 'idle']]);
  assert.equal(approvals[0].chat, 'Waiting');
  assert.deepEqual(approvals[0].diff.rows, [{ type: '+', text: 'x' }]);
  assert.equal(approvals[0].secret, undefined);
  assert.equal(approvals[0].alwaysLabel, undefined);
  assert.equal(approvals[1].tooBig, true);
  assert.equal(approvals[1].command, undefined);
});
test('following a chat shows progress without tool output', () => {
  const history = [{ role: 'user', content: 'go', at: 'x' }, { role: 'system', content: 'hidden' }, { role: 'assistant', content: 'y'.repeat(7000), activity: [{ output: 'secret' }] }, { role: 'user', content: [{ type: 'image' }] }];
  const view = phoneChat({ id: 'a', title: 'T' }, history, { rows: [{ id: 'r', tool: 'read', summary: 'a.js', status: 'done', detail: '3 lines', output: 'file contents' }], tasks: [{ text: 't', status: 'done' }], text: 'hello' }, 'working');
  assert.deepEqual(view.messages.map(message => message.role), ['user', 'assistant']);
  assert.equal(view.messages[1].text.length, 6001);
  assert.equal(JSON.stringify(view).includes('secret'), false);
  assert.equal(JSON.stringify(view).includes('file contents'), false);
  assert.equal(view.live.rows[0].summary, 'a.js');
  assert.equal(phoneChat({ id: 'a', title: 'T' }, [], null, 'idle').live, null);
});
const until = async check => { for (let tries = 0; tries < 200 && !check(); tries += 1) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(check()); };
async function askSocketServer(onConnection) {
  const sockets = new Set(), server = createSocketServer(socket => { sockets.add(socket); socket.on('error', () => {}); onConnection(socket); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const result = await reachable({ address: '127.0.0.1', port: server.address().port, timeout: 100 });
  for (const socket of sockets) socket.destroy();
  await new Promise(resolve => server.close(resolve));
  return result;
}
test('a connection the firewall holds reads as waiting, and one it drops as blocked', async () => {
  assert.equal(await askSocketServer(() => {}), 'waiting');
  assert.equal(await askSocketServer(socket => socket.destroy()), 'blocked');
});
test('a running server finds itself open', async () => {
  const { phone, done } = await setup();
  await phone.setEnabled(true);
  await until(() => phone.state().firewall === 'open');
  await done();
});
test('the firewall’s answer reaches Settings as it changes, and clears when closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-phone-')), answers = ['waiting', 'blocked', 'open'];
  let changes = 0;
  const phone = new PhoneAccess({ path: join(dir, 'phone.json'), port: 0, every: 1e7, networks: async () => [HOME], overview: () => ({}), chat: async () => ({}), answer: () => {}, reach: async () => answers.shift(), onChange: () => { changes += 1; } });
  await phone.setEnabled(true);
  await until(() => phone.state().firewall === 'waiting');
  for (const next of ['blocked', 'open']) {
    const before = changes;
    await phone.refresh();
    await until(() => phone.state().firewall === next && changes > before);
  }
  await phone.setEnabled(false);
  assert.equal(phone.state().firewall, '');
  await phone.stop();
  await rm(dir, { recursive: true, force: true });
});
test('a step that needs full access can be refused from a phone, but never allowed', async () => {
  const answered = [], { phone, done } = await setup({ approvals: [{ id: 'a', title: 't', chat: 'c', kind: 'outside', macOnly: true }], answered });
  await phone.setEnabled(true);
  const cookie = await paired(phone);
  const answer = decision => call(phone, '/api/answer', { method: 'POST', body: { id: 'a', decision }, headers: { Cookie: cookie } });
  const allow = await answer('allow');
  assert.equal(allow.status, 409);
  assert.match(allow.json().error, /only be allowed on the Mac/);
  assert.deepEqual(answered, []);
  assert.equal((await answer('deny')).status, 200);
  assert.deepEqual(answered, [['a', 'deny']]);
  await done();
});

test('a task in the overview carries its progress, current step, parent and done mark', async () => {
  const { phoneOverview } = await import('../desktop/phone-access.mjs');
  const state = { running: { w1: 'working' }, sessions: [
    { id: 'p1', title: 'Notebook search', updatedAt: '2026-11-11T01:00:00Z', work: 'Fairy' },
    { id: 'w1', title: 'Write the release notes', updatedAt: '2026-11-11T02:00:00Z', work: 'Fairy', parent: 'p1' },
    { id: 'w2', title: 'Fix the PDF reset', updatedAt: '2026-11-10T02:00:00Z', work: 'Fairy', done: '2026-11-11T03:00:00Z' },
  ] };
  const snapshot = id => id === 'w1' ? { tasks: [{ text: 'a', status: 'done' }, { text: 'b', status: 'in_progress' }, { text: 'c', status: 'pending' }], rows: [{ id: 's1', summary: 'Read notes.md', status: 'done' }, { id: 's2', summary: 'Edit CHANGELOG.md', status: 'running' }], approvals: [] } : null;
  const { chats } = phoneOverview(state, snapshot);
  const working = chats.find(chat => chat.id === 'w1'), finished = chats.find(chat => chat.id === 'w2');
  assert.deepEqual([working.state, working.parent, working.progress, working.doing], ['working', 'Notebook search', { done: 1, total: 3 }, 'Edit CHANGELOG.md']);
  assert.equal(finished.done, '2026-11-11T03:00:00Z');
  assert.equal(finished.progress, undefined);
});

test('a phone sees her thinking while she replies, and nothing when there is none', () => {
  const live = { rows: [], tasks: [], text: 'Yes.', thinking: 'Thursday has meetings at 9, so the morning is the gap.' };
  assert.equal(phoneChat({ id: 'a', title: 'T' }, [], live, 'working').live.thinking, live.thinking);
  assert.equal('thinking' in phoneChat({ id: 'a', title: 'T' }, [], { ...live, thinking: '' }, 'working').live, false);
});
