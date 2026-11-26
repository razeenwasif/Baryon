import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { cleanSaved, loadSaved, runnerTask, saveTask } from '../evals/saved.mjs';
import { runTask } from '../evals/runner.mjs';
import { startState } from '../desktop/turn-starts.mjs';

const run = promisify(execFile);
const temp = () => mkdtemp(join(tmpdir(), 'fairy-saved-'));
const g = (root, ...args) => run('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args]);
const darwin = process.platform === 'darwin';

// A small repository with a bug, committed, and changes not yet committed when the request was made.
async function repository() {
  const repo = await temp();
  await g(repo, 'init', '-q', '-b', 'main');
  await mkdir(join(repo, 'src')); await mkdir(join(repo, 'test'));
  await writeFile(join(repo, 'package.json'), '{ "type": "module" }\n');
  await writeFile(join(repo, 'src', 'add.js'), 'export const add = (a, b) => a - b;\n');
  await writeFile(join(repo, 'test', 'add.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../src/add.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n");
  await writeFile(join(repo, 'README.md'), '# adder\n');
  await g(repo, 'add', '.'); await g(repo, 'commit', '-qm', 'one');
  await writeFile(join(repo, 'README.md'), '# adder\n\nWork in progress.\n');
  await writeFile(join(repo, 'notes.txt'), 'remember the carry\n');
  return repo;
}
const fix = { call: 'write_file', arguments: { path: 'src/add.js', content: 'export const add = (a, b) => a + b;\n' } };
// Hidden: the start must have been rebuilt exactly (the uncommitted README and the untracked notes are there).
const hidden = { 'test/start.test.js': "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { readFileSync } from 'node:fs';\ntest('starts where the request was made', () => { assert.match(readFileSync('README.md', 'utf8'), /Work in progress/); assert.equal(readFileSync('notes.txt', 'utf8'), 'remember the carry\\n'); });\n" };

test('a saved task is checked before it is kept, and says what is missing', () => {
  const ok = { id: 'fix-add', ask: 'Fix add', start: { repo: '/r', commit: 'a'.repeat(40) }, verify: 'node --test' };
  assert.deepEqual(cleanSaved(ok).checks, [{ check: 'testsPass' }], 'a command alone means the tests must pass');
  for (const [bad, why] of [[{ ...ok, id: '../x' }, /an id/], [{ ...ok, ask: ' ' }, /the request/], [{ ...ok, start: { repo: 'relative', commit: 'a'.repeat(40) } }, /full path/],
    [{ ...ok, start: { repo: '/r', commit: 'HEAD' } }, /the commit/], [{ ...ok, verify: '' }, /needs a check/], [{ ...ok, start: { ...ok.start, patch: 'not base64!' } }, /aren’t a patch/]])
    assert.throws(() => cleanSaved(bad), why, JSON.stringify(bad).slice(0, 60));
  const kept = cleanSaved({ ...ok, permission: 'yolo', hidden: { '../escape.js': 'x', '.git/hooks/pre-commit': 'x', 'test/h.js': 'ok' }, checks: [{ check: 'changesOnly', paths: ['src/add.js', '/etc/passwd'] }, { check: 'neverRuns', pattern: '(' }, { check: 'nope' }],
    start: { ...ok.start, untracked: [{ path: '../x', data: 'eA==' }, { path: 'n.txt', data: 'eA==' }] } });
  assert.equal(kept.permission, 'auto');
  assert.deepEqual(Object.keys(kept.hidden), ['test/h.js']);
  assert.deepEqual(kept.checks, [{ check: 'changesOnly', paths: ['src/add.js'] }]);
  assert.deepEqual(kept.start.untracked.map(u => u.path), ['n.txt']);
  const task = runnerTask(kept);
  assert.deepEqual([task.id, task.kind, task.saved, task.checks.length], ['saved-fix-add', 'work', true, 1]);
  assert.deepEqual(task.world().git.commit, 'a'.repeat(40));
});

test('a saved turn replays from its commit and uncommitted changes, and the repository is left as it was', { skip: !darwin && 'needs the macOS sandbox' }, async () => {
  const repo = await repository(), dir = await temp();
  try {
    const start = await startState(repo);
    assert.equal(start.kept, true);
    const statusBefore = (await g(repo, 'status', '--porcelain')).stdout, refsBefore = (await g(repo, 'for-each-ref')).stdout;
    await saveTask({ id: 'fix-add', ask: 'add() subtracts. Fix it.', start: { repo, commit: start.commit, patch: start.patch, untracked: start.untracked }, verify: 'node --test', hidden,
      checks: [{ check: 'testsPass' }, { check: 'changesOnly', paths: ['src/add.js'] }], tags: ['bugfix'], reference: { seconds: 41, model: 'claude-opus-5-5', tokens: { input: 1200, output: 300 } },
      script: [{ call: 'read_file', arguments: { path: 'src/add.js' } }, fix, { reply: 'add() now adds.' }] }, { dir });
    const { tasks, problems } = await loadSaved({ dir });
    assert.deepEqual([tasks.length, problems.length], [1, 0]);
    const result = await runTask(tasks[0]);
    assert.equal(result.ok, true, JSON.stringify(result.checks) + (result.error || '') + JSON.stringify(result.verify));
    assert.equal(result.verify.exitCode, 0);
    assert.deepEqual(result.created.localFiles, ['src/add.js'], 'what was uncommitted at the start isn’t a change the turn made');
    assert.deepEqual(result.reference, { seconds: 41, tokens: { input: 1200, output: 300 }, model: 'claude-opus-5-5' });
    // A turn that doesn't fix it fails, on the same start.
    const lazy = await runTask({ ...tasks[0], script: [{ reply: 'Looks fine to me.' }] });
    assert.equal(lazy.ok, false);
    assert.match(lazy.checks.find(c => !c.ok).detail, /The tests exited 1/);
    // The repository itself: nothing changed, no new branch, worktree or remote.
    assert.equal((await g(repo, 'status', '--porcelain')).stdout, statusBefore);
    assert.equal((await g(repo, 'for-each-ref')).stdout, refsBefore);
    assert.equal((await g(repo, 'worktree', 'list')).stdout.trim().split('\n').length, 1);
    assert.equal(await readFile(join(repo, 'src', 'add.js'), 'utf8'), 'export const add = (a, b) => a - b;\n');
    // A commit that has gone: skipped and said, never run on what's there now.
    const gone = await runTask(runnerTask(cleanSaved({ id: 'gone', ask: 'x', start: { repo, commit: 'b'.repeat(40) }, verify: 'true' })));
    assert.deepEqual([gone.ok, gone.skipped], [false, true]);
    assert.match(gone.error, /isn’t in .* any more, so this saved task can’t start where it did/);
  } finally { await rm(repo, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});

test('scripts/eval.mjs --saved runs the saved tasks and sets each beside the session it came from', { skip: !darwin && 'needs the macOS sandbox' }, async () => {
  const repo = await repository(), dir = await temp(), out = join(await temp(), 'run.json');
  try {
    const start = await startState(repo);
    await saveTask({ id: 'fix-add', ask: 'add() subtracts. Fix it.', start: { repo, commit: start.commit, patch: start.patch, untracked: start.untracked }, verify: 'node --test', hidden, tags: ['bugfix'],
      reference: { seconds: 41 }, script: [{ call: 'read_file', arguments: { path: 'src/add.js' } }, fix, { reply: 'Fixed.' }] }, { dir });
    await mkdir(join(dir, 'broken')); await writeFile(join(dir, 'broken', 'task.json'), '{"id":"broken"}');
    const script = new URL('../scripts/eval.mjs', import.meta.url).pathname;
    const listed = await run(process.execPath, [script, '--list', '--saved', '--saved-dir', dir]);
    assert.match(listed.stdout, /saved-fix-add\s+work\s+add\(\) subtracts\. Fix it\./);
    const ran = await run(process.execPath, [script, '--saved', '--saved-dir', dir, '--tag', 'bugfix', '--out', out]);
    assert.match(ran.stderr, /Left out broken: A saved task needs the request\./);
    assert.match(ran.stdout, /pass {2}saved-fix-add/);
    assert.match(ran.stdout, /the first time: 41s; now [\d.]+s, 0 in \/ 0 out/);
    const saved = JSON.parse(await readFile(out, 'utf8'));
    assert.deepEqual([saved.saved, saved.summary.passed, saved.summary.total], [true, 1, 1]);
    await assert.rejects(run(process.execPath, [script, '--saved', '--saved-dir', dir, '--task', 'nope']), /No task called saved-nope/);
  } finally { await rm(repo, { recursive: true, force: true }); await rm(dir, { recursive: true, force: true }); }
});
