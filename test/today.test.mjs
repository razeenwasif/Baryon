import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanSettings, DEFAULTS } from '../desktop/core.mjs';
import { homeSummary, nextRoutine, runningChats, upcomingEvents, whenLabel } from '../src/today.js';

async function loadTodayPane() {
  const raw = readFileSync(new URL('../src/today-pane.js', import.meta.url), 'utf8')
    .replace("import './today.css';", '')
    .replace("'./conditional-task.js'", JSON.stringify(new URL('../src/conditional-task.js', import.meta.url).href))
    .replace("'./today.js'", JSON.stringify(new URL('../src/today.js', import.meta.url).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(raw).toString('base64')}`)).todayPane;
}

// A Saturday afternoon, in the Mac's own time zone.
const now = new Date(2026, 10, 7, 14, 0, 0);
const at = (day, hour, minute = 0, second = 0) => new Date(2026, 10, day, hour, minute, second).toISOString();

test('events show what is happening now, what is next and when', () => {
  const events = upcomingEvents([
    { title: 'Ended', start: at(7, 9), end: at(7, 10) },
    { title: 'Tutorial', start: at(7, 13, 30), end: at(7, 15) },
    { title: 'Coffee', start: at(7, 14, 25), end: at(7, 15) },
    { title: 'Dinner', start: at(7, 19), end: at(7, 21) },
    { title: 'Exam', start: at(8, 9), end: at(8, 12) },
    { title: 'Holiday', start: '2026-11-07', end: '2026-11-08', allDay: true },
    { title: 'Conference', start: '2026-11-08', end: '2026-11-09', allDay: true },
    { title: '', start: at(7, 16) },
  ], now);
  assert.deepEqual(events.map(e => e.title), ['Tutorial', 'Coffee', 'Dinner', 'Exam', 'Holiday', 'Conference'], 'past and untitled ones go, all-day ones come last');
  assert.deepEqual(events.map(e => whenLabel(e, now)), ['Now · until 3:00 pm', 'In 25 min', '7:00 pm', 'Tomorrow 9:00 am', 'All day', 'Tomorrow · all day']);
  assert.equal(whenLabel(upcomingEvents([{ title: 'Soon', start: at(7, 14, 0, 20), end: at(7, 15) }], now)[0], now), 'In 1 min');
  assert.equal(whenLabel(upcomingEvents([{ title: 'Later', start: at(10, 9), end: at(10, 10) }], now)[0], now), 'Tuesday 9:00 am');
  assert.deepEqual(upcomingEvents(null, now), []);
});

test('the next routine is the soonest enabled one, skipping today’s if it already ran', () => {
  const schedules = [
    { title: 'Morning brief', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6], enabled: true },
    { title: 'Weekly review', time: '17:30', days: [6], enabled: true },
    { title: 'Off', time: '15:00', days: [6], enabled: false },
  ];
  assert.deepEqual(nextRoutine(schedules, now), { title: 'Weekly review', at: new Date(2026, 10, 7, 17, 30), label: 'Today at 5:30 pm' });
  assert.equal(nextRoutine([{ ...schedules[1], lastRun: '2026-11-07' }, schedules[0]], now).label, 'Tomorrow at 8:00 am');
  assert.equal(nextRoutine([], now), null);
  assert.equal(nextRoutine([{ title: 'Broken', time: '8am', days: [6], enabled: true }], now), null);
});

test('running chats list waiting ones first, with their titles', () => {
  const sessions = { sessions: [{ id: 'a', title: 'Fix the retry test' }, { id: 'b', title: 'Nexus routing' }, { id: 'c', title: 'Idle' }], running: { a: 'working', b: 'waiting', c: '', gone: 'working' } };
  assert.deepEqual(runningChats(sessions), [{ id: 'b', title: 'Nexus routing', waiting: true }, { id: 'gone', title: 'A chat', waiting: false }, { id: 'a', title: 'Fix the retry test', waiting: false }]);
  assert.deepEqual(runningChats({}), []);
});

test('homeSummary prioritises waiting/working chats, next event, unread mail, and next routine up to 3 pills', () => {
  assert.deepEqual(homeSummary({ data: null, sessions: {}, routines: [], now }), []);
  const clear = homeSummary({ data: { calendar: { connected: true, events: [], error: '' }, email: { connected: true, unread: 0, error: '' } }, now });
  assert.deepEqual(clear, [{ kind: 'clear', badge: 'Today', text: 'Calendar & inbox clear' }]);
  const full = homeSummary({
    data: {
      calendar: { connected: true, events: [{ title: 'Group meeting', start: at(7, 14, 25), end: at(7, 15) }], error: '' },
      email: { connected: true, unread: 4, error: '' },
    },
    sessions: { sessions: [{ id: 's1', title: 'Deploy fix' }, { id: 's2', title: 'Refactor' }], running: { s1: 'waiting', s2: 'working' } },
    routines: [{ title: 'Evening sweep', time: '18:00', days: [6], enabled: true }],
    now,
  });
  assert.deepEqual(full.map(i => [i.kind, i.badge, i.text]), [
    ['waiting', 'Needs OK', 'Deploy fix'],
    ['working', 'Working', 'Refactor'],
    ['event', 'In 25 min', 'Group meeting'],
  ]);
});

test('homeToday setting validates on/off and todayPane refreshes in the background while closed', async () => {
  assert.equal(DEFAULTS.homeToday, 'on');
  assert.equal(cleanSettings({ homeToday: 'off' }).homeToday, 'off');
  assert.throws(() => cleanSettings({ homeToday: 'sometimes' }), /Today on Home/);

  const todayPane = await loadTodayPane();
  let calls = 0, allowed = true;
  const changes = [];
  const api = {
    todayData: async () => {
      calls++;
      return {
        calendar: { connected: true, events: [{ title: `Standup #${calls}`, start: new Date(Date.now() + 600000).toISOString() }], error: '' },
        email: { connected: true, unread: calls, error: '' },
      };
    },
    automationState: async () => ({ schedules: [], watchers: [] }),
  };
  const pane = todayPane({
    api,
    sessions: () => ({}),
    openSession: () => {},
    ask: () => {},
    openSettings: () => {},
    backgroundAllowed: () => allowed,
    backgroundDelayMs: 60000,
    onChange: snap => changes.push(snap),
  });
  try {
    pane.syncBackground();
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    assert.equal(calls, 1, 'initial closed background refresh runs when allowed');
    assert.equal(changes.length, 1);
    assert.equal(pane.snapshot().data.email.unread, 1);

    allowed = false;
    await pane.refresh(true);
    assert.equal(calls, 2, 'manual refresh works cleanly while closed');
    assert.equal(pane.snapshot().data.email.unread, 2);
  } finally {
    pane.dispose();
  }
});
