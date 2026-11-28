// Checkpointed work turns: what a running turn has done is kept on disk, recovered after a crash, and carried on from.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Checkpoints, checkpointOf, recoverCheckpoints, recoveredEntry, recoveredReply } from '../desktop/work-checkpoint.mjs';
import { WorkRuns } from '../desktop/work-runs.mjs';
import { workContext } from '../src/work-context.js';

const dir = () => join(mkdtempSync(join(tmpdir(), 'fairy-checkpoints-')), 'work-runs');
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
const row = (id: string, tool: string, summary: string, status = 'done', detail = '') => ({ id, tool, summary, status, ...(detail ? { detail } : {}), output: 'x'.repeat(5000) });

test('a running turn is kept on disk as it goes, without outputs, and goes once its reply is saved', async () => {
  const checkpoints = new Checkpoints({ dir: dir(), every: 5 }), runs = new WorkRuns({ checkpoints });
  const run = runs.start({ session: 'chat-1', root: '/p', at: '2026-11-16T01:00:00.000Z', request: 'Fix the parser' });
  await settle();
  const path = checkpoints.path('chat-1');
  assert.ok(existsSync(path));
  runs.emit(run, { type: 'tool', row: row('a', 'edit', 'src/parse.js') });
  runs.emit(run, { type: 'tool', row: row('b', 'run', 'npm test', 'done', 'exit 1') });
  runs.emit(run, { type: 'tasks', tasks: [{ text: 'Find the bug', status: 'done' }, { text: 'Fix it', status: 'doing' }] });
  runs.emit(run, { type: 'text', text: 'Found it in parse.js.' });
  await settle(); await settle();
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(saved.request, 'Fix the parser'); assert.equal(saved.at, '2026-11-16T01:00:00.000Z');
  assert.deepEqual(saved.rows.map((entry: any) => [entry.tool, entry.summary]), [['edit', 'src/parse.js'], ['run', 'npm test']]);
  assert.ok(!('output' in saved.rows[1]), 'outputs are left out'); assert.equal(saved.rows[1].detail, 'exit 1');
  assert.equal(saved.tasks.length, 2); assert.equal(saved.partial, 'Found it in parse.js.');
  runs.finish('chat-1'); await settle();
  assert.ok(!existsSync(path));
  // A late write after the drop doesn't bring it back.
  await checkpoints.save(run); assert.ok(!existsSync(path));
});

test('a checkpoint left by a crash becomes the turn’s unfinished reply; one whose reply was saved is just removed', async () => {
  const folder = dir(); mkdirSync(folder, { recursive: true });
  const at = '2026-11-16T01:00:00.000Z', checkpoint = { session: 'a', at, savedAt: '2026-11-16T01:05:00.000Z', rows: [row('1', 'edit', 'a.js'), row('2', 'run', 'npm test', 'done', 'exit 0'), row('3', 'run', 'npm run build', 'running')], tasks: [{ text: 'Build', status: 'doing' }], partial: 'Tests pass.' };
  writeFileSync(join(folder, 'a.json'), JSON.stringify(checkpoint));
  writeFileSync(join(folder, 'b.json'), JSON.stringify({ ...checkpoint, session: 'b' }));
  writeFileSync(join(folder, 'gone.json'), JSON.stringify({ ...checkpoint, session: 'gone' }));
  writeFileSync(join(folder, 'broken.json'), '{nope');
  const chats: Record<string, any[]> = { a: [{ role: 'user', content: 'Build it', at, mode: 'work' }], b: [{ role: 'user', content: 'Build it', at, mode: 'work' }, { role: 'assistant', content: 'Done.', at: 'later', replyTo: at, mode: 'work' }] };
  const recovered = await recoverCheckpoints({ checkpoints: new Checkpoints({ dir: folder }), find: (id: string) => chats[id], read: async (id: string) => chats[id], append: async (id: string, entries: any[]) => { chats[id].push(...entries); } });
  assert.deepEqual(recovered, ['a']);
  assert.deepEqual(readdirSync(folder), []);
  const entry = chats.a.at(-1);
  assert.equal(entry.content, 'Fairy closed before this turn finished. Before that, I changed 1 file (a.js) and ran 1 command.');
  assert.deepEqual([entry.unfinished, entry.ended, entry.replyTo, entry.partial], [true, 'closed', at, 'Tests pass.']);
  assert.equal(chats.b.length, 2, 'its reply was saved after all');
  assert.equal(recoveredReply({ rows: [] }), 'Fairy closed before this turn finished. Nothing had changed yet.');
  // Without the request's time, only a chat still ending on its request is recovered.
  assert.equal(recoveredEntry({ session: 'c', rows: [] }, [{ role: 'assistant', content: 'x' }]), null);
  assert.ok(recoveredEntry({ session: 'c', rows: [] }, [{ role: 'user', content: 'Go', mode: 'work' }]));
});

test('carrying on is told everything the cut-off turn got done, and why it stopped', () => {
  const history = [{ role: 'user', content: 'Build the export', at: '1', mode: 'work' },
    { role: 'assistant', content: 'Stopped because your Mac went to sleep, before finishing.', at: '2', mode: 'work', unfinished: true, ended: 'sleep', partial: 'CSV is done.',
      tasks: [{ text: 'CSV export', status: 'done' }, { text: 'JSON export', status: 'doing' }],
      activity: Array.from({ length: 12 }, (_, i) => row(String(i), 'run', `step ${i}`, 'done', 'exit 0')) }];
  const context = workContext(history);
  assert.match(context, /Tasks already done: CSV export/);
  assert.match(context, /Tasks not finished: JSON export/);
  assert.match(context, /This turn was cut off before it finished because the Mac went to sleep\. It had written so far: CSV is done\./);
  assert.match(context, /step 0 \(exit 0\)/, 'up to 15 commands for a cut-off turn');
  // A finished turn is described as before.
  const plain = workContext([{ role: 'user', content: 'x', at: '1', mode: 'work' } as any, { role: 'assistant', content: 'Done', at: '2', mode: 'work', tasks: [{ text: 'A', status: 'done' }], activity: Array.from({ length: 12 }, (_, i) => row(String(i), 'run', `step ${i}`)) } as any]);
  assert.doesNotMatch(plain, /Tasks already done|step 0 /);
});

test('checkpointOf keeps the newest 200 rows and the end of the text', () => {
  const rows = new Map(Array.from({ length: 250 }, (_, i) => [String(i), row(String(i), 'read', `f${i}`)]));
  const saved = checkpointOf({ session: 's', root: '/r', rows, tasks: [], text: 'y'.repeat(5000) }, new Date('2026-11-16T00:00:00Z'));
  assert.equal(saved.rows.length, 200); assert.equal(saved.rows[0].summary, 'f50'); assert.equal(saved.partial.length, 3000); assert.equal(saved.savedAt, '2026-11-16T00:00:00.000Z');
});

test('main keeps checkpoints, recovers them at start, and carries on after sleep unless you turned it off', () => {
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /workRuns = new WorkRuns\(\{ checkpoints: turnCheckpoints,/);
  assert.match(main, /workCheckpoints\.recoverCheckpoints\(\{ checkpoints: turnCheckpoints,/);
  for (const start of ["workRuns.start({ session: id, root, at, request: text })", "workRuns.start({ session: sessions.active, root, at, request: text.trim() })", "workRuns.start({ session: id, root, at, request: prompt })"]) assert.ok(main.includes(start), start);
  assert.match(main, /if \(event === 'resume'\) \{\s*suspended = false;\s*nativePower\?\.refresh\(\);\s*carryOnAfterSleep\?\.\(\);\s*\}/);
  assert.match(main, /if \(ended === 'sleep'\)\s*sleptTurns\.set\(id, Date\.now\(\)\);/);
  assert.match(main, /if \(settings\.workCarryOn === 'off' \|\| !sleptTurns\.size\)\s*return;/);
  assert.match(main, /await beginSideTurn\(id, \{ text: 'Carry on from where that stopped\.', before, at, fromSessions: false \}\);/);
  const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(app, /<select name="workCarryOn">/);
});
