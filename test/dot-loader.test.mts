import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DOT_CYCLE, dotPlan } from '../src/dot-loader.js';

test('each kind of dot loader lights its dots in its own order', () => {
  const scan = dotPlan('scan'), orbit = dotPlan('orbit'), pulse = dotPlan('pulse'), twinkle = dotPlan('twinkle');
  for (const plan of [scan, orbit, pulse, twinkle]) assert.equal(plan.length, 16);
  // Scan runs across in columns: every dot in a column together.
  assert.deepEqual(scan.slice(0, 4).map(dot => dot.delay), [0, 120, 240, 360]);
  assert.deepEqual(scan.map(dot => dot.delay).slice(4, 8), scan.map(dot => dot.delay).slice(0, 4));
  // Orbit leaves out the corners, holds the middle lit and circles the ring once a cycle.
  assert.deepEqual([0, 3, 12, 15].map(index => orbit[index].dot), ['gap', 'gap', 'gap', 'gap']);
  assert.deepEqual([5, 6, 9, 10].map(index => orbit[index].dot), ['hold', 'hold', 'hold', 'hold']);
  assert.equal(orbit[1].delay, 0);
  assert.equal(orbit[4].delay, DOT_CYCLE * 7 / 8);
  // Pulse beats from the middle, the rest just after.
  assert.deepEqual([5, 6, 9, 10].map(index => pulse[index].delay), [0, 0, 0, 0]);
  assert.equal(pulse[1].delay, DOT_CYCLE * 0.16);
  // Twinkle uses every dot, each at its own moment.
  assert.equal(new Set(twinkle.map(dot => dot.delay)).size, 16);
});

test('the dot field is strongest at the pointer and fades to nothing at its reach', async () => {
  const { dotInfluence, DOT_FIELD } = await import('../src/dot-field.js');
  assert.equal(dotInfluence(0), 1);
  assert.equal(dotInfluence(DOT_FIELD.radius), 0);
  assert.equal(dotInfluence(DOT_FIELD.radius * 2), 0);
  const steps = [0, 0.25, 0.5, 0.75].map(share => dotInfluence(DOT_FIELD.radius * share));
  for (let i = 1; i < steps.length; i++) assert(steps[i] < steps[i - 1], 'falls with distance');
});
