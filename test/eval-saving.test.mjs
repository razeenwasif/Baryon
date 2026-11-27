import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { TEST_COMMAND, TEST_FILE, buildTask, checkAtStart, draftEval, startVerdict } from '../desktop/eval-saving.mjs';
import { readSaved, removeSaved, saveTask } from '../desktop/saved-evals.mjs';
import { startState } from '../desktop/turn-starts.mjs';
import { checkpointFrom } from '../desktop/work-rewind.mjs';

const run = promisify(execFile);
const temp = () => mkdtemp(join(tmpdir(), 'fairy-eval-save-'));
const g = (root, ...args) => run('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args]);
const darwin = process.platform === 'darwin';
const AT = '2026-11-18T10:00:00.000Z';

// A repository with a bug, the start of a turn, and the turn itself: it wrote a test and fixed the bug.
async function turn({ sub = '' } = {}) {
  const repo = await temp(), root = sub ? join(repo, sub) : repo;
  await g(repo, 'init', '-q', '-b', 'main');
  await mkdir(join(root, 'src'), { recursive: true }); await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'package.json'), '{ "type": "module" }\n');
  await writeFile(join(root, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
  await g(repo, 'add', '.'); await g(repo, 'commit', '-qm', 'one');
  await writeFile(join(root, 'notes.txt'), 'uncommitted\n');
  const start = { root, ...(await startState(root)) };
  // The turn: a test written, the fix made, the tests run.
  const testText = "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n";
  const fixed = 'export const add = (a, b) => a + b;\n';
  await writeFile(join(root, 'test', 'add.test.js'), testText); await writeFile(join(root, 'src', 'add.js'), fixed);
  const checkpoint = checkpointFrom([{ path: 'test/add.test.js', before: null, after: testText }, { path: 'src/add.js', before: 'export const add = (a, b) => a - b;\n', after: fixed }]);
  const history = [
    { role: 'user', content: 'add() subtracts. Fix it, with a test.\nThanks.', at: AT, mode: 'work' },
    { role: 'assistant', content: 'Fixed add and added test/add.test.js.', at: '2026-11-18T10:00:42.000Z', replyTo: AT, mode: 'work', usage: { input: 1200, output: 300 }, auto: { model: 'claude-opus-5-5', provider: 'claude' },
      activity: [{ tool: 'run', summary: 'node --test', detail: 'Exit 1' }, { tool: 'run', summary: 'ls', detail: 'Exit 0' }, { tool: 'run', summary: 'node --test', detail: 'Exit 0' }, { tool: 'run', summary: 'npm test -- test/add.test.js', detail: 'Exit 0' }] },
  ];
  return { repo, root, start, checkpoint, history };
}

test('what counts as a test command and a test file', () => {
  for (const command of ['node --test', 'npm test', 'npm run test -- x', 'pytest -q', 'python -m pytest', 'cargo test', 'go test ./...', 'npx vitest run', 'make check']) assert.ok(TEST_COMMAND.test(command), command);
  for (const command of ['ls', 'npm install', 'node build.mjs', 'git status']) assert.ok(!TEST_COMMAND.test(command), command);
  for (const path of ['test/a.js', 'tests/b.py', 'src/a.test.ts', 'pkg/x_test.go', 'test_x.py', '__tests__/y.js', 'FooTests.swift']) assert.ok(TEST_FILE.test(path), path);
  for (const path of ['src/a.js', 'README.md', 'latest.js']) assert.ok(!TEST_FILE.test(path), path);
});

test('the draft comes from the turn: the request, where it started, a test it ran that passed, and the tests it wrote', async () => {
  const { repo, root, start, checkpoint, history } = await turn();
  try {
    const draft = await draftEval({ history, at: AT, start, checkpoint, root });
    assert.equal(draft.title, 'add() subtracts. Fix it, with a test.');
    assert.equal(draft.verify, 'npm test -- test/add.test.js', 'the last test command that passed');
    assert.deepEqual(draft.tests, ['npm test -- test/add.test.js', 'node --test']);
    assert.deepEqual(draft.changed, ['test/add.test.js', 'src/add.js']);
    assert.deepEqual(draft.hidden.map(h => [h.path, h.same, h.new]), [['test/add.test.js', true, true]]);
    assert.deepEqual([draft.start.commit, draft.start.branch, draft.start.dirty, draft.start.kept], [start.commit, 'main', true, true]);
    assert.deepEqual(draft.reference.tokens, { input: 1200, output: 300 }); assert.equal(draft.reference.seconds, 42); assert.equal(draft.reference.model, 'claude-opus-5-5');
    // A test file changed since the turn isn't offered as what the turn left.
    await writeFile(join(root, 'test', 'add.test.js'), '// changed later\n');
    assert.equal((await draftEval({ history, at: AT, start, checkpoint, root })).hidden[0].same, false);
    for (const [args, why] of [[{ at: 'nope' }, /isn’t a work request/], [{ start: null }, /didn’t note where this turn started/], [{ start: { git: false } }, /isn’t in git/], [{ start: { git: true, commit: null } }, /no commit yet/]])
      await assert.rejects(draftEval({ history, at: AT, start, checkpoint, root, ...args }), why);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('a work folder below the repository’s top is followed: paths and the check are the repository’s', async () => {
  const { repo, root, start, checkpoint, history } = await turn({ sub: 'packages/adder' });
  try {
    const draft = await draftEval({ history, at: AT, start, checkpoint, root });
    assert.equal(draft.start.prefix, 'packages/adder');
    assert.equal(draft.verify, "cd 'packages/adder' && npm test -- test/add.test.js");
    assert.equal(draft.hidden[0].inRepo, 'packages/adder/test/add.test.js');
    const task = await buildTask({ session: 's1', history, at: AT, start, checkpoint, root, choices: { hidden: ['test/add.test.js'], changesOnly: true }, id: 'fix-add-sub' });
    assert.deepEqual(Object.keys(task.hidden), ['packages/adder/test/add.test.js']);
    assert.deepEqual(task.checks, [{ check: 'testsPass' }, { check: 'changesOnly', paths: ['packages/adder/test/add.test.js', 'packages/adder/src/add.js'] }]);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('a task is built from your choices, and refuses a test file the turn didn’t leave', async () => {
  const { repo, root, start, checkpoint, history } = await turn();
  try {
    const task = await buildTask({ session: 's1', history, at: AT, start, checkpoint, root, now: () => new Date(AT),
      choices: { title: 'Fix add', verify: 'node --test', hidden: ['test/add.test.js'], kind: 'code', tags: ['bugfix', ''], permission: 'ask' } });
    assert.match(task.id, /^fix-add-[0-9a-f]{4}$/);
    assert.deepEqual([task.title, task.verify, task.kind, task.tags, task.permission, task.saved], ['Fix add', 'node --test', 'code', ['bugfix'], 'ask', AT]);
    assert.match(task.hidden['test/add.test.js'], /assert\.equal\(add\(2, 3\), 5\)/);
    assert.deepEqual(task.start.untracked.map(u => u.path), ['notes.txt']);
    assert.deepEqual([task.reference.session, task.reference.seconds], ['s1', 42]);
    await assert.rejects(buildTask({ session: 's1', history, at: AT, start, checkpoint, root, choices: { hidden: ['src/add.js'] } }), /isn’t one of the test files this turn wrote/);
    await assert.rejects(buildTask({ session: 's1', history, at: AT, start: { ...start, kept: false, why: 'The uncommitted changes come to over 5 MB.' }, checkpoint, root }), /wasn’t kept in full \(The uncommitted changes come to over 5 MB\.\)/);
    await writeFile(join(root, 'test', 'add.test.js'), '// changed later\n');
    await assert.rejects(buildTask({ session: 's1', history, at: AT, start, checkpoint, root, choices: { hidden: ['test/add.test.js'] } }), /has changed since this turn wrote it/);
    // Saved, read back and removed in Fairy's own folder.
    const dir = await temp();
    await saveTask(task, { dir });
    assert.deepEqual((await readSaved({ dir })).tasks.map(t => t.id), [task.id]);
    await assert.rejects(removeSaved('../x', { dir }), /isn’t a saved task/);
    await removeSaved(task.id, { dir });
    assert.deepEqual((await readSaved({ dir })).tasks, []);
    await rm(dir, { recursive: true, force: true });
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('the check runs once where the request started, in the sandbox: one that already passes isn’t kept', { skip: !darwin && 'needs the macOS sandbox' }, async () => {
  const { runInSandbox } = await import('../desktop/work-sandbox.mjs');
  const { repo, root, start, checkpoint, history } = await turn();
  try {
    const statusBefore = (await g(repo, 'status', '--porcelain')).stdout;
    const task = await buildTask({ session: 's1', history, at: AT, start, checkpoint, root, choices: { verify: 'node --test', hidden: ['test/add.test.js'] }, id: 'fix-add-start' });
    const result = await checkAtStart(task, { run: options => runInSandbox(options) });
    assert.notEqual(result.exitCode, 0, result.output);
    assert.deepEqual(startVerdict(result), { ok: true });
    // Without the hidden test there's nothing to fail: refused, with why.
    const vacuous = await buildTask({ session: 's1', history, at: AT, start, checkpoint, root, choices: { verify: 'true' }, id: 'always-passes' });
    const passes = await checkAtStart(vacuous, { run: options => runInSandbox(options) });
    assert.equal(passes.exitCode, 0);
    assert.match(startVerdict(passes).why, /already passes where the request started/);
    assert.match(startVerdict({ exitCode: null, timedOut: true }).why, /didn’t finish in 3 minutes/);
    assert.equal((await g(repo, 'status', '--porcelain')).stdout, statusBefore, 'the repository is left as it was');
    assert.equal(await readFile(join(root, 'src', 'add.js'), 'utf8'), 'export const add = (a, b) => a + b;\n');
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test('the window offers Save as eval under a work request, and main saves only in the work session on screen', async () => {
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8'), main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(app, /saveEval\.textContent = 'Save as eval';/);
  assert.match(app, /openSaveEval\(\{ api, at: entry\.at,/);
  assert.match(app, /<div id="evals-pane" class="automation-section"><\/div>/);
  assert.match(main, /const evalTurn = async at => \{\n\s+const id = sessions\.active, work = sessions\.work\(\);\n\s+if \(!id \|\| !work\) throw new Error\('Open a work session first\.'\);/);
  assert.match(main, /const verdict = saving\.startVerdict\(atStart\);\n\s+if \(!verdict\.ok\) throw new Error\(verdict\.why\);\n\s+\}\n\s+await \(await import\('\.\/saved-evals\.mjs'\)\)\.saveTask\(task, \{ dir: file\(join\('evals', 'saved'\)\) \}\);/);
});
