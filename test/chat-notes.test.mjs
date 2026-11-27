// A chat's notes: pinned facts first in a work session's notes, and notes you can see, correct and pin lines in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CHAT_INSTRUCTIONS, NOTE_HEADINGS, PINNED, WorkCompactor, noteSections, pinnedFacts, summarise } from '../desktop/work-compact.mjs';

const notes = `## Goal
Ship CSV and JSON export.
**Plan:**
1. CSV (done)
2. JSON
Decisions: Stream rows, to keep memory flat.
Open questions: None yet.
Done and checked:
- CSV export, tests pass

Pinned by you:
Never touch the legacy exporter.`;

test('a work session’s notes are asked for under fixed headings, the first four pinned, with yours kept word for word', async () => {
  assert.deepEqual(PINNED, ['Goal', 'Plan', 'Decisions', 'Open questions']);
  let asked = '';
  const provider = { turn: async options => { asked = options.instructions; return notes; } };
  const history = [{ role: 'user', content: 'Add exports', at: '1' }, { role: 'assistant', content: 'On it', at: '2' }, { role: 'user', content: 'Go on', at: '3' }];
  await summarise({ provider, settings: {}, history, summary: null, batch: { from: 0, through: 2, skipped: 0 }, signal: new AbortController().signal });
  for (const name of NOTE_HEADINGS) assert.ok(asked.includes(`${name}:`), name);
  assert.match(asked, /The first four are the session's pinned facts/);
  assert.match(asked, /"Pinned by you", the user wrote it: copy it unchanged at the end/);
  assert.match(CHAT_INSTRUCTIONS, /"Pinned by you", the user wrote it: copy it unchanged/);
});

test('notes are read by heading, in Markdown or not, and the pinned facts are the four plus yours', () => {
  const sections = noteSections(notes);
  assert.equal(sections.Goal, 'Ship CSV and JSON export.');
  assert.equal(sections.Plan, '1. CSV (done)\n2. JSON');
  assert.equal(sections.Decisions, 'Stream rows, to keep memory flat.');
  assert.equal(sections['Pinned by you'], 'Never touch the legacy exporter.');
  assert.equal(pinnedFacts(notes), 'Goal: Ship CSV and JSON export.\nPlan: 1. CSV (done)\n2. JSON\nDecisions: Stream rows, to keep memory flat.\nPinned by you: Never touch the legacy exporter.', '“None yet.” is left out');
  assert.equal(noteSections('Just some text.')[''], 'Just some text.');
});

test('notes can be corrected by hand: they stay over the same messages, and empty or overlong notes are refused', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fairy-notes-')), compactor = new WorkCompactor({ dir, connection: () => ({}), now: () => 'now' });
  const history = [{ role: 'user', content: 'a', at: '1' }, { role: 'assistant', content: 'b', at: '2' }, { role: 'user', content: 'c', at: '3' }];
  await assert.rejects(() => compactor.edit('chat', 'x', history), /no notes yet/);
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  await writeFile(compactor.path('chat'), JSON.stringify({ text: 'Goal: old', through: 2, lastAt: '2', skipped: 0, at: 'then' }));
  const saved = await compactor.edit('chat', 'Goal: new\r\n\r\nPinned by you:\nUse tabs.  ', history);
  assert.deepEqual(saved, { text: 'Goal: new\n\nPinned by you:\nUse tabs.', through: 2, lastAt: '2', skipped: 0, at: 'then', edited: 'now' });
  assert.equal(await compactor.notes('chat', history), 'Goal: new\n\nPinned by you:\nUse tabs.');
  await assert.rejects(() => compactor.edit('chat', '   ', history), /can’t be empty/);
  await assert.rejects(() => compactor.edit('chat', 'x'.repeat(13000), history), /under 12,000 characters/);
  // A rewind past the notes' last message leaves them unusable, so they can't be edited either.
  await assert.rejects(() => compactor.edit('chat', 'Goal: y', history.slice(0, 1)), /no notes yet/);
});

test('the window shows a Notes button on compacted messages that opens the notes, and saving goes to the chat on screen', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const compacted = read('../src/compacted.js'), app = read('../src/app.js'), view = read('../src/chat-notes.js'), main = read('../desktop/main.cjs'), preload = read('../desktop/preload.cjs');
  assert.match(compacted, /notes\.textContent = 'Notes';/);
  assert.match(compacted, /bar\.append\(head, notes\); section\.append\(bar, list\);/, 'the button sits beside the heading, not inside it');
  assert.match(app, /foldCompacted\(\$\('#messages'\), state\.history, state\.sessions\?\.summarized\?\.through \?\? 0, \{ onNotes: \(\) => openChatNotes\(\{ api, onError: error \}\) \}\);/);
  assert.match(view, /api\.sessionNotes\(\)/); assert.match(view, /api\.sessionNotesSave\(text\.value\)/); assert.match(view, /Pinned by you:\\n/);
  assert.match(preload, /sessionNotes: \(\) => ipcRenderer\.invoke\('fairy:session-notes'\),/);
  assert.match(main, /handle\('session-notes-save', async text => \{[\s\S]{0,300}if \(active \|\| workRuns\.has\(id\)\) throw new Error\('Wait for Fairy to finish replying first\.'\);[\s\S]{0,200}\.edit\(id, text, history\);/);
});

test('folding marks the messages’ place before moving them into the section (it used to fail with insertBefore)', () => {
  const compacted = readFileSync(new URL('../src/compacted.js', import.meta.url), 'utf8');
  assert.match(compacted, /const place = document\.createComment\('compacted'\); scroller\.insertBefore\(place, drawn\[0\]\);\n\s+const section = compactedSection\(groups, \{ count: through, onNotes \}\);\n\s+place\.replaceWith\(section\);/);
  assert.doesNotMatch(compacted, /scroller\.insertBefore\(section, drawn\[0\]\)/);
});
