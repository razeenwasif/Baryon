import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GoalStore } from '../desktop/goals.mjs';
import { cleanWatcher, watcherEngine } from '../desktop/watchers.mjs';
import { AutomationStore } from '../desktop/automation.mjs';
import { weekSource } from '../desktop/phone-week.mjs';

async function store(t, clock = { now: Date.UTC(2026, 10, 19, 10) }) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-goal-waits-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new GoalStore({ path: join(dir, 'goals.json'), now: () => new Date(clock.now).toISOString(), checkFolder: path => path });
}

test('an active goal waits on a watcher or a time, and wakes back to active with why', async t => {
  const clock = { now: Date.UTC(2026, 10, 19, 10) }, goals = await store(t, clock);
  await goals.add({ outcome: 'Classifier reaches 0.9', folder: '/Users/me/code/classifier', steps: ['Sweep the learning rate'] });
  await assert.rejects(goals.wait('G1', { kind: 'carrier-pigeon' }), /Wait on a watcher or a date and time/);
  await assert.rejects(goals.wait('G1', { kind: 'date', at: '2026-11-18T10:00:00Z' }), /a time still to come/);
  let goal = await goals.wait('G1', { kind: 'watcher', watcher: 'w-7', title: 'Nexus job sweep-41' });
  assert.deepEqual([goal.state, goal.reason, goal.waitsOn], ['waiting', 'Waiting on Nexus job sweep-41', { kind: 'watcher', watcher: 'w-7', title: 'Nexus job sweep-41' }]);
  assert.deepEqual(await goals.waitingOn('w-7'), ['G1']);
  assert.deepEqual(await goals.waitingOn('w-8'), []);
  goal = await goals.wake('G1', 'The job sweep-41 ended.');
  assert.deepEqual([goal.state, goal.waitsOn, goal.history.at(-1).what], ['active', undefined, 'The wait is over: The job sweep-41 ended.']);
  await assert.rejects(goals.wake('G1'), /isn’t waiting/);
  await goals.wait('G1', { kind: 'date', at: '2026-11-19T12:00:00Z' });
  assert.deepEqual(await goals.dueWaits(), []);
  clock.now = Date.UTC(2026, 10, 19, 12, 1);
  assert.deepEqual(await goals.dueWaits(), ['G1']);
  goal = await goals.state('G1', 'resume');
  assert.deepEqual([goal.state, goal.waitsOn], ['active', undefined], 'Stop waiting is a resume');
  await goals.begin('G1');
  await assert.rejects(goals.wait('G1', { kind: 'date', at: '2026-11-20T09:00:00Z' }), /A step is running/);
});

test('a step can say to wait for a Nexus job it sent; the goal keeps it until main makes the watcher', async t => {
  const goals = await store(t);
  await goals.add({ outcome: 'Classifier reaches 0.9', folder: '/Users/me/code/classifier', steps: ['Sweep'] });
  await goals.begin('G1');
  await assert.rejects(goals.report('G1', 'S1', { did: 'Sent it', waitJob: 'job; rm -rf' }), /isn’t a Nexus job id/);
  await goals.report('G1', 'S1', { did: 'Sent the sweep to forge.', next: 'Compare the sweep’s runs', waitJob: 'sweep-41' });
  const settled = await goals.settle('G1', 'S1', { outcome: 'done', changed: 1 });
  assert.deepEqual([settled.state, settled.waitJob], ['active', 'sweep-41']);
  const waiting = await goals.wait('G1', { kind: 'watcher', watcher: 'w-1', title: 'Nexus job sweep-41' });
  assert.equal(waiting.waitJob, undefined, 'taken once it waits');
});

test('a watcher may name a goal; when it fires it wakes the goals waiting on it, or does its own action if none waits', async () => {
  assert.equal(cleanWatcher({ id: 'w1', event: 'nexus-job', job: 'sweep-41', goal: 'G3' }).goal, 'G3');
  assert.equal(cleanWatcher({ id: 'w1', event: 'nexus-job', job: 'sweep-41', goal: '../x' }).goal, undefined);
  const told = [], woke = [];
  let waiting = ['G3'];
  const watchers = [cleanWatcher({ id: 'w1', event: 'nexus-job', job: 'sweep-41', goal: 'G3', state: { started: true } }), cleanWatcher({ id: 'w2', event: 'nexus-job', job: 'sweep-42', goal: 'G4', state: { started: true } })];
  const store = { watchers, saveWatchers: async () => {}, state: () => ({}) };
  const found = { key: 'ended', title: 'A Nexus job ended', body: 'Job sweep-41 ended (exit 0).' };
  const engine = watcherEngine({ store, look: { 'nexus-job': async () => [found] }, tell: notice => told.push(notice), wake: async ({ watcher, found: seen }) => { woke.push([watcher.goal, seen.body]); return waiting.length; } });
  await engine.lookNow('w1');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual([woke, told], [[['G3', 'Job sweep-41 ended (exit 0).']], []]);
  waiting = [];
  // A job's watcher is done once its job ends, so a second watcher, for a goal that no longer waits.
  await engine.lookNow('w2');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(told.at(-1)?.body, 'Job sweep-41 ended (exit 0).', 'no goal waits any more: the watcher tells you itself');
});

test('a watcher you have is tied to a goal, and untied', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-tie-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let saved = null;
  const automation = new AutomationStore({ read: async () => saved, write: async value => { saved = structuredClone(value); }, id: () => 'w-1' });
  await automation.load();
  await automation.addWatcher({ event: 'paper', query: 'grokking' });
  assert.equal((await automation.tieWatcher('w-1', 'G2')).goal, 'G2');
  assert.equal(saved.watchers[0].goal, 'G2');
  await assert.rejects(automation.tieWatcher('w-1', 'nope'), /isn’t a goal/);
  await assert.rejects(automation.tieWatcher('w-9', 'G2'), /That watcher is gone/);
  assert.equal((await automation.tieWatcher('w-1', '')).goal, undefined);
});

test('the phone’s week carries the open goals, read fresh each time, at most five', async () => {
  const off = { status: () => ({ connected: false }) };
  let list = [{ id: 'G1', outcome: 'A', state: 'active', next: 'One', running: false, done: 0, steps: 1 }];
  const week = weekSource({ calendar: off, gmail: off, goals: async () => list });
  assert.deepEqual((await week()).goals.map(goal => goal.id), ['G1']);
  list = Array.from({ length: 7 }, (_, i) => ({ id: `G${i + 1}`, outcome: 'x', state: 'active', next: '', running: false, done: 0, steps: 0 }));
  assert.equal((await week()).goals.length, 5, 'cached calendar, fresh goals');
  const failing = weekSource({ calendar: off, gmail: off, goals: async () => { throw new Error('no store'); } });
  assert.deepEqual((await failing()).goals, []);
});

test('main is wired: Ask first on waking, a job a step named becomes a wait, and the time is looked at each minute', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), swift = await readFile(new URL('../ios/Fairy/WeekView.swift', import.meta.url), 'utf8');
  assert.match(main, /const decision = await approvals\.ask\(\{ kind: 'goal-step', source: 'goal', risk: 'write', tool: 'work', title: `Start \$\{goal\.id\}’s next step\?/);
  assert.match(main, /allowLabel: 'Start step', denyLabel: 'Not now'/);
  assert.match(main, /if \(decision !== 'allow'\) \{ workNotice\(/);
  assert.match(main, /if \(goal\.waitJob && goal\.state === 'active'\) goal = await waitGoalOn\(goal\.id, \{ kind: 'job', job: goal\.waitJob \}\)/);
  assert.match(main, /for \(const id of await goalStore\.dueWaits\(\)\) await wakeGoal\(id, 'Its time came\.'\);/);
  assert.match(main, /wake: async \(\{ watcher, found \}\) => \{ const ids = await goalStore\.waitingOn\(watcher\.id\);/);
  assert.match(swift, /Text\("Fairy is working on"\)/);
  assert.match(swift, /var goals: \[Goal\]\?/);
});
