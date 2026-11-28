import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createTcp, connect, type AddressInfo, type Socket } from 'node:net';
import { createServer as createHttp, request } from 'node:http';
import { pinnedProxy, publicAddresses } from '../desktop/web-tools.mjs';

const PUBLIC = '93.184.216.34', PRIVATE = '192.168.1.1';
type Answers = string[] | ((name: string, time: number) => string[]);

// What stands in for the internet: a server on this Mac that says back whatever it's sent.
async function echo(t: TestContext): Promise<number> {
  const server = createTcp(socket => { socket.on('error', () => {}); socket.on('data', bytes => socket.write(`echo:${bytes}`)); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return (server.address() as AddressInfo).port;
}
// A proxy whose "public" addresses all lead to `upstream`, recording where it was asked to connect and what it looked up.
async function proxyFor(t: TestContext, { answers, upstream }: { answers: Answers; upstream: number }) {
  const dialed: Array<{ host: string; port: number }> = [], looked: string[] = [];
  const lookup = async (name: string) => { looked.push(name); const next = typeof answers === 'function' ? answers(name, looked.length) : answers; return next.map(address => ({ address })); };
  const proxy = await pinnedProxy({ lookup, connect: ({ host, port }: { host: string; port: number }) => { dialed.push({ host, port }); return connect({ host: '127.0.0.1', port: upstream }); } });
  t.after(() => proxy.close());
  return { proxy, dialed, looked };
}
// Ask the proxy for a tunnel, as a browser does for https; resolves to the status line and the open socket.
function tunnel(port: number, target: string): Promise<{ status: string; socket: Socket }> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: '127.0.0.1', port });
    let head = '';
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    const onData = (bytes: Buffer) => { head += bytes; if (head.includes('\r\n\r\n')) { socket.off('data', onData); resolve({ status: head.split('\r\n')[0], socket }); } };
    socket.on('data', onData);
    socket.on('close', () => resolve({ status: head.split('\r\n')[0] || 'closed', socket }));
  });
}
const said = (socket: Socket): Promise<string> => new Promise(resolve => socket.once('data', (bytes: Buffer) => resolve(String(bytes))));

test('a tunnel goes to the address that was looked up, and bytes pass through', async t => {
  const upstream = await echo(t), { proxy, dialed, looked } = await proxyFor(t, { answers: [PUBLIC], upstream });
  const { status, socket } = await tunnel(proxy.port, 'site.fairytest.org:443');
  t.after(() => socket.destroy());
  assert.match(status, /^HTTP\/1\.1 200/);
  socket.write('hello');
  assert.equal(await said(socket), 'echo:hello');
  assert.deepEqual(dialed, [{ host: PUBLIC, port: 443 }], 'the connection is to the checked address, not the name');
  assert.deepEqual(looked, ['site.fairytest.org'], 'one lookup serves the check and the connection');
});

test('a name that changes its answer can’t reach this Mac or the network', async t => {
  // Public the first time it's asked, private ever after: the trick the browser's own second lookup fell for.
  const upstream = await echo(t), { proxy, dialed, looked } = await proxyFor(t, { answers: (_name, time) => time === 1 ? [PUBLIC] : [PRIVATE], upstream });
  const first = await tunnel(proxy.port, 'rebind.fairytest.org:443');
  t.after(() => first.socket.destroy());
  assert.match(first.status, /^HTTP\/1\.1 200/);
  assert.deepEqual(dialed, [{ host: PUBLIC, port: 443 }]);
  const second = await tunnel(proxy.port, 'rebind.fairytest.org:443');
  assert.match(second.status, /^HTTP\/1\.1 403/, 'the private answer is refused');
  assert.equal(dialed.length, 1, 'and nothing is connected to for it');
  assert.equal(looked.length, 2);
});

test('private addresses are refused however they’re named, with nothing connected', async t => {
  const upstream = await echo(t), { proxy, dialed, looked } = await proxyFor(t, { answers: [PUBLIC, PRIVATE], upstream });
  for (const target of ['127.0.0.1:443', '[::1]:443', '169.254.169.254:80', '10.0.0.5:8080', 'localhost:3000', 'printer.local:443', 'router:80']) {
    assert.match((await tunnel(proxy.port, target)).status, /^HTTP\/1\.1 403/, target);
  }
  assert.deepEqual(looked, [], 'none of those needs a lookup to refuse');
  // A name with one public address and one private one is refused whole.
  assert.match((await tunnel(proxy.port, 'mixed.fairytest.org:443')).status, /^HTTP\/1\.1 403/);
  assert.deepEqual(dialed, []);
  assert.match((await tunnel(proxy.port, 'site.fairytest.org:99999')).status, /^HTTP\/1\.1 400/, 'a port that can’t exist');
  // A request too garbled to parse is dropped without an answer.
  assert.equal((await tunnel(proxy.port, 'not a host')).status, 'closed');
  assert.deepEqual(dialed, []);
});

test('a name that doesn’t exist is refused, and one that can’t be reached is a gateway error', async t => {
  const upstream = await echo(t);
  const missing = await proxyFor(t, { answers: [], upstream });
  assert.match((await tunnel(missing.proxy.port, 'nowhere.fairytest.org:443')).status, /^HTTP\/1\.1 403/);
  const dead = await pinnedProxy({ lookup: async () => [{ address: PUBLIC }], connect: () => connect({ host: '127.0.0.1', port: 1 }) });
  t.after(() => dead.close());
  assert.match((await tunnel(dead.port, 'down.fairytest.org:443')).status, /^HTTP\/1\.1 502/);
});

test('plain http is sent on to the checked address with its own host and path', async t => {
  const seen: Array<{ url: string | undefined; host: string | undefined; proxy: string | string[] | undefined }> = [];
  const site = createHttp((incoming, outgoing) => { seen.push({ url: incoming.url, host: incoming.headers.host, proxy: incoming.headers['proxy-connection'] }); outgoing.writeHead(200, { 'content-type': 'text/plain' }).end('a page'); });
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  t.after(() => site.close());
  const { proxy, dialed } = await proxyFor(t, { answers: name => name.startsWith('inside') ? [PRIVATE] : [PUBLIC], upstream: (site.address() as AddressInfo).port });
  const get = (address: string): Promise<{ status: number | undefined; body: string }> => new Promise((resolve, reject) => {
    const asking = request({ host: '127.0.0.1', port: proxy.port, path: address, headers: { host: new URL(address).host, 'proxy-connection': 'keep-alive' } }, answer => { let body = ''; answer.on('data', part => { body += part; }); answer.on('end', () => resolve({ status: answer.statusCode, body })); });
    asking.on('error', reject); asking.end();
  });
  assert.deepEqual(await get('http://site.fairytest.org/a/b?c=1'), { status: 200, body: 'a page' });
  assert.deepEqual(seen, [{ url: '/a/b?c=1', host: 'site.fairytest.org', proxy: undefined }]);
  assert.deepEqual(dialed, [{ host: PUBLIC, port: 80 }]);
  assert.equal((await get('http://inside.fairytest.org/admin')).status, 403);
  assert.equal((await get('http://127.0.0.1:8080/')).status, 403);
  assert.equal(seen.length, 1, 'nothing private was asked for anything');
});

test('the browser is told to send everything through it, loopback included', async t => {
  const proxy = await pinnedProxy({ lookup: async () => [] });
  t.after(() => proxy.close());
  assert.deepEqual(proxy.rules, { mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${proxy.port};https=127.0.0.1:${proxy.port}`, proxyBypassRules: '<-loopback>' });
  await assert.rejects(publicAddresses('localhost'), /private/);
  await assert.rejects(publicAddresses('one.fairytest.org', async () => [{ address: '8.8.8.8' }, { address: '::1' }]), /private/);
  assert.deepEqual(await publicAddresses('two.fairytest.org', async () => [{ address: '8.8.8.8' }, { address: '2606:4700:4700::1111' }]), ['8.8.8.8', '2606:4700:4700::1111']);
});
