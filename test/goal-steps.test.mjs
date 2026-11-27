import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GoalStore, IDLE_LIMIT, runningOf } from '../desktop/goals.mjs';
import { checkGoal, goalBrief } from '../desktop/goal-check.mjs';
import { WorkTools, riskOf } from '../desktop/work-tools.mjs';

const darwin = process.platform === 'darwin';
async function store(t, folder = '/Users/me/code/parser') {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-goal-steps-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let tick = 0;
  return new GoalStore({ path: join(dir, 'goals.json'), now: () => new Date(Date.UTC(2026, 10, 19, 10, 0, tick++)).toISOString(), checkFolder: path => path === folder || path.startsWith(tmpdir()) || path.startsWith('/private') ? path : (() => { throw new Error('no'); })() });
}

test('a step begins only on an active goal with a folder and nothing running; with no step written, it works one out', async t => {
  const goals = await store(t);
  await goals.add({ outcome: 'Tracked only' });
  await assert.rejects(goals.begin('G1'), /no folder, so it’s tracked only/);
  await goals.add({ outcome: 'Parser', folder: '/Users/me/code/parser' });
  const { goal, step } = await goals.begin('G2');
  assert.deepEqual([step, goal.steps.map(s => [s.id, s.state, s.what])], ['S1', [['S1', 'doing', 'Work out the next step towards the goal, and take it']]]);
  assert.ok(goal.steps[0].startedAt);
  await assert.rejects(goals.begin('G2'), /already running/);
  await assert.rejects(goals.step('G2', { op: 'remove', step: 'S1' }), /running in its chat/);
  await goals.state('G2', 'pause');
  await assert.rejects(goals.begin('G2'), /isn’t active/);
  await goals.useSession('G2', 'chat-9');
  assert.deepEqual([(await goals.get('G2')).session, (await goals.get('G2')).links.sessions], ['chat-9', ['chat-9']]);
});

test('goal_update reports for the running step only: what it did, what it learned, the next step, a question', async t => {
  const goals = await store(t);
  await goals.add({ outcome: 'Parser', folder: '/Users/me/code/parser', steps: ['Collect the crashing files', 'Fix the tokenizer'] });
  await goals.begin('G1');
  await assert.rejects(goals.report('G1', 'S2', { did: 'x' }), /That step isn’t running/);
  await assert.rejects(goals.report('G1', 'S1', { did: ' ' }), /Say what this step did/);
  await goals.report('G1', 'S1', { did: 'Found 4 files; all have nested quotes.', learned: 'Nested quotes are the cause.', next: 'Fix the tokenizer' });
  let goal = await goals.get('G1');
  assert.deepEqual(goal.steps.map(s => s.what), ['Collect the crashing files', 'Fix the tokenizer'], 'the same next step isn’t added twice');
  assert.equal(goal.steps[0].note, 'Found 4 files; all have nested quotes.');
  assert.equal(goal.notes, 'Nested quotes are the cause.');
  await goals.report('G1', 'S1', { did: 'Again', next: 'Add the files as fixtures first', needsYou: 'Can I commit the fixtures?' });
  goal = await goals.get('G1');
  assert.deepEqual(goal.steps.map(s => s.what), ['Collect the crashing files', 'Add the files as fixtures first', 'Fix the tokenizer']);
  assert.equal(goal.ask, 'Can I commit the fixtures?');
  const settled = await goals.settle('G1', 'S1', { outcome: 'done', changed: 2 });
  assert.deepEqual([settled.state, settled.reason], ['waiting-you', 'A step asks: Can I commit the fixtures?']);
  await goals.state('G1', 'resume');
  assert.equal((await goals.get('G1')).ask, undefined, 'resuming clears the question');
});

test('settling: an error waits for you, a stop goes back, two steps that change nothing wait, and a passing check is done', async t => {
  const goals = await store(t);
  await goals.add({ outcome: 'Parser', folder: '/Users/me/code/parser', steps: ['A', 'B', 'C', 'D'] });
  await goals.begin('G1');
  let goal = await goals.settle('G1', 'S1', { outcome: 'failed', error: 'Claude is signed out.' });
  assert.deepEqual([goal.state, goal.reason, goal.steps[0].state], ['waiting-you', 'Ended with an error: Claude is signed out.', 'todo']);
  await goals.state('G1', 'resume');
  await goals.begin('G1');
  goal = await goals.settle('G1', 'S1', { outcome: 'stopped' });
  assert.deepEqual([goal.state, goal.steps[0].state, goal.steps[0].note], ['active', 'todo', 'Stopped before it finished.']);
  for (let i = 0; i < IDLE_LIMIT; i++) { const { step } = await goals.begin('G1'); goal = await goals.settle('G1', step, { outcome: 'done', changed: 0, check: { at: 'now', kind: 'command', passed: false, detail: 'npm test exited 1' } }); }
  assert.deepEqual([goal.state, goal.idle], ['waiting-you', 0]);
  assert.match(goal.reason, /2 steps in a row changed nothing/);
  assert.equal(goal.lastCheck.detail, 'npm test exited 1');
  await goals.state('G1', 'resume');
  const { step } = await goals.begin('G1');
  goal = await goals.settle('G1', step, { outcome: 'done', changed: 3, check: { at: 'now', kind: 'command', passed: true, detail: 'npm test exited 0.' } });
  assert.deepEqual([goal.state, goal.reason], ['done', 'Its check passed.']);
  assert.match(goal.history.at(-1).what, /Its check passed/);
});

test('after a restart, a step left running whose chat isn’t working goes back to be done again', async t => {
  const goals = await store(t);
  await goals.add({ outcome: 'A', folder: '/Users/me/code/parser', steps: ['One'] }); await goals.add({ outcome: 'B', folder: '/Users/me/code/parser', steps: ['Two'] });
  await goals.begin('G1'); await goals.useSession('G1', 'busy'); await goals.begin('G2'); await goals.useSession('G2', 'gone');
  assert.equal(await goals.recover(chat => chat === 'busy'), 1);
  assert.equal(runningOf(await goals.get('G1')).id, 'S1');
  assert.deepEqual([runningOf(await goals.get('G2')), (await goals.get('G2')).steps[0].note], [null, 'Interrupted when Fairy quit; it’s ready to run again.']);
});

test('the check: a command in the folder, the newest run’s metric, or never for “you say so”', async () => {
  const goal = { folder: '/f', doneWhen: { kind: 'command', command: 'npm test' } }, ran = [];
  const run = async options => { ran.push(options); return { exitCode: 1, output: 'one\ntwo\nnot ok 1 - adds' }; };
  const failed = await checkGoal(goal, { run, now: () => 'now' });
  assert.deepEqual([failed.passed, failed.detail, ran[0].command, ran[0].cwd], [false, 'npm test exited 1: one\ntwo\nnot ok 1 - adds', 'npm test', '/f']);
  assert.equal((await checkGoal(goal, { run: async () => ({ exitCode: 0, output: '' }) })).passed, true);
  assert.match((await checkGoal(goal, { run: async () => ({ exitCode: null, timedOut: true }) })).detail, /didn’t finish in 3 minutes/);
  const runs = { list: async () => [{ id: 'R9', state: 'running', metrics: { accuracy: { value: 0.99 } } }, { id: 'R8', state: 'done', metrics: { accuracy: { value: 0.87 } } }, { id: 'R7', state: 'done', metrics: { accuracy: { value: 0.95 } } }] };
  const metric = await checkGoal({ folder: '/f', doneWhen: { kind: 'metric', metric: 'accuracy', op: '>=', value: 0.9 } }, { runs });
  assert.deepEqual([metric.passed, metric.run, metric.detail], [false, 'R8', 'R8: accuracy 0.87 (at least 0.9 wanted).'], 'the newest finished run counts, not a running one or an older better one');
  assert.equal((await checkGoal({ folder: '/f', doneWhen: { kind: 'metric', metric: 'loss', op: '<=', value: 0.2 } }, { runs })).detail, 'No finished run in the folder has loss yet.');
  assert.deepEqual(await checkGoal({ doneWhen: { kind: 'say' } }, { now: () => 'now' }), { at: 'now', kind: 'say', passed: false, detail: 'Done when you say so.' });
});

test('the brief a step is given: the goal, its check, what was learned, the last steps and this one, between marks', () => {
  const goal = { id: 'G3', outcome: 'The parser handles every file', doneWhen: { kind: 'command', command: 'npm test' }, notes: 'Nested quotes are the cause.', lastCheck: { passed: false, detail: 'npm test exited 1' },
    steps: [{ id: 'S1', what: 'One', state: 'done' }, { id: 'S2', what: 'Two', state: 'done' }, { id: 'S3', what: 'Three', state: 'skipped' }, { id: 'S4', what: 'Four', state: 'done', note: 'Did four.' }, { id: 'S5', what: 'Five', state: 'doing' }] };
  const brief = goalBrief(goal, goal.steps[4]);
  assert.ok(brief.startsWith('<<<GOAL\n') && brief.endsWith('\nGOAL>>>'));
  for (const piece of ['goal G3', 'Goal: The parser handles every file', 'the command `npm test` passes', 'don’t claim the goal is done', 'Nested quotes are the cause.', 'Earlier steps: One', 'Step S4 (done): Four\n  Did four.', 'The last check: not yet. npm test exited 1', 'This step (S5): Five', 'call goal_update once'])
    assert.ok(brief.includes(piece), piece);
});

test('goal_update is offered directly on a goal’s step, for that step alone, and nowhere else', async () => {
  const reported = [];
  const goal = { id: 'G1', step: 'S2', update: async report => { reported.push(report); } };
  const tools = new WorkTools({ root: tmpdir(), permission: 'auto', sandboxed: true, runCommand: async () => ({}), goal });
  assert.ok(tools.offered().some(entry => entry.name === 'goal_update'), 'a core tool on a goal’s step, not behind more_tools');
  const result = await tools.handle({ tool: 'goal_update', arguments: { did: 'Fixed nested quotes in tokenize.js', next: 'Add fixtures', needs_you: '' } });
  assert.equal(result.success, true);
  assert.deepEqual(reported, [{ did: 'Fixed nested quotes in tokenize.js', learned: '', next: 'Add fixtures', needsYou: '', waitJob: '' }]);
  assert.equal(riskOf('goal_update'), 'read');
  const plain = new WorkTools({ root: tmpdir(), permission: 'auto', sandboxed: true, runCommand: async () => ({}) });
  assert.ok(!plain.offered().some(entry => entry.name === 'goal_update'));
  assert.equal((await plain.handle({ tool: 'goal_update', arguments: { did: 'x' } })).success, false);
  const refusing = new WorkTools({ root: tmpdir(), permission: 'auto', sandboxed: true, runCommand: async () => ({}), goal: { ...goal, update: async () => { throw new Error('That step isn’t running.'); } } });
  const refused = await refusing.handle({ tool: 'goal_update', arguments: { did: 'x' } });
  assert.equal(refused.success, false);
});

test('done when: a goal with a failing test steps on, sets its next step, and is Done once the command passes (real sandbox)', { skip: !darwin && 'needs the macOS sandbox' }, async t => {
  const { runInSandbox } = await import('../desktop/work-sandbox.mjs');
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'fairy-goal-folder-')));
  t.after(() => rm(folder, { recursive: true, force: true }));
  await mkdir(join(folder, 'test'));
  await writeFile(join(folder, 'package.json'), '{ "type": "module" }\n');
  await writeFile(join(folder, 'add.js'), 'export const add = (a, b) => a - b;\n');
  await writeFile(join(folder, 'test', 'add.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../add.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n");
  const goals = await store(t, folder), run = options => runInSandbox(options), check = async () => checkGoal(await goals.get('G1'), { run });
  await goals.add({ outcome: 'add() adds', doneWhen: { kind: 'command', command: 'node --test' }, folder, steps: ['Find why the test fails'] });
  // Step 1: looks, changes nothing yet, says what's next. The check still fails.
  let { step } = await goals.begin('G1');
  await goals.report('G1', step, { did: 'add() subtracts.', next: 'Make add() add' });
  let goal = await goals.settle('G1', step, { outcome: 'done', changed: 0, check: await check() });
  assert.deepEqual([goal.state, goal.lastCheck.passed, goal.steps.map(s => [s.what, s.state])], ['active', false, [['Find why the test fails', 'done'], ['Make add() add', 'todo']]]);
  assert.match(goal.lastCheck.detail, /node --test exited 1/);
  // Step 2: the fix. The check passes and the goal is done.
  ({ step } = await goals.begin('G1'));
  assert.equal(step, 'S2');
  await writeFile(join(folder, 'add.js'), 'export const add = (a, b) => a + b;\n');
  await goals.report('G1', step, { did: 'add() now adds.' });
  goal = await goals.settle('G1', step, { outcome: 'done', changed: 1, check: await check() });
  assert.deepEqual([goal.state, goal.reason, goal.lastCheck.passed], ['done', 'Its check passed.', true]);
  assert.equal(await readFile(join(folder, 'add.js'), 'utf8'), 'export const add = (a, b) => a + b;\n', 'the check ran in the folder and left it as it was');
});

test('main is wired: a step’s turn carries its goal, ends recorded on its run, and is settled and checked', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /goal: run\.goal \|\| null,/);
  assert.match(main, /run\.outcome = finished \? 'done' : signal\.aborted \? 'stopped' : 'failed'; run\.failure = failure\?\.message \|\| ''; run\.changed = tools\?\.changed\?\.size \|\| 0;/);
  assert.match(main, /onRun: run => \{\s*started = run;\s*run\.goal = \{\s*id: goal\.id, step,\s*update: report => goalStore\.report\(goal\.id, step, report\)/);
  assert.match(main, /let goal = await goalStore\.settle\(goalId, step, \{ outcome, changed: run\.changed \|\| 0, error: run\.failure \|\| '', check \}\);/);
  assert.match(main, /void goalStore\.recover\(chat => Boolean\(chat\) && workRuns\.has\(chat\)\)/);
});
