// /btw (a side question answered beside the chat, never kept) and /fork (a copy of the chat to carry on in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../desktop/sessions.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { isLong, isRead, kindOf } from '../desktop/remote-channels.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
async function store(t) {
  const legacyDir = await mkdtemp(join(tmpdir(), 'fairy-fork-')), dir = join(legacyDir, 'sessions');
  t.after(() => rm(legacyDir, { recursive: true, force: true }));
  let clock = 0, ids = 0;
  const sessions = new SessionStore({ dir, legacyDir, readJSON, writeJSON, trash: async () => {}, now: () => new Date(Date.UTC(2026, 10, 16, 8, 0, clock++)).toISOString(), id: () => `id-${++ids}` });
  await sessions.load();
  return sessions;
}

test('/fork copies a chat as it stands, in the same sidebar folder, and the original is untouched', async t => {
  const sessions = await store(t);
  const history = [{ role: 'user', content: 'Plan my week', at: '2026-11-16T08:00:00.000Z', mode: 'chat' }, { role: 'assistant', content: 'Here’s a plan', at: '2026-11-16T08:00:01.000Z', mode: 'chat' }];
  const id = await sessions.addChat({ title: 'Week plan', history });
  const copy = await sessions.fork(id);
  assert.notEqual(copy, id);
  assert.deepEqual(await sessions.read(copy), history);
  assert.deepEqual(await sessions.read(id), history);
  const made = sessions.find(copy);
  assert.equal(made.title, 'Week plan (fork)');
  assert.equal(made.work, undefined);
  await sessions.open(copy);
  await sessions.save([...history, { role: 'user', content: 'Only in the fork', at: '2026-11-16T08:01:00.000Z', mode: 'chat' }]);
  assert.equal((await sessions.read(id)).length, 2, 'the original keeps its own messages');
});

test('a work session’s fork works in the same folder with the same permission, on its own branch if the original had one', async t => {
  const sessions = await store(t);
  const history = [{ role: 'user', content: 'Fix the tests', at: '2026-11-16T08:00:00.000Z', mode: 'work' }];
  const plain = await sessions.addWork({ title: 'Tests', folder: '/tmp/project', permission: 'auto', history });
  assert.deepEqual(sessions.find(await sessions.fork(plain)).work, { folder: '/tmp/project', permission: 'auto' });
  const branched = await sessions.addWork({ title: 'Branch', work: { folder: '/tmp/project', permission: 'ask', root: '/tmp/wt', branch: 'fairy/x' }, history });
  assert.deepEqual(sessions.find(await sessions.fork(branched)).work, { folder: '/tmp/project', permission: 'ask', isolate: true }, 'a new branch of its own, not the original’s');
  const empty = await sessions.addChat({ title: 'Empty', history: [] });
  await assert.rejects(sessions.fork(empty), /nothing to fork yet/);
});

test('both work from the MacBook’s window too: /btw waits for its answer and changes nothing there', () => {
  assert.equal(kindOf('btw'), 'remote');
  assert.equal(kindOf('session-fork'), 'remote');
  assert.ok(isRead('btw'), 'a side question changes no chat');
  assert.ok(!isRead('session-fork'), 'a fork does');
  assert.ok(isLong('btw'), 'it waits for the model');
});

test('the main process answers /btw from the chat on screen without saving it, and /fork opens the copy', async () => {
  const main = await read('../desktop/main.cjs');
  assert.match(main, /handle\('session-fork', \(\) => showing\(async \(\) => \{/);
  assert.match(main, /await sessions\.open\(await sessions\.fork\(sessions\.active\)\);/);
  const btw = main.slice(main.indexOf("handle('btw'"), main.indexOf("handle('btw'") + 1200);
  assert.match(btw, /provider\.chat\(\{ \.\.\.settings, remoteWindow: fromRemote\(\) \}, past\.slice\(-60\), `\$\{BTW_NOTE\}/);
  for (const word of ['saveTurn', 'sessions.save', 'sessions.append']) assert.ok(!btw.slice(0, btw.indexOf('}, { refresh: false });')).includes(word), `${word} never in /btw`);
  assert.match(main, /const BTW_NOTE = 'A quick side question, asked with \/btw/);
});

test('the composer takes /btw and /fork before anything else, work sessions included, and lists them', async () => {
  const app = await read('../src/app.js');
  const send = app.slice(app.indexOf('function send(text'), app.indexOf('async function sendMessage('));
  assert.ok(send.indexOf('/^\\/btw') < send.indexOf('if (state.sessions?.work) return sendWork(text);'));
  assert.ok(send.indexOf('/^\\/fork') < send.indexOf('if (busy && !vocalRun'), '/btw and /fork aren’t held back while she’s busy');
  assert.match(app, /\{ name: 'btw', about: 'Ask a quick side question; the answer isn’t kept in the chat'/);
  assert.match(app, /\{ name: 'fork', about: 'Copy this chat so far into a new one, and carry on there', run: forkChat \}/);
  assert.match(app, /<div id="btw" role="status" aria-live="polite" hidden><\/div>/);
  const preload = await read('../desktop/preload.cjs');
  assert.match(preload, /sessionFork: \(\) => ipcRenderer\.invoke\('fairy:session-fork'\),/);
  assert.match(preload, /btw: question => ipcRenderer\.invoke\('fairy:btw', question\),/);
});
