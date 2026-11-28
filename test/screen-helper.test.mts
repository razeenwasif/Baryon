// Efficiency audit, fix 7: one long-lived fairy-screen takes every picture, and an unchanged screen costs nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { ScreenHelper } from '../desktop/screen-helper.mjs';

interface FakeChild extends EventEmitter {
  args: string[];
  requests: any[];
  ended: boolean;
  killed: boolean;
  stdout: PassThrough;
  stderr: PassThrough;
  stdin: Writable;
  reply: (bytes: Buffer, size?: number) => void;
  kill: () => void;
}

const png = (text: string) => Buffer.from(`\x89PNG${text}`);
const frame = (header: Record<string, any>, body?: Buffer) => Buffer.concat([Buffer.from(`${JSON.stringify(body ? { ...header, bytes: body.length } : header)}\n`), body || Buffer.alloc(0)]);

// A fake helper per spawn. answer(request, child) decides each reply; replies can be split into chunks of any size.
function fixture({ answer = (request: any, child: FakeChild) => child.reply(frame({ id: request.id, width: 10, height: 5 }, png(`#${request.id}`))) }: { answer?: (request: any, child: FakeChild) => void } = {}) {
  const children: FakeChild[] = [], timers: Array<{ fn: () => void; ms: number } | null> = [];
  const spawnProcess = (_path: string, args: string[]) => {
    const child = new EventEmitter() as FakeChild;
    child.args = args; child.requests = []; child.ended = false; child.killed = false;
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.reply = (bytes, size = bytes.length) => { for (let i = 0; i < bytes.length; i += size) child.stdout.write(bytes.subarray(i, i + size)); };
    child.kill = () => { child.killed = true; child.emit('close', null); };
    child.stdin = new Writable({ write(chunk, _encoding, callback) { const request = JSON.parse(chunk); child.requests.push(request); callback(); queueMicrotask(() => answer(request, child)); },
      final(callback) { child.ended = true; callback(); queueMicrotask(() => child.emit('close', 0)); } });
    children.push(child); return child;
  };
  const helper = new ScreenHelper({ path: '/fake/fairy-screen', spawnProcess: spawnProcess as any, schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clear: id => { timers[(id as number) - 1] = null; } });
  const pending = (ms: number) => timers.filter((timer): timer is { fn: () => void; ms: number } => Boolean(timer && timer.ms === ms));
  const fire = (ms: number) => { const due = pending(ms); assert.equal(due.length, 1); timers[timers.indexOf(due[0])] = null; due[0].fn(); };
  return { helper, children, pending, fire };
}
const request = { displayID: 1, excludePID: 4321, foregroundOnly: 0, width: 10, height: 5 };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('one process takes every picture, and a picture arrives as bytes, never as text', async () => {
  const f = fixture();
  const first = (await f.helper.capture(request))!, second = (await f.helper.capture(request))!;
  assert.equal(f.children.length, 1, 'no process per capture');
  assert.deepEqual(f.children[0].args, ['--serve']);
  assert.equal(first.url, `data:image/png;base64,${png('#1').toString('base64')}`);
  assert.deepEqual([first.width, first.height], [10, 5]);
  assert.notEqual(second.url, first.url);
  assert.deepEqual(f.children[0].requests.map(r => r.id), [1, 2]);
});

test('an unchanged screen gives back the same picture, with no new bytes', async () => {
  const f = fixture({ answer: (r, child) => child.reply(r.id === 1 ? frame({ id: 1, width: 10, height: 5 }, png('#1')) : frame({ id: r.id, unchanged: true, sameAs: 1, width: 10, height: 5 })) });
  const first = await f.helper.capture(request), again = await f.helper.capture(request);
  assert.equal(again, first, 'the very same picture object: nothing new in memory');
  assert.equal(f.children[0].requests.length, 2);
});

test('answers split anywhere, or run together, are read whole', async () => {
  const f = fixture({ answer: (r, child) => { if (r.id === 1) child.reply(frame({ id: 1, width: 10, height: 5 }, png('x'.repeat(5000))), 7); } });
  const picture = (await f.helper.capture(request))!;
  assert.ok(Buffer.from(picture.url.split(',')[1], 'base64').equals(png('x'.repeat(5000))), 'every byte, in order');
  const g = fixture({ answer: (r, child) => { if (r.id === 2) child.reply(Buffer.concat([frame({ id: 1, width: 1, height: 1 }, png('a')), frame({ id: 2, width: 2, height: 2 }, png('b'))])); } });
  const early = g.helper.capture(request).catch(error => error), late = g.helper.request(request);
  assert.equal((await late)!.width, 2);
  assert.equal(g.helper.last!.picture.width, 2);
  void early;
});

test('an "unchanged" about a picture this side doesn’t have asks again for a fresh one', async () => {
  const f = fixture({ answer: (r, child) => child.reply(r.force ? frame({ id: r.id, width: 10, height: 5 }, png('fresh')) : frame({ id: r.id, unchanged: true, sameAs: 99, width: 10, height: 5 })) });
  const picture = (await f.helper.capture(request))!;
  assert.equal(picture.url, `data:image/png;base64,${png('fresh').toString('base64')}`);
  assert.deepEqual(f.children[0].requests.map(r => r.force ?? 0), [0, 1]);
});

test('a picture nobody waits for any more is still kept, so the next "unchanged" has it', async () => {
  let release!: () => void;
  const f = fixture({ answer: (r, child) => { if (r.id === 1) release = () => child.reply(frame({ id: 1, width: 10, height: 5 }, png('late'))); else child.reply(frame({ id: r.id, unchanged: true, sameAs: 1, width: 10, height: 5 })); } });
  const stop = new AbortController();
  const first = f.helper.capture(request, stop.signal);
  await settle(); stop.abort();
  await assert.rejects(first);
  release(); await settle();
  const next = (await f.helper.capture(request))!;
  assert.equal(next.url, `data:image/png;base64,${png('late').toString('base64')}`);
});

test('errors are passed on, and a helper that hangs is replaced for the next picture', async () => {
  const f = fixture({ answer: (r, child) => { if (r.id === 1) child.reply(frame({ id: 1, error: 'The selected display is no longer available.' })); } });
  await assert.rejects(f.helper.capture(request), /no longer available/);
  const hanging = f.helper.capture(request);
  await settle();
  f.fire(6000);
  await assert.rejects(hanging, /timed out/);
  assert.equal(f.children[0].killed, true);
  void f.helper.capture(request).catch(() => {});
  assert.equal(f.children.length, 2, 'a new helper for the next picture');
});

test('a helper that stops on its own fails what it was asked, and the next picture starts another', async () => {
  const f = fixture({ answer: (r, child) => { if (child === f.children[0]) child.emit('close', 3); else child.reply(frame({ id: r.id, width: 1, height: 1 }, png('ok'))); } });
  await assert.rejects(f.helper.capture(request), /stopped/);
  assert.equal((await f.helper.capture(request))!.width, 1);
  assert.equal(f.children.length, 2);
});

test('a minute with nothing to take stops the helper, and the next picture starts it again', async () => {
  const f = fixture();
  await f.helper.capture(request);
  assert.equal(f.pending(60000).length, 1);
  f.fire(60000);
  await settle();
  assert.equal(f.children[0].ended, true, 'its input closed, so it ends');
  assert.equal(f.helper.running, false);
  await f.helper.capture(request);
  assert.equal(f.children.length, 2);
  f.helper.dispose();
});

test('the app takes every picture through it, and the helper is built to be quick', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(main, /helper\([^;]*'fairy-screen'\)/, 'no fairy-screen process per picture');
  assert.equal((main.match(/await screenCapture\(\{/g) || []).length, 2);
  assert.match(main, /screenHelper = new \(await import\('\.\/screen-helper\.mjs'\)\)\.ScreenHelper\(\{ path: nativeBin\('fairy-screen'\) \}\);/);
  const swift = readFileSync(new URL('../native/ScreenCapture.swift', import.meta.url), 'utf8');
  assert.match(swift, /CommandLine\.arguments\.contains\("--serve"\)/);
  assert.match(swift, /"unchanged": true, "sameAs": previous\.id/);
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.match(pkg.scripts['build:screen'], /swiftc -O /);
});
