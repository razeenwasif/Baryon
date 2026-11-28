import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { GoalStore } from '../desktop/goals.mjs';
import { START_BELOW, dailyDue, dayOf, fullness, ownStart, stepsToday } from '../desktop/goal-runner.mjs';

const local = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute);
async function store(t: TestContext, clock: { now: Date }) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-goal-own-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return new GoalStore({ path: join(dir, 'goals.json'), now: () => clock.now.toISOString(), checkFolder: path => path });
}
const goal = (extra: Record<string, any> = {}): any => ({ id: 'G1', moves: 'own', state: 'active', folder: '/f', budget: { steps: 3 }, triggers: { afterStep: true, onEvent: true, daily: '' }, steps: [], ...extra });

test('a step starts on its own only for a goal set so, active, with a folder, nothing running, budget left and room on the plan', () => {
  const now = local(19, 23);
  assert.deepEqual(ownStart(goal(), { now }), { ok: true });
  for (const [extra, wait, why] of [[{ moves: 'ask' }, 'state', /asks first/], [{ state: 'paused' }, 'state', /isn’t active/], [{ folder: null }, 'state', /no folder/],
    [{ steps: [{ id: 'S1', state: 'doing' }] }, 'state', /A step is running/],
    [{ steps: [1, 2, 3].map(i => ({ id: `S${i}`, state: 'done', startedAt: local(19, i).toISOString() })) }, 'budget', /3 of 3 steps today; it goes on tomorrow/]] as [Record<string, any>, string, RegExp][]) {
    const verdict = ownStart(goal(extra), { now }) as { ok: boolean; wait?: string; why?: string };
    assert.deepEqual([verdict.ok, verdict.wait], [false, wait], JSON.stringify(extra));
    assert.match(verdict.why!, why);
  }
  const full = ownStart(goal(), { now, usage: { claude: { all: 0.6, models: { opus: 0.9 } } }, provider: 'claude' }) as { ok: boolean; wait?: string; why?: string };
  assert.deepEqual([full.wait, full.why], ['bars', 'Your plan is 90% used; it goes on once it’s under 85%.']);
  assert.equal(ownStart(goal(), { now, usage: { gemini: { all: 0.99 } }, provider: 'claude' }).ok, true, 'another provider’s bar doesn’t count');
  assert.deepEqual([fullness({ codex: 0.5 }, 'codex'), fullness({}, 'claude'), START_BELOW], [0.5, 0, 0.85]);
});

test('steps today are counted by the local day, and a daily time is due once a day from that time', () => {
  const steps = [local(18, 23, 59), local(19, 0, 1), local(19, 22)].map((at, i) => ({ id: `S${i}`, state: 'done', startedAt: at.toISOString() }));
  assert.equal(stepsToday({ steps }, local(19, 23)), 2);
  assert.equal(dayOf(local(19, 0, 1)), '2026-11-19');
  const daily = goal({ triggers: { afterStep: false, onEvent: false, daily: '09:00' } });
  assert.equal(dailyDue(daily, local(19, 8, 59)), false);
  assert.equal(dailyDue(daily, local(19, 9, 0)), true);
  assert.equal(dailyDue({ ...daily, lastDaily: '2026-11-19' }, local(19, 15)), false);
  assert.equal(dailyDue({ ...daily, lastDaily: '2026-11-19' }, local(20, 9, 5)), true);
  assert.equal(dailyDue({ ...daily, moves: 'ask' }, local(19, 9)), false);
});

test('you set how it moves: Ask first or On its own, steps a day, and what starts a step', async t => {
  const clock = { now: local(19, 10) }, goals = await store(t, clock);
  await goals.add({ outcome: 'A', folder: '/f' });
  let set = await goals.get('G1');
  assert.deepEqual([set.moves, set.budget, set.triggers], ['ask', { steps: 3 }, { afterStep: true, onEvent: true, daily: '' }], 'Ask first to start (decision 5)');
  set = await goals.set('G1', { moves: 'own', budget: { steps: 2 }, triggers: { afterStep: true, onEvent: false, daily: '07:30' } });
  assert.deepEqual([set.moves, set.budget, set.triggers], ['own', { steps: 2 }, { afterStep: true, onEvent: false, daily: '07:30' }]);
  assert.match(set.history.at(-1)!.what, /Set to move on its own; 2 steps a day; What starts a step changed/);
  for (const [patch, why] of [[{ budget: { steps: 0 } }, /between 1 and 10/], [{ budget: { steps: 11 } }, /between 1 and 10/], [{ triggers: { daily: '7:30pm' } }, /HH:MM/], [{ moves: 'sometimes' }, /Ask first or On its own/]] as [any, RegExp][])
    await assert.rejects(goals.set('G1', patch), why);
});

test('done when: on its own it takes two steps overnight inside its budget, stops at the budget with a reason, and goes on the next day', async t => {
  const clock = { now: local(19, 23) }, goals = await store(t, clock);
  await goals.add({ outcome: 'Classifier reaches 0.9', folder: '/f', steps: ['Sweep', 'Compare', 'Retrain'] });
  await goals.set('G1', { moves: 'own', budget: { steps: 2 } });
  // Two steps overnight, each after the one before ended well.
  for (const hour of [1, 2]) {
    clock.now = local(20, hour);
    assert.equal(ownStart(await goals.get('G1') as any, { now: clock.now }).ok, true, `${hour} am`);
    const { step } = await goals.begin('G1');
    await goals.settle('G1', step, { outcome: 'done', changed: 1 });
  }
  clock.now = local(20, 3);
  const verdict = ownStart(await goals.get('G1') as any, { now: clock.now }) as { ok: boolean; wait?: string; why?: string };
  assert.deepEqual([verdict.wait, verdict.why], ['budget', '2 of 2 steps today; it goes on tomorrow.']);
  let paused = await goals.budgetPause('G1', verdict.why!);
  assert.deepEqual([paused.state, paused.pausedBy, paused.reason], ['paused', 'budget', '2 of 2 steps today; it goes on tomorrow.']);
  assert.deepEqual(paused.steps.map(s => s.state), ['done', 'done', 'todo']);
  // The next day it is active again, with its third step ready.
  clock.now = local(21, 0, 1);
  assert.deepEqual(await goals.newDay(), ['G1']);
  paused = await goals.get('G1');
  assert.deepEqual([paused.state, paused.pausedBy, paused.history.at(-1)!.what], ['active', undefined, 'A new day: going on']);
  assert.equal(ownStart(paused as any, { now: clock.now }).ok, true);
  assert.deepEqual(await goals.newDay(), [], 'only goals the budget paused');
});

test('a start that waits for room on the plan is kept until a step begins; a daily start is marked for the day', async t => {
  const clock = { now: local(19, 10) }, goals = await store(t, clock);
  await goals.add({ outcome: 'A', folder: '/f', steps: ['One'] });
  assert.equal((await goals.ownPending('G1', true)).ownPending, true);
  assert.equal((await goals.begin('G1')).goal.ownPending, undefined, 'beginning clears it');
  assert.equal((await goals.markDaily('G1', '2026-11-19')).lastDaily, '2026-11-19');
  await goals.state('G1', 'pause');
  assert.equal((await goals.budgetPause('G1', 'x')).pausedBy, undefined, 'only an active goal is paused for budget');
});

test('main is wired: after a good step, when its wait is over, at its daily time, and when the plan has room', async () => {
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /if \(outcome === 'done' && goal\.state === 'active' && goal\.moves === 'own' && goal\.triggers\?\.afterStep\)\s*setTimeout\(\(\) => void ownTry\(goal\.id, 'after a good step'\)/);
  assert.match(main, /if \(goal\.moves === 'own' && goal\.triggers\?\.onEvent\) \{\s*await ownTry\(goal\.id, 'its wait is over'\);/);
  assert.match(main, /if \(goalRunner\.dailyDue\(goal, now\)\) \{\s*await goalStore\.markDaily\(goal\.id, today\);\s*await ownTry\(goal\.id, 'its daily time'\);\s*\}/);
  assert.match(main, /else if \(goal\.ownPending\)\s*await ownTry\(goal\.id, 'room on your plan'\);/);
  assert.match(main, /if \(verdict\.wait === 'budget'\) \{\s*await goalStore\.budgetPause\(goalId, verdict\.why\);\s*workNotice\(`\$\{goalId\} stopped for today`/);
});
