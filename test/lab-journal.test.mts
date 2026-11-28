// Doc 7, #9: Per-project dated lab journal — auto-recording, secret scrubbing, CRUD, compact session context, Markdown export, and IPC wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LabJournal, MAX_ENTRIES, cleanEntry, entryFromWorkTurn, journalMarkdown, journalNote, redactSecrets, worthRecording } from '../desktop/lab-journal.mjs';
import { turnNotes } from '../desktop/work-agent.mjs';

test('worthRecording and entryFromWorkTurn deterministically capture what was tried, outcome, decisions, and scrub secrets', () => {
  assert.equal(worthRecording({ activity: [{ tool: 'read', summary: 'a.js', status: 'done' }] }), false);
  assert.equal(worthRecording({ changed: ['a.js'] }), true);
  assert.equal(worthRecording({ activity: [{ tool: 'run', status: 'done' }, { tool: 'run', status: 'done' }] }), true);
  assert.equal(worthRecording({ unfinished: true, activity: [{ tool: 'read', status: 'running' }] }), true);

  const entry = entryFromWorkTurn({
    request: 'Switch the cache key to SHA-256\nAlso check memory limits.',
    reply: '```js\nconst k = "ignored code block";\n```\nSwitched the cache key to SHA-256 using sk-secretTokenValue12345. We decided to drop LRU eviction because dataset size stayed small.',
    activity: [
      { tool: 'edit', summary: 'src/cache.js', status: 'done' },
      { tool: 'run', summary: 'npm test', status: 'done' },
    ],
    verdict: { line: 'Checked (1/1 passed)' },
    changed: ['src/cache.js'],
    chat: 'chat-42',
    replyAt: '2026-11-22T09:05:00.000Z',
  });
  assert.ok(entry);
  assert.equal(entry.date, '2026-11-22');
  assert.equal(entry.title, 'Switch the cache key to SHA-256');
  assert.equal(entry.source, 'auto');
  assert.equal(entry.chat, 'chat-42');
  assert.match(entry.tried, /changed 1 file \(src\/cache\.js\)/);
  assert.match(entry.tried, /ran 1 command/);
  assert.match(entry.outcome, /^Checked \(1\/1 passed\)/);
  assert.ok(!entry.outcome.includes('sk-secretTokenValue12345'), 'secrets redacted');
  assert.ok(entry.outcome.includes('[redacted]'));
  assert.ok(!entry.outcome.includes('ignored code block'), 'fenced code blocks stripped');
  assert.match(entry.decision, /decided to drop LRU eviction/i);

  const interrupted = entryFromWorkTurn({
    request: 'Train sweep',
    reply: 'Timed out midway.',
    activity: [{ tool: 'run', summary: 'python train.py', status: 'running' }],
    unfinished: true,
    ended: 'timeout',
    replyAt: '2026-11-22T09:10:00.000Z',
  })!;
  assert.match(interrupted.outcome, /Stopped\/Failed \(timeout\)/);
  assert.equal(redactSecrets('token ghp_1234567890abcdef and hex ' + 'a'.repeat(42)), 'token [redacted] and hex [redacted]');
  assert.equal(cleanEntry({}), null);
});

test('LabJournal supports CRUD, dedup by chat+replyAt, MAX_ENTRIES cap, and listProjects', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-journal-')));
  t.after(() => rm(dir, { recursive: true, force: true }));

  let seq = 0;
  const journal = new LabJournal({
    dir,
    now: () => '2026-11-22T10:00:00.000Z',
    id: () => `j-${++seq}`,
  });

  await journal.add('/proj/alpha', {
    date: '2026-11-20',
    title: 'Baseline run',
    tried: 'Ran lr=1e-3',
    outcome: 'Accuracy 0.81',
    decision: 'Keep baseline for comparison.',
    source: 'auto',
    chat: 'c1',
    replyAt: '2026-11-20T05:00:00Z',
  });
  // Duplicate chat + replyAt is ignored
  await journal.add('/proj/alpha', {
    date: '2026-11-20',
    title: 'Duplicate turn',
    tried: 'Same turn',
    source: 'auto',
    chat: 'c1',
    replyAt: '2026-11-20T05:00:00Z',
  });
  let entries = await journal.list('/proj/alpha');
  assert.equal(entries.length, 1);

  await journal.add('/proj/alpha', {
    date: '2026-11-22',
    title: 'Second experiment',
    tried: 'Lowered lr to 3e-4',
    outcome: 'Accuracy 0.88',
    decision: 'Switched default lr to 3e-4.',
  });
  entries = await journal.list('/proj/alpha');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-11-22', 'newest date first');

  // Update marks entry as user-edited ('you')
  entries = await journal.update('/proj/alpha', 'j-1', { decision: 'Confirmed superseded by j-3.' });
  const updated = entries.find(e => e.id === 'j-1')!;
  assert.equal(updated.source, 'you');
  assert.equal(updated.decision, 'Confirmed superseded by j-3.');

  // Empty update rejected
  await assert.rejects(() => journal.update('/proj/alpha', 'j-1', { title: '', tried: '', outcome: '', decision: '' }));

  // Remove entry
  entries = await journal.remove('/proj/alpha', 'j-1');
  assert.equal(entries.length, 1);

  // Other project cap at MAX_ENTRIES
  await Promise.all(Array.from({ length: MAX_ENTRIES + 10 }, (_, i) => journal.add('/proj/beta', {
    date: '2026-11-21',
    title: `Step ${i}`,
    outcome: 'ok',
  })));
  assert.equal((await journal.list('/proj/beta')).length, MAX_ENTRIES);

  const projects = await journal.listProjects();
  assert.equal(projects.length, 2);
  assert.ok(projects.some(p => p.folder === '/proj/alpha' && p.count === 1));
  assert.ok(projects.some(p => p.folder === '/proj/beta' && p.count === MAX_ENTRIES));
});

test('journalNote, journalMarkdown, and turnNotes format compact context without displacing project memory', () => {
  assert.equal(journalNote([]), '');
  const note = journalNote([
    { date: '2026-11-20', at: '2026-11-20T01:00Z', title: 'Older trial', tried: 'x', outcome: 'fail', decision: 'dropped' },
    { date: '2026-11-22', at: '2026-11-22T02:00Z', title: 'Latest run', tried: 'y', outcome: 'pass', decision: 'kept' },
  ] as any, { maxChars: 600 });
  assert.match(note, /^Recent lab journal for this project/);
  assert.ok(note.indexOf('[2026-11-22]') < note.indexOf('[2026-11-20]'), 'newest entry listed first');

  const md = journalMarkdown('/proj/alpha', [
    { date: '2026-11-22', title: 'Latest run', tried: 'y', outcome: 'pass', decision: 'kept', source: 'you' },
  ] as any);
  assert.match(md, /# Lab journal — \/proj\/alpha/);
  assert.match(md, /## 2026-11-22/);
  assert.match(md, /### Latest run \(edited\)/);

  const combined = turnNotes({ memory: 'What the user has kept about this project\n- item', journal: note });
  assert.ok(combined.startsWith('What the user has kept about this project'), 'project memory stays first');
  assert.ok(combined.includes('Recent lab journal for this project'));
});

test('main, preload, remote-channels, and renderer wire the lab journal handlers and pane', async () => {
  const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
  const [main, preload, channels, app] = await Promise.all([
    read('../build-ts/desktop/main.cjs'),
    read('../desktop/preload.cts'),
    read('../desktop/remote-channels.mts'),
    read('../src/app.ts'),
  ]);
  assert.match(main, /journal:\s*labJournalModule\.journalNote\(await labJournal\.list\(work\.folder\)\)/);
  assert.match(main, /recordLabJournal\(/);
  for (const ch of ['lab-journal-list', 'lab-journal-add', 'lab-journal-update', 'lab-journal-remove']) {
    assert.ok(main.includes(`handle('${ch}'`), ch);
    assert.ok(preload.includes(`'fairy:${ch}'`), ch);
    assert.ok(channels.includes(`'${ch}'`), ch);
  }
  assert.ok(app.includes("journalPane"));
  assert.ok(app.includes("name: 'journal'"));
});
