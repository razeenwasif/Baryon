// "Improving existing features", item 2: a work turn keeps the Mac from idle sleep on mains power, not only when the
// iPhone link asks; on battery without the link it may sleep, and the turn picks up after waking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workAwakeWanted } from '../desktop/power-awareness.mjs';

test('a running work turn holds the Mac awake on mains power or with the iPhone link, and only then', () => {
  assert.equal(workAwakeWanted({ running: 1, onBattery: false }), true, 'on mains power');
  assert.equal(workAwakeWanted({ running: 2, phoneHolds: true, onBattery: true }), true, 'the phone link on battery');
  assert.equal(workAwakeWanted({ running: 1, onBattery: true }), false, 'battery, no link');
  assert.equal(workAwakeWanted({ running: 0, phoneHolds: true, onBattery: false }), false, 'nothing running');
  assert.equal(workAwakeWanted(), false);
});

test('main asks the power source each time, and checks again when it changes', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /try \{ onBattery = powerMonitor\.isOnBatteryPower\(\); \} catch \{\}\n\s+const wanted = workAwakeWanted\(\{ running: workRuns\?\.size \|\| 0, phoneHolds: Boolean\(phoneLink\?\.holdsAwake\), onBattery \}\);/);
  assert.match(main, /powerMonitor\.on\('on-ac', syncWorkAwake\); powerMonitor\.on\('on-battery', syncWorkAwake\);/);
  assert.match(main, /workAwake = powerSaveBlocker\.start\('prevent-app-suspension'\)/);
  assert.match(main, /workAwakeWanted:awakeRule\}=await import\('\.\/power-awareness\.mjs'\);workAwakeWanted=awakeRule;/);
});
