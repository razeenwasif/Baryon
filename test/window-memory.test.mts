import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { WindowMemory } = createRequire(import.meta.url)('../desktop/window-memory.cjs') as {
  WindowMemory: new (options: {
    window: unknown;
    reclaimMs?: number;
    schedule?: (fn: () => void, ms: number) => unknown;
    clear?: (timer: any) => void;
    onReclaim?: () => void;
    onRestore?: () => void;
  }) => {
    reclaimed: boolean;
    setVisible: (visible: unknown) => void;
    dispose: () => void;
  };
};

interface ScheduledTimer {
  fn: () => void;
  ms: number;
}

function fixture({ reclaimMs = 15_000, destroyed = false } = {}) {
  const throttlingCalls: boolean[] = [], sends: Array<[string, unknown]> = [], timers: Array<ScheduledTimer | null> = [];
  let invalidated = 0, reclaims = 0, restores = 0;
  const state = { destroyed };
  const window = {
    isDestroyed: () => state.destroyed,
    webContents: {
      setBackgroundThrottling: (value: boolean) => throttlingCalls.push(value),
      send: (channel: string, value: unknown) => sends.push([channel, value]),
      invalidate: () => { invalidated++; },
    },
  };
  const manager = new WindowMemory({
    window,
    reclaimMs,
    schedule: (fn: () => void, ms: number) => { timers.push({ fn, ms }); return timers.length; },
    clear: (id: number) => { timers[id - 1] = null; },
    onReclaim: () => { reclaims++; },
    onRestore: () => { restores++; },
  });
  const pending = () => timers.filter((entry): entry is ScheduledTimer => Boolean(entry));
  const fireTimer = () => {
    const due = pending();
    assert.equal(due.length, 1, 'expected one pending timer');
    timers[timers.indexOf(due[0])] = null;
    due[0].fn();
  };
  return {
    state, manager, throttlingCalls, sends, pending, fireTimer,
    counts: () => ({ invalidated, reclaims, restores }),
  };
}

test('setVisible(false) enables background throttling immediately and reclaims after reclaimMs', () => {
  const f = fixture();
  f.manager.setVisible(false);
  assert.deepEqual(f.throttlingCalls, [true]);
  assert.equal(f.pending().length, 1);
  assert.equal(f.pending()[0].ms, 15_000);
  assert.deepEqual(f.sends, []);
  assert.equal(f.counts().reclaims, 0);

  f.fireTimer();
  assert.deepEqual(f.sends, [['fairy:memory-idle', true]]);
  assert.equal(f.counts().reclaims, 1);
  assert.equal(f.manager.reclaimed, true);
});

test('returning setVisible(true) before reclaimMs cancels reclamation, disables throttling, and invalidates', () => {
  const f = fixture();
  f.manager.setVisible(false);
  assert.equal(f.pending().length, 1);

  f.manager.setVisible(true);
  assert.equal(f.pending().length, 0);
  assert.deepEqual(f.throttlingCalls, [true, false]);
  assert.deepEqual(f.sends, [], 'no fairy:memory-idle signal sent when returning before reclaimMs');
  assert.deepEqual(f.counts(), { invalidated: 1, reclaims: 0, restores: 0 });
});

test('returning setVisible(true) after reclaim clears memory-idle, calls onRestore, disables throttling, and invalidates', () => {
  const f = fixture();
  f.manager.setVisible(false);
  f.fireTimer();
  f.manager.setVisible(true);

  assert.deepEqual(f.throttlingCalls, [true, false]);
  assert.deepEqual(f.sends, [['fairy:memory-idle', true], ['fairy:memory-idle', false]]);
  assert.deepEqual(f.counts(), { invalidated: 1, reclaims: 1, restores: 1 });
  assert.equal(f.manager.reclaimed, false);
});

test('destroyed or disposed windows never throw or fire callbacks', () => {
  const f = fixture();
  f.manager.setVisible(false);
  f.state.destroyed = true;
  f.fireTimer();
  assert.deepEqual(f.sends, []);
  assert.equal(f.counts().reclaims, 0);

  f.manager.setVisible(true);
  assert.deepEqual(f.throttlingCalls, [true]);
  assert.equal(f.counts().invalidated, 0);

  const g = fixture();
  g.manager.setVisible(false);
  g.manager.dispose();
  assert.equal(g.pending().length, 0);
  g.manager.setVisible(true);
  assert.deepEqual(g.throttlingCalls, [true]);
});
