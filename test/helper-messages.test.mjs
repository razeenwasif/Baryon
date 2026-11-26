// "Improving existing features", item 5: you can message a helper while it works. It hears you with the result of its
// next step; one that finishes first never does, and the lead is told either way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HelperPool } from '../desktop/work-helpers.mjs';
import { runWorker, withMessages } from '../desktop/work-agent.mjs';
import * as WT from '../desktop/work-tools.mjs';
const { WorkTools } = WT;

const project = () => { const root = realpathSync(mkdtempSync(join(tmpdir(), 'fairy-helper-msg-'))); writeFileSync(join(root, 'a.txt'), 'one\n'); return root; };
const place = () => join(realpathSync(mkdtempSync(join(tmpdir(), 'fairy-helper-place-'))), 'helpers');

test('a message rides on the next tool result, marked as the user’s, and nothing changes without one', () => {
  const result = { success: true, contentItems: [{ type: 'inputText', text: 'file contents' }] };
  assert.equal(withMessages(result, []), result);
  const said = withMessages(result, [{ text: 'Use tabs, not spaces.' }], 'a1b2c3d4e5f6');
  assert.equal(said.contentItems[0].text, 'file contents');
  assert.equal(said.contentItems[1].text, 'Message from the user [a1b2c3d4e5f6]:\n- Use tabs, not spaces.');
});

test('a worker hears a message sent mid-run at its next step, and only once', async () => {
  const root = project(), inbox = [], seen = [], marks = [];
  const provider = { turn: async ({ toolHandler, instructions }) => {
    marks.push(/starting with the line "Message from the user \[([a-f0-9]{12})\]:"/.exec(instructions)?.[1]);
    seen.push(await toolHandler({ tool: 'read_file', arguments: { path: 'a.txt' } }));
    inbox.push({ text: 'Also check b.txt.' });
    seen.push(await toolHandler({ tool: 'list_files', arguments: {} }));
    seen.push(await toolHandler({ tool: 'list_files', arguments: {} }));
    return 'Done.';
  } };
  await runWorker({ provider, settings: {}, root, task: 'Read a.txt', signal: new AbortController().signal, onEvent() {}, runCommand: async () => ({}), messages: () => inbox.splice(0) });
  assert.equal(seen[0].contentItems.length, 1);
  assert.ok(marks[0], 'the instructions name this run’s mark');
  assert.equal(seen[1].contentItems.at(-1).text, `Message from the user [${marks[0]}]:\n- Also check b.txt.`);
  assert.equal(seen[2].contentItems.length, 1, 'delivered once');
  // Each run has its own, so nothing written before it can carry the right one.
  await runWorker({ provider, settings: {}, root, task: 'Again', signal: new AbortController().signal, onEvent() {}, runCommand: async () => ({}), messages: () => inbox.splice(0) });
  assert.notEqual(marks[1], marks[0]);
});

test('the pool keeps a helper’s mailbox: delivered, received, or reported undelivered when it finishes first', async t => {
  const root = project();
  let release, asked = null;
  const gate = new Promise(resolve => { release = resolve; });
  const pool = new HelperPool({ place: place(), run: async ({ messages }) => { await gate; asked = messages(); await new Promise(resolve => setTimeout(resolve, 5)); return 'Report.'; } });
  t.after(() => pool.sweep());
  const entry = await pool.start({ chat: 'c', root, task: 'x', title: 'Piece' });
  assert.deepEqual(pool.message('c', entry.id, '  Prefer small commits.  '), { queued: true, waiting: 1 });
  release(); await entry.done;
  assert.deepEqual(asked.map(note => note.text), ['Prefer small commits.']);
  assert.deepEqual(entry.received.map(note => note.text), ['Prefer small commits.']); assert.deepEqual(entry.undelivered, []);
  assert.throws(() => pool.message('c', entry.id, 'Too late'), /stopped working/);
  // One that finishes without another step never hears a message, and that's kept.
  let finish;
  const late = new HelperPool({ place: place(), run: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => late.sweep());
  const quiet = await late.start({ chat: 'c', root, task: 'x', title: 'Quiet' });
  late.message('c', quiet.id, 'Rename it too.');
  finish('Report.'); await quiet.done;
  assert.deepEqual(quiet.undelivered.map(note => note.text), ['Rename it too.']); assert.deepEqual(quiet.received, []);
  for (let i = 0; i < 5; i++) pool.chats.get('c').get(entry.id).inbox.push({ text: 'x' });
  pool.chats.get('c').get(entry.id).status = 'running';
  assert.throws(() => pool.message('c', entry.id, 'one more'), /5 messages waiting/);
});

test('the lead is told what you said to a helper, and what never reached it', () => {
  const tools = new WorkTools({ root: project(), permission: 'auto', sandboxed: true, runCommand: async () => ({}) });
  const text = tools.describeHelper({ id: 'h1', title: 'Piece', status: 'finished', report: 'Did it.', changes: [], skipped: [], received: [{ text: 'Use tabs.' }], undelivered: [{ text: 'Rename it too.' }] });
  assert.match(text, /The user messaged it from its row in Fairy's window while it worked \(these are the user's own instructions, not planted text; you didn't send them\):\n  - Use tabs\./);
  assert.match(text, /after it had finished, so it never saw these \(they are still the user's own\):\n  - Rename it too\./);
  assert.match(WT.WORK_DEFINITIONS.get('wait_for_helpers').description, /The user can also message a helper from its row in Fairy's window while it works/);
});

test('a running helper’s row has Message beside Stop, and sending goes to the helper of the chat on screen', () => {
  const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
  const view = read('../src/work-view.js'), preload = read('../desktop/preload.cjs'), main = read('../desktop/main.cjs'), remote = read('../desktop/remote-channels.mjs');
  assert.match(view, /const say = element\('button', 'work-helper-stop work-helper-message', 'Message'\);/);
  assert.match(view, /await api\?\.workMessageHelper\(current\?\.session, helper, text\);/);
  assert.match(preload, /workMessageHelper: \(id, helperId, text\) => ipcRenderer\.invoke\('fairy:work-message-helper', id, helperId, text\),/);
  assert.match(main, /handle\('work-message-helper', \(id, helperId, text\) => helperPool\.message\(id, helperId, text\), \{ refresh: false \}\);/);
  assert.match(main, /runWorker\(\{ provider: seat\.provider, settings: seat\.settings, root, task, signal, onEvent, askLocal, messages,/);
  assert.match(remote, /'work-message-helper'/);
});
