import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore } from '../desktop/sessions.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { kindOf, REMOTE } from '../desktop/remote-channels.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

async function makeStore(t) {
  const legacyDir = await mkdtemp(join(tmpdir(), 'fairy-chat-rewind-'));
  const dir = join(legacyDir, 'sessions');
  t.after(() => rm(legacyDir, { recursive: true, force: true }));
  let clock = 0, ids = 0;
  const store = new SessionStore({
    dir,
    legacyDir,
    readJSON,
    writeJSON,
    trash: async () => {},
    now: () => new Date(Date.UTC(2026, 10, 23, 1, 0, clock++)).toISOString(),
    id: () => `chat-${++ids}`,
  });
  await store.load();
  return store;
}

test('plain chat rewind truncates at timestamp or fallback index and preserves prior turns', async t => {
  const store = await makeStore(t);
  await store.save([
    { role: 'user', content: 'First prompt', at: '2026-11-23T00:01:00.000Z', mode: 'chat' },
    { role: 'assistant', content: 'First answer', at: '2026-11-23T00:01:05.000Z', mode: 'chat' },
    { role: 'user', content: 'Second prompt', mode: 'chat', attachments: [{ id: 'att-2', name: 'notes.md' }] },
    { role: 'assistant', content: 'Second answer', at: '2026-11-23T00:02:05.000Z', mode: 'chat' },
  ]);

  // Fallback index rewind (for older user entries without `at`).
  const targetIndex = 2;
  assert.equal(store.history[targetIndex].role, 'user');
  const restoredPrompt = store.history[targetIndex].content;
  await store.truncate(store.active, targetIndex);
  assert.equal(restoredPrompt, 'Second prompt');
  assert.equal(store.history.length, 2);
  assert.equal(store.history[0].content, 'First prompt');
  assert.equal(store.history[1].content, 'First answer');

  // Timestamp rewind to first turn leaves empty history.
  const firstIndex = store.history.findIndex(e => e.role === 'user' && e.at === '2026-11-23T00:01:00.000Z');
  assert.equal(firstIndex, 0);
  await store.truncate(store.active, firstIndex);
  assert.equal(store.history.length, 0);
});

test('chat-rewind is registered as a Remote channel and wired across preload, main, UI, and CSS', async () => {
  assert.ok(REMOTE.includes('chat-rewind'));
  assert.equal(kindOf('chat-rewind'), 'remote');

  const [mainSrc, preloadSrc, appSrc, cssSrc] = await Promise.all([
    read('../desktop/main.cjs'),
    read('../desktop/preload.cjs'),
    read('../src/app.js'),
    read('../src/workspace.css'),
  ]);

  assert.match(mainSrc, /handle\('chat-rewind'/);
  assert.match(preloadSrc, /chatRewind:/);
  assert.match(appSrc, /function attachUserActions\(/);
  assert.match(appSrc, /function startInlineEdit\(/);
  assert.match(appSrc, /data-action.*copy|makeBtn\('copy'/);
  assert.match(appSrc, /makeBtn\('edit',\s*'Edit message'/);
  assert.match(appSrc, /makeBtn\('rewind',\s*'Undo to this point'/);
  assert.match(appSrc, /Save & Resend/);
  assert.match(cssSrc, /\.message-action-btn/);
  assert.match(cssSrc, /\.message-inline-edit/);
  assert.match(cssSrc, /\.message-edit-save/);
});
