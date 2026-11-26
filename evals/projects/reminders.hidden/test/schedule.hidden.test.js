process.env.TZ = 'Australia/Sydney';
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTimes } from '../src/schedule.js';

const local = time => [time.getMonth() + 1, time.getDate(), time.getDay(), time.getHours(), time.getMinutes()];

test('it stays at 9 am when daylight saving starts (4 October 2026)', () => {
  assert.deepEqual(nextTimes(new Date(2026, 9, 1, 9, 0), 3).map(local), [[10, 1, 4, 9, 0], [10, 8, 4, 9, 0], [10, 15, 4, 9, 0]]);
});

test('it stays at 9 am when daylight saving ends (5 April 2026)', () => {
  assert.deepEqual(nextTimes(new Date(2026, 3, 2, 9, 0), 3).map(local), [[4, 2, 4, 9, 0], [4, 9, 4, 9, 0], [4, 16, 4, 9, 0]]);
});

test('a whole year of Monday 6.30 pm reminders all go off at 6.30 pm on a Monday', () => {
  const times = nextTimes(new Date(2026, 0, 5, 18, 30), 52);
  assert.equal(times.length, 52);
  assert.ok(times.every(time => time.getDay() === 1 && time.getHours() === 18 && time.getMinutes() === 30));
  assert.deepEqual(local(times[51]), [12, 28, 1, 18, 30]);
});

test('the first time is the one it was given, and the list doesn’t share it', () => {
  const first = new Date(2026, 5, 4, 9, 0), times = nextTimes(first, 2);
  assert.equal(times[0].getTime(), first.getTime());
  times[0].setHours(10);
  assert.equal(first.getHours(), 9);
  assert.deepEqual(nextTimes(first, 0), []);
});
