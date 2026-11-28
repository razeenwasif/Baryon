import test from 'node:test';
import assert from 'node:assert/strict';
import { VocalTimer } from '../src/vocal-timer.js';
import { cleanSettings } from '../desktop/core.mjs';
test('ambient vocals wait through activity and respect a persisted attempt cooldown', () => {
  let now = 10000000;
  const timer = new VocalTimer({ now: () => now, random: () => 0, lastAttempt: now });
  now += 19 * 60000; assert.equal(timer.due(false), false);
  timer.defer(); now += 19 * 60000; assert.equal(timer.due(false), false);
  now += 60000; assert.equal(timer.due(true), false); assert.equal(timer.due(false), true);
  timer.attempted(); assert.equal(timer.due(false), false);
});
test('stop snooze survives subsequent quiet deferrals and hum-only never selects singing', () => {
  let now = 10000000;
  const timer = new VocalTimer({ now: () => now, random: () => .9 });
  timer.snooze(); timer.defer(); now += 25 * 60000; assert.equal(timer.due(false), false);
  assert.equal(timer.choose('hum'), 'hum'); assert.equal(timer.choose('mixed'), 'sing');
});
test('automatic vocals stay opt-in and reject unsupported modes and frequencies', () => {
  assert.equal(cleanSettings().vocalMode, 'off');
  assert.throws(() => cleanSettings({ vocalMode: 'song-name' } as any), /vocal settings/);
  assert.throws(() => cleanSettings({ vocalMinutes: '0' } as any), /vocal settings/);
});
