import test from 'node:test';
import assert from 'node:assert/strict';
import { mightPromise, readPromises, readDue, nudgeAt, headsUpAt, dueWords, PromiseBook, promisePrompt, nudgeText, asksReminder, reminderNote } from '../desktop/promises.mjs';
import { weekView } from '../desktop/phone-week.mjs';

const said = new Date(2026, 10, 12, 11, 5).toISOString(); // Thu 12 Nov 2026, 11:05 local
const messages = [{ text: 'ok cool. I’ll email Sam after lunch about the report', at: said, chat: 'c1' }, { text: 'remind me to call Mum tomorrow', at: said, chat: 'c2' }];

test('only lines that read like a promise are checked', () => {
  for (const text of ["I'll email Sam after lunch", 'I’ll do it tonight', 'remind me to call Mum', 'I need to submit the form by Friday', "don't let me forget the bins"]) assert.ok(mightPromise(text), text);
  for (const text of ['what is a black hole', 'thanks!', 'can you show me how to export this', 'x'.repeat(3000) + " I'll"]) assert.ok(!mightPromise(text), text.slice(0, 40));
  const prompt = promisePrompt(messages);
  assert.match(prompt, /Thu 2026-11-12 11:05/);
  assert.match(prompt, /I'll email Sam/);
});

test('promises are kept only where they quote what was said, with a checked due time', () => {
  const reply = JSON.stringify({ promises: [
    { what: 'Email Sam about the report', due: '2026-11-12T13:30', quote: "I'll email Sam after lunch" },
    { what: 'Call Mum', due: '2026-11-13', quote: 'remind me to call Mum tomorrow' },
    { what: 'Buy a boat', due: '2026-11-12T15:00', quote: 'I will buy a boat' },          // never said
    { what: 'Old thing', due: '2026-11-01T09:00', quote: 'email Sam after lunch' },       // due long before it was said
  ] });
  const found = readPromises('Here you go:\n' + reply, messages);
  assert.equal(found.length, 3);
  assert.deepEqual(found.slice(0, 2).map(({ what, due, dayOnly, chat }) => ({ what, due, dayOnly, chat })), [
    { what: 'Email Sam about the report', due: '2026-11-12T13:30', dayOnly: false, chat: 'c1' },
    { what: 'Call Mum', due: '2026-11-13', dayOnly: true, chat: 'c2' }]);
  assert.equal(found[2].due, '', 'a due time before it was said is dropped, not the promise');
  assert.deepEqual(readPromises('no json here', messages), []);
  assert.deepEqual(readDue('2026-02-30', said), { due: '', dayOnly: false });
  assert.deepEqual(readDue('2028-01-01', said), { due: '', dayOnly: false });
});

test('a day alone is nudged in the morning, or in the evening if said later that day', () => {
  assert.deepEqual(nudgeAt({ due: '2026-11-13', dayOnly: true, at: said }), new Date(2026, 10, 13, 9, 0));
  assert.deepEqual(nudgeAt({ due: '2026-11-12', dayOnly: true, at: said }), new Date(2026, 10, 12, 18, 0));
  assert.equal(nudgeAt({ due: '2026-11-12', dayOnly: true, at: new Date(2026, 10, 12, 19, 0).toISOString() }), null);
  assert.deepEqual(nudgeAt({ due: '2026-11-12T13:30', dayOnly: false, at: said }), new Date(2026, 10, 12, 13, 30));
  assert.equal(nudgeAt({ due: '', at: said }), null);
});

test('the book nudges each promise once, skips repeats, and ticks them off', async () => {
  let now = new Date(2026, 10, 12, 11, 6), saved = null, n = 0;
  const book = new PromiseBook({ read: async () => null, write: async value => { saved = structuredClone(value); }, now: () => now, id: () => `p${++n}` });
  await book.load();
  const found = readPromises(JSON.stringify({ promises: [{ what: 'Email Sam about the report', due: '2026-11-12T13:30', quote: "I'll email Sam after lunch" }, { what: 'Call Mum', due: '2026-11-13', quote: 'remind me to call Mum tomorrow' }, { what: 'Finish the KKT set', due: null, quote: 'remind me to call Mum' }] }), messages);
  assert.equal((await book.add(found)).length, 3);
  assert.equal((await book.add(found.slice(0, 1))).length, 0, 'the same promise again is skipped');
  assert.deepEqual(await book.takeDue(), []);
  now = new Date(2026, 10, 12, 13, 31);
  const due = await book.takeDue();
  assert.deepEqual(due.map(item => item.what), ['Email Sam about the report']);
  assert.deepEqual(await book.takeDue(), [], 'nudged once');
  assert.equal(saved.items.find(item => item.id === 'p1').nudged, true);
  const view = book.view();
  assert.deepEqual(view.open.map(item => [item.what, item.due, item.overdue]), [['Email Sam about the report', '2026-11-12T13:30:00', true], ['Call Mum', '2026-11-13', false], ['Finish the KKT set', null, false]]);
  await book.setDone('p2');
  assert.deepEqual(book.view().open.map(item => item.id), ['p1', 'p3']);
  assert.deepEqual(book.view().done.map(item => item.id), ['p2']);
  await book.remove('p3');
  assert.deepEqual(book.view().open.map(item => item.id), ['p1']);
  await assert.rejects(book.setDone('nope'), /no longer here/);
  // One caught after its time has already gone isn't nudged late; it shows as overdue.
  const late = await book.add([{ what: 'Water the plants', due: '2026-11-12T09:00', dayOnly: false, said: 'water the plants', at: said, chat: '' }]);
  assert.equal(late[0].nudged, true);
  assert.equal(nudgeText({ what: 'Call Mum', said: 'remind me to call Mum tomorrow' }).body, 'Call Mum. You said: “remind me to call Mum tomorrow”');
});

test('Your week carries the open promises', () => {
  const promises = [{ id: 'p1', what: 'Call Mum', due: '2026-11-13', allDay: true, said: 'remind me', overdue: false }];
  assert.deepEqual(weekView({ now: new Date(2026, 10, 12), promises }).promises, promises);
  assert.deepEqual(weekView({ now: new Date(2026, 10, 12) }).promises, []);
});

test('a deadline gets a heads-up while there is still time, and only once', async () => {
  // Thu 12 Nov, 11:05. "by Friday night" (Fri 20:00): a day before. "by 7 tonight": three hours before.
  // "by 2" (under three hours off): none. "by Monday" (a day): Sunday evening. Not a deadline: none.
  assert.deepEqual(headsUpAt({ deadline: true, due: '2026-11-13T20:00', dayOnly: false, at: said }), new Date(2026, 10, 12, 20, 0));
  assert.deepEqual(headsUpAt({ deadline: true, due: '2026-11-12T19:00', dayOnly: false, at: said }), new Date(2026, 10, 12, 16, 0));
  assert.deepEqual(headsUpAt({ deadline: true, due: '2026-11-12T15:00', dayOnly: false, at: said }), new Date(2026, 10, 12, 14, 0));
  assert.equal(headsUpAt({ deadline: true, due: '2026-11-12T14:00', dayOnly: false, at: said }), null);
  assert.deepEqual(headsUpAt({ deadline: true, due: '2026-11-16', dayOnly: true, at: said }), new Date(2026, 10, 15, 18, 0));
  assert.equal(headsUpAt({ deadline: true, due: '2026-11-12', dayOnly: true, at: said }), null, 'the evening before has gone');
  assert.equal(headsUpAt({ deadline: false, due: '2026-11-13T20:00', dayOnly: false, at: said }), null);

  const found = readPromises(JSON.stringify({ promises: [{ what: 'Submit the report', due: '2026-11-13T20:00', deadline: true, quote: "I'll email Sam after lunch" }] }), messages);
  assert.equal(found[0].deadline, true);
  let now = new Date(2026, 10, 12, 11, 6);
  const book = new PromiseBook({ read: async () => null, write: async () => {}, now: () => now, id: () => 'd1' });
  await book.add(found);
  assert.deepEqual(await book.takeDue(), []);
  now = new Date(2026, 10, 12, 20, 1);
  const early = await book.takeDue();
  assert.deepEqual(early.map(item => [item.id, item.early]), [['d1', true]]);
  assert.deepEqual(nudgeText(early[0], now), { title: 'Due tomorrow at 8 pm', body: 'Submit the report. You said you’d have it done by then.' });
  assert.deepEqual(await book.takeDue(), [], 'one heads-up');
  now = new Date(2026, 10, 13, 20, 0);
  assert.deepEqual((await book.takeDue()).map(item => [item.id, item.early]), [['d1', undefined]], 'then the deadline itself');
  // One caught after its heads-up time but before the deadline gets no late heads-up.
  now = new Date(2026, 10, 13, 19, 0);
  const late = new PromiseBook({ read: async () => null, write: async () => {}, now: () => now, id: () => 'd2' });
  await late.add(found);
  assert.deepEqual(await late.takeDue(), []);
  assert.equal(dueWords({ due: '2026-11-18T09:30', dayOnly: false }, new Date(2026, 10, 12)), 'Wednesday at 9:30 am');
});

test('a reminder asked for outright is set at once, confirmed in the reply, and not set twice', async () => {
  assert.ok(asksReminder('can you remind me on November 22nd that Claude subscription will be renewed'));
  assert.ok(asksReminder('Set a reminder for my dentist at 3'));
  assert.ok(asksReminder('don’t let me forget the bins'));
  assert.equal(asksReminder('I’ll email Sam after lunch'), false, 'promises in passing wait for the look through the chats');
  const asked = { text: 'can you remind me on November 22nd that Claude subscription will be renewed', at: said, chat: 'c9' };
  const [found] = readPromises(JSON.stringify({ promises: [{ what: 'Check the Claude subscription renewal', due: '2026-11-22', quote: 'remind me on November 22nd that Claude subscription will be renewed' }] }), [asked]);
  assert.match(reminderNote([found], new Date(2026, 10, 12)), /"Check the Claude subscription renewal" on Sunday 22 November at 9 am\. Confirm it/);
  assert.match(reminderNote([]), /Ask them what to remind them about/);
  const book = new PromiseBook({ read: async () => null, write: async () => {}, now: () => new Date(2026, 10, 12, 11, 6), id: () => 'r1' });
  assert.equal((await book.add([found])).length, 1);
  // The look through the chats finds the same message a minute later, in other words.
  const again = readPromises(JSON.stringify({ promises: [{ what: 'Remind about Claude subscription renewal', due: '2026-11-22', quote: 'remind me on November 22nd that Claude subscription will be renewed' }] }), [asked]);
  assert.equal((await book.add(again)).length, 0);
});
