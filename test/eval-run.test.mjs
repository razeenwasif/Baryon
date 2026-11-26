import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { EvalResults, KEEP_RESULTS, runCost, runSavedTask } from '../desktop/eval-run.mjs';
import { cleanSaved } from '../desktop/saved-evals.mjs';
import { startState } from '../desktop/turn-starts.mjs';
import { PLAIN_NEED, WorkTools } from '../desktop/work-tools.mjs';
import { resultLine } from '../src/evals-settings.js';
import { evalSettings, scriptedProvider } from '../evals/runner.mjs';

const run = promisify(execFile);
const temp = () => mkdtemp(join(tmpdir(), 'fairy-eval-run-'));
const g = (root, ...args) => run('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args]);
const darwin = process.platform === 'darwin';

async function savedTask() {
  const repo = await temp();
  await g(repo, 'init', '-q', '-b', 'main');
  await mkdir(join(repo, 'src')); await writeFile(join(repo, 'package.json'), '{ "type": "module" }\n');
  await writeFile(join(repo, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
  await g(repo, 'add', '.'); await g(repo, 'commit', '-qm', 'one');
  const start = await startState(repo);
  const task = cleanSaved({ id: 'fix-add', title: 'Fix add', ask: 'add() subtracts. Fix it.', start: { repo, commit: start.commit }, verify: 'node --test',
    hidden: { 'test/add.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n" },
    checks: [{ check: 'testsPass' }, { check: 'changesOnly', paths: ['src/add.js'] }], reference: { seconds: 41, tokens: { input: 1200, output: 300 }, model: 'claude-opus-5-5' } });
  return { repo, task };
}

test('a saved eval runs in the app as one work turn, scored as scripts/eval.mjs scores it', { skip: !darwin && 'needs the macOS sandbox' }, async () => {
  const { runInSandbox } = await import('../desktop/work-sandbox.mjs'), { runWork } = await import('../desktop/work-agent.mjs');
  const { repo, task } = await savedTask();
  try {
    const tools = { WorkTools, runWork, runInSandbox: options => runInSandbox(options) };
    const fixing = scriptedProvider([{ call: 'read_file', arguments: { path: 'src/add.js' } }, { call: 'write_file', arguments: { path: 'src/add.js', content: 'export const add = (a, b) => a + b;\n' } }, { reply: 'Fixed.' }]);
    const passed = await runSavedTask(task, { work: { provider: fixing, settings: evalSettings('claude') }, tools });
    assert.equal(passed.ok, true, JSON.stringify(passed.checks) + (passed.error || ''));
    assert.deepEqual([passed.calls, passed.changed, passed.verify.exitCode, passed.reply], [2, ['src/add.js'], 0, 'Fixed.']);
    assert.deepEqual(passed.first, { seconds: 41, tokens: { input: 1200, output: 300 }, model: 'claude-opus-5-5' });
    assert.ok(passed.seconds >= 0);
    const lazy = await runSavedTask(task, { work: { provider: scriptedProvider([{ reply: 'Looks fine.' }]), settings: evalSettings('claude') }, tools });
    assert.equal(lazy.ok, false); assert.match(lazy.checks.find(c => !c.ok).detail, /The tests exited 1/);
    const gone = await runSavedTask(cleanSaved({ ...task, start: { repo, commit: 'b'.repeat(40) } }), { work: { provider: fixing, settings: evalSettings('claude') }, tools });
    assert.deepEqual([gone.ok, gone.skipped], [false, true]); assert.match(gone.error, /isn’t in .* any more/);
    assert.equal(await readFile(join(repo, 'src', 'add.js'), 'utf8'), 'export const add = (a, b) => a - b;\n', 'the repository is left as it was');
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('results are kept, the latest for each task read back, and the card’s cost worked out', async () => {
  const dir = await temp();
  try {
    const results = new EvalResults({ dir });
    await results.save({ started: '2026-11-18T10:00:00.000Z', finished: '2026-11-18T10:05:00.000Z', model: 'claude-opus-5-5', results: [{ id: 'a', ok: false, seconds: 50, tokens: { input: 10, output: 5 } }, { id: 'b', ok: true, seconds: 20, tokens: { input: 1, output: 1 } }] });
    await results.save({ started: '2026-11-18T11:00:00.000Z', finished: '2026-11-18T11:05:00.000Z', model: 'gemini-4-argon-high', results: [{ id: 'a', ok: true, seconds: 40, tokens: { input: 9, output: 4 } }] });
    const latest = await results.latest();
    assert.deepEqual([latest.a.ok, latest.a.model, latest.b.ok, latest.b.model], [true, 'gemini-4-argon-high', true, 'claude-opus-5-5']);
    assert.equal(KEEP_RESULTS, 200);
    assert.deepEqual(runCost([{ reference: { tokens: { input: 1000, output: 200 }, seconds: 60 } }, { reference: { seconds: 30 } }]), { count: 2, tokens: { input: 1000, output: 200 }, seconds: 90, known: 1 });
    assert.match(resultLine({ firstSeconds: 41, firstTokens: { input: 1200, output: 300 }, firstModel: 'claude-opus-5-5', last: { ok: true, seconds: 38, tokens: { input: 1100, output: 250 }, at: '2026-11-18T11:05:00.000Z', model: 'gemini-4-argon-high' } }),
      /^Last run .*: passed in 38 s, 1,100 in \/ 250 out on gemini-4-argon-high · the first time 41 s, 1,200 \/ 300 on claude-opus-5-5$/);
    assert.equal(resultLine({ firstSeconds: null }), 'Not run yet');
    assert.match(resultLine({ last: { skipped: true, error: 'The commit isn’t there.', at: 'x' } }), /couldn’t start: The commit isn’t there\./);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a chat offers Save as eval for the previous request, on its card, and saves nothing itself', async () => {
  let offered = 0;
  const tools = new WorkTools({ root: tmpdir(), runCommand: async () => ({}), evals: { offer: async () => { offered++; return { title: 'Fix add', shown: true }; } } });
  assert.ok(tools.toolGroups().has('evals'));
  assert.ok(tools.offered({ request: 'That went well, save it as an eval' }).some(t => t.name === 'offer_save_eval'));
  assert.ok(!tools.offered({ request: 'Fix the parser' }).some(t => t.name === 'offer_save_eval'));
  const result = await tools.handle({ tool: 'more_tools', arguments: { name: 'offer_save_eval', arguments: {} } });
  assert.equal(result.success, true); assert.equal(offered, 1);
  assert.match(result.contentItems[0].text, /Opened the Save as eval card for “Fix add”\. The user chooses the check and saves it; nothing is saved unless they do\./);
  const refusing = new WorkTools({ root: tmpdir(), runCommand: async () => ({}), evals: { offer: async () => { throw new Error('There’s no earlier request in this chat to save.'); } } });
  assert.equal((await refusing.handle({ tool: 'offer_save_eval', arguments: {} })).success, false);
  for (const request of ['save that as an eval', 'that went badly', 'keep this as a test case', 'a good example to keep']) assert.ok(PLAIN_NEED.evals.test(request), request);
  for (const request of ['evaluate this expression', 'fix the eval() call', 'run the tests']) assert.ok(!PLAIN_NEED.evals.test(request), request);
});

test('main runs saved evals only after an OK on a card, one at a time, and offers the card from a chat', async () => {
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'), app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(main, /const decision = await approvals\.ask\(\{ kind: 'evals-run', source: 'evals', risk: 'write',[^]*?\{ choices: \['allow', 'deny'\], unanswered: 'timeout' \}\);\n\s+if \(decision !== 'allow'\) return \{ started: false \};/);
  assert.match(main, /if \(evalsRunning\) throw new Error\('Saved evals are already running\.'\);/);
  assert.match(main, /for \(const task of wanted\) \{\n\s+if \(controller\.signal\.aborted\) break;/);
  assert.match(main, /evals: \{ offer: \(\) => offerEval\(id, at\) \},/);
  assert.match(main, /if \(workRuns\.has\(id\) && workRuns\.runs\.get\(id\)\?\.at === at\) throw new Error\('Wait for this request’s work to finish first\.'\);/);
  assert.match(app, /api\?\.onEvalOffer\?\.\(\(\{ at \}\) => void import\('\.\/save-eval\.js'\)/);
});

test('an eval run is kept as a run in the tracker, under Saved evals, to compare across models', async () => {
  const { trackedRun } = await import('../desktop/eval-run.mjs'), { RunStore } = await import('../desktop/runs.mjs'), { runReader } = await import('../desktop/run-reader.mjs');
  const results = [{ id: 'fix-add', ok: true, seconds: 38, tokens: { input: 1100, output: 250 } }, { id: 'json-flag', ok: false, seconds: 120.5, tokens: { input: 3000, output: 900 } }, { id: 'gone', ok: false, skipped: true, seconds: 0, tokens: { input: 0, output: 0 } }];
  const tracked = trackedRun({ results, model: 'gemini-4-neon-high', provider: 'antigravity', version: '0.9.0' });
  assert.equal(tracked.name, 'gemini-4-neon-high · 1/2');
  assert.deepEqual(tracked.params, { model: 'gemini-4-neon-high', provider: 'antigravity', version: '0.9.0', tasks: 3, skipped: 1 });
  assert.deepEqual(Object.fromEntries(Object.entries(tracked.metrics).map(([k, m]) => [k, m.value])), { passed: 1, 'pass rate': 50, seconds: 158.5, 'tokens in': 4100, 'tokens out': 1150, 'pass fix-add': 1, 'pass json-flag': 0 });
  assert.equal(tracked.state, 'done'); assert.equal(trackedRun({ results, stopped: true }).state, 'stopped');
  const dir = await temp(), evals = join(await temp(), 'evals');
  try {
    const store = new RunStore({ dir });
    const kept = await store.start(evals, { name: tracked.name, command: tracked.command, params: tracked.params, where: { kind: 'here' } });
    const done = await store.finish(evals, kept.id, { state: tracked.state, metrics: tracked.metrics, seconds: tracked.seconds });
    assert.deepEqual([done.id, done.state, done.seconds, done.metrics['pass rate']], ['R1', 'done', 158.5, { value: 50, unit: '%' }]);
    const [project] = await runReader({ store, titles: { [evals]: 'Saved evals' } }).projects();
    assert.deepEqual([project.title, project.kind, project.count], ['Saved evals', 'evals', 1]);
  } finally { await rm(dir, { recursive: true, force: true }); }
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /const kept = await runStore\.start\(file\('evals'\), \{ name: tracked\.name, command: tracked\.command, params: tracked\.params, where: \{ kind: 'here' \} \}\);/);
  assert.match(main, /titles: \{ \[file\('evals'\)\]: 'Saved evals', /);
});
