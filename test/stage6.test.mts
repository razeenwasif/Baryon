import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rewindFiles, saveCheckpoint } from '../desktop/work-rewind.mjs';
import { SkillStore, parseSkill } from '../desktop/skills.mjs';
import { AutomationStore, dueSchedules } from '../desktop/automation.mjs';
import { ConnectorStore, McpClient, connectorToolName } from '../desktop/mcp-client.mjs';
import { SessionStore } from '../desktop/sessions.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';

async function folder(t: TestContext): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-stage6-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const chat = (text: string, at = '2026-11-02T10:00:00.000Z') => [{ role: 'user', content: text, at, mode: 'work' }, { role: 'assistant', content: `About ${text}`, at, mode: 'work' }];

test('rewinding restores what file tools changed, newest first, and removes what they created', async t => {
  const root = await folder(t), dir = join(root, '.data'), sessionId = 'chat-1', project = join(root, 'p');
  await mkdir(project);
  await writeFile(join(project, 'a.txt'), 'three');
  await writeFile(join(project, 'new.txt'), 'created');
  await saveCheckpoint({ dir, sessionId, turn: 2, journal: [{ path: 'a.txt', before: 'one', after: 'two' }] });
  await saveCheckpoint({ dir, sessionId, turn: 4, journal: [{ path: 'a.txt', before: 'two', after: 'three' }, { path: 'new.txt', before: null, after: 'created' }] });
  const later = await rewindFiles({ dir, sessionId, root: project, fromTurn: 4 });
  assert.deepEqual(later, { restored: ['a.txt', 'new.txt'], conflicts: [] });
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'two');
  assert.equal(existsSync(join(project, 'new.txt')), false);
  await rewindFiles({ dir, sessionId, root: project, fromTurn: 0 });
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'one');
});
test('a file changed since is left alone and reported', async t => {
  const root = await folder(t), dir = join(root, '.data'), project = join(root, 'p');
  await mkdir(project);
  await writeFile(join(project, 'a.txt'), 'yours now');
  await saveCheckpoint({ dir, sessionId: 'c', turn: 0, journal: [{ path: 'a.txt', before: 'one', after: 'two' }] });
  assert.deepEqual(await rewindFiles({ dir, sessionId: 'c', root: project, fromTurn: 0 }), { restored: [], conflicts: ['a.txt'] });
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'yours now');
});
test('rewinding can’t write outside the folder or through a link', async t => {
  const root = await folder(t), dir = join(root, '.data'), project = join(root, 'p');
  await mkdir(project);
  await writeFile(join(root, 'outside.txt'), 'safe');
  await symlink(join(root, 'outside.txt'), join(project, 'link.txt'));
  await saveCheckpoint({ dir, sessionId: 'c', turn: 0, journal: [{ path: '../outside.txt', before: 'evil', after: 'safe' }, { path: 'link.txt', before: 'evil', after: 'safe' }] });
  const result = await rewindFiles({ dir, sessionId: 'c', root: project, fromTurn: 0 });
  assert.deepEqual(result.restored, []);
  assert.equal(await readFile(join(root, 'outside.txt'), 'utf8'), 'safe');
  await assert.rejects(saveCheckpoint({ dir, sessionId: '../evil', turn: 0, journal: [{ path: 'a', before: '', after: '' }] }), /isn’t valid/);
  // A folder swapped for a link after the turn, pointing somewhere the file doesn't exist yet.
  const outside = join(root, 'elsewhere');
  await mkdir(outside);
  await symlink(outside, join(project, 'sub'));
  await saveCheckpoint({ dir, sessionId: 'd', turn: 0, journal: [{ path: 'sub/planted.txt', before: 'evil', after: 'x' }, { path: 'sub/deep/planted.txt', before: 'evil', after: 'x' }] });
  assert.deepEqual(await rewindFiles({ dir, sessionId: 'd', root: project, fromTurn: 0 }), { restored: [], conflicts: ['sub/planted.txt', 'sub/deep/planted.txt'] });
  assert.equal(existsSync(join(outside, 'planted.txt')), false);
  assert.equal(existsSync(join(outside, 'deep')), false);
});

test('skills expand only for a name you typed, and project skills are labelled', async t => {
  const root = await folder(t), store = new SkillStore({ dir: join(root, 'skills') }), project = join(root, 'p');
  await store.save({ name: 'review', description: 'Check a change', text: 'Read the diff carefully.' });
  await mkdir(join(project, '.fairy/skills'), { recursive: true });
  await writeFile(join(project, '.fairy/skills/deploy.md'), '---\ndescription: Ship it\n---\nRun the deploy.');
  await writeFile(join(project, '.fairy/skills/review.md'), 'A project trying to replace yours.');
  const listed = await store.list(project);
  assert.deepEqual(listed.map(skill => [skill.name, skill.source, skill.description]), [['review', 'yours', 'Check a change'], ['deploy', 'project', 'Ship it']]);
  assert.match(await store.expand('/review the auth change', project), /Read the diff carefully\.\n\nThe user's request: the auth change$/);
  assert.match(await store.expand('/deploy', project), /It comes from this project\.[\s\S]*Run the deploy\.$/);
  assert.equal(await store.expand('please /review this', project), 'please /review this');
  assert.equal(await store.expand('/unknown thing', project), '/unknown thing');
  await assert.rejects(store.save({ name: '../evil', text: 'x' }), /lowercase/);
  await assert.rejects(store.save({ name: 'empty', text: '  ' }), /instructions/);
  await store.remove('review');
  assert.equal((await store.list()).length, 0);
  assert.equal(parseSkill('x', 'no front matter').text, 'no front matter');
});

function automation(now: Date) {
  const disk: { value: any } = { value: null };
  return { disk, store: new AutomationStore({ read: async () => disk.value, write: async (value: unknown) => { disk.value = JSON.parse(JSON.stringify(value)); }, now: () => now, id: () => `id-${Math.random()}` }) };
}
test('schedules run once a day on their days, and catch up only a little', () => {
  const brief: any = { id: 'a', enabled: true, time: '09:00', days: [1], lastRun: '' }; // Mondays
  const monday = (hour: number, minute = 0) => new Date(2026, 10, 2, hour, minute);
  assert.deepEqual(dueSchedules([brief], monday(8, 59)), []);
  assert.deepEqual(dueSchedules([brief], monday(9)), [brief]);
  assert.deepEqual(dueSchedules([brief], monday(11, 30)), [brief], 'the Mac was asleep at 9');
  assert.deepEqual(dueSchedules([brief], monday(13)), [], 'too late, so it waits for next time');
  assert.deepEqual(dueSchedules([{ ...brief, lastRun: '2026-11-02' }], monday(9)), []);
  assert.deepEqual(dueSchedules([{ ...brief, days: [2] }], monday(9)), []);
  assert.deepEqual(dueSchedules([{ ...brief, enabled: false }], monday(9)), []);
});
test('hooks and schedules are checked, kept, and marked when run', async () => {
  const now = new Date(2026, 10, 2, 9, 30), { store, disk } = automation(now);
  await store.load();
  await assert.rejects(store.addHook({ folder: '/p', event: 'whenever' as any, command: 'x' }), /hook needs/);
  await assert.rejects(store.addSchedule({ prompt: 'x', time: '25:00', days: [1] }), /scheduled task/);
  await assert.rejects(store.addSchedule({ prompt: ' ', time: '09:00', days: [1] }), /scheduled task/);
  await store.addHook({ folder: '/p', event: 'after-turn', command: 'npm test' });
  await store.addSchedule({ title: 'Brief', prompt: 'Brief me', time: '09:00', days: [1] });
  assert.equal(store.hooksFor('/p', 'after-turn').length, 1);
  assert.equal(store.hooksFor('/other', 'after-turn').length, 0);
  assert.equal(store.due().length, 1);
  await store.markRun(store.schedules[0].id);
  assert.equal(store.due().length, 0);
  const again = new AutomationStore({ read: async () => disk.value, write: async () => {} });
  await again.load();
  assert.equal(again.schedules[0].lastRun, '2026-11-02');
});

test('connectors check their names and addresses', async () => {
  const store = new ConnectorStore({ read: async () => null, write: async () => {}, id: () => 'x' });
  await store.load();
  await assert.rejects(store.add({ name: 'Bad Name', kind: 'command', target: 'x' }), /lowercase/);
  await assert.rejects(store.add({ name: 'web', kind: 'url', target: 'http://example.com/mcp' }), /https/);
  await store.add({ name: 'web', kind: 'url', target: 'https://example.com/mcp' });
  await store.add({ name: 'local', kind: 'url', target: 'http://127.0.0.1:9000/mcp' });
  await assert.rejects(store.add({ name: 'web', kind: 'command', target: 'x' }), /already/);
  assert.equal(connectorToolName('my.server', 'look up'), 'c_my_server__look_up');
});
test('a connector really talks MCP over a process', async t => {
  const root = await folder(t), server = join(root, 'server.mjs');
  await writeFile(server, `import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line); if (m.id === undefined) continue;
  const reply = r => console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }));
  if (m.method === 'initialize') reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 't', version: '1' } });
  else if (m.method === 'tools/list') reply({ tools: [{ name: 'echo', description: 'Echoes', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
  else if (m.method === 'tools/call') reply({ content: [{ type: 'text', text: 'you said ' + m.params.arguments.text }], isError: m.params.arguments.text === 'bad' });
  else console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { message: 'nope' } }));
}`);
  const client = new McpClient({ connector: { name: 'demo', kind: 'command', target: `node ${JSON.stringify(server)}` } as any });
  t.after(() => client.close());
  const tools = await client.connect();
  assert.deepEqual(tools.map(tool => [tool.name, tool.remote]), [['c_demo__echo', 'echo']]);
  assert.deepEqual(await client.call('echo', { text: 'hi' }), { failed: false, text: 'you said hi' });
  assert.equal((await client.call('echo', { text: 'bad' })).failed, true);
  await assert.rejects(client.request('nothing', {}), /nope/);
});

test('a connector hands pictures to the model, and only ones the bridges can carry', async t => {
  const root = await folder(t), server = join(root, 'server.mjs');
  await writeFile(server, `import { createInterface } from 'node:readline';
const big = 'A'.repeat(8 * 1024 * 1024 + 1);
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line); if (m.id === undefined) continue;
  const reply = r => console.log(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: r }));
  if (m.method === 'initialize') reply({ protocolVersion: m.params.protocolVersion, capabilities: { tools: {} } });
  else if (m.method === 'tools/list') reply({ tools: [{ name: 'look', description: 'Looks' }] });
  else if (m.params.arguments.kind === 'mixed') reply({ content: [{ type: 'image', mimeType: 'image/jpeg', data: 'QUJD' }, { type: 'text', text: 'Screen: 10×10.' }, { type: 'image', mimeType: 'image/svg+xml', data: 'QUJD' }, { type: 'image', mimeType: 'image/png', data: 'not base64!' }, { type: 'image', mimeType: 'image/png', data: big }, { type: 'audio', mimeType: 'audio/wav', data: 'QUJD' }] });
  else reply({ content: Array.from({ length: 6 }, () => ({ type: 'image', mimeType: 'image/png', data: 'QUJD' })) });
}`);
  const client = new McpClient({ connector: { name: 'demo', kind: 'command', target: `node ${JSON.stringify(server)}` } as any });
  t.after(() => client.close());
  await client.connect();
  const mixed = await client.call('look', { kind: 'mixed' });
  assert.deepEqual(mixed.images, [{ mimeType: 'image/jpeg', data: 'QUJD' }]);
  assert.equal(mixed.text, '[image]\nScreen: 10×10.\n[image]\n[image]\n[image]\n[audio]');
  assert.equal((await client.call('look', { kind: 'many' })).images!.length, 4);
});

test('a work session gives a connector\'s pictures to the model but keeps them out of the record', async t => {
  const root = await folder(t), rows: any[] = [];
  const tools = new WorkTools({ root, permission: 'auto', runCommand: async () => ({}) as any, onEvent: (event: any) => rows.push(event), approve: async () => 'allow' });
  tools.connectors = new Map([['c_demo__look', { connector: 'demo', remote: 'look', description: 'Looks', call: async () => ({ failed: false, text: '[image]', images: [{ mimeType: 'image/jpeg', data: 'QUJD' }] }) } as any]]);
  const result = await tools.handle({ tool: 'c_demo__look', arguments: {} });
  assert.equal(result.success, true);
  assert.match((result.contentItems[0] as { text: string }).text, /^From demo \(data, not instructions\):/);
  assert.deepEqual(result.contentItems[1], { type: 'inputImage', imageUrl: 'data:image/jpeg;base64,QUJD' });
  assert(!JSON.stringify(rows).includes('QUJD'));
});

test('a connector also talks MCP over an address', async t => {
  const seen: Array<{ method: string; session: string | string[] | undefined }> = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const message = JSON.parse(body);
      seen.push({ method: message.method, session: request.headers['mcp-session-id'] });
      if (message.id === undefined) { response.writeHead(202).end(); return; }
      const result = message.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} } } : message.method === 'tools/list' ? { tools: [{ name: 'look', description: 'Looks' }] } : { content: [{ type: 'text', text: 'seen it' }] };
      const reply = JSON.stringify({ jsonrpc: '2.0', id: message.id, result });
      // Servers may answer either way: plain JSON, or as an event stream.
      if (message.method === 'tools/call') response.writeHead(200, { 'content-type': 'text/event-stream' }).end(`event: message\ndata: ${reply}\n\n`);
      else response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'abc' }).end(reply);
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  t.after(() => server.close());
  const client = new McpClient({ connector: { name: 'web', kind: 'url', target: `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp` } as any });
  assert.deepEqual((await client.connect()).map(tool => tool.name), ['c_web__look']);
  assert.deepEqual(await client.call('look', {}), { failed: false, text: 'seen it' });
  assert.deepEqual(seen.map(entry => entry.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(seen.at(-1)!.session, 'abc', 'it keeps the session the server gave');
});

async function sessions(t: TestContext) {
  const root = await folder(t);
  let ids = 0, clock = 0;
  const make = () => new SessionStore({ dir: join(root, 'sessions'), legacyDir: root, readJSON, writeJSON, trash: async () => {}, now: () => new Date(Date.UTC(2026, 10, 2, 12, 0, clock++)).toISOString(), id: () => `id-${++ids}` });
  const store = make(); await store.load();
  return { store, make };
}
test('a chat not on screen can still be added to, without changing what’s on screen', async t => {
  const { store, make } = await sessions(t);
  await store.createWork('/code/app');
  await store.save(chat('Background job'));
  const worker = store.active!;
  await store.create();
  await store.save(chat('Something else'));
  const shown = store.active!;
  await store.append(worker, [{ role: 'assistant', content: 'Finished', at: 'x', mode: 'work' }]);
  assert.equal(store.active, shown);
  assert.equal(store.history.at(-1)!.content, 'About Something else');
  assert.equal((await store.read(worker)).at(-1)!.content, 'Finished');
  assert.equal(store.find(worker)!.turns, 3);
  await store.append(shown, chat('More'));
  assert.equal(store.history.length, 4);
  const reopened = make(); await reopened.load();
  assert.equal((await reopened.read(worker)).length, 3);
});
test('a worktree stays with its chat, and a finished background chat can be added', async t => {
  const { store } = await sessions(t);
  await store.createWork('/code/app');
  await store.setWork({ isolate: true });
  assert.equal(store.work()!.isolate, true);
  await store.save(chat('Own branch'));
  const id = store.active!;
  await store.setWorkFor(id, { root: '/wt/app-1', branch: 'fairy/own-branch' });
  assert.deepEqual(store.state().work, { folder: '/code/app', permission: 'ask', isolate: true, root: '/wt/app-1', branch: 'fairy/own-branch', worktree: '/wt/app-1', gitCommon: '', name: 'app', path: '/wt/app-1' });
  const added = await store.addChat({ title: 'Morning brief', history: chat('Brief me') });
  assert.equal(store.active, id, 'what’s on screen stays');
  assert.equal(store.find(added)!.title, 'Morning brief');
  await store.truncate(id, 0);
  assert.deepEqual(store.history, []);
  await assert.rejects(store.truncate(added, 0), /Open that chat/);
});


import { createWorktree, gitPush, gitStatus, mergeBranch, mergeInfo, openPr, prStatus, removeWorktree, reviewChanges, summarizePr } from '../desktop/git-tools.mjs';
import { runInSandbox, sandboxWorks } from '../desktop/work-sandbox.mjs';
import { WorkRuns } from '../desktop/work-runs.mjs';
import { WorkTools } from '../desktop/work-tools.mjs';
import { REVIEW_HEADING, reviewPrompt, runHelper, runReview } from '../desktop/work-agent.mjs';
import { tokenCounts } from '../desktop/token-usage.mjs';
import { workMeter } from '../src/work-context.js';
import { matchItems } from '../src/command-palette.js';

function repo(path: string) {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  return git;
}
test('only one run per chat and per folder, and only a few at once', async () => {
  const seen: any[] = [], changes: any[] = [], runs = new WorkRuns({ limit: 2, onEvent: (event: any) => seen.push(event), onChange: () => changes.push(runs.summary()) });
  const first = runs.start({ session: 'a', root: '/p' });
  assert.throws(() => runs.start({ session: 'a', root: '/other' }), /still working/);
  assert.throws(() => runs.start({ session: 'b', root: '/p' }), /already working in this folder/);
  runs.start({ session: 'b', root: '/q' });
  assert.throws(() => runs.start({ session: 'c', root: '/r' }), /2 chats are already working/);
  runs.emit(first, { type: 'tool', row: { id: '1', status: 'running' } });
  runs.emit(first, { type: 'tool', row: { id: '1', status: 'done' } });
  runs.emit(first, { type: 'text', text: 'hello' });
  runs.emit(first, { type: 'approval', id: 'x', title: 'OK?' });
  assert.deepEqual(runs.summary(), { a: 'waiting', b: 'working' });
  assert.deepEqual(runs.snapshot('a'), { rows: [{ id: '1', status: 'done' }], tasks: [], text: 'hello', approvals: [{ type: 'approval', id: 'x', title: 'OK?' }] });
  assert.equal(seen.at(-1).session, 'a');
  runs.emit(first, { type: 'approval-closed', id: 'x' });
  assert.equal(runs.summary().a, 'working');
  runs.stop('a');
  assert.equal(first.controller.signal.aborted, true);
  runs.finish('a');
  assert.equal(runs.snapshot('a'), null);
  assert.equal(runs.size, 1);
  runs.runs.get('b')!.finished = Promise.resolve();
  await runs.stopAndWait(50);
  assert.equal(runs.size, 0);
});
test('a chat’s own checkout works in the sandbox without reaching what runs outside it', async t => {
  if (!await sandboxWorks()) return t.skip('This Mac’s sandbox isn’t available.');
  const root = await folder(t), project = join(root, 'project'), home = join(root, 'home');
  await mkdir(project); await mkdir(home);
  const git = repo(project);
  await writeFile(join(project, 'a.txt'), 'one\n'); await writeFile(join(project, 'mine.txt'), 'private\n');
  git('add', '.'); git('commit', '-qm', 'first');
  await writeFile(join(project, 'uncommitted.txt'), 'yours\n');
  const made = await createWorktree({ folder: project, title: 'Fix the login page!', id: () => 'abcd1234-ffff', base: join(root, 'trees') });
  assert.equal(made.branch, 'fairy/fix-the-login-page-abcd1234');
  assert.equal(made.gitCommon, join(project, '.git'));
  assert.equal(existsSync(join(made.root, 'a.txt')), true);
  assert.equal(existsSync(join(made.root, 'uncommitted.txt')), false, 'it starts from the last commit');
  const run = (command: string) => runInSandbox({ command, cwd: made.root, home, gitCommon: made.gitCommon });
  const commit = await run(`echo two >> a.txt && git add a.txt && git -c user.name=T -c user.email=t@example.com commit -qm second && git log --oneline | wc -l`);
  assert.equal(commit.exitCode, 0, commit.output);
  assert.match(commit.output, /2/);
  for (const path of [join(project, '.git/hooks/pre-commit'), join(project, '.git/config'), join(made.root, '.git'), join(project, '.git/worktrees', 'project-abcd1234', 'commondir')]) {
    const before = existsSync(path) ? await readFile(path, 'utf8') : null;
    assert.notEqual((await run(`echo planted > ${JSON.stringify(path)}`)).exitCode, 0, path);
    assert.equal(existsSync(path) ? await readFile(path, 'utf8') : null, before, path);
  }
  assert.notEqual((await run(`cat ${JSON.stringify(join(project, "mine.txt"))}`)).exitCode, 0, "the rest of your folder stays unread");
  assert.notEqual((await run(`echo no > ${JSON.stringify(join(project, 'a.txt'))}`)).exitCode, 0, 'your own folder stays out of reach');
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'one\n');
  assert.equal((await gitStatus(made.root)).branch, made.branch);
  await writeFile(join(made.root, 'wip.txt'), 'not committed\n');
  assert.equal(await removeWorktree(made), false, 'unfinished work is kept');
  assert.equal(existsSync(made.root), true);
  await rm(join(made.root, 'wip.txt'));
  assert.equal(await removeWorktree(made), true);
  assert.equal(existsSync(made.root), false);
  assert.match(git('branch', '--list', made.branch), /fix-the-login/, 'the branch stays');
});
test('a folder that can’t have its own branch says why', async t => {
  const root = await folder(t), plain = join(root, 'plain'), fresh = join(root, 'fresh');
  await mkdir(plain); await mkdir(fresh); repo(fresh);
  await assert.rejects(createWorktree({ folder: plain, title: 'x', base: join(root, 'trees') }), /isn’t a Git repository/);
  await assert.rejects(createWorktree({ folder: fresh, title: 'x', base: join(root, 'trees') }), /no commits yet/);
});
test('pull request status reads what GitHub reports, and what’s wrong when it can’t', async () => {
  assert.deepEqual(summarizePr({ number: 7, title: 'T', state: 'OPEN', isDraft: true, url: 'javascript:alert(1)', reviewDecision: 'APPROVED', statusCheckRollup: [{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }, { status: 'IN_PROGRESS', conclusion: '' }, { state: 'PENDING' }, { state: 'ERROR' }] }),
    { number: 7, title: 'T', state: 'OPEN', draft: true, url: '', review: 'APPROVED', checks: { passed: 1, failed: 2, pending: 2 } });
  const answer = (message: string) => prStatus('/x', { run: async () => { throw Object.assign(new Error(message), { missing: message === 'gone' }); } });
  assert.deepEqual(await answer('no pull requests found for branch x'), { available: true, pr: null });
  assert.match((await answer('gone')).reason!, /Install the GitHub CLI/);
  assert.match((await answer('To get started, please run: gh auth login')).reason!, /Sign in/);
  assert.match((await answer('no git remotes found')).reason!, /isn’t on GitHub/);
  const called: Array<readonly string[]> = [];
  assert.equal(await openPr('/x', { run: async (_root: string, args: readonly string[]) => { called.push(args); return 'Creating pull request\nhttps://github.com/a/b/pull/1\n'; } }), 'https://github.com/a/b/pull/1');
  assert.deepEqual(called[0], ['pr', 'create', '--fill']);
});
test('pushing publishes the branch to its remote', async t => {
  const root = await folder(t), project = join(root, 'project'), remote = join(root, 'remote.git');
  await mkdir(project);
  execFileSync('git', ['init', '-q', '--bare', remote]);
  const git = repo(project);
  await writeFile(join(project, 'a.txt'), 'one\n');
  git('add', '.'); git('commit', '-qm', 'first'); git('remote', 'add', 'origin', remote); git('checkout', '-qb', 'feature');
  assert.equal((await gitStatus(project)).upstream, false);
  assert.equal(await gitPush(project), 'feature');
  const status = await gitStatus(project);
  assert.equal(status.upstream, true);
  assert.equal(status.ahead, 0);
  assert.match(execFileSync('git', ['--git-dir', remote, 'branch'], { encoding: 'utf8' }), /feature/);
});
function fakeTools(root: string, options: { answer?: string; runCommand?: any; tools?: Record<string, any> } = {}) {
  const approvals: any[] = [];
  const tools = new WorkTools({ root, sandboxed: true, approve: async (request: any) => { approvals.push(request); return (options.answer || 'allow') as any; }, runCommand: options.runCommand, ...options.tools });
  return { tools, approvals };
}
test('file changes are journalled for rewinding, and hooks run after them', async t => {
  const root = await folder(t), commands: string[] = [], saved: number[] = [];
  await writeFile(join(root, 'a.txt'), 'one');
  const { tools } = fakeTools(root, { answer: 'allow', runCommand: async ({ command }: { command: string }) => { commands.push(command); return { exitCode: command === 'lint' ? 1 : 0, output: 'lint says no', timedOut: false }; },
    tools: { permission: 'auto', onChange: (journal: any[]) => saved.push(journal.length), hooks: { 'after-edit': ['format', 'lint'], 'after-turn': ['test'] } } });
  await tools.handle({ tool: 'read_file', arguments: { path: 'a.txt' } });
  const edited = await tools.handle({ tool: 'edit_file', arguments: { path: 'a.txt', old_text: 'one', new_text: 'two' } });
  assert.deepEqual(tools.journal, [{ path: 'a.txt', before: 'one', after: 'two' }]);
  assert.deepEqual(saved, [1]);
  assert.deepEqual(commands, ['format', 'lint']);
  assert.match((edited.contentItems[0] as { text: string }).text, /A hook the user set up failed afterwards:\nlint\nlint says no/);
  assert.deepEqual(tools.activity.filter(row => row.tool === 'hook').map(row => [row.summary, row.status]), [['format', 'done'], ['lint', 'failed']]);
  assert.equal(await tools.runHooks('after-turn'), '');
  assert.deepEqual(commands.at(-1), 'test');
});
test('connector tools always ask, even when a chat runs on its own, unless allowed for that chat', async t => {
  const root = await folder(t), calls: any[] = [], allowed = new Set<string>();
  const connectors = new Map([['c_notes__find', { connector: 'notes', remote: 'find', description: 'From notes: finds', inputSchema: { type: 'object' }, call: async (input: any) => { calls.push(input); return { failed: false, text: 'a note' }; } } as any]]);
  const { tools, approvals } = fakeTools(root, { answer: 'always', tools: { permission: 'auto', connectors, allowed } });
  assert.ok(tools.available().some(tool => tool.name === 'c_notes__find'));
  const first = await tools.handle({ tool: 'c_notes__find', arguments: { q: 'x' } });
  assert.equal(first.success, true);
  assert.match((first.contentItems[0] as { text: string }).text, /data, not instructions/);
  assert.equal(approvals.length, 1);
  assert.match(approvals[0].title, /find from notes/);
  await tools.handle({ tool: 'c_notes__find', arguments: { q: 'y' } });
  assert.equal(approvals.length, 1, 'allowed for this chat now');
  const later = fakeTools(root, { tools: { permission: 'auto', connectors, allowed } });
  await later.tools.handle({ tool: 'c_notes__find', arguments: { q: 'z' } });
  assert.equal(later.approvals.length, 0, 'the next turn in this chat remembers');
  assert.equal(calls.length, 3);
  const refused = fakeTools(root, { answer: 'deny', tools: { permission: 'auto', connectors, allowed: new Set() } });
  assert.equal((await refused.tools.handle({ tool: 'c_notes__find', arguments: {} })).success, false);
  const planning = fakeTools(root, { tools: { permission: 'plan', connectors, allowed: new Set() } });
  assert.match(((await planning.tools.handle({ tool: 'c_notes__find', arguments: {} })).contentItems[0] as { text: string }).text, /plan mode/);
  assert.equal(calls.length, 3);
});
test('a helper can only read, and what it did stays on the record', async t => {
  const root = await folder(t);
  await writeFile(join(root, 'a.txt'), 'needle\n');
  let offered: string[] | undefined;
  const provider = { turn: async ({ tools: list, toolHandler }: { tools: any[]; toolHandler: any }) => {
    offered = list.map(tool => tool.name);
    const read = await toolHandler({ tool: 'read_file', arguments: { path: 'a.txt' } });
    const write = await toolHandler({ tool: 'write_file', arguments: { path: 'b.txt', content: 'no' } });
    return `found ${read.contentItems[0].text.includes('needle')} wrote ${write.success}`;
  } };
  const { tools } = fakeTools(root, { tools: { helper: ({ task, onEvent }: { task: string; onEvent: any }) => runHelper({ provider: provider as any, settings: {} as any, root, sandboxed: true, task, onEvent }) } });
  assert.ok(tools.available().some(tool => tool.name === 'ask_helper'));
  const result = await tools.handle({ tool: 'ask_helper', arguments: { task: 'Where is the needle?' } });
  assert.deepEqual(offered, ['read_file', 'list_files', 'search_files']);
  assert.match((result.contentItems[0] as { text: string }).text, /found true wrote false/);
  assert.equal(existsSync(join(root, 'b.txt')), false);
  assert.deepEqual(tools.activity.map(row => [row.tool, row.status]), [['helper', 'done'], ['read', 'done'], ['write', 'failed']]);
  assert.ok(!fakeTools(root).tools.available().some(tool => tool.name === 'ask_helper'));
});
test('usage is read from each provider’s shape, and absent means not measured', () => {
  assert.deepEqual(tokenCounts({ input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 20 }), { input: 115, output: 20, cached: 100 });
  assert.deepEqual(tokenCounts({ inputTokens: 50, cachedInputTokens: 30, outputTokens: 5, totalTokens: 55 }), { input: 50, output: 5, cached: 30 });
  assert.deepEqual(tokenCounts({ promptTokenCount: 7, candidatesTokenCount: 3, cachedContentTokenCount: 2 }), { input: 7, output: 3, cached: 2 });
  assert.equal(tokenCounts({ something: 'else' }), null);
  assert.equal(tokenCounts(undefined), null);
  const meter = workMeter([{ role: 'user', content: 'x'.repeat(2400) }, { role: 'assistant', content: 'y', usage: { input: 100, output: 10, cached: 50 } }, { role: 'assistant', content: 'z', usage: { input: 1, output: 1, cached: 0 } }]);
  assert.deepEqual(meter, { context: 10, summarized: 0, input: 101, output: 11, cached: 50, measured: true });
  assert.equal(workMeter([{ role: 'user', content: 'hi' }]).measured, false);
});
test('the palette finds items by every word', () => {
  const items = [{ group: 'Chats', label: 'Plan for the work' }, { group: 'Commands', label: 'Start a new chat', hint: '/new' }];
  assert.deepEqual(matchItems(items, 'work plan').map(item => item.label), ['Plan for the work']);
  assert.deepEqual(matchItems(items, '/new').map(item => item.label), ['Start a new chat']);
  assert.equal(matchItems(items, '').length, 2);
  assert.equal(matchItems(items, 'nothing').length, 0);
});

async function ownBranch(t: TestContext) {
  const root = await folder(t), project = join(root, 'project');
  await mkdir(project);
  const run = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd, encoding: 'utf8' }).trim();
  run(project, 'init', '-q', '-b', 'main');
  await writeFile(join(project, 'a.txt'), 'one\n');
  await writeFile(join(project, 'b.txt'), 'two\n');
  run(project, 'add', '.'); run(project, 'commit', '-qm', 'start');
  const made = await createWorktree({ folder: project, title: 'A job', id: () => 'abcd1234-ffff', base: join(root, 'trees') });
  const work = { folder: project, root: made.root, branch: made.branch, worktree: made.worktree, gitCommon: made.gitCommon };
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: project }); execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: project });
  return { project, work, run, commitOnBranch: async (name: string, text: string) => { await writeFile(join(made.root, name), text); run(made.root, 'add', '.'); run(made.root, 'commit', '-qm', `change ${name}`); } };
}

test('a chat’s branch merges into what its folder has checked out', async t => {
  const { project, work, run, commitOnBranch } = await ownBranch(t);
  assert.deepEqual(await mergeInfo(work), { branch: work.branch, into: 'main', folder: project, commits: 0, detached: false, uncommitted: 0 });
  await commitOnBranch('a.txt', 'changed\n');
  await writeFile(join(work.root, 'loose.txt'), 'not committed\n');
  const info = await mergeInfo(work);
  assert.equal((info as any).commits, 1);
  assert.equal((info as any).uncommitted, 1);
  const merged = await mergeBranch(work);
  assert.equal(merged.into, 'main');
  assert.equal(merged.commits, 1);
  assert.equal(merged.hash, run(project, 'log', '-1', '--format=%h'));
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'changed\n');
  assert(!existsSync(join(project, 'loose.txt')), 'what isn’t committed stays behind');
  assert.equal(((await mergeInfo(work)) as any).commits, 0);
  await assert.rejects(mergeBranch(work), /nothing new to merge/);
});

test('a merge that clashes leaves the folder as it was and says what to do', async t => {
  const { project, work, run, commitOnBranch } = await ownBranch(t);
  await commitOnBranch('a.txt', 'from the chat\n');
  await writeFile(join(project, 'a.txt'), 'from main\n');
  run(project, 'add', '.'); run(project, 'commit', '-qm', 'change on main');
  const before = run(project, 'rev-parse', 'HEAD');
  await assert.rejects(mergeBranch(work), /clashes with main in 1 file: a\.txt\. Nothing was changed/);
  assert.equal(run(project, 'rev-parse', 'HEAD'), before);
  assert.equal(run(project, 'status', '--porcelain'), '');
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'from main\n');
});

test('a merge won’t overwrite uncommitted work or disturb a merge already under way', async t => {
  const { project, work, run, commitOnBranch } = await ownBranch(t);
  await commitOnBranch('a.txt', 'from the chat\n');
  await writeFile(join(project, 'a.txt'), 'my unsaved work\n');
  await assert.rejects(mergeBranch(work), /changes this merge would overwrite: a\.txt\. Nothing was changed/);
  assert.equal(await readFile(join(project, 'a.txt'), 'utf8'), 'my unsaved work\n');
  await writeFile(join(project, 'a.txt'), 'one\n');
  // A merge of the user's own, part way through: only they should end it.
  run(project, 'checkout', '-qb', 'side'); await writeFile(join(project, 'b.txt'), 'side\n'); run(project, 'commit', '-qam', 'side');
  run(project, 'checkout', '-q', 'main'); await writeFile(join(project, 'b.txt'), 'main\n'); run(project, 'commit', '-qam', 'main');
  assert.throws(() => run(project, 'merge', 'side'));
  await assert.rejects(mergeBranch(work), /already in the middle of a merge/);
  assert.equal(run(project, 'rev-parse', '--verify', 'MERGE_HEAD'), run(project, 'rev-parse', 'side'), 'their merge is still under way');
});

test('a hook written on a chat’s branch doesn’t run when it’s merged', async t => {
  const { project, work, run, commitOnBranch } = await ownBranch(t);
  run(project, 'config', 'core.hooksPath', 'hooks');
  const proof = join(project, 'hook-ran');
  await mkdir(join(work.root, 'hooks'));
  await writeFile(join(work.root, 'hooks', 'post-merge'), `#!/bin/sh\ntouch ${JSON.stringify(proof)}\n`, { mode: 0o755 });
  await commitOnBranch('a.txt', 'changed\n');
  await mergeBranch(work);
  assert(existsSync(join(project, 'hooks', 'post-merge')), 'the file itself merges');
  assert(!existsSync(proof));
});

test('merging needs a folder on a branch, and a branch that still exists', async t => {
  const { project, work, run, commitOnBranch } = await ownBranch(t);
  await commitOnBranch('a.txt', 'changed\n');
  run(project, 'checkout', '-q', '--detach');
  assert.equal(((await mergeInfo(work)) as any).detached, true);
  await assert.rejects(mergeBranch(work), /Check out a branch/);
  run(project, 'checkout', '-q', 'main');
  run(project, 'worktree', 'remove', '--force', work.worktree);
  run(project, 'branch', '-qD', work.branch);
  assert.equal(((await mergeInfo(work)) as any).gone, true);
});

test('a second opinion looks at the whole of a chat’s branch, including what isn’t committed', async t => {
  const { work, commitOnBranch } = await ownBranch(t);
  assert.equal((await reviewChanges(work))!.empty, true, 'nothing yet');
  await commitOnBranch('a.txt', 'committed change\n');
  await writeFile(join(work.root, 'b.txt'), 'uncommitted change\n');
  await writeFile(join(work.root, 'new.txt'), 'brand new\n');
  const changes = (await reviewChanges(work))!;
  assert.match(changes.what, /own branch, compared with main/);
  assert.match(changes.diff, /committed change/);
  assert.match(changes.diff, /uncommitted change/);
  assert.deepEqual(changes.untracked, ['new.txt']);
  assert.equal(changes.empty, false);
});

test('without its own branch a second opinion looks at what isn’t committed, or else the latest commit', async t => {
  const { project } = await ownBranch(t), work = { folder: project };
  const latest = (await reviewChanges(work))!;
  assert.equal(latest.what, 'the latest commit');
  assert.match(latest.diff, /^start/);
  await writeFile(join(project, 'a.txt'), 'edited\n');
  const uncommitted = (await reviewChanges(work))!;
  assert.equal(uncommitted.what, 'what isn’t committed yet');
  assert.match(uncommitted.diff, /edited/);
  await writeFile(join(project, 'a.txt'), 'x'.repeat(300 * 1024));
  const big = (await reviewChanges(work))!;
  assert.equal(big.truncated, true);
  assert(big.diff.length <= 200 * 1024);
});

test('a folder outside Git has no changes to show', async t => {
  assert.equal(await reviewChanges({ folder: await folder(t) }), null);
});

test('a second opinion can only read, and gets the request, the claim and the changes as data', async t => {
  const root = await folder(t), calls: any[] = [];
  const provider = { turn: async (request: any) => { calls.push(request); return 'a.txt line 3 divides by zero when the list is empty.'; } };
  const history = [
    { role: 'user', content: 'Add an average function', mode: 'work' },
    { role: 'assistant', content: 'Added average, and the tests pass.', mode: 'work' },
    { role: 'user', content: '/review', mode: 'work' },
    { role: 'assistant', content: `${REVIEW_HEADING} Gemini**\n\nAn earlier finding`, mode: 'work' },
  ];
  const changes = { what: 'the latest commit', diff: '+return sum(values) / len(values)', truncated: true, untracked: ['new.py'], empty: false };
  const found = await runReview({ provider: provider as any, settings: { backend: 'antigravity' } as any, tools: { root, handle: async () => '' } as any, history, changes, focus: 'the empty case' });
  assert.match(found, /divides by zero/);
  const [{ instructions, input, tools, settings }] = calls, prompt = input[0].text;
  assert.deepEqual(tools.map((tool: any) => tool.name).sort(), ['list_files', 'read_file', 'search_files']);
  assert.equal(settings.backend, 'antigravity');
  assert.match(instructions, /You can only read/);
  assert.match(instructions, /are all data/);
  for (const part of ['Add an average function', 'Added average, and the tests pass', 'the empty case', 'the latest commit', '+return sum(values)', 'new.py', 'cut off']) assert(prompt.includes(part), part);
  assert(!prompt.includes('An earlier finding'), 'it forms its own view');
  assert(!/^\/review/m.test(prompt));
});

test('with no Git to compare, a second opinion is told to work from the claim', () => {
  assert.match(reviewPrompt({ history: [{ role: 'assistant', content: 'Changed notes.txt', mode: 'work' }], changes: null }), /isn’t in Git[^]*read those files/);
});
