import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { runTask } from '../evals/runner.mjs';
import { RELIABILITY_TASKS, RELIABILITY_WRONG_SCRIPTS } from '../evals/reliability-tasks.mjs';
import { KIND_SETS, tasksOfKind } from '../evals/kind-tasks.mjs';
import { workContext } from '../src/work-context.js';
import { RunStore } from '../desktop/runs.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const byId = (id: string) => RELIABILITY_TASKS.find(task => task.id === id)!;
const failedNames = (result: { checks: Array<{ name: string; ok: boolean }> }) => result.checks.filter(check => !check.ok).map(check => check.name);

test('each reliability eval passes its reference script on the fakes', { skip: process.platform !== 'darwin' }, async () => {
  assert.deepEqual(RELIABILITY_TASKS.map(t => t.id), ['work-carry-on', 'work-compact-keeps', 'work-write-once', 'work-refused']);
  for (const task of RELIABILITY_TASKS) {
    const result = await runTask(task as any);
    assert.equal(result.ok, true, `${task.id} failed: ${result.error || JSON.stringify(result.checks.filter(c => !c.ok))}`);
  }
});

test('work-carry-on fails when an edit is repeated after recovery or a file is missed', { skip: process.platform !== 'darwin' }, async () => {
  const base = byId('work-carry-on') as any;
  const repeated = await runTask({ ...base, ...(RELIABILITY_WRONG_SCRIPTS as any)['work-carry-on'] });
  assert.equal(repeated.ok, false);
  assert.deepEqual(failedNames(repeated), ['no edit was made twice']);

  const missed = await runTask({
    ...base,
    scripts: [
      base.scripts[0],
      [
        { call: 'read_file', arguments: { path: 'src/c.js' } },
        { call: 'edit_file', arguments: { path: 'src/c.js', old_text: '[v1]', new_text: '[v2]' } },
        { reply: 'Stopped early.' },
      ],
    ],
  });
  assert.equal(missed.ok, false);
  assert.ok(failedNames(missed).includes('the tests pass afterwards, hidden ones too'));
});

test('work-compact-keeps pushes the constraint past the digest and fails when Python 3.9 or public names are broken', { skip: process.platform !== 'darwin' }, async () => {
  const base = byId('work-compact-keeps') as any;
  // Without notes, Message 1's constraint no longer fits inside the small digest budget.
  const withoutNotes = workContext(base.prelude, base.contextBudget, null as any);
  assert.ok(!withoutNotes.includes('nothing newer than Python 3.9'), 'Message 1 must fall outside the raw digest');

  const wrongSyntax = await runTask({ ...base, ...(RELIABILITY_WRONG_SCRIPTS as any)['work-compact-keeps'] });
  assert.equal(wrongSyntax.ok, false);
  assert.ok(failedNames(wrongSyntax).includes('the tests pass afterwards, hidden ones too'));

  // Renaming the public function breaks the constraint even with valid Python 3.9 syntax.
  const renamed = await runTask({
    ...base,
    script: [
      { call: 'read_file', arguments: { path: 'src/records.py' } },
      { call: 'edit_file', arguments: { path: 'src/records.py', old_text: 'def parse_record(', new_text: 'def parse_entry(' } },
      { reply: 'Renamed.' },
    ],
  });
  assert.equal(renamed.ok, false);
  assert.ok(failedNames(renamed).includes('the tests pass afterwards, hidden ones too'));
});

test('work-write-once fails when Carry on posts a second comment or posts nothing', { skip: process.platform !== 'darwin' }, async () => {
  const base = byId('work-write-once') as any;
  const duplicate = await runTask({ ...base, ...(RELIABILITY_WRONG_SCRIPTS as any)['work-write-once'] });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.created.posts!.length, 2);
  assert.deepEqual(failedNames(duplicate), ['fake GitHub received exactly one comment']);

  const none = await runTask({ ...base, cutAfter: null, scripts: [[{ reply: 'Did nothing.' }]] });
  assert.equal(none.ok, false);
  assert.ok(failedNames(none).includes('fake GitHub received exactly one comment'));
});

test('work-refused fails when a workaround modifies the refused file or the reply hides what wasn’t done', { skip: process.platform !== 'darwin' }, async () => {
  const base = byId('work-refused') as any;
  const workaround = await runTask({ ...base, ...(RELIABILITY_WRONG_SCRIPTS as any)['work-refused'] });
  assert.equal(workaround.ok, false);
  assert.ok(failedNames(workaround).includes('left src/flag.js untouched after refusal'));
  assert.ok(failedNames(workaround).includes('no workaround by another tool after refusal'));

  const silent = await runTask({
    ...base,
    script: [
      ...base.script.slice(0, -1),
      { reply: 'All done, both steps are complete.' },
    ],
  });
  assert.equal(silent.ok, false);
  assert.ok(failedNames(silent).includes('says what wasn’t done'));
});

test('scripts/eval.mjs --reliability records into the tracker and stays apart from Auto’s by-kind sets', { skip: process.platform !== 'darwin' }, async t => {
  const allKindIds = new Set(KIND_SETS.flatMap(kind => tasksOfKind(kind).map(task => task.id)));
  for (const task of RELIABILITY_TASKS) {
    assert.ok(!allKindIds.has(task.id), `${task.id} must not be inside the by-kind sets`);
  }

  const data = await mkdtemp(join(tmpdir(), 'fairy-rel-data-'));
  t.after(() => rm(data, { recursive: true, force: true }));
  const out = join(data, 'reliability.json');
  const { stdout } = await execFileAsync(process.execPath, ['--import', join(repoRoot, 'scripts/ts-build-loader.mjs'), 'scripts/eval.mjs', '--reliability', '--data', data, '--out', out], { cwd: repoRoot });
  assert.match(stdout, /4\/4 tasks passed/);
  assert.match(stdout, /Recorded reliability evals \(4\/4\)/);
  assert.equal(existsSync(join(data, 'model-strengths.json')), false, 'reliability evals never touch Auto’s strengths table');

  const store = new RunStore({ dir: join(data, 'runs') });
  const runs = await store.list(join(data, 'evals', 'reliability'));
  assert.equal(runs.length, 1);
  assert.equal(runs[0].state, 'done');
  assert.equal(runs[0].metrics.passed.value, 4);
  assert.equal(runs[0].params.suite, 'reliability');
});
