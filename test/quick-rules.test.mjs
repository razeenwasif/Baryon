// Token use, step 9: plain requests answered by code, with the model left for everything else.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MacTimers, agendaReply, agendaRequest, answerByRule, reminderRequest, ringText, stopTimersRequest, timerRequest } from '../desktop/quick-rules.mjs';

const now = new Date(2026, 10, 15, 10, 0, 0);
const local = (h, m = 0, day = 15) => new Date(2026, 10, day, h, m, 0);

test('timers and alarms read as the iPhone reads them', () => {
  const seconds = text => timerRequest(text, now)?.seconds ?? null;
  assert.equal(seconds('set a timer for 10 minutes'), 600);
  assert.equal(seconds('Hey Fairy, can you set a timer for 10 minutes?'), 600);
  assert.equal(seconds('timer for 1h30m'), 5400);
  assert.equal(seconds('a timer for half an hour'), 1800);
  assert.equal(seconds('set an alarm for 10 minutes'), 600);
  const pasta = timerRequest('a pasta timer for an hour and a half', now);
  assert.deepEqual([pasta.kind, pasta.seconds, pasta.label], ['timer', 5400, 'Pasta']);
  const seven = timerRequest('set an alarm for 7am', now);
  assert.deepEqual([seven.kind, seven.clock, +seven.at], ['alarm', true, +local(7, 0, 16)]);
  assert.equal(+timerRequest('alarm at 3pm', now).at, +local(15));
  // Without am or pm, whichever comes sooner.
  assert.equal(+timerRequest('wake me at 6:30', now).at, +local(18, 30));
  for (const text of ['add a 10 minute timer to the quiz page', 'how do I write a timer for 5 seconds in Swift', 'set a timer for 10 minutes in my React app', 'set a timer', 'how long is left on my timer', 'cancel the timer', 'remind me in 10 minutes to stir', 'what is a timer?']) assert.equal(timerRequest(text, now), null, text);
  for (const text of ['cancel the timer', 'stop my alarms', 'Fairy, turn off all the timers please']) assert.ok(stopTimersRequest(text), text);
  assert.ok(!stopTimersRequest('stop') && !stopTimersRequest('cancel the meeting'));
});

test('a reminder with a plain time is read; anything less plain is left to the model', () => {
  const read = text => { const r = reminderRequest(text, now); return r && [r.what, +r.at, r.word]; };
  assert.deepEqual(read('remind me in 20 minutes to call Sam'), ['Call Sam', +local(10, 20), 'to']);
  assert.deepEqual(read('can you remind me to call Sam at 3pm?'), ['Call Sam', +local(15), 'to']);
  assert.deepEqual(read('remind me tomorrow at 9 to email Jo'), ['Email Jo', +local(9, 0, 16), 'to']);
  assert.deepEqual(read('Remind me at 9 tomorrow to email Jo'), ['Email Jo', +local(9, 0, 16), 'to']);
  assert.deepEqual(read('remind me tonight at 8 to take the bins out'), ['Take the bins out', +local(20), 'to']);
  assert.deepEqual(read('remind me in an hour about the oven'), ['The oven', +local(11), 'about']);
  for (const text of ['can you remind me on November 22nd that Claude subscription will be renewed', 'remind me to stretch every day at 9', 'remind me at 3', 'remind me tomorrow to call Sam', 'remind me to call Sam after lunch', 'I need to call Sam at 3']) assert.equal(reminderRequest(text, now), null, text);
});

test('what’s next, asked plainly; the rest goes to the calendar agent', () => {
  for (const [text, day] of [["what's next?", 'next'], ['when is my next meeting', 'next'], ["what's on today", 'today'], ['what does my day look like', 'today'], ['Hey Fairy, what do I have tomorrow?', 'tomorrow'], ['what is on my calendar tomorrow', 'tomorrow']]) assert.deepEqual(agendaRequest(text), { day }, text);
  for (const text of ["what's next for the project?", 'am I free at 3?', 'move my 3pm to 4', 'what do I have on Friday']) assert.equal(agendaRequest(text), null, text);
});

test('the agenda is said from the calendar’s events', () => {
  const events = [{ title: 'Team sync', start: local(9, 30).toISOString(), end: local(10, 30).toISOString() }, { title: 'Dentist', start: local(16).toISOString(), end: local(17).toISOString() }, { title: 'Holiday', start: '2026-11-15', end: '2026-11-16', allDay: true }];
  assert.equal(agendaReply(events, { day: 'today' }, now), 'Still today:\n- all day: Holiday\n- 9:30 am (on now): Team sync, until 10:30 am\n- 4 pm: Dentist, until 5 pm');
  assert.equal(agendaReply(events, { day: 'next' }, now), 'Next: Dentist, today at 4 pm (in 6 hours).');
  assert.equal(agendaReply([], { day: 'tomorrow' }, now), 'Nothing on your calendar tomorrow.');
  assert.equal(agendaReply([events[0]], { day: 'next' }, now), 'Nothing else on your calendar in the next week.');
});

test('the rules answer with no model, set what they say, and leave everything else alone', async () => {
  const set = [], asked = [], timers = { added: [], add: async item => { timers.added.push(item); return item; }, stop: async () => 2 };
  const deps = { timers, remind: async item => { set.push(item); }, events: async range => { asked.push(range); return [{ title: 'Dentist', start: local(16).toISOString(), end: local(17).toISOString() }]; }, now };
  assert.deepEqual(await answerByRule('set a timer for 10 minutes', deps), { kind: 'timer', text: 'Timer set for 10 minutes, until 10:10 am.' });
  assert.deepEqual(await answerByRule('wake me at 7am', deps), { kind: 'alarm', text: 'Alarm set for tomorrow at 7 am.' });
  assert.equal(timers.added.length, 2);
  assert.deepEqual(await answerByRule('cancel my timers', deps), { kind: 'timer-stop', text: 'Stopped all 2 timers and alarms.' });
  assert.deepEqual(await answerByRule('remind me in 20 minutes to call Sam', deps), { kind: 'reminder', text: 'I’ll remind you to call Sam today at 10:20 am.' });
  assert.deepEqual(set, [{ what: 'Call Sam', at: local(10, 20), said: 'remind me in 20 minutes to call Sam' }]);
  assert.deepEqual(await answerByRule("what's next?", deps), { kind: 'agenda', text: 'Next: Dentist, today at 4 pm (in 6 hours).' });
  assert.deepEqual(asked, [{ timeMin: local(0).toISOString(), timeMax: local(0, 0, 23).toISOString() }]);
  // No calendar, no timers (the phone), or nothing plain: the model answers.
  assert.equal(await answerByRule("what's next?", { ...deps, events: null }), null);
  assert.equal(await answerByRule('set a timer for 10 minutes', { ...deps, timers: null }), null);
  for (const text of ['explain the simplex method', 'can you remind me on November 22nd that Claude subscription will be renewed', 'x'.repeat(400)]) assert.equal(await answerByRule(text, deps), null, text.slice(0, 40));
});

test('Mac timers ring when due, survive a restart, ring late ones at once, and stop', async () => {
  let saved = null, clock = now.getTime();
  const scheduled = [], rung = [];
  const make = () => new MacTimers({ read: async () => saved, write: async value => { saved = structuredClone(value); }, ring: async (item, how) => rung.push([item.label, how.late]), now: () => new Date(clock),
    schedule: (fn, ms) => { const handle = { fn, ms }; scheduled.push(handle); return handle; }, unschedule: handle => { handle.cancelled = true; } });
  const timers = make();
  await timers.add({ kind: 'timer', seconds: 600, label: 'Tea', at: new Date(clock + 600_000) });
  assert.equal(scheduled[0].ms, 600_000); assert.equal(saved.items.length, 1);
  clock += 600_000; await scheduled[0].fn();
  assert.deepEqual(rung, [['Tea', false]]); assert.equal(saved.items.length, 0);
  // Set, then Fairy restarts after it was due: it rings at once, marked late.
  await timers.add({ kind: 'alarm', seconds: 60, label: null, at: new Date(clock + 60_000) });
  clock += 3_600_000;
  const again = make(); await again.load();
  assert.equal(scheduled.at(-1).ms, 0); await scheduled.at(-1).fn();
  assert.deepEqual(rung.at(-1), [null, true]);
  await again.add({ kind: 'timer', seconds: 60, at: new Date(clock + 60_000) });
  assert.equal(await again.stop(), 1); assert.ok(scheduled.at(-1).cancelled); assert.deepEqual(saved.items, []);
  assert.deepEqual(ringText({ kind: 'timer', seconds: 600, label: 'Tea', at: now.toISOString() }), { title: 'Tea timer done', body: '10 minutes, done.' });
  assert.equal(ringText({ kind: 'alarm', seconds: 60, at: local(7).toISOString() }).body, 'It\'s 7 am.');
});

test('main tries the rules before any model, in chat, the companion and from the phone, and counts each request', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /const ruled = await quickRule\(text, \{ chat: chatId \}\)[^\n]*\n\s+if \(ruled\) \{ noteRequest\('rule', ruled\.kind, 'chat'\);/);
  assert.match(main, /noteRequest\('model', mode, 'chat'\);\n/);
  // A face on another Mac asks through quickReply, which notes who asked (from); the companion here, the window's chat.
  assert.match(main, /if \(ruled\) \{ noteRequest\('rule', ruled\.kind, from\);/);
  assert.match(main, /quickReply\(text, \{ from: 'face'/);
  assert.match(main, /const ruled = await quickRule\(text, \{ chat, phone: true \}\)/);
  assert.match(main, /timers: phone \? null : macTimers,/);
  assert.match(main, /mightPromise\(entry\.content\) && !quickRules\.reminderRequest\(entry\.content, new Date\(entry\.at\)\)/);
});
