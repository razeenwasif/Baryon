import test from 'node:test';
import assert from 'node:assert/strict';
import { weekView, weekStart, dayKey, weekSource } from '../desktop/phone-week.mjs';

const at = (text: string) => new Date(text);
test('the week runs Monday to Sunday around today', () => {
  assert.equal(dayKey(weekStart(at('2026-11-12T15:00:00'))), '2026-11-09');
  assert.equal(dayKey(weekStart(at('2026-11-15T23:00:00'))), '2026-11-09');
  assert.equal(dayKey(weekStart(at('2026-11-16T01:00:00'))), '2026-11-16');
});

test('events land on their days, meetings left are counted, and a deadline is counted down to', () => {
  const now = at('2026-11-11T12:00:00');
  const week = [
    { title: 'COMP3600 lecture', start: '2026-11-10T10:00:00', end: '2026-11-10T11:00:00' },
    { title: 'Lunch with Sam', start: '2026-11-11T13:30:00', end: '2026-11-11T14:30:00' },
    { title: 'Public holiday', start: '2026-11-13', end: '2026-11-14', allDay: true },
  ];
  const ahead = [week[1], { title: 'Lab report due', start: '2026-11-20T17:00:00', end: '2026-11-20T17:30:00' }, { title: 'COMP3600 exam', start: '2026-11-27T09:00:00', end: '2026-11-27T12:00:00' }];
  const view = weekView({ now, week, ahead, unread: 33, calendar: { connected: true }, email: { connected: true } });
  assert.equal(view.start, '2026-11-09');
  assert.equal(view.days.length, 7);
  assert.deepEqual(view.days.map(day => day.events.length), [0, 1, 1, 0, 1, 0, 0]);
  assert.deepEqual(view.meetings, { week: 2, left: 1 });
  assert.equal(view.unread, 33);
  assert.equal(view.countdown!.title, 'Lab report due');
  assert.equal(view.countdown!.days, 9);
});

test('with Gmail and Calendar off for the phone, nothing is fetched', async () => {
  let asked = 0;
  const google = { status: () => ({ connected: true }), events: async () => { asked += 1; return { events: [] }; }, unreadEstimate: async () => { asked += 1; return 1; } };
  const view = await weekSource({ calendar: google, gmail: google, allowed: () => false })();
  assert.equal(asked, 0);
  assert.equal(view.sources.calendar.off, true);
  assert.equal(view.unread, null);
});

test('a dropped sign-in says why', async () => {
  const google = { status: () => ({ connected: true }), events: async () => ({ events: [] }), unreadEstimate: async () => 4 };
  const gmail = { status: () => ({ connected: false, error: 'Google sign-in expired or was rejected. Reconnect Gmail in Settings.' }) };
  const view = await weekSource({ calendar: google, gmail: gmail as any })();
  assert.equal(view.sources.email.connected, false);
  assert.match(view.sources.email.error, /expired/);
  assert.equal(view.unread, null);
});
