// Swarm stage 6: measure. Pass rate, minutes and designer calls for each way, side by side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HARD_TASKS, project } from '../evals/work-tasks.mjs';
import { runTask, evalSettings } from '../evals/runner.mjs';
import { runSwarmTask, unattendedPick } from '../evals/swarm-run.mjs';
import { measure, reportText } from '../scripts/swarm-report.mjs';
import { runInSandbox } from '../desktop/work-sandbox.mjs';

const task = id => HARD_TASKS.find(item => item.id === id);
const answerFiles = name => Object.entries(project(`${name}.answer`));
// A designer that reads the files, writes the answer, runs the tests and replies; then, asked again, checks the review.
function designer(name) {
  let turns = 0;
  return { turn: async ({ toolHandler }) => {
    if (turns++) return 'Checked the second opinion: nothing real to fix.';
    for (const [path, content] of answerFiles(name)) { await toolHandler({ tool: 'read_file', arguments: { path } }); await toolHandler({ tool: 'write_file', arguments: { path, content } }); }
    await toolHandler({ tool: 'run_command', arguments: { command: 'node --test' } });
    return 'Fixed it, and the tests pass.';
  } };
}

test('three hard tasks, each held to its README by hidden tests, and not to be passed by editing the tests', () => {
  assert.deepEqual(HARD_TASKS.map(item => item.id), ['hard-statement-drift', 'hard-loader-dedupe', 'hard-reminder-dst']);
  for (const item of HARD_TASKS) {
    const world = item.world();
    assert.ok(item.hard && item.kind === 'work' && item.verify === 'node --test', item.id);
    assert.ok(Object.keys(world.hidden).some(path => path.endsWith('.hidden.test.js')), `${item.id} has hidden tests`);
    assert.ok(world.files['README.md'], `${item.id} states its rules`);
    const kept = item.checks.find(check => check.label === 'keeps the tests it was given');
    const visible = Object.keys(world.files).find(path => path.startsWith('test/'));
    assert.equal(kept({ created: { localFiles: [visible], removedFiles: [] } }).ok, false, `${item.id}: editing the tests fails`);
    assert.equal(kept({ created: { localFiles: ['src/x.js', 'test/extra.test.js'], removedFiles: [] } }).ok, true, 'adding tests of its own is fine');
  }
});

test('with a Second opinion: the designer works, a model of another family reviews it, and the designer acts on it', async () => {
  const reviewed = [];
  const reviewer = { turn: async options => { reviewed.push(options.input[0].text); return 'Not blocking: the rounding helper could use a comment.'; } };
  const run = await runTask(task('hard-statement-drift'), { provider: designer('statement'), settings: evalSettings('claude', { model: 'claude-opus-5-5', effort: 'high' }),
    helpers: { provider: designer('statement'), seat: () => ({ settings: evalSettings('claude'), label: null }), review: { provider: reviewer, settings: evalSettings('gemini', { model: 'gemini-4-argon-high', effort: 'high' }) } } });
  assert.equal(run.ok, true, JSON.stringify(run.checks));
  assert.equal(run.way, 'review');
  assert.equal(run.designerCalls, 3, 'two turns of the designer and one review');
  assert.equal(run.review.turns, 1);
  assert.match(reviewed[0], /src\/money\.js/, 'the review reads the turn’s changes');
  assert.match(run.reply, /Checked the second opinion/);
  const alone = await runTask(task('hard-statement-drift'), { provider: designer('statement'), settings: evalSettings('claude') });
  assert.deepEqual([alone.way, alone.designerCalls, alone.ok], ['designer', 1, true]);
});

test('as a swarm: the runner hands the task to the swarm and keeps its count', async () => {
  const run = await runTask(task('hard-loader-dedupe'), { provider: designer('profiles'), settings: evalSettings('claude'),
    helpers: { seat: () => ({ settings: evalSettings('claude'), label: null }), swarm: async ({ task: given, root }) => {
      assert.equal(given.id, 'hard-loader-dedupe');
      const { writeFile } = await import('node:fs/promises');
      for (const [path, content] of answerFiles('profiles')) await writeFile(join(root, path), content);
      return { reply: 'Swarm build: done', outcome: 'done', settled: true, rounds: 1, designerCalls: 7, builderCalls: 1, designs: 2 };
    } } });
  assert.deepEqual([run.ok, run.way, run.designerCalls, run.swarm], [true, 'swarm', 7, { outcome: 'done', settled: true, rounds: 1, builderCalls: 1, designs: 2 }]);
});

test('a swarm with nobody watching designs, convenes, briefs, builds and checks a hard task', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'fairy-measure-'))), root = join(base, 'statement'), place = join(base, 'copies');
  t.after(() => rm(base, { recursive: true, force: true }));
  const { mkdir, writeFile, readFile } = await import('node:fs/promises');
  for (const [path, text] of Object.entries(project('statement'))) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), text); }
  const design = '## Finding\nRows round, the total doesn’t, and toFixed rounds 1.005 down.\n## Evidence\nsrc/statement.js:6\n## Plan\n1. src/money.js, src/statement.js: whole cents.\n## Check\nnode --test\n## Risk\nNone.\n## Confidence\nhigh: the test.';
  const brief = '# Keep the statement in whole cents\n## Steps\n1. Add toCents and format cents. Files: src/money.js\n2. Sum rounded rows. Files: src/statement.js\n## Files\n- src/money.js\n- src/statement.js\n## Constraints\n- Don’t change the tests.\n## Check\n`node --test`\n## Disagreement\nNone: both agreed.';
  const roles = [];
  const designerModel = { turn: async ({ instructions }) => {
    const role = /Write your design in exactly these six sections/.test(instructions) ? 'design' : /labelled by letter only/.test(instructions) ? 'convene' : /write the brief a builder will follow/.test(instructions) ? 'brief' : /answer "Approve\."/.test(instructions) ? 'sign-off' : /reviewing work another AI model just did/.test(instructions) ? 'check' : 'other';
    roles.push(role);
    return { design, convene: '## On design B\nStrongest point: same.\nNo objections.\n## My design\nUnchanged.\n## Vote\nA', brief, 'sign-off': 'Approve.', check: 'Not blocking: fine.' }[role] || '';
  } };
  const builder = { turn: async ({ toolHandler }) => {
    for (const [path, content] of answerFiles('statement')) { await toolHandler({ tool: 'read_file', arguments: { path } }); await toolHandler({ tool: 'write_file', arguments: { path, content } }); }
    return 'Built it.';
  } };
  const seats = [{ provider: 'claude', name: 'Claude', model: 'claude-opus-5-5', effort: 'high' }, { provider: 'gemini', name: 'Gemini', model: 'gemini-4-argon-high', effort: 'high' }];
  const done = await runSwarmTask({ prompt: task('hard-statement-drift').ask, root, seats, place, run: runInSandbox, connect: () => ({ provider: designerModel, settings: {} }),
    builder: { provider: builder, settings: {}, model: 'claude-sonnet-5-5' } });
  assert.deepEqual([done.outcome, done.settled, done.rounds, done.designs], ['done', true, 1, 2]);
  assert.deepEqual(roles.sort(), ['brief', 'check', 'convene', 'convene', 'design', 'design', 'sign-off'], 'Gemini checks the Claude builder’s work; Claude doesn’t mark its own');
  assert.deepEqual([done.designerCalls, done.builderCalls], [7, 1]);
  assert.match(done.reply, /^\*\*Swarm build: done\*\*/);
  assert.match(await readFile(join(root, 'src', 'money.js'), 'utf8'), /toCents/);
  assert.deepEqual(await readdir(place), [], 'no copies left');
});

test('with nobody to choose, the design with the most votes is built', () => {
  const designs = ['A', 'B', 'C'].map(letter => ({ letter }));
  const answers = votes => ({ designs, design: null, history: [{ answers: votes.map(vote => ({ vote })) }] });
  assert.equal(unattendedPick({ designs, design: 'B', history: [] }), 'B');
  assert.equal(unattendedPick(answers(['C', 'C', 'A'])), 'C');
  assert.equal(unattendedPick(answers(['B', 'A'])), 'A', 'a tie goes to the earlier letter');
  assert.equal(unattendedPick(answers([null, null])), 'A');
});

test('the report: pass rate, minutes and designer calls for each way, side by side', () => {
  const result = (id, ok, seconds, designerCalls) => ({ id, ok, seconds, designerCalls });
  const run = (way, started, results, extra = {}) => ({ way, started, provider: 'claude', model: 'claude-opus-5-5', commit: 'abc1234', hard: true, results, ...extra });
  const report = measure([
    run('designer', '2026-11-14T03:00:00Z', [result('hard-statement-drift', false, 120, 1), result('hard-loader-dedupe', true, 60, 1), result('hard-reminder-dst', true, 60, 1)]),
    run('designer', '2026-11-13T03:00:00Z', [result('hard-statement-drift', true, 1, 1)]),
    run('review', '2026-11-14T04:00:00Z', [result('hard-statement-drift', true, 200, 3), result('hard-loader-dedupe', true, 100, 3), result('hard-reminder-dst', true, 60, 3)]),
    run('swarm', '2026-11-14T05:00:00Z', [], { provider: 'scripted' }),
  ]);
  assert.deepEqual(report.rows.map(row => [row.way, row.missing ? 'missing' : `${row.passed}/${row.total}`, row.rate, row.minutes, row.designerCalls, row.each?.designerCalls]),
    [['designer', '2/3', 67, 4, 3, 1], ['review', '3/3', 100, 6, 9, 3], ['swarm', 'missing', undefined, undefined, undefined, undefined]], 'the latest real run of each way; scripted runs don’t count');
  assert.deepEqual(report.tasks[0], { id: 'hard-statement-drift', designer: { ok: false, seconds: 120, designerCalls: 1 }, review: { ok: true, seconds: 200, designerCalls: 3 }, swarm: null });
  const text = reportText(report);
  assert.match(text, /^Way\s+Passed\s+Rate\s+Minutes\s+per task\s+Designer calls\s+per task\s+Run\n/);
  assert.match(text, /One designer\s+2\/3\s+67%\s+4\s+1\.3\s+3\s+1\s+claude claude-opus-5-5 at abc1234/);
  assert.match(text, /Swarm\s+not run yet/);
  assert.match(text, /hard-statement-drift\s+FAIL 120s 1 calls\s+pass 200s 3 calls\s+—/);
});
