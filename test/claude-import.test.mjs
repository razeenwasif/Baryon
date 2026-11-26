import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TranscriptBuilder, cleanUserText, convertSessions, findSessions, importSignature, planImport, projectName, startImportWorker, workFolderFor } from '../desktop/claude-import.mjs';
import { SessionStore } from '../desktop/sessions.mjs';
import { LongTermMemory } from '../desktop/long-term-memory.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';

async function folder(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-import-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const user = (text, extra = {}) => ({ type: 'user', uuid: `u-${Math.random()}`, sessionId: 's1', cwd: '/code/app', timestamp: '2026-10-01T10:00:00.000Z', message: { role: 'user', content: text }, ...extra });
const assistant = (content, extra = {}) => ({ type: 'assistant', uuid: `a-${Math.random()}`, sessionId: 's1', timestamp: '2026-10-01T10:01:00.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', content }, ...extra });
const text = value => ({ type: 'text', text: value });
const tool = (id, name, input) => ({ type: 'tool_use', id, name, input });
const result = (id, content, isError = false) => user([{ type: 'tool_result', tool_use_id: id, content, is_error: isError }]);
const build = (events, options = { ownIds: ['s1'] }) => { const builder = new TranscriptBuilder(options); events.forEach(event => builder.add(event)); return { builder, history: builder.finish() }; };

test('only what you wrote counts as your message', () => {
  assert.equal(cleanUserText('<system-reminder>be nice</system-reminder>\nFix the bug'), 'Fix the bug');
  assert.equal(cleanUserText('<task-notification><summary>done</summary></task-notification>'), '');
  assert.equal(cleanUserText('<artifact-view-context url="x">page</artifact-view-context> Make it blue'), 'Make it blue');
  assert.equal(cleanUserText('[Request interrupted by user]'), '');
  assert.equal(cleanUserText('<pasted_content id="1">some paste</pasted_content>'), 'some paste');
  assert.equal(cleanUserText('<bash-input>npm test</bash-input><bash-stdout>ok</bash-stdout>'), '! npm test');
  assert.equal(cleanUserText('<command-name>/compact</command-name><command-message>compact</command-message><command-args>keep it short</command-args>'), '/compact keep it short');
  assert.equal(cleanUserText('<local-command-stdout>done</local-command-stdout>'), '');
  assert.equal(cleanUserText('Why does <div> break here?'), 'Why does <div> break here?');
});
test('a transcript becomes turns, with steps, and without private thinking', () => {
  const { history } = build([
    user('Fix the tests'),
    assistant([{ type: 'thinking', thinking: 'secret reasoning' }]),
    assistant([text('Looking.'), tool('t1', 'Read', { file_path: '/code/app/src/a.js' })]),
    result('t1', 'file contents that are long'),
    assistant([tool('t2', 'Bash', { command: 'npm test', description: 'Run tests' })]),
    result('t2', 'one failing', true),
    assistant([tool('t3', 'mcp__ccd_turn__update_plan', { items: [] }), tool('t4', 'Edit', { file_path: '/elsewhere/b.js' }), tool('t5', 'mcp__proton-notebook__read_source', { id: 'abc' }), tool('t6', 'Bash', { command: 'sleep 9' })]),
    result('t4', 'ok'), result('t5', 'ok'),
    assistant([text('Fixed it.')]),
    user([text('Thanks'), { type: 'image', source: {} }]),
  ]);
  assert.deepEqual(history.map(entry => [entry.role, entry.content]), [['user', 'Fix the tests'], ['assistant', 'Looking.\n\nFixed it.'], ['user', 'Thanks\n\n[An image]']]);
  assert.ok(history.every(entry => entry.mode === 'claude-code'));
  assert.ok(!JSON.stringify(history).includes('secret reasoning'));
  assert.deepEqual(history[1].activity.map(row => [row.tool, row.summary, row.status]), [['read', 'src/a.js', 'done'], ['run', 'npm test', 'failed'], ['edit', '/elsewhere/b.js', 'done'], ['read_source', 'abc', 'done'], ['run', 'sleep 9', 'failed']]);
  assert.equal(history[1].activity[0].output, undefined, 'a file’s contents aren’t copied again');
  assert.equal(history[1].activity[1].output, 'one failing');
  assert.equal(history[1].activity[1].reason, 'Run tests');
  assert.equal(history[1].at, '2026-10-01T10:01:00.000Z', 'the last thing that happened in the turn');
});
test('what the app adds is left out, and repeats only count once', () => {
  const repeat = user('Once');
  const { history } = build([
    user('The summary so far', { isCompactSummary: true }), user('hidden', { isMeta: true }), user('side', { isSidechain: true }),
    repeat, repeat,
    assistant([text('API Error')], { isApiErrorMessage: true }), assistant([text('No response')], { message: { model: '<synthetic>', content: [text('No response')] } }),
    assistant([]),
    user('<task-notification>finished</task-notification>'),
    assistant([text('Answer')]),
  ]);
  assert.deepEqual(history.map(entry => entry.content), ['Once', 'Answer']);
});
test('history copied from another session is dropped only if that session still has it', () => {
  const parentLine = user('From the parent', { sessionId: 'parent', uuid: 'p1' }), lostLine = user('Only here now', { sessionId: 'gone', uuid: 'g1' });
  const { history } = build([parentLine, assistant([text('Parent reply')], { sessionId: 'parent', uuid: 'p2' }), lostLine, user('My own question')], { ownIds: ['s1'], alreadyElsewhere: (id, uuid) => id === 'parent' && ['p1', 'p2'].includes(uuid) });
  assert.deepEqual(history.map(entry => entry.content), ['Only here now', 'My own question']);
});
test('titles and folders', async t => {
  const titled = build([{ type: 'ai-title', aiTitle: 'From the model', sessionId: 's1' }, { type: 'custom-title', customTitle: 'Named by me', sessionId: 's1' }, { type: 'custom-title', customTitle: 'Parent’s', sessionId: 'parent' }]).builder;
  assert.equal(titled.customTitle, 'Named by me');
  assert.equal(titled.aiTitle, 'From the model');
  const home = '/Users/me';
  assert.equal(projectName('/Users/me/Github/Proton/.claude/worktrees/x', home), 'Proton');
  assert.equal(projectName('/Users/me/Notebooks/optimisation/.notebook/sources', home), 'optimisation');
  assert.equal(projectName('/Users/me', home), 'Home folder');
  assert.equal(projectName('/private/tmp/claude-501/x', home), 'Temporary folders');
  assert.equal(projectName('', home), 'Unknown folder');
  const root = await folder(t), projectPath = join(root, 'home/code/app');
  await mkdir(projectPath, { recursive: true });
  const exists = path => path === projectPath || path === join(root, 'home');
  const options = { home: join(root, 'home'), exists, tempRoots: [] };
  assert.equal(workFolderFor(`${projectPath}/.claude/worktrees/gone`, options), projectPath, 'a worktree that’s gone falls back to its project');
  assert.equal(workFolderFor(join(root, 'home'), options), null, 'never the whole home folder');
  assert.equal(workFolderFor('/private/tmp/x', { home: join(root, 'home'), exists: () => true }), null, 'never a temp folder');
  assert.equal(workFolderFor('/nowhere', options), null);
});
async function fixture(t) {
  const root = await folder(t), claudeDir = join(root, 'claude'), desktopDir = join(root, 'desktop'), sessionsDir = join(root, 'sessions'), project = join(claudeDir, 'projects/-code-app'), work = join(root, 'home/code/app');
  await mkdir(join(project, 'one/subagents'), { recursive: true }); await mkdir(join(desktopDir, 'a/b'), { recursive: true }); await mkdir(sessionsDir); await mkdir(work, { recursive: true });
  const write = (name, events) => writeFile(join(project, `${name}.jsonl`), `${events.map(event => JSON.stringify(event)).join('\n')}\nnot json\n`);
  const line = (session, content, extra = {}) => user(content, { sessionId: session, cwd: work, ...extra });
  await write('aaaa-prior', [line('aaaa-prior', 'First part', { uuid: 'x1', timestamp: '2026-10-01T01:00:00.000Z' })]);
  await write('bbbb-main', [line('bbbb-main', 'Second part', { uuid: 'x2', timestamp: '2026-10-02T01:00:00.000Z' }), assistant([text('Done')], { sessionId: 'bbbb-main', timestamp: '2026-10-02T02:00:00.000Z' })]);
  await write('cccc-cli', [{ type: 'ai-title', aiTitle: 'A terminal chat', sessionId: 'cccc-cli' }, user('In the home folder', { sessionId: 'cccc-cli', cwd: join(root, 'home'), timestamp: '2026-10-03T01:00:00.000Z' })]);
  await write('dddd-fork', [line('bbbb-main', 'Second part', { uuid: 'x2' }), line('dddd-fork', 'Forked question', { timestamp: '2026-10-04T01:00:00.000Z' })]);
  await write('eeee-empty', [{ type: 'queue-operation', sessionId: 'eeee-empty' }]);
  await write('agent-old', [line('agent-old', 'An old helper')]);
  await writeFile(join(project, 'one/subagents/agent-x.jsonl'), JSON.stringify(line('sub', 'A helper')));
  await writeFile(join(desktopDir, 'a/b/local_1.json'), JSON.stringify({ cliSessionId: 'bbbb-main', priorCliSessionIds: ['aaaa-prior', 'missing'], title: 'Named in the app', originCwd: work }));
  return { root, claudeDir, desktopDir, sessionsDir, project, write, home: join(root, 'home'), work };
}
test('finds each chat once, joining what the app treats as one, and ignoring helpers', async t => {
  const { claudeDir, desktopDir } = await fixture(t);
  const { groups, paths } = await findSessions({ claudeDir, desktopDir });
  assert.deepEqual(groups.map(group => [group.id, group.files.map(file => file.id)]).sort(), [['cc-aaaa-prior', ['aaaa-prior', 'bbbb-main']], ['cc-cccc-cli', ['cccc-cli']], ['cc-dddd-fork', ['dddd-fork']], ['cc-eeee-empty', ['eeee-empty']]]);
  assert.ok(!Object.keys(paths).includes('agent-old'));
  assert.deepEqual(await findSessions({ claudeDir: join(claudeDir, 'nothing'), desktopDir: join(desktopDir, 'nothing') }), { groups: [], paths: {} });
});
test('converting writes chats, on a worker, without touching Claude Code’s files', async t => {
  const { claudeDir, desktopDir, sessionsDir, project, home, work } = await fixture(t);
  const before = await Promise.all((await readdir(project)).map(async name => [name, (await stat(join(project, name))).mtimeMs]));
  const { groups, paths } = await findSessions({ claudeDir, desktopDir });
  const progress = [], job = startImportWorker({ todo: groups, paths, sessionsDir, dataDir: join(sessionsDir, '..', 'data'), home, tempRoots: [] }, value => progress.push(value));
  const { chats, failed } = await job.done;
  assert.deepEqual(failed, []);
  assert.equal(progress.at(-1).done >= 3, true);
  const byId = Object.fromEntries(chats.map(chat => [chat.id, chat]));
  assert.equal(byId['cc-aaaa-prior'].title, 'Named in the app');
  assert.deepEqual(byId['cc-aaaa-prior'].work, { folder: work, permission: 'ask' });
  assert.equal(byId['cc-aaaa-prior'].imported.project, 'app');
  assert.equal(byId['cc-aaaa-prior'].updatedAt, '2026-10-02T02:00:00.000Z');
  assert.equal(byId['cc-cccc-cli'].title, 'A terminal chat');
  assert.equal(byId['cc-cccc-cli'].work, undefined, 'the home folder can’t be a work session');
  assert.equal(byId['cc-cccc-cli'].imported.project, 'Home folder');
  assert.equal(byId['cc-eeee-empty'].turns, 0);
  assert.deepEqual((await readdir(sessionsDir)).sort(), ['cc-aaaa-prior.json', 'cc-cccc-cli.json', 'cc-dddd-fork.json']);
  const joined = JSON.parse(await readFile(join(sessionsDir, 'cc-aaaa-prior.json'), 'utf8'));
  assert.deepEqual(joined.map(entry => entry.content), ['First part', 'Second part', 'Done']);
  const forked = JSON.parse(await readFile(join(sessionsDir, 'cc-dddd-fork.json'), 'utf8'));
  assert.deepEqual(forked.map(entry => entry.content), ['Forked question'], 'what the fork copied is in the original chat already');
  const after = await Promise.all((await readdir(project)).map(async name => [name, (await stat(join(project, name))).mtimeMs]));
  assert.deepEqual(after, before);
});
test('sessions a program ran are left out, unless the desktop app kept them as yours', async t => {
  const { claudeDir, desktopDir, sessionsDir, home, write, work } = await fixture(t);
  const helpers = [join(claudeDir, 'projects/-Users-me-Library-Application-Support-lyra-companion-fairy-claude-workspace'), join(claudeDir, 'projects/-private-tmp-claude-501-x-scratchpad-data-claude-workspace')];
  for (const dir of helpers) await mkdir(dir, { recursive: true });
  await writeFile(join(helpers[0], 'ffff-usage.jsonl'), JSON.stringify(user('/usage', { sessionId: 'ffff-usage' })));
  await writeFile(join(helpers[1], 'gggg-test.jsonl'), JSON.stringify(user('A test copy’s question', { sessionId: 'gggg-test' })));
  await writeFile(join(helpers[1], 'hhhh-kept.jsonl'), JSON.stringify(user('Asked in the app, in a scratch folder', { sessionId: 'hhhh-kept', turnOrigin: 'human' })));
  await writeFile(join(desktopDir, 'a/b/local_2.json'), JSON.stringify({ cliSessionId: 'hhhh-kept', title: 'A scratch chat', cwd: '/private/tmp/x' }));
  await write('iiii-probe', [user('Use the Bash tool once to run exactly this command', { sessionId: 'iiii-probe', cwd: work, turnOrigin: 'sdk', promptSource: 'sdk' })]);
  await write('jjjj-typed', [user('Typed in the terminal', { sessionId: 'jjjj-typed', cwd: work, turnOrigin: 'human' })]);
  const { groups, paths } = await findSessions({ claudeDir, desktopDir });
  const ids = groups.map(group => group.id);
  assert.ok(!ids.includes('cc-ffff-usage') && !ids.includes('cc-gggg-test'), 'Fairy’s own calls and test copies');
  assert.ok(ids.includes('cc-hhhh-kept'), 'the app kept it, so it’s yours wherever it ran');
  const { chats } = await convertSessions({ todo: groups.filter(group => ['cc-hhhh-kept', 'cc-iiii-probe', 'cc-jjjj-typed'].includes(group.id)), paths, sessionsDir, dataDir: join(sessionsDir, '..', 'data'), home, tempRoots: [] });
  const turns = Object.fromEntries(chats.map(chat => [chat.id, chat.turns]));
  assert.deepEqual(turns, { 'cc-hhhh-kept': 1, 'cc-iiii-probe': 0, 'cc-jjjj-typed': 1 }, 'a program’s prompts alone don’t make a chat');
});
test('a chat you deleted stays deleted, and one you carried on with stays as you left it', () => {
  const group = (id, size) => ({ id, files: [{ id, size, mtimeMs: 1 }] });
  const groups = [group('new', 1), group('same', 1), group('grown', 2), group('deleted', 2), group('continued', 2), group('open', 2), group('empty', 2)];
  const manifest = { same: { signature: importSignature(group('same', 1)), turns: 4 }, grown: { signature: 'old', turns: 4 }, deleted: { signature: 'old', turns: 4 }, continued: { signature: 'old', turns: 4 }, open: { signature: 'old', turns: 4 }, empty: { signature: 'old', turns: 0 } };
  const sessions = { same: { turns: 4 }, grown: { turns: 4 }, continued: { turns: 6 }, open: { turns: 4 } };
  const { todo, kept } = planImport(groups, manifest, { sessionById: id => sessions[id] || null, busy: id => id === 'open' });
  assert.deepEqual(todo.map(entry => entry.id), ['new', 'grown', 'empty']);
  assert.deepEqual(kept, ['deleted', 'continued', 'open']);
});
async function store(t) {
  const root = await folder(t);
  let ids = 0, clock = 0;
  const make = () => new SessionStore({ dir: join(root, 'sessions'), legacyDir: root, readJSON, writeJSON, trash: async () => {}, now: () => new Date(Date.UTC(2026, 10, 2, 12, 0, clock++)).toISOString(), id: () => `id-${++ids}` });
  const sessions = make();
  await sessions.load();
  return { sessions, make };
}
const imported = (id, project = 'app', turns = 2) => ({ id, title: `Chat ${id}`, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z', turns, imported: { from: 'claude-code', project, turns } });
test('imported chats go in a closed folder for each project, and importing again doesn’t duplicate them', async t => {
  const { sessions, make } = await store(t);
  await sessions.create();
  await sessions.save([{ role: 'user', content: 'Mine', at: '2026-11-01T00:00:00.000Z', mode: 'chat' }]);
  const mine = sessions.active;
  for (const id of ['cc-a', 'cc-b', 'cc-c']) await writeJSON(join(sessions.dir, `${id}.json`), []);
  assert.equal(await sessions.addImported([imported('cc-a'), imported('cc-b', 'other')]), 2);
  assert.equal(sessions.active, mine, 'what’s on screen stays');
  assert.deepEqual(sessions.folders.map(entry => [entry.name, entry.collapsed]), [['app', true], ['other', true]]);
  assert.equal(sessions.find('cc-a').folder, sessions.folders[0].id);
  assert.equal(sessions.find('cc-b').folder, sessions.folders[1].id);
  await sessions.rename('cc-a', 'My name for it');
  await sessions.pin('cc-a', true);
  assert.equal(await sessions.addImported([imported('cc-a', 'app', 8), imported('cc-c')]), 1);
  assert.equal(sessions.folders.length, 2);
  assert.equal(sessions.find('cc-c').folder, sessions.folders[0].id, 'joins its project’s folder');
  assert.equal(sessions.find('cc-a').title, 'My name for it');
  assert.equal(sessions.find('cc-a').pinned, true);
  assert.equal(sessions.find('cc-a').turns, 8);
  const again = make(); await again.load();
  assert.equal(again.find('cc-c').imported.project, 'app');
  assert.equal(again.sessions.length, 4);
});
test('a project uses a folder you already have by that name', async t => {
  const { sessions } = await store(t);
  await sessions.createFolder('Proton');
  const [mine] = sessions.folders;
  await writeJSON(join(sessions.dir, 'cc-a.json'), []);
  await sessions.addImported([imported('cc-a', 'proton')]);
  assert.equal(sessions.folders.length, 1);
  assert.equal(sessions.find('cc-a').folder, mine.id);
  assert.equal(mine.collapsed, false, 'left as you had it');
});
test('chats in the old shared folder move to their projects once, and the rest stay put', async t => {
  const { sessions, make } = await store(t);
  await sessions.createFolder('Claude Code');
  await sessions.createFolder('Mine');
  const [old, mine] = sessions.folders;
  for (const [id, updatedAt] of [['cc-a', '2026-10-01'], ['cc-b', '2026-10-03'], ['cc-c', '2026-10-02'], ['cc-moved', '2026-10-04']]) {
    await writeJSON(join(sessions.dir, `${id}.json`), []);
    sessions.sessions.push({ ...imported(id, id === 'cc-b' ? 'other' : 'app'), updatedAt: `${updatedAt}T00:00:00.000Z`, folder: id === 'cc-moved' ? mine.id : old.id, pane: { open: false, tab: '', view: null } });
  }
  sessions.importsSorted = false;
  await sessions.saveIndex();
  const after = make(); await after.load();
  assert.deepEqual(after.folders.map(entry => [entry.name, entry.collapsed]), [['Mine', false], ['other', true], ['app', true]], 'emptied, then newest project first');
  const named = id => after.folders.find(entry => entry.id === after.find(id).folder).name;
  assert.deepEqual(['cc-a', 'cc-b', 'cc-c', 'cc-moved'].map(named), ['app', 'other', 'app', 'Mine']);
  await after.createFolder('Claude Code');
  await after.move('cc-a', after.folders.at(-1).id);
  const later = make(); await later.load();
  assert.equal(later.folders.find(entry => entry.id === later.find('cc-a').folder).name, 'Claude Code', 'a folder you name that later is yours');
});
test('a project’s new chats join the folder you keep its others in, after you rename or merge it', async t => {
  const { sessions } = await store(t);
  for (const id of ['cc-a', 'cc-b', 'cc-c', 'cc-d', 'cc-e', 'cc-f']) await writeJSON(join(sessions.dir, `${id}.json`), []);
  await sessions.addImported([imported('cc-a', 'Proton'), imported('cc-b', 'Aether'), imported('cc-c', 'Fairy')]);
  const [proton, aether, lyra] = sessions.folders;
  await sessions.renameFolder(proton.id, 'Proton & Aether');
  await sessions.move('cc-b', proton.id);
  await sessions.removeFolder(aether.id);
  await sessions.renameFolder(lyra.id, 'Fairy');
  await sessions.addImported([imported('cc-d', 'aether'), imported('cc-e', 'Fairy'), imported('cc-f', 'Proton')]);
  assert.deepEqual(sessions.folders.map(entry => entry.name), ['Proton & Aether', 'Fairy'], 'no new folders');
  assert.deepEqual(['cc-d', 'cc-e', 'cc-f'].map(id => sessions.find(id).folder), [proton.id, lyra.id, proton.id]);
});
test('notebook chats go under Notebooks, apart from a course of the same name', async t => {
  const { sessions, make } = await store(t);
  for (const id of ['cc-new', 'cc-course', 'cc-old']) await writeJSON(join(sessions.dir, `${id}.json`), []);
  await sessions.addImported([{ ...imported('cc-new', 'hpc'), imported: { from: 'claude-code', project: 'hpc', turns: 2, notebook: true } }, imported('cc-course', 'HPC')]);
  assert.deepEqual(sessions.folders.map(entry => [entry.name, entry.section]), [['hpc', 'notebooks'], ['HPC', undefined]]);
  const before = make(); await before.load();
  assert.equal(before.folders[0].section, 'notebooks', 'kept across a restart');
  assert.equal(before.find('cc-new').imported.notebook, true);
  // Imported before chats knew: the folder it carries on in says so.
  await sessions.createFolder('Claude Code');
  const old = sessions.folders.at(-1);
  sessions.sessions.push({ ...imported('cc-old', 'optimisation'), work: { folder: '/Users/me/Github/Notebooks/optimisation/.notebook/sources', permission: 'ask' }, folder: old.id, pane: { open: false, tab: '', view: null } });
  sessions.importsSorted = false;
  await sessions.saveIndex();
  const after = make(); await after.load();
  const folder = after.folders.find(entry => entry.id === after.find('cc-old').folder);
  assert.deepEqual([folder.name, folder.section], ['optimisation', 'notebooks']);
  assert.equal(after.state().sessions.find(session => session.id === 'cc-old').work, 'optimisation', 'named after the notebook');
});
test('the old shared folder stays if something else is in it', async t => {
  const { sessions, make } = await store(t);
  await sessions.createFolder('Claude Code');
  const [old] = sessions.folders;
  await sessions.create();
  await sessions.save([{ role: 'user', content: 'Mine', at: '2026-11-01T00:00:00.000Z', mode: 'chat' }]);
  await sessions.move(sessions.active, old.id);
  await writeJSON(join(sessions.dir, 'cc-a.json'), []);
  sessions.sessions.push({ ...imported('cc-a'), folder: old.id, pane: { open: false, tab: '', view: null } });
  sessions.importsSorted = false;
  await sessions.saveIndex();
  const after = make(); await after.load();
  assert.deepEqual(after.folders.map(entry => entry.name), ['Claude Code', 'app']);
  assert.equal(after.find('cc-a').folder, after.folders[1].id);
});
test('imported chats stay out of reflection until you carry them on', async t => {
  const { sessions } = await store(t);
  const entry = (role, content, at, mode) => ({ role, content, at, mode });
  await sessions.create();
  await sessions.save([entry('user', 'Companion chat', '2026-11-01T00:00:00.000Z', 'chat')]);
  await writeJSON(join(sessions.dir, 'cc-a.json'), [entry('user', 'Coding question', '2026-11-01T01:00:00.000Z', 'claude-code'), entry('assistant', 'Coding answer', '2026-11-01T01:00:01.000Z', 'claude-code')]);
  await sessions.addImported([imported('cc-a')]);
  assert.deepEqual((await sessions.allHistory()).map(item => item.content), ['Companion chat'], 'not even read while it’s untouched');
  await sessions.open('cc-a');
  await sessions.save([...sessions.history, entry('user', 'Carrying on', '2026-11-02T00:00:00.000Z', 'chat')]);
  const memory = new LongTermMemory({ read: async () => null, write: async () => {} });
  await memory.load();
  const { turns } = memory.reflectionPrompt(await sessions.allHistory());
  assert.deepEqual(turns.map(turn => turn.content), ['Companion chat', 'Carrying on'], 'only what was said here');
});
