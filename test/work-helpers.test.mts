import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { ignoredPaths, keepNotIgnored } from '../desktop/git-tools.mjs';
import { runWorker, workInstructions, type WorkProvider } from '../desktop/work-agent.mjs';
import { collectChanges, copyIgnored, copyProject, HelperPool, mergeText, planBringBack, type HelperPoolOptions } from '../desktop/work-helpers.mjs';
import { rewindFiles, saveCheckpoint } from '../desktop/work-rewind.mjs';
import { runInSandbox, sandboxWorks, type SandboxCommandResult } from '../desktop/work-sandbox.mjs';
import { WorkTools, type WorkActivityRow, type WorkEvent, type WorkHelpersContext, type WorkJournalEntry, type WorkToolResult, type WorkToolsOptions } from '../desktop/work-tools.mjs';

async function folder(t: TestContext) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'fairy-helpers-test-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function project(t: TestContext, files: Record<string, string> = { 'a.txt': 'one\ntwo\nthree\n' }) {
  const dir = await folder(t), root = join(dir, 'project');
  await mkdir(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), content); }
  return { root, place: join(dir, 'copies') };
}
const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
const text = (result: WorkToolResult) => (result.contentItems[0] as { text?: string }).text as string;
const bytesOf = (root: string) => async (path: string) => { try { return await readFile(join(root, path)); } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } };

interface SetupWorkArgs {
  copy: string;
  signal: AbortSignal;
  task: string;
  onEvent: (event: unknown) => void;
}
interface SetupOptions {
  pool?: Partial<HelperPoolOptions>;
  permission?: string;
  sandboxed?: boolean;
  answer?: string;
}
// A pool whose helpers run the given function on their copy instead of a model.
function setup(root: string, place: string, doWork: ((opts: SetupWorkArgs) => Promise<string> | string) | null, options: SetupOptions = {}) {
  const asked: Record<string, unknown>[] = [], rows = new Map<string, WorkActivityRow>(), saved: WorkJournalEntry[][] = [];
  const pool = new HelperPool({ place, run: ({ root: copy, signal, task, onEvent }) => Promise.resolve(doWork!({ copy, signal, task, onEvent })), ...options.pool });
  const tools = new WorkTools({ root, permission: options.permission ?? 'auto', sandboxed: options.sandboxed ?? true, owner: 'chat', helpers: pool as unknown as WorkHelpersContext, allowed: new Set(), runCommand: async () => ({ exitCode: 0, output: '' }) as SandboxCommandResult,
    approve: async request => { asked.push(request); return options.answer ?? 'allow'; }, onEvent: event => { if (event.type === 'tool') rows.set(event.row!.id, { ...event.row! }); }, onChange: journal => { saved.push([...journal]); } });
  const call = (tool: string, input: Record<string, unknown>) => tools.handle({ tool, arguments: input });
  return { pool, tools, call, asked, rows, saved };
}
const started = (text: string) => /helper (h\d+)/.exec(text)![1];

test('a helper’s copy has the uncommitted work and dependencies, but no keys', async t => {
  const { root, place } = await project(t, { 'a.txt': 'hello\n', 'node_modules/dep/index.js': 'dep\n', '.env': 'SECRET=1\n', 'keys/server.pem': 'key\n', 'untracked.md': 'new\n' });
  const copy = await copyProject({ root, place });
  t.after(() => rm(copy.dir, { recursive: true, force: true }));
  assert.equal(await readFile(join(copy.work, 'a.txt'), 'utf8'), 'hello\n');
  assert.equal(await readFile(join(copy.work, 'node_modules/dep/index.js'), 'utf8'), 'dep\n');
  assert.equal(await readFile(join(copy.work, 'untracked.md'), 'utf8'), 'new\n');
  assert.equal(existsSync(join(copy.work, '.env')), false);
  assert.equal(existsSync(join(copy.work, 'keys/server.pem')), false);
  assert.equal(existsSync(join(root, '.env')), true, 'the real one stays');
  assert.ok(copy.work.endsWith('/project'), 'it keeps the project’s name');
});
test('a chat’s own checkout doesn’t bring a link to its real Git history', async t => {
  const { root, place } = await project(t);
  await writeFile(join(root, '.git'), 'gitdir: /somewhere/else\n');
  const copy = await copyProject({ root, place });
  assert.equal(existsSync(join(copy.work, '.git')), false);
});
test('it finds what changed, and leaves behind Git’s files, node_modules, links and new keys', async t => {
  const { root, place } = await project(t, { 'a.txt': 'one\n', 'gone.txt': 'bye\n', 'same.txt': 'same\n', 'node_modules/x.js': 'x\n' });
  await mkdir(join(root, '.git'));
  await writeFile(join(root, '.git/config'), 'real\n');
  const copy = await copyProject({ root, place });
  await writeFile(join(copy.work, 'a.txt'), 'one\nmore\n');
  await rm(join(copy.work, 'gone.txt'));
  await writeFile(join(copy.work, 'new.txt'), 'hi\n');
  await writeFile(join(copy.work, 'same.txt'), 'same\n');
  await writeFile(join(copy.work, 'node_modules/x.js'), 'changed\n');
  await writeFile(join(copy.work, '.git/config'), 'bad\n');
  await writeFile(join(copy.work, '.env'), 'NEW=1\n');
  await symlink('/etc/passwd', join(copy.work, 'link.txt'));
  const { changes, skipped } = await collectChanges(copy);
  assert.deepEqual(changes.map(({ path, kind }) => [path, kind]), [['a.txt', 'changed'], ['gone.txt', 'removed'], ['new.txt', 'added']]);
  assert.equal(changes[0].added, 1);
  assert.deepEqual(skipped.map(item => item.path).sort(), ['.env', 'link.txt']);
});
test('in a repository, what Git ignores doesn’t come back, and a tracked file in dist still does', async t => {
  const { root, place } = await project(t, { 'a.txt': 'one\n', '.gitignore': 'out/\n*.log\n', 'dist/kept.js': 'kept\n', 'out/old.js': 'old\n' });
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'start');
  const ignored = await ignoredPaths(root);
  assert.deepEqual([...ignored!], ['out']);
  const copy = await copyProject({ root, place, ignored });
  await writeFile(join(copy.work, 'dist/kept.js'), 'changed\n');
  await writeFile(join(copy.work, 'out/old.js'), 'changed\n');
  await writeFile(join(copy.work, 'debug.log'), 'noise\n');
  await writeFile(join(copy.work, 'wanted.txt'), 'yes\n');
  const { changes } = await collectChanges(copy, { keepNotIgnored, root });
  assert.deepEqual(changes.map(change => change.path), ['dist/kept.js', 'wanted.txt']);
  assert.equal(await ignoredPaths(await realpath(tmpdir())), null, 'not in a repository');
});
test('without Git, rebuilt folders are left alone', async t => {
  const { root, place } = await project(t, { 'a.txt': 'one\n', 'dist/out.js': 'x\n' });
  const copy = await copyProject({ root, place });
  await writeFile(join(copy.work, 'dist/out.js'), 'changed\n');
  assert.deepEqual((await collectChanges(copy)).changes, []);
});
test('changes in different places merge, and the same line clashes', async () => {
  const base = Buffer.from('one\ntwo\nthree\nfour\nfive\n');
  assert.equal(String(await mergeText(Buffer.from('ONE\ntwo\nthree\nfour\nfive\n'), base, Buffer.from('one\ntwo\nthree\nfour\nFIVE\n'))), 'ONE\ntwo\nthree\nfour\nFIVE\n');
  assert.equal(await mergeText(Buffer.from('ONE\ntwo\nthree\nfour\nfive\n'), base, Buffer.from('uno\ntwo\nthree\nfour\nfive\n')), null);
});
test('the plan covers every combination of what happened to a file', async t => {
  const { root, place } = await project(t, { 'plain.txt': 'a\n', 'merge.txt': '1\n2\n3\n4\n5\n', 'clash.txt': 'x\n', 'gone.txt': 'g\n', 'goneboth.txt': 'g\n', 'taken.txt': 't\n', 'removed-changed.txt': 'r\n', 'equal.txt': 'e\n' });
  const copy = await copyProject({ root, place });
  const put = (dir: string, path: string, content: string) => writeFile(join(dir, path), content);
  await put(copy.work, 'plain.txt', 'a\nb\n'); await put(copy.work, 'merge.txt', '1\n2\n3\n4\nfive\n'); await put(copy.work, 'clash.txt', 'helper\n'); await put(copy.work, 'new.txt', 'n\n'); await put(copy.work, 'both-new.txt', 'theirs\n'); await put(copy.work, 'equal.txt', 'same now\n');
  await rm(join(copy.work, 'gone.txt')); await rm(join(copy.work, 'goneboth.txt')); await rm(join(copy.work, 'removed-changed.txt'));
  await put(copy.work, 'taken.txt', 'helper\n');
  await put(root, 'merge.txt', 'one\n2\n3\n4\n5\n'); await put(root, 'clash.txt', 'me\n'); await put(root, 'both-new.txt', 'mine\n'); await put(root, 'removed-changed.txt', 'mine\n'); await put(root, 'equal.txt', 'same now\n');
  await rm(join(root, 'goneboth.txt')); await rm(join(root, 'taken.txt'));
  const { changes } = await collectChanges(copy), steps = Object.fromEntries((await planBringBack(copy, changes, bytesOf(root))).map(step => [step.path, step]));
  assert.equal(steps['plain.txt'].action, 'write');
  assert.equal(steps['merge.txt'].action, 'write');
  assert.equal(steps['merge.txt'].merged, true);
  assert.equal(String(steps['merge.txt'].content), 'one\n2\n3\n4\nfive\n');
  assert.equal(steps['clash.txt'].action, 'conflict');
  assert.equal(steps['new.txt'].action, 'write');
  assert.equal(steps['both-new.txt'].action, 'conflict');
  assert.equal(steps['gone.txt'].action, 'remove');
  assert.equal(steps['goneboth.txt'].action, 'same');
  assert.equal(steps['taken.txt'].action, 'conflict');
  assert.equal(steps['removed-changed.txt'].action, 'conflict');
  assert.equal(steps['equal.txt'].action, 'same');
});
test('a file swapped for a link after the helper stopped isn’t followed out of the copy', async t => {
  const { root, place } = await project(t, { 'a.txt': 'one\n' });
  const secret = join(root, '..', 'private.txt');
  await writeFile(secret, 'private\n');
  const copy = await copyProject({ root, place });
  await writeFile(join(copy.work, 'a.txt'), 'two\n');
  const { changes } = await collectChanges(copy);
  await rm(join(copy.work, 'a.txt'));
  await symlink(secret, join(copy.work, 'a.txt'));
  const [step] = await planBringBack(copy, changes, bytesOf(root));
  assert.equal(step.action, 'conflict');
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'one\n');
});
test('three helpers run at once, none can see the others, and all of it comes back', async t => {
  const { root, place } = await project(t, { 'shared.txt': '1\n2\n3\n4\n5\n6\n7\n8\n9\n' });
  let working = 0, most = 0, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { call, pool, tools } = setup(root, place, async ({ copy, task }) => {
    most = Math.max(most, ++working);
    await writeFile(join(copy, `${task}.txt`), task);
    const shared = (await readFile(join(copy, 'shared.txt'), 'utf8')).split('\n');
    shared[({ first: 0, second: 4, third: 8 } as Record<string, number>)[task]] = task;
    await writeFile(join(copy, 'shared.txt'), shared.join('\n'));
    await gate;
    assert.deepEqual(['first', 'second', 'third'].filter(name => name !== task && existsSync(join(copy, `${name}.txt`))), []);
    working--;
    return `did ${task}`;
  });
  const ids: string[] = [];
  for (const task of ['first', 'second', 'third']) ids.push(started(text(await call('start_helper', { task, title: task }))));
  assert.deepEqual(ids, ['h1', 'h2', 'h3']);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(most, 3, 'all at the same time');
  assert.equal(existsSync(join(root, 'first.txt')), false, 'nothing touches the project yet');
  release();
  const report = text(await call('wait_for_helpers', {}));
  assert.match(report, /did first/); assert.match(report, /did third/); assert.match(report, /Nothing has reached the project yet/);
  for (const id of ids) { const back = await call('helper_changes', { id, action: 'bring_back' }); assert.notEqual(back.success, false, text(back)); }
  assert.equal(await readFile(join(root, 'shared.txt'), 'utf8'), 'first\n2\n3\n4\nsecond\n6\n7\n8\nthird\n');
  for (const name of ['first', 'second', 'third']) assert.equal(await readFile(join(root, `${name}.txt`), 'utf8'), name);
  assert.equal(pool.list('chat').length, 0, 'copies go once it’s all back');
  assert.equal([...tools.changed].length, 4);
});
test('no more than three work at once, and a turn can’t start endlessly many', async t => {
  const { root, place } = await project(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { call, tools } = setup(root, place, () => gate as any);
  for (const title of ['a', 'b', 'c']) assert.notEqual((await call('start_helper', { task: 'x', title })).success, false);
  const fourth = await call('start_helper', { task: 'x', title: 'd' });
  assert.equal(fourth.success, false); assert.match(text(fourth), /already working/);
  release();
  await call('wait_for_helpers', {});
  tools.started = 12;
  assert.match(text(await call('start_helper', { task: 'x', title: 'e' })), /12 helpers/);
});
test('a clash leaves the project’s file alone, shows the helper’s version, and can then be discarded', async t => {
  const { root, place } = await project(t, { 'a.txt': 'start\n', 'b.txt': 'b\n' });
  const { call, pool } = setup(root, place, async ({ copy }) => { await writeFile(join(copy, 'a.txt'), 'helper\n'); await writeFile(join(copy, 'b.txt'), 'b2\n'); return 'done'; });
  await call('start_helper', { task: 'x', title: 'clash' });
  await writeFile(join(root, 'a.txt'), 'mine\n');
  await call('wait_for_helpers', {});
  const back = text(await call('helper_changes', { id: 'h1', action: 'bring_back' }));
  assert.match(back, /b\.txt/); assert.match(back, /These clash/); assert.match(back, /a\.txt/);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'mine\n');
  assert.equal(await readFile(join(root, 'b.txt'), 'utf8'), 'b2\n');
  assert.match(text(await call('helper_changes', { id: 'h1', action: 'show', path: 'a.txt' })), /1: helper/);
  const { dir } = pool.get('chat', 'h1').copy!;
  assert.match(text(await call('helper_changes', { id: 'h1', action: 'discard' })), /Threw away/);
  assert.equal(existsSync(dir), false);
});
test('in ask mode, starting and bringing back each ask; a no changes nothing', async t => {
  const { root, place } = await project(t);
  const yes = setup(root, place, async ({ copy }) => { await writeFile(join(copy, 'a.txt'), 'changed\n'); return 'done'; }, { permission: 'ask' });
  await yes.call('start_helper', { task: 'the brief', title: 'ask' });
  assert.equal(yes.asked[0].kind, 'helper'); assert.equal(yes.asked[0].command, 'the brief');
  await yes.call('wait_for_helpers', {});
  await yes.call('helper_changes', { id: 'h1', action: 'bring_back' });
  assert.equal(yes.asked[1].kind, 'edit'); assert.match(yes.asked[1].title as string, /Bring back 1 file/); assert.ok((yes.asked[1].diff as { rows: unknown[] }).rows.length);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'changed\n');
  const no = setup(root, join(place, 'other'), async () => { assert.fail('it must not start'); }, { permission: 'ask', answer: 'deny' });
  assert.equal((await no.call('start_helper', { task: 'x', title: 'no' })).success, false);
  assert.equal(no.pool.list('chat').length, 0);
});
test('a refused bring-back keeps the helper’s work, and the project as it was', async t => {
  const { root, place } = await project(t);
  let answer = 'allow';
  const pool = new HelperPool({ place, run: async ({ root: copy }) => { await writeFile(join(copy, 'a.txt'), 'changed\n'); return 'done'; } });
  const tools = new WorkTools({ root, permission: 'ask', sandboxed: true, owner: 'chat', helpers: pool as unknown as WorkHelpersContext, allowed: new Set(), approve: async () => answer });
  await tools.handle({ tool: 'start_helper', arguments: { task: 'x', title: 'y' } });
  await tools.handle({ tool: 'wait_for_helpers', arguments: {} });
  answer = 'deny';
  assert.equal((await tools.handle({ tool: 'helper_changes', arguments: { id: 'h1', action: 'bring_back' } })).success, false);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'one\ntwo\nthree\n');
  assert.equal(pool.list('chat').length, 1);
});
test('plan mode can’t start a helper or bring one back, and an unsandboxed Mac can’t start one', async t => {
  const { root, place } = await project(t);
  const planning = setup(root, place, async () => 'x', { permission: 'plan' });
  assert.match(text(await planning.call('start_helper', { task: 'x', title: 'y' })), /plan mode/);
  const open = setup(root, place, async () => 'x', { sandboxed: false });
  assert.match(text(await open.call('start_helper', { task: 'x', title: 'y' })), /aren’t sandboxed/);
});
test('it can’t bring back over a key file or into Git, whatever the copy says', async t => {
  const { root, place } = await project(t);
  const { call, pool } = setup(root, place, async () => 'done');
  await call('start_helper', { task: 'x', title: 'y' });
  await call('wait_for_helpers', {});
  const entry = pool.get('chat', 'h1');
  await mkdir(join(entry.copy!.work, '.git/hooks'), { recursive: true });
  await writeFile(join(entry.copy!.work, '.git/hooks/pre-commit'), 'bad\n');
  await writeFile(join(entry.copy!.work, '.env'), 'x\n');
  // As if it had been recorded as a change.
  entry.changes = [{ path: '.git/hooks/pre-commit', kind: 'added', added: 1, removed: 0 }, { path: '.env', kind: 'added', added: 1, removed: 0 }];
  const back = text(await call('helper_changes', { id: 'h1', action: 'bring_back' }));
  assert.match(back, /clash/);
  assert.equal(existsSync(join(root, '.git/hooks/pre-commit')), false);
  assert.equal(existsSync(join(root, '.env')), false);
});
test('a link in the project can’t take the changes outside it', async t => {
  const { root, place } = await project(t, { 'dir/a.txt': 'one\n' });
  const outside = join(root, '..', 'outside');
  await mkdir(outside); await writeFile(join(outside, 'a.txt'), 'one\n');
  const { call } = setup(root, place, async ({ copy }) => { await writeFile(join(copy, 'dir/a.txt'), 'changed\n'); return 'done'; });
  await call('start_helper', { task: 'x', title: 'y' });
  await call('wait_for_helpers', {});
  await rm(join(root, 'dir'), { recursive: true });
  await symlink(outside, join(root, 'dir'));
  await call('helper_changes', { id: 'h1', action: 'bring_back' });
  assert.equal(await readFile(join(outside, 'a.txt'), 'utf8'), 'one\n');
});
test('waiting has a limit, so a slow helper doesn’t hold the tool call past the model’s patience', async t => {
  const { root, place } = await project(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { call, tools } = setup(root, place, () => gate as any);
  tools.waitLimit = 30;
  await call('start_helper', { task: 'x', title: 'slow' });
  assert.match(text(await call('wait_for_helpers', {})), /still working/);
  assert.match(text(await call('helper_changes', { id: 'h1', action: 'bring_back' })), /still working/);
  release();
  tools.waitLimit = 5000;
  assert.match(text(await call('wait_for_helpers', { ids: ['h1'] })), /finished/);
});
test('stopping one helper keeps its work for review and leaves the others going', async t => {
  const { root, place } = await project(t);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const { call, pool, rows } = setup(root, place, async ({ copy, task, signal }) => {
    await writeFile(join(copy, `${task}.txt`), task);
    if (task === 'stop me') await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped.'))));
    await gate;
    return 'done';
  });
  await call('start_helper', { task: 'stop me', title: 'one' });
  await call('start_helper', { task: 'carry on', title: 'two' });
  pool.stop('chat', 'h1');
  await pool.get('chat', 'h1').done;
  const stopped = pool.get('chat', 'h1');
  assert.equal(stopped.status, 'stopped');
  assert.deepEqual(stopped.changes.map(change => change.path), ['stop me.txt']);
  assert.equal(pool.get('chat', 'h2').status, 'running');
  assert.equal([...rows.values()].find(row => row.summary === 'one')!.detail, 'Stopped');
  release();
  await pool.get('chat', 'h2').done;
});
test('stopping the turn stops its helpers, and the end of a turn stops any left running', async t => {
  const { root, place } = await project(t);
  const controller = new AbortController(), pool = new HelperPool({ place, run: ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped.')))) });
  const tools = new WorkTools({ root, permission: 'auto', sandboxed: true, owner: 'chat', helpers: pool as unknown as WorkHelpersContext, signal: controller.signal });
  await tools.handle({ tool: 'start_helper', arguments: { task: 'x', title: 'one' } });
  await tools.handle({ tool: 'start_helper', arguments: { task: 'x', title: 'two' } });
  const waiting = tools.handle({ tool: 'wait_for_helpers', arguments: {} });
  controller.abort();
  await assert.rejects(waiting, /Stopped/);
  await Promise.all(pool.list('chat').map(entry => entry.done));
  assert.deepEqual(pool.list('chat').map(entry => entry.status), ['stopped', 'stopped']);
  await pool.endTurn('chat');
  assert.deepEqual(pool.list('chat'), [], 'nothing was changed, so nothing is kept');
  const later = setup(root, join(place, 'later'), ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('Stopped.')))));
  await later.call('start_helper', { task: 'x', title: 'y' });
  const [entry] = later.pool.list('chat');
  await later.pool.endTurn('chat');
  assert.equal(entry.status, 'stopped');
});
test('at the end of a turn, helpers with nothing to show are cleared, and ones with changes stay', async t => {
  const { root, place } = await project(t);
  const { call, pool } = setup(root, place, async ({ copy, task }) => { if (task === 'change') await writeFile(join(copy, 'a.txt'), 'x\n'); return 'done'; });
  await call('start_helper', { task: 'change', title: 'one' });
  await call('start_helper', { task: 'nothing', title: 'two' });
  await call('wait_for_helpers', {});
  const { dir } = pool.get('chat', 'h2').copy!;
  await pool.endTurn('chat');
  assert.deepEqual(pool.list('chat').map(entry => entry.id), ['h1']);
  assert.equal(existsSync(dir), false);
});
test('a helper that fails says why, and what it did can still come back', async t => {
  const { root, place } = await project(t);
  const { call, rows } = setup(root, place, async ({ copy }) => { await writeFile(join(copy, 'a.txt'), 'partly\n'); throw new Error('The model gave up.'); });
  await call('start_helper', { task: 'x', title: 'fails' });
  const report = text(await call('wait_for_helpers', {}));
  assert.match(report, /failed: The model gave up/); assert.match(report, /a\.txt/);
  assert.equal([...rows.values()][0].status, 'failed');
  await call('helper_changes', { id: 'h1', action: 'bring_back' });
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'partly\n');
});
test('a helper’s steps stay inside its own row, and don’t reach the task list', async t => {
  const { root, place } = await project(t);
  const events: WorkEvent[] = [];
  const pool = new HelperPool({ place, run: async ({ onEvent }) => {
    onEvent({ type: 'tool', row: { id: 's1', tool: 'read', summary: 'a.txt', status: 'running', output: 'long output' } });
    onEvent({ type: 'tool', row: { id: 's1', tool: 'read', summary: 'a.txt', status: 'done', output: 'long output' } });
    onEvent({ type: 'tasks', tasks: [{ text: 'its own', status: 'pending' }] });
    return 'done';
  } });
  const tools = new WorkTools({ root, permission: 'auto', sandboxed: true, owner: 'chat', helpers: pool as unknown as WorkHelpersContext, onEvent: event => events.push(structuredClone(event)) });
  await tools.handle({ tool: 'start_helper', arguments: { task: 'x', title: 'row' } });
  await tools.handle({ tool: 'wait_for_helpers', arguments: {} });
  assert.equal(events.some(event => event.type === 'tasks'), false);
  assert.deepEqual([...new Set(events.map(event => event.row!.tool))], ['worker', 'wait']);
  const last = events.filter(event => event.row!.tool === 'worker').at(-1)!.row!;
  assert.deepEqual(last.steps, [{ id: 's1', tool: 'read', summary: 'a.txt', status: 'done' }]);
  assert.equal(last.detail, 'No changes');
  assert.equal(last.helper, undefined, 'no Stop button once it has finished');
});
test('rewinding undoes what came back from a helper', async t => {
  const { root, place } = await project(t, { 'a.txt': 'before\n', 'gone.txt': 'keep me\n' });
  const dir = join(place, '..', 'rewind');
  const pool = new HelperPool({ place, run: async ({ root: copy }) => { await writeFile(join(copy, 'a.txt'), 'after\n'); await writeFile(join(copy, 'new.txt'), 'new\n'); await rm(join(copy, 'gone.txt')); return 'done'; } });
  const tools = new WorkTools({ root, permission: 'auto', sandboxed: true, owner: 'chat', helpers: pool as unknown as WorkHelpersContext, onChange: async journal => { await saveCheckpoint({ dir, sessionId: 'chat', turn: 5, journal }); } });
  await tools.handle({ tool: 'start_helper', arguments: { task: 'x', title: 'y' } });
  await tools.handle({ tool: 'wait_for_helpers', arguments: {} });
  await tools.handle({ tool: 'helper_changes', arguments: { id: 'h1', action: 'bring_back' } });
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'after\n');
  assert.equal(existsSync(join(root, 'gone.txt')), false);
  const { conflicts } = await rewindFiles({ dir, sessionId: 'chat', root, fromTurn: 5 });
  assert.deepEqual(conflicts, []);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'before\n');
  assert.equal(await readFile(join(root, 'gone.txt'), 'utf8'), 'keep me\n');
  assert.equal(existsSync(join(root, 'new.txt')), false);
});
test('brought-back files must be read again before they can be replaced', async t => {
  const { root, place } = await project(t);
  const { call } = setup(root, place, async ({ copy }) => { await writeFile(join(copy, 'a.txt'), 'theirs\n'); return 'done'; });
  await call('read_file', { path: 'a.txt' });
  await call('start_helper', { task: 'x', title: 'y' });
  await call('wait_for_helpers', {});
  await call('helper_changes', { id: 'h1', action: 'bring_back' });
  assert.match(text(await call('write_file', { path: 'a.txt', content: 'stale\n' })), /Read a\.txt first/);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'theirs\n');
});
test('new executable files stay executable when they come back', async t => {
  const { root, place } = await project(t);
  const { call } = setup(root, place, async ({ copy }) => { await writeFile(join(copy, 'run.sh'), '#!/bin/sh\n'); await chmod(join(copy, 'run.sh'), 0o755); return 'done'; });
  await call('start_helper', { task: 'x', title: 'y' });
  await call('wait_for_helpers', {});
  await call('helper_changes', { id: 'h1', action: 'bring_back' });
  assert.equal((await lstat(join(root, 'run.sh'))).mode & 0o111, 0o111);
});
test('a worker can use its tools in its copy, and can’t reach the network, outside the sandbox, or anyone to ask', async t => {
  const { root } = await project(t);
  let offered!: string[], results: unknown[] = [];
  const provider: WorkProvider = { turn: async ({ tools, toolHandler, instructions, input }) => {
    offered = tools.map(tool => tool.name);
    assert.match(instructions, /Nobody can answer/); assert.equal(input[0].text, 'the job');
    results.push(await toolHandler({ tool: 'run_command', arguments: { command: 'curl example.com', reason: 'x', network: true } }));
    results.push(await toolHandler({ tool: 'run_command', arguments: { command: 'git push', reason: 'x', outside_sandbox: true } }));
    results.push(await toolHandler({ tool: 'write_file', arguments: { path: 'made.txt', content: 'made\n' } }));
    results.push(await toolHandler({ tool: 'run_command', arguments: { command: 'cat made.txt', reason: 'x' } }));
    return 'finished the job';
  } };
  const ran: string[] = [];
  const reply = await runWorker({ provider, settings: {}, root, task: 'the job', runCommand: async ({ command }) => { ran.push(command); return { exitCode: 0, output: 'ran' } as SandboxCommandResult; } });
  assert.equal(reply, 'finished the job');
  assert.deepEqual(offered, ['read_file', 'list_files', 'search_files', 'write_file', 'edit_file', 'run_command']);
  assert.match(text(results[0] as WorkToolResult), /can’t ask the user/); assert.match(text(results[1] as WorkToolResult), /can’t run outside the sandbox/);
  assert.deepEqual(ran, ['cat made.txt']);
  assert.equal(await readFile(join(root, 'made.txt'), 'utf8'), 'made\n');
});
test('in the real sandbox, a copy’s commands can write there, not to the project', async t => {
  if (!await sandboxWorks()) return t.skip('No sandbox on this Mac');
  const { root, place } = await project(t, { 'a.txt': 'hello\n' });
  await mkdir(join(root, '.git/hooks'), { recursive: true });
  await writeFile(join(root, '.git/config'), '[core]\n');
  const copy = await copyProject({ root, place });
  const here = await runInSandbox({ command: 'cat a.txt && echo more >> a.txt', cwd: copy.work });
  assert.equal(here.exitCode, 0, here.output);
  const there = await runInSandbox({ command: `echo bad >> ${JSON.stringify(join(root, 'a.txt'))}`, cwd: copy.work });
  assert.notEqual(there.exitCode, 0);
  const hook = await runInSandbox({ command: 'echo bad > .git/hooks/pre-commit', cwd: copy.work });
  assert.notEqual(hook.exitCode, 0);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'hello\n');
});
test('in the real sandbox, Git works on a copy’s own history and leaves the real one alone', async t => {
  if (!await sandboxWorks()) return t.skip('No sandbox on this Mac');
  const { root, place } = await project(t, { 'a.txt': 'hello\n' });
  git(root, 'init', '-q'); git(root, 'add', '-A'); git(root, 'commit', '-qm', 'start');
  const before = git(root, 'rev-parse', 'HEAD');
  const copy = await copyProject({ root, place });
  const looked = await runInSandbox({ command: 'echo more >> a.txt && git status --short && git -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qam mine && git log --oneline | wc -l', cwd: copy.work });
  assert.equal(looked.exitCode, 0, looked.output);
  assert.match(looked.output, /M a\.txt/);
  assert.equal(git(root, 'rev-parse', 'HEAD'), before);
  assert.deepEqual((await collectChanges(copy)).changes.map(change => change.path), ['a.txt'], 'a commit there doesn’t hide the change');
});
test('leftover helpers are mentioned in the next turn, and a chat’s removal clears them', async t => {
  const { root, place } = await project(t);
  const pool = new HelperPool({ place, run: async ({ root: copy }) => { await writeFile(join(copy, 'a.txt'), 'x\n'); return 'done'; } });
  const entry = await pool.start({ chat: 'chat', root, task: 'x', title: 'left over' });
  await entry.done;
  assert.deepEqual(pool.waiting('chat').map(item => item.title), ['left over']);
  const { dir } = entry.copy!;
  await pool.closeChat('chat');
  assert.equal(existsSync(dir), false);
  assert.deepEqual(pool.waiting('chat'), []);
  await writeFile(join(place, 'stale'), 'x');
  await pool.sweep();
  assert.equal(existsSync(place), false);
});
test('the instructions mention helpers only when there are some', () => {
  assert.match(workInstructions({ root: '/x', permission: 'auto', sandboxed: true, helpers: true }), /start_helper/);
  assert.doesNotMatch(workInstructions({ root: '/x', permission: 'auto', sandboxed: true }), /start_helper/);
});
test('a new checkout gets what Git ignores, apart from keys', async t => {
  const { root, place } = await project(t, { 'a.txt': 'tracked\n', '.gitignore': 'node_modules/\nbin/\n.env\n*.pem\ndata/\n', 'node_modules/dep/index.js': 'dep\n', 'node_modules/dep/.env': 'NESTED=1\n', 'bin/tool': 'tool\n', '.env': 'SECRET=1\n', 'server.pem': 'key\n', 'data/credentials.json': '{}\n', 'data/keep.txt': 'keep\n', 'untracked.txt': 'not ignored\n' });
  git(root, 'init', '-q'); git(root, 'add', '.gitignore', 'a.txt'); git(root, 'commit', '-qm', 'start');
  const to = join(place, 'checkout');
  await mkdir(to, { recursive: true });
  await writeFile(join(to, 'a.txt'), 'tracked\n');
  await mkdir(join(to, 'bin')); await writeFile(join(to, 'bin/tool'), 'already here\n');
  const copied = await copyIgnored({ from: root, to, ignored: await ignoredPaths(root) });
  assert.deepEqual(copied.sort(), ['data', 'node_modules']);
  assert.equal(await readFile(join(to, 'node_modules/dep/index.js'), 'utf8'), 'dep\n');
  assert.equal(await readFile(join(to, 'data/keep.txt'), 'utf8'), 'keep\n');
  assert.equal(await readFile(join(to, 'bin/tool'), 'utf8'), 'already here\n', 'what’s there isn’t overwritten');
  for (const key of ['.env', 'server.pem', 'node_modules/dep/.env', 'data/credentials.json']) assert.equal(existsSync(join(to, key)), false, key);
  assert.equal(existsSync(join(to, 'untracked.txt')), false);
  assert.equal(await readFile(join(root, 'node_modules/dep/.env'), 'utf8'), 'NESTED=1\n', 'the originals stay');
  assert.deepEqual(await copyIgnored({ from: root, to, ignored: null }), [], 'outside a repository there’s nothing to copy');
});
test('a checkout can be filled even if an ignored file sits at the top', async t => {
  const { root, place } = await project(t, { 'notes.log': 'log\n' });
  await mkdir(place);
  assert.deepEqual(await copyIgnored({ from: root, to: place, ignored: new Set(['notes.log']) }), ['notes.log']);
  assert.equal(await readFile(join(place, 'notes.log'), 'utf8'), 'log\n');
});
interface PortToolsOptions {
  permission?: string;
  sandboxed?: boolean;
  allowed?: Set<string>;
  answers?: string[];
}
function portTools(root: string, options: PortToolsOptions = {}) {
  const asked: Record<string, unknown>[] = [], ran: Parameters<NonNullable<WorkToolsOptions['runCommand']>>[0][] = [];
  const tools = new WorkTools({ root, permission: options.permission ?? 'auto', sandboxed: options.sandboxed ?? true, allowed: options.allowed ?? new Set(), runCommand: async run => { ran.push(run); return { exitCode: 0, output: '' } as SandboxCommandResult; }, approve: async request => { asked.push(request); return (options.answers ?? ['always']).shift() ?? 'deny'; } });
  const run = (input: Record<string, unknown>) => tools.handle({ tool: 'run_command', arguments: { command: 'npm test', reason: 'tests', ...input } });
  return { asked, ran, run };
}
test('this Mac’s own ports ask, even running on its own, and can be allowed for the chat', async t => {
  const { root } = await project(t);
  const { asked, ran, run } = portTools(root);
  await run({ local_ports: true });
  assert.equal(asked.length, 1); assert.equal(asked[0].kind, 'local'); assert.match(asked[0].note as string, /no internet/); assert.equal(asked[0].alwaysLabel, 'Allow in this chat');
  assert.equal(ran[0].loopback, true); assert.equal(ran[0].network, false);
  await run({ local_ports: true });
  assert.equal(asked.length, 1, 'it asks once');
  await run({});
  assert.equal(ran[2].loopback, false, 'a command that doesn’t ask for them doesn’t get them');
});
test('refusing the ports stops the command, and one yes covers only one', async t => {
  const { root } = await project(t);
  const refused = portTools(root, { answers: ['deny'] });
  assert.equal((await refused.run({ local_ports: true })).success, false);
  assert.deepEqual(refused.ran, []);
  const once = portTools(root, { answers: ['allow', 'deny'] });
  await once.run({ local_ports: true });
  assert.equal((await once.run({ local_ports: true })).success, false);
  assert.equal(once.ran.length, 1);
});
test('allowing the ports doesn’t allow every command in a chat that asks first', async t => {
  const { root } = await project(t);
  const { asked, ran, run } = portTools(root, { permission: 'ask', answers: ['always', 'allow', 'allow'] });
  await run({ local_ports: true });
  assert.deepEqual(asked.map(request => request.kind), ['local', 'command']);
  await run({ local_ports: true });
  assert.deepEqual(asked.map(request => request.kind), ['local', 'command', 'command']);
  assert.equal(ran.length, 2);
  const planning = portTools(root, { permission: 'plan' });
  assert.match(text(await planning.run({ local_ports: true })), /plan mode/);
});
test('the ports aren’t asked about where they’d mean nothing', async t => {
  const { root } = await project(t);
  const wide = portTools(root, { answers: ['allow'] });
  await wide.run({ network: true, local_ports: true });
  assert.equal(wide.asked[0].kind, 'network'); assert.equal(wide.ran[0].loopback, false);
  const open = portTools(root, { sandboxed: false, answers: ['allow'] });
  await open.run({ local_ports: true });
  assert.deepEqual(open.asked.map(request => request.kind), ['command']);
});
test('in the real sandbox, the ports let a test server run, and the internet stays shut', async t => {
  if (!await sandboxWorks()) return t.skip('No sandbox on this Mac');
  const { root } = await project(t);
  const script = `const http=require('node:http');const s=http.createServer((q,a)=>a.end('reached'));s.on('error',e=>{console.log('NO',e.code);process.exit(3)});s.listen(0,'127.0.0.1',()=>http.get({port:s.address().port,host:'127.0.0.1'},r=>{r.on('data',d=>console.log(String(d)));r.on('end',()=>s.close())}).on('error',e=>{console.log('NO',e.code);process.exit(4)}))`;
  await writeFile(join(root, 'server.cjs'), script);
  const shut = await runInSandbox({ command: 'node server.cjs', cwd: root });
  assert.notEqual(shut.exitCode, 0); assert.doesNotMatch(shut.output, /reached/);
  const open = await runInSandbox({ command: 'node server.cjs', cwd: root, loopback: true });
  assert.equal(open.exitCode, 0, open.output); assert.match(open.output, /reached/);
  await writeFile(join(root, 'out.cjs'), `require('node:net').connect({host:'1.1.1.1',port:443,timeout:3000}).on('connect',()=>{console.log('OUT');process.exit(0)}).on('error',e=>{console.log('NO',e.code);process.exit(5)}).on('timeout',()=>process.exit(6))`);
  const out = await runInSandbox({ command: 'node out.cjs', cwd: root, loopback: true });
  assert.notEqual(out.exitCode, 0, 'the internet is still out of reach'); assert.doesNotMatch(out.output, /OUT/);
});
test('a helper’s request for the ports reaches the user through the chat, and nothing else does', async t => {
  const { root } = await project(t);
  const asked: Record<string, unknown>[] = [], ran: Parameters<NonNullable<WorkToolsOptions['runCommand']>>[0][] = [];
  let results: unknown[] = [];
  const provider: WorkProvider = { turn: async ({ toolHandler }) => {
    results.push(await toolHandler({ tool: 'run_command', arguments: { command: 'npm test', reason: 'tests', local_ports: true } }));
    results.push(await toolHandler({ tool: 'run_command', arguments: { command: 'curl x', reason: 'x', network: true } }));
    return 'done';
  } };
  await runWorker({ provider, settings: {}, root, task: 'x', askLocal: async request => { asked.push(request); }, runCommand: async run => { ran.push(run); return { exitCode: 0, output: '' } as SandboxCommandResult; } });
  assert.equal(asked.length, 1); assert.match(asked[0].title as string, /own ports/);
  assert.equal(ran.length, 1); assert.equal(ran[0].loopback, true);
  assert.match(text(results[1] as WorkToolResult), /can’t ask the user/);
  const refused = await runWorker({ provider: { turn: async ({ toolHandler }) => text(await toolHandler({ tool: 'run_command', arguments: { command: 'npm test', reason: 'x', local_ports: true } }) as WorkToolResult) }, settings: {}, root, task: 'x', askLocal: async () => { throw new Error('The user didn’t allow this.'); }, runCommand: async () => assert.fail('it must not run') });
  assert.match(refused, /didn’t allow/);
  const noWay = await runWorker({ provider: { turn: async ({ toolHandler }) => text(await toolHandler({ tool: 'run_command', arguments: { command: 'npm test', reason: 'x', local_ports: true } }) as WorkToolResult) }, settings: {}, root, task: 'x', runCommand: async () => assert.fail('it must not run') });
  assert.match(noWay, /can’t ask the user/);
});
test('the pool passes the helper’s way of asking along', async t => {
  const { root, place } = await project(t);
  let got: unknown;
  const { call, asked } = setup(root, place, () => 'x', { permission: 'auto', pool: { run: async ({ askLocal }) => { got = askLocal; await askLocal!({ title: 'ports' }); return 'done'; } } });
  await call('start_helper', { task: 'x', title: 'y' });
  await call('wait_for_helpers', {});
  assert.equal(typeof got, 'function');
  assert.equal(asked[0].kind, 'local');
});
test('the instructions cover scratch files and local ports', () => {
  const said = workInstructions({ root: '/x', permission: 'auto', sandboxed: true });
  assert.match(said, /\$TMPDIR/); assert.match(said, /local_ports/);
});

test('a writing helper is a builder unless the lead names another role, and its row says which model took it', async t => {
  const { root, place } = await project(t);
  const roles: string[] = [];
  const { call, rows, pool } = setup(root, place, null, { pool: { run: async ({ role, onSeat }) => { roles.push(role); onSeat({ model: role === 'builder' ? 'claude-sonnet-5-5' : 'claude-haiku-5-5', role }); return 'done'; } } });
  const first = started(text(await call('start_helper', { task: 'Add the tests', title: 'Tests' })));
  const second = started(text(await call('start_helper', { task: 'Rename x to y', title: 'Rename', role: 'scout' })));
  await Promise.all([first, second].map(id => pool.get('chat', id).done));
  assert.deepEqual(roles, ['builder', 'scout']);
  const seats = [...rows.values()].filter(row => row.tool === 'worker').map(row => row.seat);
  assert.deepEqual(seats, [{ model: 'claude-sonnet-5-5', role: 'builder' }, { model: 'claude-haiku-5-5', role: 'scout' }]);
});
test('a helper’s finished work outlives a restart, can still be brought back, and only unkept copies are cleared', async t => {
  const { root, place } = await project(t);
  const pool = new HelperPool({ place, run: async ({ root: copy }) => { await writeFile(join(copy, 'a.txt'), 'changed\n'); return 'Changed a.txt'; } });
  const tools = new WorkTools({ root, permission: 'auto', sandboxed: true, owner: 'chat', helpers: pool as unknown as WorkHelpersContext, allowed: new Set(), approve: async () => 'allow' });
  await tools.handle({ tool: 'start_helper', arguments: { task: 'change a', title: 'Change a' } });
  await tools.handle({ tool: 'wait_for_helpers', arguments: {} });
  assert.equal(pool.waiting('chat').length, 1);
  const { readdir: list, mkdir: make } = await import('node:fs/promises');
  await make(join(place, 'copy-left-by-a-crash'));
  // Fairy restarts: a new pool restores what was kept.
  const again = new HelperPool({ place, run: async () => 'unused' });
  await again.restore();
  assert.deepEqual(again.waiting('chat').map(entry => [entry.id, entry.title, entry.report, entry.changes.map(change => change.path)]), [['h1', 'Change a', 'Changed a.txt', ['a.txt']]]);
  assert.ok(!(await list(place)).includes('copy-left-by-a-crash'), 'a copy nothing keeps is cleared');
  const after = new WorkTools({ root, permission: 'auto', sandboxed: true, owner: 'chat', helpers: again as unknown as WorkHelpersContext, allowed: new Set(), approve: async () => 'allow' });
  assert.equal((await after.handle({ tool: 'helper_changes', arguments: { id: 'h1', action: 'bring_back' } })).success, true);
  assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'changed\n');
  // A new helper in that chat gets the next number, and once nothing is kept, a restart keeps nothing.
  await again.closeChat('chat');
  const third = new HelperPool({ place, run: async () => 'unused' });
  await third.restore();
  assert.equal(third.list('chat').length, 0);
  assert.deepEqual((await list(place)).filter(name => name.startsWith('copy-')), []);
});
