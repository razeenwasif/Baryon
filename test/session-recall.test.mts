// Doc 7, #10: Recall across work and plain sessions, ⌘K content search, and recall_sessions work tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SessionRecall,
  buildTurnDocs,
  formatRecallForTool,
  isRecallQuestion,
  loadSessionsFromDir,
} from '../desktop/session-recall.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';

function makeStore(initial: any[] = []) {
  const histories = new Map<string, any[]>(initial.map(s => [s.id, s.history]));
  return {
    active: null,
    history: [] as any[],
    sessions: initial.map(({ history: _history, ...meta }) => ({ ...meta })),
    async read(id: string) { return histories.get(id) || []; },
    _histories: histories,
  };
}

test('SessionRecall searches across work sessions and plain chats with citations, folder boost, and perSession cap', async () => {
  const store = makeStore([
    {
      id: 'w-cache',
      title: 'Cache invalidation work',
      updatedAt: '2026-11-20T10:00:00Z',
      turns: 4,
      work: { folder: '/repos/alpha', permission: 'auto' },
      history: [
        { role: 'user', content: 'Should we keep an in-memory LRU cache for embeddings?', at: '2026-11-20T09:50:00Z', mode: 'work' },
        {
          role: 'assistant',
          content: 'We decided to key the LRU cache by content SHA-256 hash and cap it at 512 MB.',
          at: '2026-11-20T09:55:00Z',
          mode: 'work',
          activity: [{ tool: 'edit', summary: 'src/cache.js', status: 'done' }],
          verdict: { line: 'Checked (4/4 passed)' },
        },
        { role: 'user', content: 'Run the benchmark on cache warmup too.', at: '2026-11-20T09:58:00Z', mode: 'work' },
        { role: 'assistant', content: 'Cold warmup cache latency dropped from 420 ms to 38 ms.', at: '2026-11-20T10:00:00Z', mode: 'work' },
      ],
    },
    {
      id: 'c-notes',
      title: 'Sunday architecture chat',
      updatedAt: '2026-11-18T08:00:00Z',
      turns: 2,
      history: [
        { role: 'user', content: 'Remind me why we stopped using pickle for model checkpoints?', at: '2026-11-18T07:55:00Z', mode: 'chat' },
        { role: 'assistant', content: 'We switched checkpoints to safetensors because pickle executes arbitrary code on load.', at: '2026-11-18T08:00:00Z', mode: 'chat' },
      ],
    },
    {
      id: 'w-other',
      title: 'Beta service cache',
      updatedAt: '2026-11-21T10:00:00Z',
      turns: 2,
      work: { folder: '/repos/beta', permission: 'ask' },
      history: [
        { role: 'user', content: 'Add cache metrics', at: '2026-11-21T09:59:00Z', mode: 'work' },
        { role: 'assistant', content: 'Decided to emit LRU cache hit rate metrics to stdout.', at: '2026-11-21T10:00:00Z', mode: 'work' },
      ],
    },
  ]);

  const recall = new SessionRecall({ sessions: store });
  const res = await recall.search('what did we decide about the cache?', { preferFolder: '/repos/alpha' });
  assert.ok(res.hits.length >= 2);
  assert.equal(res.hits[0].sessionId, 'w-cache', 'folder boost prefers /repos/alpha');
  assert.equal(res.hits[0].isWork, true);
  assert.equal(res.hits[0].folder, 'alpha');
  assert.equal(res.hits[0].turnIndex, 1);
  assert.match(res.hits[0].citation, /Cache invalidation work.*work · alpha.*2026-11-20, turn #1/);

  // Plain chat hit is also searchable across all sessions
  const safeRes = await recall.search('safetensors pickle checkpoint');
  assert.equal(safeRes.hits[0].sessionId, 'c-notes');
  assert.equal(safeRes.hits[0].isWork, false);

  // onlyFolder + excludeSession filters
  const betaOnly = await recall.search('cache LRU', { onlyFolder: '/repos/beta' });
  assert.deepEqual(betaOnly.hits.map(h => h.sessionId), ['w-other']);

  const excluded = await recall.search('cache LRU', { excludeSession: 'w-cache' });
  assert.ok(excluded.hits.every(h => h.sessionId !== 'w-cache'));

  // perSession = 1 (for ⌘K palette) keeps one hit per session
  const onePer = await recall.search('cache', { perSession: 1 });
  assert.equal(new Set(onePer.hits.map(h => h.sessionId)).size, onePer.hits.length);
});

test('SessionRecall incrementally invalidates updated sessions and active history', async () => {
  const store = makeStore([
    {
      id: 's-1',
      title: 'Active draft',
      updatedAt: '2026-11-22T01:00:00Z',
      turns: 2,
      history: [
        { role: 'user', content: 'Hello', at: '2026-11-22T00:59:00Z' },
        { role: 'assistant', content: 'Hi there.', at: '2026-11-22T01:00:00Z' },
      ],
    },
  ]);
  const recall = new SessionRecall({ sessions: store });
  assert.equal((await recall.search('quantum turbine')).hits.length, 0);

  // Update session metadata & history
  store.sessions[0].updatedAt = '2026-11-22T02:00:00Z';
  store.sessions[0].turns = 4;
  store._histories.get('s-1')!.push(
    { role: 'user', content: 'Test the quantum turbine scheduler.', at: '2026-11-22T01:59:00Z' },
    { role: 'assistant', content: 'Quantum turbine scheduler verified.', at: '2026-11-22T02:00:00Z' },
  );
  const updated = await recall.search('quantum turbine');
  assert.equal(updated.hits.length, 1);
  assert.equal(updated.hits[0].turnIndex, 2);
});

test('retrieveForChat gates low-relevance noise while returning cited recall context when relevant', async () => {
  const store = makeStore([
    {
      id: 's-db',
      title: 'SQLite WAL tuning',
      updatedAt: '2026-11-21T12:00:00Z',
      turns: 2,
      work: { folder: '/proj/db', permission: 'ask' },
      history: [
        { role: 'user', content: 'Why was SQLite throwing SQLITE_BUSY?', at: '2026-11-21T11:55:00Z', mode: 'work' },
        { role: 'assistant', content: 'We enabled WAL mode and busy_timeout=5000 in sqlite to resolve lock contention.', at: '2026-11-21T12:00:00Z', mode: 'work' },
      ],
    },
  ]);
  const recall = new SessionRecall({ sessions: store });
  assert.equal(isRecallQuestion('What did we decide about SQLite WAL?'), true);
  assert.equal(isRecallQuestion('Write a haiku about rain'), false);

  assert.equal(await recall.retrieveForChat('hello good morning'), '');
  const ctx = await recall.retrieveForChat('What did we decide about SQLite WAL busy_timeout?');
  assert.match(ctx, /^Relevant turns from earlier chats and work sessions/);
  assert.match(ctx, /SQLite WAL tuning/);
  assert.match(ctx, /turn #1/);
});

test('recall_sessions work tool executes via WorkTools.handle, respects Part A enforce checks, and loadSessionsFromDir reads disk stores', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-recall-tool-')));
  const dataDir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-recall-disk-')));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(dataDir, { recursive: true, force: true });
  });

  const sessionsDir = join(dataDir, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  await writeFile(join(sessionsDir, 'index.json'), JSON.stringify({
    version: 1,
    sessions: [
      { id: 'c-disk-1', title: 'Parser refactor', updatedAt: '2026-11-21T08:00:00Z', turns: 2, work: { folder: root, permission: 'ask' } },
    ],
  }));
  await writeFile(join(sessionsDir, 'c-disk-1.json'), JSON.stringify([
    { role: 'user', content: 'Replace regex tokenizer with state machine parser?', at: '2026-11-21T07:55:00Z', mode: 'work' },
    { role: 'assistant', content: 'Kept the state machine tokenizer in src/parse.js with sk-secretKey123456789012 redacted.', at: '2026-11-21T08:00:00Z', mode: 'work' },
  ]));

  const diskStore = await loadSessionsFromDir(sessionsDir);
  const sessionRecall = new SessionRecall({ sessions: diskStore });

  const tools = new WorkTools({
    root,
    permission: 'plan',
    argumentsMode: 'enforce',
    recall: ({ query, projectOnly, limit }) => sessionRecall.search(query, {
      limit,
      preferFolder: root,
      onlyFolder: projectOnly ? root : '',
    }),
  });

  // Available tool list includes recall_sessions
  assert.ok(tools.available().some(tool => tool.name === 'recall_sessions'));

  // Part A enforce rejects invalid arguments
  const bad = await tools.handle({ tool: 'recall_sessions', arguments: { query: 'parser', extra: 1 } });
  assert.equal(bad.success, false);
  assert.equal(bad.outcome, 'invalid');

  // Valid call returns cited excerpt with secrets redacted
  const good = await tools.handle({ tool: 'recall_sessions', arguments: { query: 'state machine tokenizer parser', project_only: true, limit: 5 } });
  assert.equal(good.success, true);
  assert.equal(good.outcome, 'ok');
  const outText = (good.contentItems[0] as any).text;
  assert.match(outText, /Parser refactor/);
  assert.match(outText, /c-disk-1/);
  assert.ok(!outText.includes('sk-secretKey123456789012'), 'secrets scrubbed from recall output');

  assert.equal(buildTurnDocs({ id: 'x', title: 'Empty' }, []).length, 0);
  assert.match(formatRecallForTool({ query: 'zzz', terms: ['zzz'], hits: [] }), /No past work sessions/);

  const [main, preload, channels] = await Promise.all([
    readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/preload.cts', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/remote-channels.mts', import.meta.url), 'utf8'),
  ]);
  assert.ok(main.includes("handle('session-recall'"));
  assert.ok(preload.includes("'fairy:session-recall'"));
  assert.ok(channels.includes("'session-recall'"));
});
