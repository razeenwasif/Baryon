// Efficiency audit, fix 3: the power policy hears whether you're at the Mac and whether anyone can see the window.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AWAY_SECONDS, IDLE_SECONDS, PowerAwareness, powerPolicy } from '../desktop/power-awareness.mjs';
import { ConditionalTask } from '../src/conditional-task.js';

test('two idle minutes is battery saver, ten or a locked screen pauses the background, and nobody sees a thing drawn', () => {
  const here = powerPolicy({ idleSeconds: 30 });
  assert.deepEqual([here.level, here.away, here.fps, here.screenMs, here.warmProvider, here.label], [0, 0, 30, 5000, true, 'Normal power']);
  const idle = powerPolicy({ idleSeconds: IDLE_SECONDS });
  assert.deepEqual([idle.level, idle.away, idle.fps, idle.screenMs, idle.quizMs, idle.warmProvider, idle.optional, idle.label], [1, 1, 20, 15000, 1000, false, true, 'Idle · reduced activity']);
  const away = powerPolicy({ idleSeconds: AWAY_SECONDS });
  assert.deepEqual([away.level, away.away, away.fps, away.screenMs, away.quizMs, away.playbackMs, away.optional, away.handsFree, away.label], [2, 2, 0, 0, 0, 0, false, true, 'Away · background paused'],
    'away: no captures and nothing drawn, but hands-free listening still hears you come back');
  assert.deepEqual([powerPolicy({ locked: true }).away, powerPolicy({ locked: true }).fps], [2, 0], 'a locked screen is away');
  const hidden = powerPolicy({ visible: false });
  assert.deepEqual([hidden.level, hidden.fps, hidden.screenMs, hidden.optional], [0, 0, 5000, true], 'a window nobody can see draws nothing, and nothing else changes');
  assert.equal(powerPolicy({ visible: true }).fps, 30);
});

test('upkeep carries on while you’re away; only power and heat pause it', () => {
  assert.equal(powerPolicy({ idleSeconds: 3600 }).maintenance, true, 'reflection and the notes index catch up while you’re away');
  assert.equal(powerPolicy({ locked: true }).maintenance, true);
  assert.equal(powerPolicy({ thermal: 'serious' }).maintenance, false);
  assert.equal(powerPolicy({ onBattery: true, batteryPercent: 15 }).maintenance, false);
  assert.equal(powerPolicy({ onBattery: true }).maintenance, true, 'battery saver still allows it');
  // The stricter of the two wins, and power's own label shows when power is the reason.
  const both = powerPolicy({ thermal: 'serious', idleSeconds: IDLE_SECONDS });
  assert.deepEqual([both.level, both.powerLevel, both.away, both.label], [2, 2, 1, 'Warm · background paused']);
  assert.equal(powerPolicy({ onBattery: true, idleSeconds: AWAY_SECONDS }).label, 'Away · background paused');
  assert.equal(powerPolicy({ idleSeconds: -5 }).away, 0, 'an idle time it couldn’t read counts as here');
});

// A monitor whose idle time and lock state the test sets, and a clock it turns.
function fixture() {
  const monitor = new EventEmitter();
  monitor.isOnBatteryPower = () => false; monitor.getCurrentThermalState = () => 'nominal';
  let idle = 0;
  monitor.getSystemIdleTime = () => idle;
  const watched = [], changes = [];
  const power = new PowerAwareness({ monitor, changed: policy => changes.push(policy), schedule: () => 0, clear: () => {},
    watch: { schedule: (fn, ms) => { watched.push({ fn, ms }); return watched.length; }, clear: id => { watched[id - 1] = null; } } });
  const next = () => watched.findLast(Boolean);
  const tick = seconds => { idle = seconds; const due = next(); watched[watched.indexOf(due)] = null; due.fn(); return power.state(); };
  return { monitor, power, changes, next, tick, setIdle: seconds => { idle = seconds; } };
}

test('idle time is read slowly while you’re here and quickly once you’re away, and coming back is immediate', () => {
  const f = fixture();
  assert.equal(f.next().ms, 30000, 'here: a look every 30 s at most');
  assert.equal(f.tick(100).level, 0);
  assert.equal(f.next().ms, 20000, 'and the next lands when the two minutes would be up');
  assert.equal(f.tick(IDLE_SECONDS).level, 1);
  assert.equal(f.next().ms, 5000, 'away: a look every five seconds, to notice you’re back');
  const away = f.tick(AWAY_SECONDS);
  assert.deepEqual([away.level, away.fps, away.screenMs], [2, 0, 0]);
  const back = f.tick(1);
  assert.deepEqual([back.level, back.fps, back.screenMs], [0, 30, 5000], 'back at once, with no recovery wait');
  assert.deepEqual(f.changes.map(policy => policy.away), [1, 2, 0], 'each change is published once');
  f.power.dispose();
  assert.equal(f.next(), undefined, 'disposing stops the idle reader');
});

test('locking the screen is away at once, and sleep stops the idle reader until the Mac wakes', () => {
  const f = fixture();
  f.monitor.emit('lock-screen');
  assert.equal(f.power.state().away, 2);
  f.setIdle(0);
  f.monitor.emit('unlock-screen');
  assert.equal(f.power.state().away, 0);
  f.monitor.emit('suspend');
  assert.equal(f.next(), undefined, 'asleep: no idle reads');
  f.monitor.emit('resume');
  assert.ok(f.next(), 'awake: reading again');
  f.power.dispose();
  assert.equal(f.monitor.eventNames().length, 0);
});

test('a hidden window draws nothing until it’s shown again', () => {
  const f = fixture();
  f.power.setVisible(false);
  assert.equal(f.power.state().fps, 0);
  f.power.setVisible(true);
  assert.equal(f.power.state().fps, 30);
  assert.deepEqual(f.changes.map(policy => policy.fps), [0, 30]);
  f.power.dispose();
});

test('after ten idle minutes captures and drawing stop, and both resume when you’re back', () => {
  const f = fixture();
  // The screen-awareness task as main.cjs builds it, on the policy: it owns a timer only while captures are allowed.
  let timers = 0;
  const capture = new ConditionalTask({ enabled: () => f.power.state().screenMs > 0, delay: () => f.power.state().screenMs, run: async () => {},
    schedule: () => ++timers, clear: () => {} });
  capture.sync();
  assert.ok(capture.timer !== null);
  f.tick(AWAY_SECONDS);
  capture.sync(true);
  assert.equal(capture.timer, null, 'away: no capture timer at all');
  assert.equal(f.power.state().fps, 0, 'and nothing drawn');
  f.tick(0);
  capture.sync(true);
  assert.ok(capture.timer !== null, 'back: capturing again');
  assert.equal(f.power.state().fps, 30);
  capture.dispose(); f.power.dispose();
});
