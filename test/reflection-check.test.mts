// Efficiency audit, fix 10: the 30-minute reflection check reads no chat until reflection could be due, and then only
// the chats changed since the last pass.
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../desktop/sessions.mjs';
import { LongTermMemory } from '../desktop/long-term-memory.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';

const turn = (role: string, content: string, at: string) => ({ role, content, at, mode: 'chat' });
async function store(t: TestContext) {
  const legacyDir = await mkdtemp(join(tmpdir(), 'fairy-reflect-')), dir = join(legacyDir, 'sessions');
  t.after(() => rm(legacyDir, { recursive: true, force: true }));
  let clock = '2026-11-01T10:00:00.000Z', ids = 0;
  const s = new SessionStore({ dir, legacyDir, readJSON, writeJSON, trash: async () => {}, now: () => clock, id: () => `chat-${++ids}` });
  await s.load();
  const reads: string[] = [], read = s.read.bind(s);
  s.read = async id => { reads.push(id); return read(id); };
  return { s, reads, at: (value: string) => { clock = value; } };
}

test('only chats changed since the last reflection are read, and the open chat always counts', async t => {
  const { s, reads, at } = await store(t);
  at('2026-11-01T10:00:00.000Z'); await s.save([turn('user', 'Old one', '2026-11-01T10:00:00.000Z')]);
  await s.create();
  at('2026-11-03T09:00:00.000Z'); await s.save([turn('user', 'New one', '2026-11-03T09:00:00.000Z')]);
  await s.create();
  at('2026-11-03T09:30:00.000Z'); await s.save([turn('user', 'Open one', '2026-11-03T09:30:00.000Z')]);
  reads.length = 0;
  const since = await s.allHistory({ since: '2026-11-02T00:00:00.000Z' });
  assert.deepEqual(since.map(e => e.content), ['New one', 'Open one']);
  assert.deepEqual(reads, ['chat-2'], 'the old chat isn’t opened; the open one is already in memory');
  reads.length = 0;
  assert.deepEqual((await s.allHistory()).map(e => e.content), ['Old one', 'New one', 'Open one'], 'without since, every chat as before');
  assert.equal(reads.length, 2);
});

test('a chat whose time can’t be read is read all the same', async t => {
  const { s, reads, at } = await store(t);
  at('2026-11-01T10:00:00.000Z'); await s.save([turn('user', 'Undated', '2026-11-05T10:00:00.000Z')]);
  await s.create();
  s.sessions.find(x => x.id === 'chat-1')!.updatedAt = '';
  reads.length = 0;
  assert.deepEqual((await s.allHistory({ since: '2026-11-02T00:00:00.000Z' })).map(e => e.content), ['Undated']);
  assert.deepEqual(reads, ['chat-1']);
});

test('within 20 hours of the last pass it can’t be due, so nothing is read', () => {
  const now = new Date('2026-11-03T10:00:00.000Z');
  const memory = new LongTermMemory({ read: async () => null, write: async () => {}, now: () => now });
  assert.equal(memory.mayBeDue(now), true, 'never reflected: maybe');
  memory.lastReflection = { at: '2026-11-03T00:00:00.000Z' } as any;
  assert.equal(memory.mayBeDue(now), false, '10 hours ago: no');
  memory.lastReflection = { at: '2026-11-02T13:00:00.000Z' } as any;
  assert.equal(memory.mayBeDue(now), true, '21 hours ago: maybe');
  // mayBeDue never says no when due() would say yes.
  const history = Array.from({ length: 6 }, (_, i) => turn('user', `m${i}`, `2026-11-03T0${i}:00:00.000Z`));
  for (const at of ['2026-11-03T00:00:00.000Z', '2026-11-02T13:00:00.000Z', null]) {
    memory.lastReflection = (at ? { at } : null) as any;
    if (memory.due(history, now)) assert.equal(memory.mayBeDue(now), true);
  }
});

test('the app checks the time first, then reads only what changed', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  const timer = main.slice(main.indexOf('const reflectionTimer = setInterval'), main.indexOf('reflectionTimer.unref'));
  assert.ok(timer.indexOf('if (!longTermMemory.mayBeDue()) return;') < timer.indexOf('allHistory('), 'the time gate comes before any reading');
  assert.match(timer, /sessions\.allHistory\(\{ since: longTermMemory\.reflectedUntil \}\)/);
  assert.match(main, /longTermMemory\.reflectionPrompt\(await sessions\.allHistory\(\{ since: longTermMemory\.reflectedUntil \}\)\)/);
});
