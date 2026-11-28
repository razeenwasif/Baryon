// Why a request ended: every stop names its reason, and every end is logged with one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { END_REASONS, STOP_NOTES, endReason, stopWith, stoppedWords } from '../desktop/stop-reasons.mjs';
import { WorkRuns } from '../desktop/work-runs.mjs';
import { unfinishedReply } from '../desktop/work-agent.mjs';

test('a stop carries its reason, still reads as an abort, and the end says which', () => {
  for (const reason of Object.keys(STOP_NOTES) as Array<keyof typeof STOP_NOTES>) {
    const controller = new AbortController(); stopWith(controller, reason);
    assert.equal((controller.signal.reason as any).name, 'AbortError'); assert.equal((controller.signal.reason as any).message, STOP_NOTES[reason]);
    assert.equal(endReason({ signal: controller.signal }), reason);
    assert.throws(() => controller.signal.throwIfAborted(), { name: 'AbortError' });
  }
  // The first reason stands; an unknown one is yours; a plain abort is yours too.
  const twice = new AbortController(); stopWith(twice, 'sleep'); stopWith(twice, 'you'); assert.equal(endReason({ signal: twice.signal }), 'sleep');
  const odd = new AbortController(); stopWith(odd, 'nonsense' as any); assert.equal(endReason({ signal: odd.signal }), 'you');
  const plain = new AbortController(); plain.abort(); assert.equal(endReason({ signal: plain.signal }), 'you');
  assert.equal(endReason({ signal: AbortSignal.abort(new DOMException('late', 'TimeoutError')) }), 'timeout');
});

test('with no stop, the error says why: time, a usage limit, signed out, or something else', () => {
  assert.equal(endReason({}), 'done');
  assert.equal(endReason({ error: new Error('Claude Code timed out.') }), 'timeout');
  assert.equal(endReason({ error: new Error('You have hit your usage limit. Try again at 4pm.') }), 'limit');
  assert.equal(endReason({ error: new Error('Sign in to Claude Code with your Claude subscription first.') }), 'signed-out');
  assert.equal(endReason({ error: new Error('ENOENT: no such file') }), 'error');
  for (const reason of ['done', 'you', 'sleep', 'timeout', 'limit', 'signed-out', 'error'] as const) assert.ok(END_REASONS.includes(reason));
});

test('work runs are stopped with a reason, and quitting says so', async () => {
  const runs = new WorkRuns();
  const a = runs.start({ session: 'a', root: '/a' }), b = runs.start({ session: 'b', root: '/b' });
  runs.stop('a'); assert.equal(endReason({ signal: a.controller.signal }), 'you');
  runs.stopAll('sleep'); assert.equal(endReason({ signal: b.controller.signal }), 'sleep');
  const c = new WorkRuns(), run = c.start({ session: 'c', root: '/c' }); run.finished = Promise.resolve();
  await c.stopAndWait(10); assert.equal(endReason({ signal: run.controller.signal }), 'quit');
});

test('an unfinished work turn says why it stopped', () => {
  const tools = { changed: new Set(['a.js']), activity: [{ tool: 'run', status: 'done' }] };
  assert.equal(unfinishedReply(tools as any, new Error('x'), 'sleep'), 'Stopped because your Mac went to sleep, before finishing. Before that, I changed 1 file (a.js) and ran 1 command.');
  assert.equal(unfinishedReply(tools as any, new Error('Stopped.'), 'you'), 'Stopped before finishing. Before that, I changed 1 file (a.js) and ran 1 command.');
  assert.match(unfinishedReply(tools as any, new Error('Claude Code timed out.'), 'timeout'), /^This ran past its time limit/);
  assert.match(unfinishedReply(tools as any, new Error('Boom'), 'error'), /^This stopped with an error: Boom/);
  assert.match(unfinishedReply(tools as any, new Error('Stopped.')), /^Stopped before finishing/, 'with no reason, as before');
  assert.equal(stoppedWords('lock'), 'Stopped because your Mac locked, before finishing.');
});

test('main names the reason at every stop and logs every end', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /if \(stopReasons\)\s*noteEnd\(what, stopReasons\.endReason\(\{ signal: controller\.signal, error: failure \}\), Date\.now\(\) - started\);/);
  for (const [call, reason] of [["stop('Stopped because your Mac went to sleep.', 'sleep')", 'sleep'], ["stop('Stopped because your Mac locked.', 'lock')", 'lock'], ["workRuns?.stopAll('sleep')", 'sleep'], ["abortFor(active, 'senses')", 'senses'], ["stop('', 'quit')", 'quit']]) assert.ok(main.includes(call), reason);
  assert.match(main, /\}, 'chat'\);\n\s+\/\/ A turn the window started/);
  assert.match(main, /noteEnd\('work', ended, Date\.now\(\) - turnStarted\);/);
  assert.match(main, /outcome: finished \? 'done' : signal\.aborted \? 'stopped' : 'failed', end: ended/);
  assert.match(main, /unfinished: true, ended,/);
});
