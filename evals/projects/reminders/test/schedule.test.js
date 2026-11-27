process.env.TZ = 'Australia/Sydney';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTimes } from '../src/schedule.js';

test('a weekly reminder comes round on the same day at the same time', () => {
  const times = nextTimes(new Date(2026, 5, 4, 9, 0), 4);
  assert.deepEqual(times.map(time => [time.getDate(), time.getDay(), time.getHours(), time.getMinutes()]), [[4, 4, 9, 0], [11, 4, 9, 0], [18, 4, 9, 0], [25, 4, 9, 0]]);
});
