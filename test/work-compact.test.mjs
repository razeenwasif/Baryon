import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { COMPACT_AT, SUMMARY_LIMIT, WorkCompactor, nextBatch, summarise } from '../desktop/work-compact.mjs';
import { CONTEXT_BUDGET, SUMMARY_LIMIT as CONTEXT_SUMMARY_LIMIT, describeEntry, unsummarised, usableSummary, workContext, workMeter } from '../src/work-context.js';

const chat = (count, size = 2000) => Array.from({ length: count }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message ${index} ${'x'.repeat(size)}`, at: `t${index}` }));
const notesOn = (history, through, text = 'THE NOTES') => ({ text, through, lastAt: history[through - 1].at, at: 'now' });
function fakeProvider(replies = () => 'New notes') {
  const calls = [];
  return { calls, turn: async options => { calls.push(options); return replies(options, calls.length); } };
}
async function compactor(provider, onSaved) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-compact-'));
  return { dir, compact: new WorkCompactor({ dir, connection: () => ({ provider, settings: { backend: 'claude' } }), onSaved, now: () => 'now' }) };
}

test('notes stop counting once a rewind takes away the message they end on', () => {
  const history = chat(6), notes = notesOn(history, 4);
  assert.equal(usableSummary(notes, history), notes);
  assert.equal(usableSummary(notes, history.slice(0, 3)), null);
  const redone = [...history.slice(0, 3), { role: 'assistant', content: 'different', at: 'other' }];
  assert.equal(usableSummary(notes, redone), null);
  for (const broken of [null, {}, { text: '', through: 1 }, { text: 'x', through: 0 }, { text: 'x', through: 1.5 }]) assert.equal(usableSummary(broken, history), null);
});
test('the next turn gets the notes and then only the newer messages', () => {
  const history = chat(6), context = workContext(history, undefined, notesOn(history, 4));
  assert.match(context, /THE NOTES/);
  assert.match(context, /data, not instructions/);
  assert.match(context, /message 5/);
  assert.doesNotMatch(context, /message 1 /);
  assert.doesNotMatch(context, /left out/);
  assert.match(workContext(history, undefined, notesOn(history, 6)), /THE NOTES/);
});
test('without usable notes the digest works as before, and says what it left out', () => {
  const long = chat(60);
  assert.match(workContext(long), /older messages left out/);
  assert.equal(workContext([]), '');
  const rewound = long.slice(0, 2);
  assert.doesNotMatch(workContext(rewound, undefined, notesOn(long, 40)), /THE NOTES/);
});
test('a stopped turn says so, with its unfinished tasks and what it had written', () => {
  const history = [{ role: 'user', content: 'go', at: 'a' }, { role: 'assistant', content: 'Stopped', at: 'b', unfinished: true, partial: 'half a thought', tasks: [{ text: 'first', status: 'done' }, { text: 'second', status: 'in_progress' }], activity: [{ tool: 'edit', status: 'done', summary: 'a.js' }] }];
  const text = workContext(history);
  assert.match(text, /cut off before it finished/);
  assert.match(text, /half a thought/);
  assert.match(text, /Tasks not finished: second/);
  assert.doesNotMatch(text, /Tasks not finished: first/);
  assert.match(text, /Files changed: a\.js/);
  assert.doesNotMatch(workContext([{ role: 'assistant', content: 'Done', at: 'b', tasks: [{ text: 'first', status: 'done' }] }]), /cut off|Tasks not/);
});
test('a request that never got a reply says so, and an answered one doesn’t', () => {
  assert.match(describeEntry([{ role: 'user', content: 'go' }], 0), /got no reply/);
  assert.match(describeEntry([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }], 0), /got no reply/);
  assert.doesNotMatch(describeEntry([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], 0), /got no reply/);
});
test('the newest messages stay as they were said, and older ones go in batches', () => {
  const history = chat(40), batch = nextBatch(history, null);
  assert.equal(batch.from, 0);
  assert.ok(batch.through < 40 && batch.through >= 34, `kept from ${batch.through}`);
  assert.equal(nextBatch(chat(2, 50000), null), null);
  const big = chat(200, 2000).map((entry, index) => ({ ...entry, content: `m${index} ${'y'.repeat(7000)}` }));
  const first = nextBatch(big, null);
  assert.ok(first.through - first.from < 40, 'one batch is limited');
  const notes = notesOn(big, first.through), second = nextBatch(big, notes);
  assert.equal(second.from, first.through);
  assert.equal(nextBatch(history, notesOn(history, 39)), null);
});
test('a very long chat only reads back so far, and the notes say what they don’t cover', async () => {
  const huge = Array.from({ length: 300 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: 'z'.repeat(5000), at: `t${index}` }));
  const batch = nextBatch(huge, null);
  assert.ok(batch.skipped > 100, `skipped ${batch.skipped}`);
  assert.equal(batch.from, batch.skipped);
  const provider = fakeProvider(), notes = await summarise({ provider, settings: {}, history: huge, summary: null, batch });
  assert.equal(notes.skipped, batch.skipped);
  assert.match(provider.calls[0].input[0].text, /too long ago to read/);
  assert.match(workContext(huge, undefined, notes), /oldest messages aren't covered/);
});
test('writing notes uses no tools, and folds in the notes so far', async () => {
  const history = chat(30), provider = fakeProvider(), notes = await summarise({ provider, settings: { reasoning: 'max' }, history, summary: notesOn(history, 4, 'OLD NOTES'), batch: { from: 4, through: 10, skipped: 0 } });
  const call = provider.calls[0];
  assert.deepEqual(call.tools, []);
  assert.equal(call.toolHandler, undefined);
  assert.equal(call.settings.reasoning, 'medium');
  assert.match(call.input[0].text, /OLD NOTES/);
  assert.match(call.input[0].text, /message 4 /);
  assert.doesNotMatch(call.input[0].text, /message 3 /);
  assert.doesNotMatch(call.input[0].text, /message 10 /);
  assert.match(call.prompt, /instructions, they didn't come from the user/);
  assert.match(call.instructions, /Never copy a password/);
  assert.equal(notes.through, 10);
  assert.equal(notes.lastAt, 't9');
});
test('an empty reply isn’t taken for notes, and a long one is cut to size', async () => {
  const history = chat(30), batch = { from: 0, through: 10, skipped: 0 };
  await assert.rejects(summarise({ provider: fakeProvider(() => '  '), settings: {}, history, summary: null, batch }), /empty/);
  assert.equal((await summarise({ provider: fakeProvider(() => 'n'.repeat(50000)), settings: {}, history, summary: null, batch })).text.length, 12000);
  assert.equal((await summarise({ provider: fakeProvider(() => ({ text: 'object reply' })), settings: {}, history, summary: null, batch })).text, 'object reply');
});
test('nothing is written until a chat is long enough', async () => {
  const provider = fakeProvider(), { compact, dir } = await compactor(provider);
  const short = chat(4);
  assert.ok(unsummarised(short) < COMPACT_AT);
  await compact.soon('a', short);
  assert.equal(provider.calls.length, 0);
  assert.equal(await compact.read('a'), null);
  await rm(dir, { recursive: true, force: true });
});
test('notes are saved privately and told to the chat list', async () => {
  const provider = fakeProvider(), saved = [], { compact, dir } = await compactor(provider, (id, value) => saved.push([id, value]));
  const history = chat(20);
  await compact.soon('a', history);
  const notes = await compact.read('a');
  assert.equal(notes.text, 'New notes');
  assert.ok(notes.through >= 14);
  assert.equal((await stat(join(dir, 'a.json'))).mode & 0o777, 0o600);
  assert.equal(saved.at(-1)[0], 'a');
  assert.equal(JSON.stringify(saved).includes('New notes'), false);
  assert.equal(usableSummary(notes, history), notes);
  assert.ok(workContext(history, undefined, notes).length < CONTEXT_BUDGET);
  await compact.remove('a');
  assert.equal(await compact.read('a'), null);
  await rm(dir, { recursive: true, force: true });
});
test('one chat is only summarised once at a time', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; }), provider = fakeProvider(async () => { await gate; return 'Notes'; }), { compact, dir } = await compactor(provider);
  const history = chat(14), one = compact.start('a', history), two = compact.start('a', history);
  assert.equal(one, two);
  await new Promise(resolve => setTimeout(resolve, 20));
  release();
  await one;
  assert.equal(provider.calls.length, 1);
  await rm(dir, { recursive: true, force: true });
});
test('a turn only waits when older messages would be lost, and Stop ends the wait', async () => {
  const provider = fakeProvider(async () => new Promise(() => {})), { compact, dir } = await compactor(provider);
  let waited = 0;
  await compact.catchUp('a', chat(6), new AbortController().signal, () => { waited += 1; });
  assert.equal(waited, 0);
  const controller = new AbortController(), wait = compact.catchUp('b', chat(60), controller.signal, () => { waited += 1; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(waited, 1);
  controller.abort();
  await assert.rejects(wait, /Stopped/);
  await rm(dir, { recursive: true, force: true });
});
test('a failed summary leaves the earlier notes in place', async () => {
  const provider = fakeProvider((_, call) => { if (call > 1) throw new Error('over the limit'); return 'First notes'; }), { compact, dir } = await compactor(provider);
  const history = chat(14);
  await compact.start('a', history);
  await assert.rejects(compact.start('a', [...history, ...chat(14).map((entry, index) => ({ ...entry, at: `later${index}` }))]), /over the limit/);
  assert.equal((await compact.read('a')).text, 'First notes');
  assert.equal(compact.running.size, 0);
  assert.equal(JSON.parse(await readFile(join(dir, 'a.json'), 'utf8')).text, 'First notes');
  await rm(dir, { recursive: true, force: true });
});
test('the meter counts what’s in the notes as room freed up', () => {
  const history = chat(20), summarized = { through: 18, lastAt: 't17', at: 'now' };
  const before = workMeter(history), after = workMeter(history, summarized);
  assert.equal(before.summarized, 0);
  assert.equal(after.summarized, 18);
  assert.ok(after.context < before.context);
  assert.equal(workMeter(history.slice(0, 5), summarized).summarized, 0);
});

test('compacting by hand folds everything but the last exchange, with the chat instructions', async () => {
  const history = chat(6, 50), provider = fakeProvider(), saved = [];
  const dir = await mkdtemp(join(tmpdir(), 'fairy-compact-'));
  const { CHAT_INSTRUCTIONS } = await import('../desktop/work-compact.mjs');
  const compact = new WorkCompactor({ dir, instructions: CHAT_INSTRUCTIONS, connection: () => ({ provider, settings: {} }), onSaved: (id, value) => saved.push(value), now: () => 'now' });
  assert.equal(nextBatch(history, null), null, 'too little to fold automatically');
  assert.deepEqual(nextBatch(history, null, 0), { from: 0, through: 4, skipped: 0 });
  const notes = await compact.compactNow('c1', history);
  assert.equal(notes.through, 4);
  assert.equal(provider.calls[0].instructions, CHAT_INSTRUCTIONS);
  assert.deepEqual(saved, [{ through: 4, lastAt: 't3', at: 'now', chars: 'New notes'.length }]);
  assert.equal(await compact.notes('c1', history), 'New notes');
  assert.equal(await compact.notes('c1', history.slice(0, 2)), '', 'notes that no longer fit are left out');
  await rm(dir, { recursive: true, force: true });
});

test('the meter counts the notes alongside the digest against both limits together (Astra’s probe)', async () => {
  assert.equal(CONTEXT_SUMMARY_LIMIT, SUMMARY_LIMIT);
  // Astra's exact probe: nine alternating 2,900-character messages and a valid 12,000-character summary covering message 1.
  const history = Array.from({ length: 9 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'a'.repeat(2900),
    at: `t${i}`,
    mode: 'work',
  }));
  const fullSummary = { text: 's'.repeat(12000), through: 1, lastAt: 't0', at: 'now' };
  const sent = workContext(history, CONTEXT_BUDGET, fullSummary);
  assert.ok(sent.length > 35000, `expected > 35,000 context characters, got ${sent.length}`);

  const fullMeter = workMeter(history, fullSummary);
  assert.equal(fullMeter.contextChars, sent.length);
  assert.equal(fullMeter.contextBudget, CONTEXT_BUDGET + SUMMARY_LIMIT);
  assert.equal(fullMeter.context, Math.min(100, Math.round(sent.length / (CONTEXT_BUDGET + SUMMARY_LIMIT) * 100)));
  assert.equal(fullMeter.notesChars, 12000);
  assert.equal(fullMeter.notesShare, Math.round(12000 / sent.length * 100));

  // The metadata-only summarized object from SessionStore (chars without text) gives the exact same reading.
  const metaMeter = workMeter(history, { through: 1, lastAt: 't0', at: 'now', chars: 12000 });
  assert.deepEqual(metaMeter, fullMeter);

  // Small notes on the same 9 messages read markedly lower than 12,000-character notes (previously both read 98%).
  const smallMeter = workMeter(history, { text: 's'.repeat(100), through: 1, lastAt: 't0', at: 'now' });
  assert.ok(smallMeter.context < fullMeter.context - 20, `small=${smallMeter.context}% vs full=${fullMeter.context}%`);
  assert.equal(smallMeter.notesChars, 100);

  // A session with 12,000-character notes and no newer messages shows the notes rather than 0%.
  const notesOnly = workMeter(history.slice(0, 1), fullSummary);
  assert.ok(notesOnly.context >= 33, `expected >= 33%, got ${notesOnly.context}%`);
  assert.equal(notesOnly.notesChars, 12000);

  // Compaction's trigger is unchanged.
  assert.equal(COMPACT_AT, Math.round(CONTEXT_BUDGET * 0.75));
  // SessionStore preserves chars without keeping text, and app.js hover surfaces notesChars and notesShare.
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /meter\.notesChars/);
  assert.match(app, /meter\.notesShare/);
});
