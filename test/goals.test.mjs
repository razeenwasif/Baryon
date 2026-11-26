import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GoalStore, MAX_OPEN, cardOf, cleanGoal, nextOf } from '../desktop/goals.mjs';
import { boardColumns, doneWhenWords, folderName } from '../src/goals-logic.js';

async function store(t, options = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-goals-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let tick = 0;
  const allowed = '/Users/me/code/parser';
  return { dir, goals: new GoalStore({ path: join(dir, 'goals.json'), now: () => new Date(Date.UTC(2026, 10, 19, 9, 0, tick++)).toISOString(),
    checkFolder: folder => { if (folder !== allowed && folder !== '/Users/me/code/site') throw new Error('Fairy can’t work in that folder.'); return folder; }, ...options }), allowed };
}

test('a goal is an outcome, a done-when and a folder or none, numbered G1, G2 and never reused', async t => {
  const { goals, allowed } = await store(t);
  const first = await goals.add({ outcome: '  The parser handles every file in fixtures/  ', doneWhen: { kind: 'command', command: 'npm test' }, folder: allowed, steps: ['Collect the failing files', '', 'Fix the tokenizer'] });
  assert.deepEqual([first.id, first.outcome, first.doneWhen, first.folder, first.state, first.moves], ['G1', 'The parser handles every file in fixtures/', { kind: 'command', command: 'npm test' }, allowed, 'active', 'ask']);
  assert.deepEqual(first.steps.map(s => [s.id, s.what, s.state]), [['S1', 'Collect the failing files', 'todo'], ['S2', 'Fix the tokenizer', 'todo']]);
  assert.deepEqual(first.history.map(h => h.what), ['Made']);
  const loose = await goals.add({ outcome: 'Read the three papers on grokking', doneWhen: { kind: 'say' } });
  assert.deepEqual([loose.id, loose.folder, loose.doneWhen.kind], ['G2', null, 'say'], 'no folder: kept and tracked only');
  await goals.state('G2', 'drop');
  assert.equal((await goals.add({ outcome: 'Another', doneWhen: { kind: 'metric', metric: 'accuracy', op: '>=', value: '0.9' }, folder: allowed })).id, 'G3', 'a dropped goal’s number isn’t reused');
  assert.deepEqual((await goals.get('G3')).doneWhen, { kind: 'metric', metric: 'accuracy', op: '>=', value: 0.9 });
  for (const [value, why] of [[{ outcome: ' ' }, /what should be true at the end/], [{ outcome: 'x', doneWhen: { kind: 'command', command: 'npm test' } }, /A command can only be checked in a folder/],
    [{ outcome: 'x', doneWhen: { kind: 'command', command: ' ' }, folder: allowed }, /Give the command/], [{ outcome: 'x', doneWhen: { kind: 'metric', metric: 'loss' }, folder: allowed }, /metric and the value/],
    [{ outcome: 'x', folder: '/etc' }, /can’t work in that folder/], [{ outcome: 'x', folder: 42 }, /Choose a folder, or none/]])
    await assert.rejects(goals.add(value), why, JSON.stringify(value));
  await assert.rejects(goals.get('G9'), /no such goal/);
});

test('at most five open at once; done and dropped don’t count, and reopening one must fit', async t => {
  const { goals } = await store(t);
  for (let i = 0; i < MAX_OPEN; i++) await goals.add({ outcome: `Goal ${i}` });
  await assert.rejects(goals.add({ outcome: 'One too many' }), /5 goals are open already/);
  await goals.state('G1', 'pause');
  await assert.rejects(goals.add({ outcome: 'Paused still counts' }), /5 goals are open already/);
  await goals.state('G2', 'done', 'Shipped on Friday');
  const sixth = await goals.add({ outcome: 'Now it fits' });
  assert.equal(sixth.id, 'G6');
  await assert.rejects(goals.state('G2', 'reopen'), /5 goals are open already/);
  const listed = await goals.list();
  assert.deepEqual([listed.open, listed.max, listed.goals.length], [5, 5, 6]);
  assert.equal((await goals.get('G2')).reason, 'Shipped on Friday');
});

test('you move a goal: pause, resume, done, drop and reopen, each from where it can, each in its history', async t => {
  const { goals } = await store(t);
  await goals.add({ outcome: 'A' });
  await assert.rejects(goals.state('G1', 'resume'), /active can’t resume/);
  for (const [move, state] of [['pause', 'paused'], ['resume', 'active'], ['done', 'done'], ['reopen', 'active'], ['drop', 'dropped']]) assert.equal((await goals.state('G1', move)).state, state, move);
  await assert.rejects(goals.state('G1', 'pause'), /dropped can’t pause/);
  await assert.rejects(goals.state('G1', 'finish'), /isn’t something a goal can do/);
  await assert.rejects(goals.state('../x', 'pause'), /no such goal/);
  assert.deepEqual((await goals.get('G1')).history.map(h => h.what), ['Made', 'Paused', 'Resumed', 'Marked done by you', 'Reopened', 'Dropped']);
});

test('steps you write: add, tick, untick, skip, reword, note and remove; the next is the first not done', async t => {
  const { goals } = await store(t);
  await goals.add({ outcome: 'A', steps: ['One', 'Two'] });
  await goals.step('G1', { op: 'add', what: 'Three' });
  await goals.step('G1', { op: 'tick', step: 'S1' });
  assert.equal(nextOf(await goals.get('G1')).what, 'Two');
  await goals.step('G1', { op: 'skip', step: 'S2' });
  await goals.step('G1', { op: 'reword', step: 'S3', what: 'Three, properly' });
  await goals.step('G1', { op: 'note', step: 'S3', note: 'Needs the fixtures first' });
  let goal = await goals.get('G1');
  assert.deepEqual(goal.steps.map(s => [s.id, s.what, s.state]), [['S1', 'One', 'done'], ['S2', 'Two', 'skipped'], ['S3', 'Three, properly', 'todo']]);
  assert.equal(goal.steps[2].note, 'Needs the fixtures first');
  assert.ok(goal.steps[0].doneAt);
  await goals.step('G1', { op: 'untick', step: 'S1' });
  await goals.step('G1', { op: 'remove', step: 'S2' });
  await goals.step('G1', { op: 'add', what: 'Four' });
  goal = await goals.get('G1');
  assert.deepEqual(goal.steps.map(s => s.id), ['S1', 'S3', 'S4'], 'a removed step’s number isn’t reused');
  assert.deepEqual(cardOf(goal), { id: 'G1', outcome: 'A', state: 'active', next: 'One', done: 0, steps: 3, running: false, folder: null, doneWhen: { kind: 'say' }, moves: 'ask', updated: goal.updated });
  for (const [op, why] of [[{ op: 'add', what: ' ' }, /Say what the step is/], [{ op: 'tick', step: 'S9' }, /no such step/], [{ op: 'fly', step: 'S1' }, /isn’t something a step can do/]])
    await assert.rejects(goals.step('G1', op), why);
});

test('only you change the outcome, done-when, folder and notes, and a command needs a folder', async t => {
  const { goals, allowed } = await store(t);
  await goals.add({ outcome: 'A' });
  await assert.rejects(goals.set('G1', { doneWhen: { kind: 'command', command: 'npm test' } }), /A command can only be checked in a folder/);
  const changed = await goals.set('G1', { outcome: 'B', doneWhen: { kind: 'command', command: 'npm test' }, folder: allowed, notes: 'The tokenizer is the slow part.' });
  assert.deepEqual([changed.outcome, changed.doneWhen.command, changed.folder, changed.notes], ['B', 'npm test', allowed, 'The tokenizer is the slow part.']);
  assert.equal(changed.history.at(-1).what, 'Outcome changed; Done-when changed; Folder changed');
  await goals.set('G1', { notes: 'More' });
  assert.equal((await goals.get('G1')).history.length, 2, 'notes alone aren’t history');
  await assert.rejects(goals.set('G1', { outcome: '' }), /needs its outcome/);
  await assert.rejects(goals.set('G1', { moves: 'always' }), /Ask first or On its own/);
  await assert.rejects(goals.set('G1', { folder: '/etc' }), /can’t work in that folder/);
});

test('chats and runs linked to a goal, and only real-looking ones', async t => {
  const { goals, allowed } = await store(t);
  await goals.add({ outcome: 'A', folder: allowed });
  await goals.link('G1', { session: 'chat-1' }); await goals.link('G1', { session: 'chat-1' });
  await goals.link('G1', { run: 'R12', folder: allowed });
  let goal = await goals.get('G1');
  assert.deepEqual([goal.links.sessions, goal.links.runs], [['chat-1'], [{ id: 'R12', folder: allowed }]]);
  await goals.link('G1', { session: 'chat-1', remove: true }); await goals.link('G1', { run: 'R12', folder: allowed, remove: true });
  goal = await goals.get('G1');
  assert.deepEqual([goal.links.sessions, goal.links.runs], [[], []]);
  for (const [link, why] of [[{ session: '../x' }, /isn’t a chat/], [{ run: 'R1; rm', folder: allowed }, /isn’t a run/], [{ run: 'R1' }, /isn’t a run/], [{}, /Link a chat or a run/]])
    await assert.rejects(goals.link('G1', link), why);
});

test('kept whole in goals.json; one change at a time; an unreadable file kept aside, and junk cleaned', async t => {
  const { goals, dir } = await store(t);
  await Promise.all([goals.add({ outcome: 'A' }), goals.add({ outcome: 'B' }), goals.add({ outcome: 'C' })]);
  const saved = JSON.parse(await readFile(join(dir, 'goals.json'), 'utf8'));
  assert.deepEqual([saved.next, saved.goals.map(g => g.id)], [4, ['G1', 'G2', 'G3']]);
  await writeFile(join(dir, 'goals.json'), '{ nope');
  const listed = await goals.list();
  assert.match(listed.problem, /kept as goals\.unreadable\.json/);
  assert.equal(await readFile(join(dir, 'goals.unreadable.json'), 'utf8'), '{ nope');
  assert.equal(cleanGoal({ id: 'X1', outcome: 'a' }), null);
  const odd = cleanGoal({ id: 'G7', outcome: 'a', state: 'flying', moves: 'yolo', doneWhen: { kind: 'command' }, steps: [{ id: 'S1', what: 'ok', state: 'weird' }, { id: 'bad', what: 'x' }], links: { sessions: ['ok-1', '../x'], runs: [{ id: 'R1', folder: '/a' }, { id: 'R1;', folder: '/a' }] } });
  assert.deepEqual([odd.state, odd.moves, odd.doneWhen, odd.steps.map(s => [s.id, s.state]), odd.links.sessions, odd.links.runs.length], ['active', 'ask', { kind: 'say' }, [['S1', 'todo']], ['ok-1'], 1]);
});

test('the board: three columns, newest first; words for a done-when; and the window and main are wired', async () => {
  const columns = boardColumns([{ id: 'G1', state: 'active', updated: '1' }, { id: 'G2', state: 'paused', updated: '2' }, { id: 'G3', state: 'active', updated: '3' }, { id: 'G4', state: 'dropped', updated: '4' }, { id: 'G5', state: 'waiting-you', updated: '0' }]);
  assert.deepEqual(columns.map(c => [c.title, c.goals.map(g => g.id)]), [['Active', ['G3', 'G1']], ['Waiting or paused', ['G2', 'G5']], ['Done', ['G4']]]);
  assert.equal(doneWhenWords({ kind: 'command', command: 'npm test' }), 'npm test passes');
  assert.equal(doneWhenWords({ kind: 'metric', metric: 'loss', op: '<=', value: 0.2 }), 'a run’s loss is at most 0.2');
  assert.equal(doneWhenWords({ kind: 'say' }), 'you say so');
  assert.equal(folderName('/Users/me/code/parser/'), 'parser');
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(main, /new \(await import\('\.\/goals\.mjs'\)\)\.GoalStore\(\{ path: file\('goals\.json'\), checkFolder: folder => goalFolder\(folder, \{ dataDir \}\) \}\)/);
  assert.match(app, /<button id="sidebar-goals" class="side-item"/);
  assert.match(app, /<section id="goals-view" aria-label="Goals" hidden><\/section>/);
  assert.match(app, /const hideRuns = \(\) => \{ void runsBoard\?\.then\(view => view\?\.hide\(\)\); hideGoals\(\); \};/);
});
