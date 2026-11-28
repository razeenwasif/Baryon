import test from 'node:test'; import assert from 'node:assert/strict';
import { isListeningCancellation, startListeningSession } from '../src/listening-start.js';
const aborted = () => Error("Error invoking remote method 'fairy:ambient-prepare': AbortError: This operation was aborted.");
test('recognizes native and IPC-wrapped cancellation without masking genuine errors', () => {
  assert(isListeningCancellation(new DOMException('Aborted', 'AbortError'))); assert(isListeningCancellation(aborted()));
  assert(!isListeningCancellation(Error('Microphone permission denied'))); assert(!isListeningCancellation(Error('Network timeout')));
});
test('cancelled startup retries and starts exactly one microphone', async () => {
  let prepares = 0, starts = 0, cancels = 0; const delays: number[] = [];
  const ok = await startListeningSession({ cancel: async () => { cancels++; }, prepare: async () => { if (++prepares < 3) throw aborted(); }, start: async () => { starts++; }, current: () => true, wait: async ms => { delays.push(ms); } });
  assert(ok); assert.equal(prepares, 3); assert.equal(cancels, 3); assert.equal(starts, 1); assert.deepEqual(delays, [150, 300]);
});
test('pause/off during retry stops quietly without reacquiring the microphone', async () => {
  let wanted = true, starts = 0, prepares = 0;
  const ok = await startListeningSession({ cancel: async () => {}, prepare: async () => { prepares++; throw aborted(); }, start: async () => { starts++; }, current: () => wanted, wait: async () => { wanted = false; } });
  assert.equal(ok, false); assert.equal(starts, 0); assert.equal(prepares, 1);
});
test('late cancellation from obsolete preparation neither faults nor starts a stale session', async () => {
  let wanted = true, starts = 0;
  const ok = await startListeningSession({ cancel: async () => {}, prepare: async () => { wanted = false; throw aborted(); }, start: async () => { starts++; }, current: () => wanted });
  assert.equal(ok, false); assert.equal(starts, 0);
});
test('persistent cancellations have a bounded retry count and useful error; permissions never retry', async () => {
  for (const [failure, expected, count] of [[aborted(), /interrupted repeatedly/, 3], [Error('Permission denied'), /Permission denied/, 1]] as Array<[Error, RegExp, number]>) {
    let prepares = 0; await assert.rejects(() => startListeningSession({ cancel: async () => {}, prepare: async () => { prepares++; throw failure; }, start: async () => assert.fail(), current: () => true, wait: async () => {} }), expected); assert.equal(prepares, count);
  }
});
