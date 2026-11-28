import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { AgyCheck, CHECKS, STEPS, codePicture, outcome } from '../desktop/agy-check.mjs';

// Reads the digits back out of a code picture, cell by cell, the way a person would.
function pixels(url: string) {
  const bytes = Buffer.from(url.split(',')[1], 'base64');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  let data = Buffer.alloc(0);
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8);
    if (type === 'IDAT') data = Buffer.concat([data, bytes.subarray(at + 8, at + 8 + length)]);
    at += 12 + length;
  }
  const raw = inflateSync(data);
  return { width, height, raw, at: (x: number, y: number) => raw[y * (width + 1) + 1 + x] };
}
const cells = (picture: ReturnType<typeof pixels>, slot: number) => Array.from({ length: 35 }, (_, i) => picture.at(48 + slot * 84 + (i % 5) * 12 + 6, 48 + Math.floor(i / 5) * 12 + 6) === 0 ? '1' : '0').join('');
const GLYPHS = Array.from({ length: 10 }, (_, d) => cells(pixels(codePicture(String(d)).url), 0));
const readCode = (url: string) => { const picture = pixels(url), count = (picture.width - 96 + 24) / 84; return Array.from({ length: count }, (_, slot) => GLYPHS.indexOf(cells(picture, slot))).join(''); };

test('the code picture is a real PNG that holds the code', () => {
  const picture = codePicture('405172');
  assert.match(picture.url, /^data:image\/png;base64,/);
  assert.deepEqual([picture.width, picture.height], [576, 180]);
  const { raw } = pixels(picture.url);
  assert.equal(raw.length, (576 + 1) * 180);
  assert.equal(new Set(GLYPHS).size, 10, 'every digit looks different');
  assert.equal(readCode(picture.url), '405172');
});

test('a check passes or fails on what Gemini actually did', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agy-check-')), settings = { antigravityModel: 'gemini-test' };
  const run = (key: string, connection: any) => (CHECKS as any)[key]({ connection, settings, signal: new AbortController().signal, dir });
  // Screen: only the code in the picture counts, whatever is said around it.
  assert.deepEqual(await run('screen', { chat: async (_s: any, _h: any, _t: any, _signal: any, shot: any) => ({ text: `Your code is ${readCode(shot.url).replace(/(\d{3})/, '$1 ')}.` }) }), { ok: true });
  const guessed = await run('screen', { chat: async () => ({ text: 'The code is 123456.' }) });
  assert.equal(guessed.ok, false); assert.match(guessed.detail, /The code was \d{6}, and Gemini said “The code is 123456\.”/);
  await assert.rejects(run('screen', { chat: async () => { throw new Error('Gemini tried to use a tool (read_file), so Fairy stopped this reply.'); } }), /read_file/);
  // Search: Fairy's own evidence check is what decides.
  let options: any;
  assert.deepEqual(await run('search', { chat: async (...args: any[]) => { options = args[5]; return { text: 'Node 26 ([nodejs.org](https://nodejs.org)).' }; } }), { ok: true });
  assert.deepEqual(options, { webSearch: true });
  // Tools: the tool has to run, and its code has to come back.
  const tools = (handler: (req: any) => Promise<any>) => run('tools', { turn: async (request: any) => handler(request) });
  assert.deepEqual(await tools(async ({ toolHandler }) => (await toolHandler({ tool: 'check_code', arguments: {} })).contentItems[0].text.match(/[0-9a-f]{8}/)[0]), { ok: true });
  assert.match((await tools(async () => 'deadbeef')).detail, /never called/);
  assert.match((await tools(async ({ toolHandler }) => { await toolHandler({}); return 'Done.'; })).detail, /didn’t have its code/);
  // Tool-free chat: a refusal passes; reading the file or reaching for a tool fails.
  const chat = (reply: (path: string) => Promise<any>) => run('chat', { chat: async (_s: any, _h: any, text: string) => reply(text.match(/open (\S+) and/)![1]) });
  assert.deepEqual(await chat(async () => ({ text: 'I can’t open files.' })), { ok: true });
  assert.match((await chat(async path => ({ text: (await readFile(path, 'utf8')).trim() }))).detail, /read a file in plain chat/);
  assert.match((await chat(async () => { throw new Error('Gemini tried to use a tool (read_file), so Fairy stopped this reply.'); })).detail, /no longer keep plain chat free of tools/);
  await assert.rejects(chat(async () => { throw new Error('Antigravity timed out. Please try again.'); }), /timed out/);
  assert.deepEqual(await readdir(dir), [], 'the note is removed every time');
});

test('the outcome tells a change in agy from Gemini being out of reach', () => {
  const step = (ok: boolean, detail?: string, thrown = !ok) => ({ ok, detail, thrown }) as any;
  assert.equal(outcome([step(true), step(true)]), 'ok');
  assert.equal(outcome([step(false, 'The code was 1, and Gemini said “2”.', false), step(true)]), 'failed');
  assert.equal(outcome([step(false, 'Antigravity: please sign in again'), step(false, 'getaddrinfo ENOTFOUND example')]), 'unreachable');
  assert.equal(outcome([step(false, 'Antigravity timed out. Please try again.'), step(false, 'Antigravity: please sign in again')]), 'failed', 'a new agy that hangs is a change, not an outage');
});

function harness({ results = {}, version = '1.5.2', record = {}, ...rest }: Record<string, any> = {}) {
  const saved: any[] = [], changes: any[] = [], failures: any[] = [], calls: string[] = [];
  const checks = Object.fromEntries(STEPS.map(({ key }) => [key, async (context: any) => {
    calls.push(key); assert.equal(context.settings.backend, 'antigravity');
    const result = typeof results[key] === 'function' ? await results[key](context) : results[key];
    if (result instanceof Error) throw result;
    return result ?? { ok: true };
  }])) as any;
  let current = version;
  const check = new AgyCheck({ path: '/x/agy-check.json', dir: '/x/agy-check', connection: {} as any, settings: (() => ({ backend: 'claude', antigravityModel: 'gemini-test' })) as any, checks,
    readJSON: async () => structuredClone(record), writeJSON: async (_path, value) => { saved.push(structuredClone(value)); },
    version: typeof version === 'function' ? version : async () => current, onChange: value => changes.push(value), onFailure: last => failures.push(last), now: () => new Date('2026-11-07T07:00:00Z'), ...rest });
  return { check, saved, changes, failures, calls, setVersion: (next: string) => { current = next; } };
}

test('Fairy checks each new agy version once, and says when one breaks', async () => {
  const h = harness();
  await h.check.load();
  const first = (await h.check.tick())!;
  assert.equal(first.status, 'ok'); assert.equal(first.version, '1.5.2'); assert.equal(first.reason, 'update');
  assert.deepEqual(h.calls, ['screen', 'search', 'tools', 'chat']);
  assert.deepEqual(h.changes.filter(c => c.running).map(c => [c.running.index, c.running.label]), [[0, 'Screen questions'], [1, 'Web search'], [2, 'Tools'], [3, 'Tool-free chat']]);
  assert.equal(h.changes.at(-1).running, null); assert.equal(h.changes.at(-1).last.status, 'ok');
  assert.equal(h.saved.at(-1).checkedVersion, '1.5.2');
  assert.equal(await h.check.tick(), null, 'the same version isn’t checked twice'); assert.equal(h.calls.length, 4);
  h.setVersion('1.5.3');
  const broken = harness({ record: h.saved.at(-1), version: '1.5.3', results: { screen: { ok: false, detail: 'The code was 1, and Gemini said “2”.' } } });
  await broken.check.load();
  assert.equal((await broken.check.tick())!.status, 'failed');
  assert.equal(broken.failures.length, 1); assert.equal(broken.failures[0].steps[0].label, 'Screen questions');
  assert.equal(broken.saved.at(-1).checkedVersion, '1.5.3');
  // After a relaunch, a failed version gets one more try, quietly, in case Fairy was updated to cope.
  const relaunched = harness({ record: broken.saved.at(-1), version: '1.5.3' });
  await relaunched.check.load();
  assert.equal(relaunched.check.state().last!.status, 'failed', 'the last result shows before anything runs');
  const retry = (await relaunched.check.tick())!;
  assert.equal(retry.status, 'ok'); assert.equal(retry.reason, 'retry'); assert.equal(relaunched.failures.length, 0);
  assert.equal(await relaunched.check.tick(), null);
});

test('the check waits for Gemini to be in use and reachable', async () => {
  const unused = harness({ inUse: () => false });
  assert.equal(await unused.check.tick(), null); assert.equal(unused.calls.length, 0);
  const asleep = harness({ quiet: () => true });
  assert.equal(await asleep.check.tick(), null); assert.equal(asleep.calls.length, 0);
  const missing = harness({ version: async () => { throw new Error('Install the Antigravity CLI (agy).'); } });
  assert.equal(await missing.check.tick(), null);
  const offline = harness({ results: Object.fromEntries(STEPS.map(({ key }) => [key, new Error('getaddrinfo ENOTFOUND cloudcode-pa.googleapis.com')])) });
  const last = (await offline.check.tick())!;
  assert.equal(last.status, 'unreachable'); assert.equal(offline.failures.length, 0, 'no alarm for being offline');
  assert.equal(offline.saved.at(-1).checkedVersion, undefined, 'so the next tick tries again');
  assert.deepEqual(last.steps[0], { key: 'screen', label: 'Screen questions', ok: false, detail: 'getaddrinfo ENOTFOUND cloudcode-pa.googleapis.com', thrown: true, seconds: 0 });
});

test('only one check runs at a time, a manual one never alarms, and quitting stops it', async () => {
  let release!: (val: any) => void;
  const h = harness({ results: { screen: () => new Promise(resolve => { release = resolve; }), search: { ok: false, detail: 'no' } } });
  const first = h.check.run(), second = h.check.run();
  assert.equal(first, second);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.check.state().running!.label, 'Screen questions');
  release({ ok: true });
  const last = await first;
  assert.equal(last.reason, 'manual'); assert.equal(last.status, 'failed'); assert.equal(h.failures.length, 0);
  const stopped = harness({ results: { screen: ({ signal }: { signal: AbortSignal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped.')))) } });
  const pending = stopped.check.run();
  await new Promise(resolve => setImmediate(resolve));
  stopped.check.stop();
  await assert.rejects(pending);
  assert.equal(stopped.saved.length, 0); assert.equal(stopped.check.state().running, null);
});

test('every tick checks Gemini can still sign in for Fairy’s tools, and says once when it can’t', async () => {
  const answers: any[] = [{ ok: true }, { ok: false, signIn: true, detail: 'Antigravity: authentication failed or timed out' }, { ok: false, signIn: true, detail: 'Antigravity: authentication failed or timed out' }, { ok: false, detail: 'Individual quota reached.' }, { ok: true }, { ok: false, signIn: true, detail: 'again' }];
  const lost: string[] = [];
  const h = harness({ signIn: async () => answers.shift(), onSignInLost: (found: any) => lost.push(found.detail) });
  await h.check.load();
  await h.check.tick();
  assert.equal(h.saved.at(-1).signIn.ok, true);
  assert.equal(h.saved.at(-1).checkedVersion, '1.5.2', 'the version check still ran, and kept the sign-in result');
  await h.check.tick();
  assert.deepEqual(lost, ['Antigravity: authentication failed or timed out']);
  assert.equal(h.check.state().signIn!.ok, false);
  await h.check.tick();
  assert.equal(lost.length, 1, 'not told again while it stays lost');
  await h.check.tick();
  assert.equal(lost.length, 1, 'a used-up plan isn’t a lost sign-in');
  await h.check.tick(); await h.check.tick();
  assert.deepEqual(lost, ['Antigravity: authentication failed or timed out', 'again'], 'told again after it came back and was lost once more');
});
