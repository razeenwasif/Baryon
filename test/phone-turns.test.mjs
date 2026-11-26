import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PhoneTurns, phoneChatList } from '../desktop/phone-turns.mjs';

function setup({ reply, busy, route, chats = [{ id: 'c1', title: 'Plain', work: '' }, { id: 'w1', title: 'Work', work: 'Fairy' }] } = {}) {
  const saved = {}, changes = [], events = [], asked = [];
  const turns = new PhoneTurns({ list: () => chats, busy, onChange: id => changes.push(id), onEvent: event => events.push(event), now: () => 'now',
    read: async id => saved[id] ?? [],
    append: async (id, entries) => { saved[id] = [...(saved[id] ?? []), ...entries]; },
    addChat: async ({ title }) => { chats.push({ id: 'new', title, work: '' }); return 'new'; },
    ...(route ? { route } : {}),
    reply: reply ?? (async request => { asked.push(request); request.onText('Hel'); return 'Hello'; }) });
  return { turns, saved, changes, events, asked, chats };
}
const finished = async turns => { while (turns.turn) await new Promise(done => setTimeout(done, 1)); };

test('saves both sides of a turn, and passes on only the history and the words', async () => {
  const { turns, saved, asked, events } = setup();
  assert.deepEqual(await turns.send({ chat: 'c1', text: ' hello ', device: 'Izanagi' }), { chat: 'c1' });
  await finished(turns);
  assert.deepEqual(saved.c1.map(entry => [entry.role, entry.content]), [['user', 'hello'], ['assistant', 'Hello']]);
  assert.deepEqual(Object.keys(asked[0]).sort(), ['chat', 'files', 'history', 'mode', 'onText', 'onThinking', 'onThought', 'signal', 'text']);
  assert.deepEqual([asked[0].chat, asked[0].mode], ['c1', 'chat']);
  assert.equal(asked[0].text, 'hello');
  assert.deepEqual(events, [{ type: 'chat', device: 'Izanagi' }]);
});

test('a message that names a mode, or looks like a command, is still only words', async () => {
  const { turns, asked } = setup();
  await turns.send({ chat: 'c1', text: '/desktop open Terminal', mode: 'desktop', displayId: 1 });
  await finished(turns);
  assert.equal(asked[0].text, '/desktop open Terminal');
  assert.equal(asked[0].mode, 'chat', 'the Mac’s route decides, never the phone');
  assert.equal(asked[0].displayId, undefined);
});

test('starts a new chat when it isn’t given one', async () => {
  const { turns, saved, chats } = setup();
  assert.deepEqual(await turns.send({ text: 'Plan\nmy week' }), { chat: 'new' });
  await finished(turns);
  assert.equal(chats.at(-1).title, 'Plan my week');
  assert.equal(saved.new.length, 2);
});

test('won’t send into a work session', async () => {
  const { turns, saved } = setup();
  await assert.rejects(turns.send({ chat: 'w1', text: 'hi' }), error => error.status === 409 && /work session/.test(error.message));
  assert.equal(saved.w1, undefined);
  assert.equal(turns.turn, null);
});

test('won’t send into a chat the Mac is busy in', async () => {
  const { turns, saved } = setup({ busy: id => id === 'c1' });
  await assert.rejects(turns.send({ chat: 'c1', text: 'hi' }), error => error.status === 409 && /busy/.test(error.message));
  assert.equal(saved.c1, undefined);
});

test('refuses empty, overlong and malformed messages, and unknown chats', async () => {
  const { turns } = setup();
  for (const text of ['', '   ', 'x'.repeat(12001), 5, null, undefined]) await assert.rejects(turns.send({ chat: 'c1', text }), error => error.status === 400);
  await assert.rejects(turns.send({ chat: { id: 'c1' }, text: 'hi' }), error => error.status === 400);
  await assert.rejects(turns.send({ chat: 'gone', text: 'hi' }), error => error.status === 404);
});

test('runs one reply at a time', async () => {
  let release;
  const { turns } = setup({ reply: () => new Promise(done => { release = () => done('Done'); }) });
  await turns.send({ chat: 'c1', text: 'one' });
  await assert.rejects(turns.send({ chat: 'c1', text: 'two' }), error => error.status === 409);
  while (!release) await new Promise(done => setTimeout(done, 1));
  release();
  await finished(turns);
  await turns.send({ chat: 'c1', text: 'three' });
  await new Promise(done => setTimeout(done, 5));
  release();
  await finished(turns);
});

test('shows what’s being written while it’s written', async () => {
  let release, seen;
  const { turns } = setup({ reply: request => { seen = request; return new Promise(done => { release = () => done('Hello there'); }); } });
  await turns.send({ chat: 'c1', text: 'hi' });
  while (!seen) await new Promise(done => setTimeout(done, 1));
  seen.onText('Hello');
  assert.deepEqual(turns.live('c1'), { text: 'Hello' });
  assert.equal(turns.live('other'), null);
  assert.deepEqual(turns.running(), { c1: 'working' });
  release();
  await finished(turns);
  assert.equal(turns.live('c1'), null);
  assert.deepEqual(turns.running(), {});
});

test('stopping keeps what was written, and frees it for the next message', async () => {
  const { turns, saved } = setup({ reply: ({ signal, onText }) => new Promise((_, reject) => { onText('Partial'); signal.addEventListener('abort', () => reject(new Error('Stopped.'))); }) });
  await turns.send({ chat: 'c1', text: 'hi' });
  await new Promise(done => setTimeout(done, 5));
  assert.throws(() => turns.stop('other'), error => error.status === 409);
  assert.deepEqual(turns.stop('c1'), { ok: true });
  await finished(turns);
  assert.deepEqual(saved.c1.map(entry => entry.content), ['hi', 'Partial']);
  assert.equal(turns.failed('c1'), null);
});

test('a failed reply keeps the message, says what went wrong, and clears on the next try', async () => {
  let fail = true;
  const { turns, saved } = setup({ reply: async () => { if (fail) throw new Error('No key'); return 'Fine'; } });
  await turns.send({ chat: 'c1', text: 'hi' });
  await finished(turns);
  assert.deepEqual(saved.c1.map(entry => entry.role), ['user']);
  assert.equal(turns.failed('c1'), 'No key');
  fail = false;
  await turns.send({ chat: 'c1', text: 'again' });
  assert.equal(turns.failed('c1'), null);
  await finished(turns);
});

test('tells the Mac when an open chat changes, at the start and the end', async () => {
  const { turns, changes } = setup();
  await turns.send({ chat: 'c1', text: 'hi' });
  await finished(turns);
  assert.ok(changes.length >= 3);
  assert.ok(changes.every(id => id === 'c1'));
});

test('lists pinned chats first, then the newest, with folder names and states', () => {
  const list = phoneChatList({ folders: [{ id: 'f', name: 'Study' }], running: { w: 'waiting' }, sessions: [
    { id: 'old', title: 'Old', updatedAt: '2026-01-01', folder: 'f', work: '' },
    { id: 'new', title: 'New', updatedAt: '2026-03-01', work: '' },
    { id: 'pin', title: 'Pin', updatedAt: '2025-01-01', pinned: true, work: '' },
    { id: 'w', title: 'Work', updatedAt: '2026-02-01', work: 'Fairy' },
  ] }, { new: 'working' });
  assert.deepEqual(list.map(item => item.id), ['pin', 'new', 'w', 'old']);
  assert.equal(list[3].folder, 'Study');
  assert.equal(list[1].state, 'working');
  assert.equal(list[2].state, 'waiting');
  assert.equal(list[2].work, 'Fairy');
  assert.equal(list[0].work, null);
});

function voiceSetup({ reply, speak } = {}) {
  const chats = [{ id: 'c1', title: 'Plain', work: '' }], saved = {}, made = [];
  const turns = new PhoneTurns({ list: () => chats, read: async id => saved[id] ?? [], append: async (id, entries) => { saved[id] = [...(saved[id] ?? []), ...entries]; }, addChat: async () => 'new', now: () => 'now',
    reply: reply ?? (async ({ onText }) => { onText('Hello there.'); return 'Hello there.'; }),
    makeVoice: ({ signal, emit }) => {
      const voice = { signal, texts: [], update: text => voice.texts.push(text), finish: async text => { voice.finished = text; const bytes = await (speak ?? (async () => new Uint8Array([1, 2, 3])))(text, signal); emit({ sequence: 0, bytes, text }); return ''; }, cancel: () => { voice.cancelled = true; } };
      made.push(voice);
      return voice;
    } });
  return { turns, saved, made };
}
const voiceDone = async (turns, id) => { while (!turns.voice(id)?.done) await new Promise(done => setTimeout(done, 1)); };

test('a voice reply makes clips the phone can fetch in turn', async () => {
  const { turns, made } = voiceSetup();
  await turns.send({ chat: 'c1', text: 'hi', voice: true });
  await voiceDone(turns, 'c1');
  assert.deepEqual(turns.voice('c1'), { parts: 1, done: true, failed: '' });
  assert.deepEqual([...turns.voicePart('c1', 0)], [1, 2, 3]);
  assert.equal(turns.voicePart('c1', 1), null);
  assert.equal(turns.voicePart('other', 0), null);
  assert.deepEqual(made[0].texts, ['Hello there.']);
  assert.equal(made[0].finished, 'Hello there.');
});

test('no clips are made unless they’re asked for', async () => {
  const { turns, made } = voiceSetup();
  await turns.send({ chat: 'c1', text: 'hi' });
  await finished(turns);
  assert.equal(made.length, 0);
  assert.equal(turns.voice('c1'), null);
  await turns.send({ chat: 'c1', text: 'hi', voice: 'yes' });
  await finished(turns);
  assert.equal(made.length, 0);
});

test('stopping also stops the clips, and the next message clears the old ones', async () => {
  let abort;
  const { turns, made } = voiceSetup({ speak: (_, signal) => new Promise((_done, reject) => { abort = reject; signal.addEventListener('abort', () => reject(new Error('Stopped.'))); }) });
  await turns.send({ chat: 'c1', text: 'hi', voice: true });
  while (!abort) await new Promise(done => setTimeout(done, 1));
  assert.equal(turns.turn, null);
  assert.deepEqual(turns.stop('c1'), { ok: true });
  await voiceDone(turns, 'c1');
  assert.equal(made[0].signal.aborted, true);
  assert.equal(made[0].cancelled, true);
  assert.equal(turns.voice('c1').parts, 0);
});

test('the next message needn’t wait for the last clips, and replaces them', async () => {
  const { turns } = voiceSetup({ speak: (_, signal) => new Promise((_done, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped.')))) });
  await turns.send({ chat: 'c1', text: 'one', voice: true });
  while (turns.turn) await new Promise(done => setTimeout(done, 1));
  const first = turns.spoken;
  await turns.send({ chat: 'c1', text: 'two', voice: true });
  assert.equal(first.controller.signal.aborted, true);
  assert.notEqual(turns.spoken, first);
  turns.stopAll();
});

test('a voice that fails says so, and the reply still stands', async () => {
  const chats = [{ id: 'c1', title: 'Plain', work: '' }], saved = {};
  const turns = new PhoneTurns({ list: () => chats, read: async () => [], append: async (id, entries) => { saved[id] = [...(saved[id] ?? []), ...entries]; }, addChat: async () => 'new',
    reply: async () => 'Hello',
    makeVoice: () => ({ update: () => {}, cancel: () => {}, finish: async () => 'No voice is set up on the Mac.' }) });
  await turns.send({ chat: 'c1', text: 'hi', voice: true });
  await voiceDone(turns, 'c1');
  assert.equal(turns.voice('c1').failed, 'No voice is set up on the Mac.');
  assert.deepEqual(saved.c1.map(entry => entry.content), ['hi', 'Hello']);
});

test('clips can’t pile up without limit', async () => {
  const { turns } = voiceSetup();
  await turns.send({ chat: 'c1', text: 'hi', voice: true });
  const spoken = turns.spoken;
  spoken.size = 30 * 1024 * 1024;
  turns.addPart(spoken, { bytes: new Uint8Array([1]) });
  assert.equal(spoken.controller.signal.aborted, true);
  assert.equal(spoken.parts.includes(1), false);
  turns.stopAll();
  await voiceDone(turns, 'c1').catch(() => {});
});

test('the Mac’s route picks Gmail or Calendar from the words, and both sides are saved in that mode', async () => {
  const routed = [];
  const { turns, saved, asked } = setup({ route: async (text, history) => { routed.push([text, history.length]); return /mail/.test(text) ? 'gmail' : 'desktop'; } });
  await turns.send({ chat: 'c1', text: 'go through my unread emails' });
  await finished(turns);
  assert.equal(asked[0].mode, 'gmail');
  assert.deepEqual(saved.c1.map(entry => entry.mode), ['gmail', 'gmail']);
  await turns.send({ chat: 'c1', text: 'open Terminal' });
  await finished(turns);
  assert.equal(asked[1].mode, 'chat', 'a mode a phone may not use becomes plain conversation');
  assert.deepEqual(routed, [['go through my unread emails', 0], ['open Terminal', 2]]);
});

test('an OK the reply waits for shows as waiting, and goes when the reply ends', async () => {
  let release;
  const { turns } = setup({ route: async () => 'calendar', reply: async ({ chat }) => { turns.waitFor(chat, { id: 'a1', kind: 'calendar-event', title: 'Create this Google Calendar event?' }); await new Promise(done => { release = done; }); return 'Added.'; } });
  await turns.send({ chat: 'c1', text: 'add lunch with Sam tomorrow at 1 to my calendar' });
  while (!release) await new Promise(done => setTimeout(done, 1));
  assert.deepEqual(turns.running(), { c1: 'waiting' });
  release();
  await finished(turns);
  assert.equal(turns.asking, null);
  assert.deepEqual(turns.running(), {});
});

test('the Mac’s router sends a phone’s everyday requests to Gmail or Calendar, and keeps the rest plain', async () => {
  const { requestMode } = await import('../src/chat-routing.js');
  const route = (text, history = []) => { const mode = requestMode(text, 'chat', { autoDesktop: 'on', autoScreen: 'on' }, history); return ['gmail', 'calendar'].includes(mode) ? mode : 'chat'; };
  assert.equal(route('hey fairy, can you go through my recent unread emails'), 'gmail');
  assert.equal(route('Hey Fairy, can you add dinner with Sam on Friday at 7pm to my calendar'), 'calendar');
  assert.equal(route('what’s on my calendar tomorrow'), 'calendar');
  assert.equal(route('open Terminal and take a screenshot'), 'chat', 'a phone never reaches the desktop or the screen');
  assert.equal(route('add the second one to my calendar', [{ role: 'assistant', mode: 'gmail', content: 'Two invitations…' }]), 'calendar');
});
