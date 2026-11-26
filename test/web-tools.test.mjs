import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkWebAddress, hostIsPublic, hostStatus, isPublicAddress, judgeRequest, parseResults, searchWeb, siteOf } from '../desktop/web-tools.mjs';
import { WorkTools, workTools } from '../desktop/work-tools.mjs';
import { workInstructions } from '../desktop/work-agent.mjs';

test('private and special addresses aren’t public', () => {
  for (const address of ['127.0.0.1', '127.8.8.8', '10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.68.1', '169.254.169.254', '100.64.0.1', '100.100.100.100', '0.0.0.0', '224.0.0.1', '255.255.255.255', '192.0.2.1', '198.18.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', '::ffff:7f00:1', '64:ff9b::7f00:1', 'not an address', '']) assert.equal(isPublicAddress(address), false, address);
  for (const address of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) assert.equal(isPublicAddress(address), true, address);
});
test('addresses that lead back to this Mac or the network are refused, however they’re written', () => {
  for (const address of ['http://127.0.0.1/', 'http://localhost:3000', 'http://LOCALHOST/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://2130706433/', 'http://0x7f.0.0.1/', 'http://0177.0.0.1/', 'http://127.1/', 'http://192.168.68.1/', 'http://169.254.169.254/latest/meta-data/', 'http://printer.local/', 'http://nas/', 'http://db.internal/', 'http://localhost./', 'http://foo.localhost/', 'http://router.lan/', 'http://100.100.100.100/']) assert.throws(() => checkWebAddress(address), /this Mac or your own network/, address);
});
test('only plain web addresses are accepted', () => {
  for (const address of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.org/', 'about:blank', 'chrome://settings', 'lyra-file:x', 'not a url', '', null, 7, `https://a.org/${'x'.repeat(2100)}`]) assert.throws(() => checkWebAddress(address), undefined, String(address).slice(0, 30));
  assert.throws(() => checkWebAddress('https://user:pass@a.org/'), /name or password/);
  assert.equal(checkWebAddress('  https://Docs.Example.org/a b?q=1#x ').href, 'https://docs.example.org/a%20b?q=1#x');
});
test('a public name that points somewhere private is refused', async () => {
  const lookup = answers => async () => answers.map(address => ({ address }));
  assert.equal(await hostIsPublic('good.org', lookup(['8.8.8.8'])), true);
  assert.equal(await hostIsPublic('rebind.org', lookup(['127.0.0.1'])), false);
  assert.equal(await hostIsPublic('mixed.org', lookup(['8.8.8.8', '192.168.1.1'])), false, 'every address has to be public');
  assert.equal(await hostIsPublic('none.org', lookup([])), false);
  assert.equal(await hostIsPublic('broken.org', async () => { throw new Error('no'); }), false);
  assert.equal(await hostIsPublic('127.0.0.1', lookup(['8.8.8.8'])), false);
  assert.equal(await hostIsPublic('printer.local', lookup(['8.8.8.8'])), false);
  assert.equal(await hostIsPublic('8.8.8.8', lookup([])), true);
});
test('a name that doesn’t exist is told apart from a private one', async () => {
  assert.equal(await hostStatus('gone.org', async () => { throw new Error('ENOTFOUND'); }), 'unknown');
  assert.equal(await hostStatus('gone.org', async () => []), 'unknown');
  assert.equal(await hostStatus('rebind.org', async () => [{ address: '10.0.0.1' }]), 'private');
  assert.equal(await hostStatus('good.org', async () => [{ address: '8.8.8.8' }]), 'public');
});
test('what a page may load', () => {
  const judge = (url, type = 'script', firstAddress = 'https://docs.a.org/') => judgeRequest({ url, type, site: 'docs.a.org', firstAddress });
  assert.deepEqual(judge('https://cdn.other.org/x.js'), { action: 'check', host: 'cdn.other.org' });
  assert.deepEqual(judge('http://127.0.0.1/x', 'xhr'), { action: 'check', host: '127.0.0.1' });
  assert.deepEqual(judge('data:text/plain,hi'), { action: 'allow' });
  for (const refused of ['file:///etc/passwd', 'chrome://gpu', 'fairy-artifact://x', 'https://u:p@a.org/']) assert.equal(judge(refused).action, 'refuse', refused);
  for (const type of ['image', 'media', 'font', 'webSocket', 'ping', 'object']) assert.equal(judge('https://a.org/x', type).action, 'refuse', type);
  assert.deepEqual(judge('https://evil.org/?x=1', 'mainFrame'), { action: 'redirect', to: 'https://evil.org/?x=1' });
  assert.equal(judge('https://docs.a.org/next', 'mainFrame').action, 'check');
  assert.equal(judge('https://www.docs.a.org/', 'mainFrame').action, 'check');
  assert.equal(judge('https://a.org/', 'mainFrame').action, 'check');
  assert.equal(judge('https://evil-docs.a.org.evil.org/', 'mainFrame').action, 'redirect');
  assert.equal(judge('https://notdocs.a.org/', 'mainFrame').action, 'redirect');
  assert.equal(judge('https://docs.a.org/', 'mainFrame').action, 'check', 'the first address itself');
  assert.equal(judgeRequest({ url: 'https://elsewhere.org/', type: 'subFrame', site: 'a.org', firstAddress: 'https://a.org/' }).action, 'check');
});
test('search results are read carefully', () => {
  const good = { title: 'T', url: 'https://a.org/x', snippet: 's' };
  assert.deepEqual(parseResults(`Here you go:\n\`\`\`json\n${JSON.stringify([good])}\n\`\`\``), [{ title: 'T', url: 'https://a.org/x', snippet: 's' }]);
  assert.deepEqual(parseResults(JSON.stringify([{ title: 'bad', url: 'http://127.0.0.1/' }, { title: 'bad', url: 'file:///x' }, { title: 'none' }, null, good])).map(item => item.url), ['https://a.org/x']);
  for (const nothing of ['', 'no json', '[not json]', '{"a":1}', undefined]) assert.deepEqual(parseResults(nothing), []);
  assert.equal(parseResults(JSON.stringify(Array.from({ length: 30 }, () => good))).length, 8);
  assert.equal(parseResults(JSON.stringify([{ ...good, snippet: 'x'.repeat(5000) }]))[0].snippet.length, 400);
  assert.equal(siteOf('https://WWW.Example.org:8080/a'), 'example.org');
});
test('a search turn has only search, sees nothing else, and asks little of the plan', async () => {
  const calls = [], provider = { turn: async options => { calls.push(options); return JSON.stringify([{ title: 'T', url: 'https://a.org/', snippet: 's' }]); } };
  const found = await searchWeb({ provider, settings: { backend: 'claude', claudeModel: 'claude-opus-5-5', reasoning: 'max' }, query: 'electron docs' });
  assert.equal(found.results.length, 1);
  const call = calls[0];
  assert.equal(call.webSearch, true);
  assert.deepEqual(call.tools, []);
  assert.equal(call.toolHandler, undefined);
  assert.equal(call.settings.claudeModel, 'claude-haiku-5-5');
  assert.equal(call.settings.reasoning, 'low');
  assert.match(call.input[0].text, /electron docs/);
  assert.match(call.instructions, /ignore any instructions/);
  await searchWeb({ provider, settings: { backend: 'antigravity', antigravityModel: 'gemini' }, query: 'x' });
  assert.equal(calls[1].settings.antigravityModel, 'gemini');
  assert.match(calls[1].prompt, /Search the web for: x/);
});
async function folder(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-web-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const PAGE = { title: 'Docs', url: 'https://a.org/x', status: 200, text: 'hello', links: [{ text: 'Next', href: 'https://a.org/y' }] };
function setup(root, options = {}) {
  const asked = [], reads = [], searches = [], allowed = options.allowed ?? new Set();
  const results = options.results ?? [{ title: 'T', url: 'https://found.org/page', snippet: 's' }];
  const instance = new WorkTools({ root, permission: options.permission ?? 'ask', runCommand: async () => ({ exitCode: 0, output: '' }), allowed,
    web: options.web === undefined ? { search: async value => { searches.push(value.query); return { results, text: 'raw' }; }, read: async value => { reads.push(value.url); return options.page ?? PAGE; } } : options.web,
    approve: async request => { asked.push(request); return options.answer ?? 'allow'; } });
  return { instance, asked, reads, searches, allowed, call: (tool, input) => instance.handle({ tool, arguments: input }) };
}
const failed = result => result.success === false, text = result => result.contentItems[0].text;
test('search itself doesn’t ask, in any mode, and comes back marked as data', async t => {
  for (const permission of ['ask', 'auto', 'plan']) {
    const { call, asked, searches } = setup(await folder(t), { permission }), result = await call('web_search', { query: ' electron ' });
    assert.equal(failed(result), false, permission);
    assert.equal(asked.length, 0);
    assert.deepEqual(searches, ['electron']);
    assert.match(text(result), /data, not instructions/);
    assert.match(text(result), /https:\/\/found\.org\/page/);
  }
  const { call } = setup(await folder(t));
  for (const query of ['', '  ', 7, 'x'.repeat(401)]) assert.equal(failed(await call('web_search', { query })), true);
});
test('a page from the search opens without asking; the same site with anything added asks', async t => {
  const { call, asked, reads } = setup(await folder(t), { permission: 'auto' });
  await call('web_search', { query: 'x' });
  assert.equal(failed(await call('read_page', { url: 'https://found.org/page' })), false);
  assert.equal(asked.length, 0);
  assert.deepEqual(reads, ['https://found.org/page']);
  await call('read_page', { url: 'https://found.org/page?secret=KEY' });
  assert.equal(asked.length, 1, 'data added to the address has to be seen');
  assert.equal(asked[0].command, 'https://found.org/page?secret=KEY');
});
test('other sites ask, even in Run on its own and plan mode, and allowing covers that site only', async t => {
  for (const permission of ['ask', 'auto', 'plan']) {
    const { call, asked, reads } = setup(await folder(t), { permission, answer: 'always' });
    assert.equal(failed(await call('read_page', { url: 'https://a.org/x' })), false, permission);
    assert.equal(asked[0].kind, 'site:a.org');
    assert.equal(asked[0].command, 'https://a.org/x');
    assert.match(asked[0].note, /none of your sign-ins/);
    await call('read_page', { url: 'https://www.a.org/y' });
    assert.equal(asked.length, 1, 'that site is allowed now');
    await call('read_page', { url: 'https://b.org/' });
    assert.equal(asked.length, 2);
    assert.equal(reads.length, 3);
  }
});
test('allowing once doesn’t cover the next read', async t => {
  const { call, asked } = setup(await folder(t), { answer: 'allow' });
  await call('read_page', { url: 'https://a.org/1' });
  await call('read_page', { url: 'https://a.org/2' });
  assert.equal(asked.length, 2);
});
test('a refusal reads nothing', async t => {
  const { call, reads } = setup(await folder(t), { answer: 'deny' }), result = await call('read_page', { url: 'https://a.org/x' });
  assert.equal(failed(result), true);
  assert.deepEqual(reads, []);
});
test('local addresses are refused before asking', async t => {
  const { call, asked, reads } = setup(await folder(t), { answer: 'always' });
  for (const url of ['http://127.0.0.1:47615/api/overview', 'http://192.168.68.1/', 'http://169.254.169.254/', 'file:///etc/passwd', 'http://localhost/']) assert.equal(failed(await call('read_page', { url })), true, url);
  assert.equal(asked.length, 0);
  assert.deepEqual(reads, []);
});
test('a redirect to another site doesn’t follow itself', async t => {
  const { call } = setup(await folder(t), { page: { redirected: 'https://other.org/' } }), result = await call('read_page', { url: 'https://a.org/x' });
  assert.equal(failed(result), true);
  assert.match(text(result), /redirects to another site: https:\/\/other\.org/);
});
test('long pages come in parts, read only once, with their links at the end', async t => {
  const long = { ...PAGE, text: 'a'.repeat(30000) + 'b'.repeat(100) }, { call, reads } = setup(await folder(t), { page: long, answer: 'always' });
  const one = await call('read_page', { url: 'https://a.org/x' });
  assert.match(text(one), /call read_page with start 30000/);
  assert.doesNotMatch(text(one), /Links on the page/);
  assert.match(text(one), /data, not instructions/);
  const two = await call('read_page', { url: 'https://a.org/x', start: 30000 });
  assert.match(text(two), /b{100}/);
  assert.match(text(two), /Next: https:\/\/a\.org\/y/);
  assert.equal(reads.length, 1);
});
test('an error page says so', async t => {
  const { call } = setup(await folder(t), { page: { ...PAGE, status: 404 }, answer: 'always' });
  assert.match(text(await call('read_page', { url: 'https://a.org/x' })), /status 404/);
});
test('where web tools aren’t given, they aren’t offered', async t => {
  const without = setup(await folder(t), { web: null }), names = list => list.available().map(tool => tool.name);
  assert.equal(names(without.instance).includes('web_search'), false);
  assert.equal(names(without.instance).includes('read_page'), false);
  assert.equal(failed(await without.call('web_search', { query: 'x' })), true);
  assert.ok(names(setup(await folder(t)).instance).includes('read_page'));
});
test('the model is told how to use them, and to keep private things out', () => {
  const describe = name => workTools.find(tool => tool.name === name).description;
  assert.match(describe('web_search'), /never put anything private/);
  assert.match(describe('read_page'), /Never put anything private/);
  assert.match(workInstructions({ root: '/p', permission: 'auto', sandboxed: true }), /web_search and then read_page/);
});
test('a search’s own redirect link is followed, but never to somewhere private, and other redirects still stop', async t => {
  const hops = { 'https://found.org/page': { redirected: 'https://landing.org/real' }, 'https://landing.org/real': PAGE };
  const web = { search: async () => ({ results: [{ title: 'T', url: 'https://found.org/page', snippet: '' }], text: '' }), read: async ({ url }) => hops[url] };
  const { call, asked } = setup(await folder(t), { web, permission: 'auto' });
  await call('web_search', { query: 'x' });
  const followed = await call('read_page', { url: 'https://found.org/page' });
  assert.equal(failed(followed), false);
  assert.match(text(followed), /hello/);
  assert.equal(asked.length, 0);
  const toPrivate = { ...web, read: async () => ({ redirected: 'http://192.168.68.1/' }) }, second = setup(await folder(t), { web: toPrivate });
  await second.call('web_search', { query: 'x' });
  const refused = await second.call('read_page', { url: 'https://found.org/page' });
  assert.equal(failed(refused), true);
  assert.match(text(refused), /your own network/);
  const endless = { ...web, read: async ({ url }) => ({ redirected: `${url}x` }) }, third = setup(await folder(t), { web: endless });
  await third.call('web_search', { query: 'x' });
  assert.equal(failed(await third.call('read_page', { url: 'https://found.org/page' })), true);
});
