// Token use, step 7: background model calls are counted, and a timed check-in calls the model only when something is new.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backgroundLine, countBackground, readBackground, recordBackground } from '../desktop/background-calls.mjs';
import { checkInLook, cleanCheckIns, lookIsNew } from '../desktop/check-ins.mjs';

const now = new Date('2026-11-14T10:00:00Z');
const gmail = ids => ({ status: () => ({ connected: true }), unreadIds: async query => { gmail.query = query; return ids; } });
const calendar = events => ({ status: () => ({ connected: true }), events: async range => { calendar.range = range; return { events }; } });
const event = (id, hours, length = 1) => ({ id, start: new Date(now.getTime() + hours * 3600000).toISOString(), end: new Date(now.getTime() + (hours + length) * 3600000).toISOString() });

test('a background line has the kind, the model, the outcome and whether you were idle, and no content', () => {
  const line = backgroundLine('quiz', { idleSeconds: 300.4, provider: 'claude', model: 'claude-opus-5-5', at: now });
  assert.deepEqual(line, { at: now.toISOString(), kind: 'quiz', outcome: 'called', idleSeconds: 300, idle: true, provider: 'claude', model: 'claude-opus-5-5' });
  assert.equal(backgroundLine('idea', { idleSeconds: 30 }).idle, false);
  assert.equal('model' in backgroundLine('check-in', { outcome: 'unchanged' }), false);
});

test('lines are counted by kind over a window, with calls per hour and the idle ones apart', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'fairy-background-')), 'background-calls.jsonl'), at = minutes => new Date(now.getTime() + minutes * 60000);
  await recordBackground(path, backgroundLine('check-in', { at: at(0), idleSeconds: 900 }));
  await recordBackground(path, backgroundLine('check-in', { at: at(60), idleSeconds: 900, outcome: 'unchanged' }));
  await recordBackground(path, backgroundLine('quiz', { at: at(90), idleSeconds: 2 }));
  await recordBackground(path, backgroundLine('quiz', { at: at(130), idleSeconds: 2 }));
  assert.equal(readFileSync(path, 'utf8').trim().split('\n').length, 4);
  const counted = countBackground(await readBackground(path), { from: now, to: at(120) });
  assert.deepEqual(counted, { hours: 2, called: 2, idleCalled: 1, skipped: 1, perHour: 1, kinds: { 'check-in': { called: 1, idleCalled: 1, skipped: 1 }, quiz: { called: 1, idleCalled: 0, skipped: 0 } } });
  assert.deepEqual(await readBackground(join(tmpdir(), 'no-such-fairy-file.jsonl')), []);
});

test('the look asks Google for IDs only and keeps them as hashes, with an event’s time and whether it’s soon', async () => {
  const look = await checkInLook({ gmail: gmail(['m1', 'm2']), calendar: calendar([event('e1', 2), event('e2', 10)]), work: '- Fix: working', now, everyHours: 6 });
  assert.equal(gmail.query, 'in:inbox is:unread newer_than:1d');
  assert.deepEqual(calendar.range, { timeMin: now.toISOString(), timeMax: '2026-11-15T10:00:00.000Z' });
  assert.equal(look.mail.length, 2); assert.equal(look.events.length, 2);
  for (const value of [...look.mail, ...look.events, look.work]) assert.match(value, /^[0-9a-f]{24}$/);
  assert.ok(!JSON.stringify(look).includes('m1') && !JSON.stringify(look).includes('e1'));
  // Not connected: nothing asked, and that part is left out of the comparison.
  const none = await checkInLook({ gmail: { status: () => ({ connected: false }) }, calendar: null, now });
  assert.deepEqual(none, { mail: null, events: null, work: '' });
});

test('only something new calls the model: a new email or event, a moved event, one now soon, or changed work', async () => {
  const look = (mail, events, work = '', at = now) => checkInLook({ gmail: gmail(mail), calendar: calendar(events), work, now: at, everyHours: 6 });
  const seen = await look(['m1', 'm2'], [event('e1', 2), event('e2', 10)]);
  assert.equal(lookIsNew(seen, null), true, 'the first look always calls');
  assert.equal(lookIsNew(await look(['m2', 'm1'], [event('e2', 10), event('e1', 2)]), seen), false, 'the same, in another order');
  assert.equal(lookIsNew(await look(['m1'], [event('e2', 10)]), seen), false, 'mail read and an event gone need no call');
  assert.equal(lookIsNew(await look(['m1', 'm2', 'm3'], [event('e1', 2), event('e2', 10)]), seen), true, 'a new email');
  assert.equal(lookIsNew(await look(['m1', 'm2'], [event('e1', 2), event('e2', 11)]), seen), true, 'a moved event');
  assert.equal(lookIsNew(await look(['m1', 'm2'], [event('e1', 2), event('e2', 10)], '- Fix: waiting for your OK'), seen), true, 'work changed');
  // Six hours later, e2 (at 16:00, an hour long) is within the hours before the next check-in.
  const later = new Date(now.getTime() + 5 * 3600000), moved = { ...event('e2', 10) };
  const soon = await checkInLook({ gmail: gmail(['m1', 'm2']), calendar: calendar([moved]), now: later, everyHours: 6 });
  assert.equal(lookIsNew(soon, seen), true, 'an event now soon');
  // Gmail connected since the last look: anything in it is new.
  assert.equal(lookIsNew(await look(['m1'], [event('e1', 2)]), { ...seen, mail: null }), true);
});

test('the last look is kept in check-ins.json as hashes only', async () => {
  const seen = await checkInLook({ gmail: gmail(['m1']), calendar: calendar([event('e1', 2)]), work: 'w', now });
  assert.deepEqual(cleanCheckIns({ seen }).seen, seen);
  assert.equal(cleanCheckIns({}).seen, null);
  assert.deepEqual(cleanCheckIns({ seen: { mail: ['not a hash', seen.mail[0]], events: 'x', work: 5 } }).seen, { mail: [seen.mail[0]], events: null, work: '' });
});

test('main records each background call, and a timed check-in skips the model when nothing is new', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  for (const kind of ['quiz', 'idea', 'reflection', 'brief', 'check-in', 'schedule', 'promises', 'meeting-summary']) assert.match(main, new RegExp(`noteBackground\\('${kind}'`), kind);
  assert.match(main, /if \(look && !asked && !checkIns\.lookIsNew\(look, checkInState\.seen\)\) \{/);
  assert.match(main, /noteBackground\('check-in', \{ outcome: 'unchanged' \}\);\n\s+return \{ said: false, unchanged: true \};/);
  assert.match(main, /handle\('check-ins-run', kind => runCheckIns\(kind === 'brief' \? 'brief' : 'check', \{ asked: true \}\)/);
});
