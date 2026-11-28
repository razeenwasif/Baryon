import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduledFor, daysWords, nextOn } from '../desktop/phone-schedule.mjs';

test('days are said as you would say them', () => {
  assert.equal(daysWords([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(daysWords([0, 6]), 'Weekends');
  assert.equal(daysWords([0, 1, 2, 3, 4, 5, 6]), 'Every day');
  assert.equal(daysWords([1, 3]), 'Mon, Wed');
});

test('the brief, check-ins and schedules come with when they next run, soonest first', () => {
  const now = new Date('2026-11-11T12:00:00');   // a Wednesday
  const list = scheduledFor({ now,
    checkIns: { brief: { enabled: true, time: '07:30' }, lastBrief: '2026-11-11', checkIns: { enabled: true, everyHours: 3, quietFrom: '22:00', quietTo: '07:00' }, lastCheck: '2026-11-11T10:00:00' },
    schedules: [{ id: 's1', title: 'Gym reminder', time: '18:00', days: [1, 3, 5], enabled: true }, { id: 's2', title: 'Off', time: '09:00', days: [1], enabled: false }] });
  assert.deepEqual(list.map(item => item.title), ['Check-in', 'Gym reminder', 'Morning brief']);
  assert.equal(new Date(list[0].next!).getHours(), 13);
  assert.equal(new Date(list[1].next!).getDate(), 11);
  assert.equal(new Date(list[2].next!).getDate(), 12);
  assert.equal(list[1].every, 'Mon, Wed, Fri at 6:00 PM');
});

test('a check-in due in quiet hours waits for them to end', () => {
  const now = new Date('2026-11-11T23:00:00');
  const [item] = scheduledFor({ now, checkIns: { brief: { enabled: false }, checkIns: { enabled: true, everyHours: 1, quietFrom: '22:00', quietTo: '07:00' }, lastCheck: '2026-11-11T21:30:00' } as any });
  assert.equal(new Date(item.next!).getHours(), 7);
  assert.equal(new Date(item.next!).getDate(), 12);
  // Wednesday at 11, asked late on a Wednesday: next week's.
  assert.equal(nextOn([3], '11:00', now)!.getDate(), 18);
});
