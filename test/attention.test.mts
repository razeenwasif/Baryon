// Efficiency audit, fix 2: what watches the screen looks only while you're at the Mac, and the watchers share one
// picture instead of taking one each.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_SECONDS, HEARTBEAT_MS, shareMaxAge, watchCadence } from '../desktop/attention.mjs';
import { ScreenAwareness } from '../desktop/awareness.mjs';
import { ConditionalTask } from '../src/conditional-task.js';
import { powerPolicy } from '../desktop/power-awareness.mjs';

test('nothing looks at the screen while you are away, and the heartbeat notices when you are back', () => {
  const here = watchCadence({ base: 5000, idleSeconds: 3 });
  assert.deepEqual(here, { look: true, delay: 5000 }, 'at the Mac: the policy’s own cadence');
  assert.deepEqual(watchCadence({ base: 500, idleSeconds: AWAY_SECONDS - 1 }), { look: true, delay: 500 }, 'still here a second before');
  assert.deepEqual(watchCadence({ base: 500, idleSeconds: AWAY_SECONDS }), { look: false, delay: HEARTBEAT_MS }, 'away: no picture, only a heartbeat');
  assert.ok(HEARTBEAT_MS <= 5000, 'the heartbeat is quick, since it costs only a timer');
  // A watcher the power policy has already stopped stays stopped: that is its decision, not this one.
  assert.deepEqual(watchCadence({ base: 0, idleSeconds: 3 }), { look: false, delay: null });
  assert.deepEqual(watchCadence({ base: powerPolicy({ thermal: 'serious' }).screenMs, idleSeconds: 3 }), { look: false, delay: null }, 'warm: stopped');
  assert.deepEqual(watchCadence(), { look: false, delay: null });
  assert.deepEqual(watchCadence({ base: 5000, idleSeconds: -1 }), { look: true, delay: 5000 }, 'an idle time it couldn’t read counts as here');
});

test('a task that stops looking still comes back by itself', async () => {
  // The real ConditionalTask, on a clock this test turns: a delay it can't use cancels the timer and nothing
  // restarts it, so a watcher that's away must keep a heartbeat rather than stop.
  let idle = 300, looks = 0, pending: { fn: () => void; wait: number } | null = null, ms = 0;
  const task = new ConditionalTask({ enabled: () => true, now: () => ms,
    delay: () => watchCadence({ base: 500, idleSeconds: idle }).delay as number,
    run: () => { if (watchCadence({ base: 500, idleSeconds: idle }).look) looks++; },
    schedule: (fn, wait) => { pending = { fn, wait }; return 1 as any; }, clear: () => { pending = null; } });
  const tick = async () => { const due = pending!; pending = null; ms += due.wait; due.fn(); await Promise.resolve(); await Promise.resolve(); return due.wait; };
  task.sync();
  assert.equal((pending as any).wait, HEARTBEAT_MS, 'away: a heartbeat, not its usual poll');
  for (let beat = 0; beat < 3; beat++) assert.equal(await tick(), HEARTBEAT_MS);
  assert.equal(looks, 0, 'it never looks while you’re away');
  assert.ok(pending as any, 'but it keeps waking');
  idle = 0;
  await tick();
  assert.equal(looks, 1, 'and looks again once you’re back, with nothing needed to restart it');
  assert.equal((pending as any).wait, 500, 'at its usual poll');
});

test('the quiz works from the picture screen awareness took, unless it needs this moment’s screen', () => {
  assert.equal(shareMaxAge({ pollMs: 500, shareMs: 5000 }), 2000, 'scanning: screen awareness’s picture, up to the ceiling');
  assert.equal(shareMaxAge({ pollMs: 500, shareMs: 0 }), 500, 'with awareness off, anything since its own last look');
  assert.equal(shareMaxAge({ pollMs: 4000, shareMs: 0 }), 2000, 'and never older than the ceiling');
  assert.equal(shareMaxAge({ pollMs: 500, shareMs: 5000, hovering: true }), 0, 'dwelling on an answer: this moment’s screen');
  assert.equal(shareMaxAge({ pollMs: 4000, shareMs: 5000, checking: true }), 100, 'checking a question it found: near enough to now');
  assert.equal(shareMaxAge({ pollMs: 0 }), 100);
  assert.equal(shareMaxAge(), 500);
});

test('two watchers sharing one cache take one picture, not two', async () => {
  // Ten seconds of a work session with the quiz on: screen awareness looks every 5 s, the quiz scans every 500 ms.
  const tenSeconds = async (quizMaxAge: number) => {
    let captures = 0, at = 0;
    const screen = new ScreenAwareness({ capture: async () => ({ frame: ++captures }) as any, allowed: () => true, now: () => at });
    for (let step = 0; step < 20; step++) {
      at = step * 500;
      if (at % 5000 === 0) await screen.fresh(undefined, 5000);
      await screen.fresh(undefined, quizMaxAge);
    }
    return captures;
  };
  assert.equal(await tenSeconds(shareMaxAge({ pollMs: 500, shareMs: 5000 })), 5, 'five pictures, shared between the two');
  assert.equal(await tenSeconds(100), 20, 'where before this fix the quiz took its own at every poll, four times as many');
});
