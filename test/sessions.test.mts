import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionStore, titleFor, type HistoryEntry, type SessionStoreState } from '../desktop/sessions.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { arrangeSessions, type SessionSummary } from '../src/session-list.js';
import { SIDEBAR_DEFAULT, sidebarWidth } from '../src/sidebar-resize.js';

const turn = (role: string, content: string, at: string, mode = 'chat'): HistoryEntry => ({ role, content, at, mode });
const chat = (question: string, at = '2026-11-02T10:00:00.000Z'): HistoryEntry[] => [turn('user', question, at), turn('assistant', `About ${question}`, at)];
async function setup(t: TestContext, files: Record<string, unknown> = {}) {
  const legacyDir = await mkdtemp(join(tmpdir(), 'fairy-sessions-')), dir = join(legacyDir, 'sessions'), trashed: string[] = [];
  t.after(() => rm(legacyDir, { recursive: true, force: true }));
  for (const [name, value] of Object.entries(files)) await writeFile(join(legacyDir, name), typeof value === 'string' ? value : JSON.stringify(value));
  let clock = 0, ids = 0;
  const make = () => new SessionStore({ dir, legacyDir, readJSON, writeJSON, trash: async path => { await access(path); trashed.push(path); await rm(path); },
    now: () => new Date(Date.UTC(2026, 10, 2, 12, 0, clock++)).toISOString(), id: () => `id-${++ids}` });
  const store = make(); await store.load();
  return { store, make, dir, legacyDir, trashed };
}

test('your existing conversation becomes a chat, and the original file is left alone', async t => {
  const history = chat('Plan my week', '2026-09-19T11:59:37.153Z');
  const { store, make, legacyDir } = await setup(t, { 'history.json': history });
  assert.deepEqual(store.history, history);
  assert.equal(store.state().sessions[0].title, 'Earlier conversations');
  assert.equal(store.state().active, 'earlier');
  assert.deepEqual(JSON.parse(await readFile(join(legacyDir, 'history.json'), 'utf8')), history);
  const reopened = make(); await reopened.load();
  assert.equal(reopened.sessions.length, 1, 'importing only happens once');
  assert.deepEqual(reopened.history, history);
});

test('old New chat backups become chats named after what was asked', async t => {
  const { store } = await setup(t, { 'history.json': chat('Current'), 'history-backup-1700000000000.json': chat('Thesis outline', '2026-01-01T00:00:00.000Z') });
  const backup = store.state().sessions.find(session => session.id === 'backup-1700000000000')!;
  assert.equal(backup.title, 'Thesis outline');
  await store.open(backup.id);
  assert.equal(store.history[0].content, 'Thesis outline');
});

test('an unreadable old file stops the import rather than dropping it silently', async t => {
  const legacyDir = await mkdtemp(join(tmpdir(), 'fairy-sessions-'));
  t.after(() => rm(legacyDir, { recursive: true, force: true }));
  await writeFile(join(legacyDir, 'history.json'), '{ not json');
  const store = new SessionStore({ dir: join(legacyDir, 'sessions'), legacyDir, readJSON, writeJSON, trash: async () => {} });
  await assert.rejects(store.load());
  assert.equal(await readFile(join(legacyDir, 'history.json'), 'utf8'), '{ not json');
});

test('a new chat is only written once something is said', async t => {
  const { store, dir } = await setup(t);
  await store.create();
  assert.deepEqual(store.history, []);
  assert.deepEqual((await readdir(dir)).filter(file => file !== 'index.json'), []);
  const history = chat('What is DTW?');
  await store.save(history);
  assert.equal(store.state().sessions.length, 1);
  assert.equal(store.state().sessions[0].title, 'What is DTW?');
  assert.deepEqual(await store.read(store.active!), history);
});

test('chats keep their own histories when you move between them', async t => {
  const { store, make } = await setup(t);
  await store.save(chat('First'));
  const first = store.active!;
  await store.create();
  await store.save(chat('Second'));
  const second = store.active!;
  assert.notEqual(first, second);
  await store.open(first);
  assert.equal(store.history[0].content, 'First');
  await store.save([...store.history, ...chat('More')]);
  await store.open(second);
  assert.equal(store.history.length, 2);
  const reopened = make(); await reopened.load();
  assert.equal(reopened.active, second, 'a restart returns to the same chat');
  assert.equal((await reopened.read(first)).length, 4);
});

test('a chat you named keeps its name; others follow what was first asked', async t => {
  const { store } = await setup(t);
  await store.save([turn('assistant', 'A thought from Fairy', 'a', 'proactive')]);
  assert.equal(store.find(store.active!).title, 'A thought from Fairy');
  await store.save([...store.history, ...chat('Now a real question')]);
  assert.equal(store.find(store.active!).title, 'Now a real question');
  await store.rename(store.active!, '  My   thesis ');
  await store.save([...store.history, ...chat('Another')]);
  assert.equal(store.find(store.active!).title, 'My thesis');
  await assert.rejects(store.rename(store.active!, '   '), /name/);
  assert.equal(titleFor([]), 'New chat');
});

test('ids from the window must be chats that exist, so they can’t reach other files', async t => {
  const { store } = await setup(t);
  for (const bad of ['../keys', '../../secret', 'missing']) {
    await assert.rejects(store.open(bad), /no longer here/);
    await assert.rejects(store.remove(bad), /no longer here/);
  }
});

test('a tampered index can’t point a chat at another file', async t => {
  const { store, make, dir, legacyDir } = await setup(t);
  await store.save(chat('Real'));
  const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8')) as { sessions: Array<Record<string, unknown>> };
  index.sessions[0].source = '../keys.json';
  index.sessions.push({ id: '../keys', title: 'Bad' });
  await writeFile(join(dir, 'index.json'), JSON.stringify(index));
  await writeFile(join(legacyDir, 'keys.json'), 'secret');
  const reopened = make(); await reopened.load();
  assert.equal(reopened.sessions.length, 1);
  assert.equal(reopened.sessions[0].source, undefined);
});

test('deleting goes to the Trash, including the file a chat was imported from', async t => {
  const { store, legacyDir, dir, trashed } = await setup(t, { 'history.json': chat('Old') });
  await store.remove('earlier');
  assert.deepEqual(trashed.sort(), [join(dir, 'earlier.json'), join(legacyDir, 'history.json')].sort());
  assert.equal(store.active, null);
  assert.deepEqual(store.history, []);
  assert.deepEqual(store.state().sessions, []);
});

test('several chats go to the Trash together, and one that can’t go stays', async t => {
  const { store, dir } = await setup(t);
  const ids: string[] = [];
  for (const text of ['One', 'Two', 'Three', 'Four']) { await store.create(); await store.save(chat(text)); ids.push(store.active!); }
  const trash = store.trash;
  store.trash = async path => { if (path.includes(ids[1])) throw new Error('Trash unavailable'); return trash(path); };
  const { removed, failed } = await store.removeMany([ids[0], ids[1], ids[3], 'gone']);
  assert.deepEqual(removed.sort(), [ids[0], ids[3]].sort());
  assert.deepEqual(failed.map(entry => entry.id).sort(), [ids[1], 'gone'].sort());
  assert.equal(failed.find(entry => entry.id === ids[1])!.message, 'Trash unavailable');
  assert.deepEqual(store.state().sessions.map(session => session.id).sort(), [ids[1], ids[2]].sort());
  assert.equal(store.active, null, 'the chat on screen was one of them');
  assert.deepEqual(store.history, []);
  const saved = (await store.readJSON(join(dir, 'index.json'), null)) as SessionStoreState;
  assert.deepEqual(saved.sessions.map(session => session.id).sort(), [ids[1], ids[2]].sort());
});

test('deleting other chats leaves the one on screen alone', async t => {
  const { store } = await setup(t);
  await store.create(); await store.save(chat('Other'));
  const other = store.active!;
  await store.create(); await store.save(chat('On screen'));
  const showing = store.active!;
  await store.removeMany([other]);
  assert.equal(store.active, showing);
  assert.equal(store.history[0].content, 'On screen');
});

test('a failed Trash keeps the chat', async t => {
  const { store } = await setup(t);
  await store.save(chat('Keep me'));
  const id = store.active!;
  store.trash = async () => { throw new Error('Trash unavailable'); };
  await assert.rejects(store.remove(id), /Trash unavailable/);
  assert.equal(store.active, id);
  assert.equal(store.history[0].content, 'Keep me');
});

test('folders hold chats, and deleting one puts its chats back in the list', async t => {
  const { store, make } = await setup(t);
  await store.save(chat('In a folder'));
  const id = store.active!;
  await store.createFolder('Thesis');
  const folder = store.folders[0].id;
  await store.move(id, folder);
  await store.collapseFolder(folder, true);
  await store.renameFolder(folder, 'Dissertation');
  let reopened = make(); await reopened.load();
  assert.equal(reopened.find(id).folder, folder);
  assert.equal(reopened.folder(folder).name, 'Dissertation');
  assert.equal(reopened.folder(folder).collapsed, true);
  await assert.rejects(store.move(id, 'nope'), /no longer here/);
  await store.removeFolder(folder);
  assert.equal(store.find(id).folder, null);
  assert.equal(store.folders.length, 0);
});

test('each chat remembers its side pane, and a new chat inherits the one you opened in it', async t => {
  const { store } = await setup(t);
  await store.setPane({ open: true, tab: 'outline' });
  await store.save(chat('First'));
  const first = store.active!;
  assert.deepEqual(store.state().pane, { open: true, tab: 'outline', view: null, layout: null });
  await store.create();
  assert.deepEqual(store.state().pane, { open: false, tab: '', view: null, layout: null });
  await store.save(chat('Second'));
  assert.equal(store.state().pane.open, false);
  await store.open(first);
  assert.equal(store.state().pane.open, true);
  await store.setPane({ open: true, tab: 'artifacts', view: { artifact: 'page-1', seq: 2 } });
  assert.deepEqual(store.state().pane.view, { artifact: 'page-1', seq: 2 });
  await store.setPane({ open: true, tab: 'artifacts', view: { artifact: 5 } as any });
  assert.equal(store.state().pane.view, null);
  // Up to three panes, as laid out, kept with the chat (src/pane-layout.js cleans it).
  await store.setPane({ open: true, tab: 'terminal', layout: { dir: 'row', items: [{ tab: 'artifacts' }, { dir: 'col', items: [{ tab: 'terminal' }, { tab: 'simulator' }], sizes: [1, 1] }], sizes: [0.6, 0.4] } });
  assert.deepEqual(store.state().pane.layout, { dir: 'row', items: [{ tab: 'artifacts' }, { dir: 'col', items: [{ tab: 'terminal' }, { tab: 'simulator' }], sizes: [0.5, 0.5] }], sizes: [0.6, 0.4] });
});

test('search looks through every chat and says where it matched', async t => {
  const { store } = await setup(t);
  await store.save(chat('Calendar for Friday'));
  await store.create();
  await store.save(chat('Sprite sheets'));
  const found = await store.search('FRIDAY');
  assert.equal(found.length, 1);
  assert.equal(found[0].title, 'Calendar for Friday');
  assert.equal(found[0].snippet, '', 'the title already shows the match');
  assert.match((await store.search('about sprite'))[0].snippet, /About Sprite sheets/);
  assert.deepEqual(await store.search('   '), []);
  assert.deepEqual(await store.search('nothing here'), []);
});

test('a damaged index is rebuilt from the chats on disk', async t => {
  const { store, make, dir } = await setup(t, { 'history.json': chat('Imported') });
  await store.create();
  await store.save(chat('Newer'));
  const id = store.active!;
  await writeFile(join(dir, 'index.json'), '{ broken');
  const reopened = make(); await reopened.load();
  assert.deepEqual(new Set(reopened.sessions.map(session => session.id)), new Set(['earlier', id]));
  assert.equal(reopened.find(id).title, 'Newer');
  assert.equal(reopened.sessions.filter(session => session.id === 'earlier').length, 1);
});

test('a work session keeps its folder and permission mode, and isn’t written until something is said', async t => {
  const { store, make, dir } = await setup(t);
  await store.createWork('/Users/me/code/app');
  assert.deepEqual(store.state().work, { folder: '/Users/me/code/app', permission: 'ask', name: 'app', path: '/Users/me/code/app' });
  assert.deepEqual((await readdir(dir)).filter(file => file !== 'index.json'), []);
  await store.setPermission('plan');
  await store.save(chat('Fix the tests'));
  const id = store.active!;
  assert.equal(store.state().sessions[0].work, 'app');
  await store.setPermission('auto');
  await store.setPermission('nonsense');
  assert.equal(store.work()!.permission, 'ask', 'anything unknown falls back to asking');
  await store.setPermission('plan');
  await store.create();
  assert.equal(store.work(), null);
  assert.equal(store.state().work, null);
  await assert.rejects(store.setPermission('auto'), /isn’t a work session/);
  const reopened = make(); await reopened.load();
  await reopened.open(id);
  assert.deepEqual(reopened.work(), { folder: '/Users/me/code/app', permission: 'plan' });
  await reopened.createWork('/x');
  await reopened.open(id);
  assert.equal(reopened.work()!.folder, '/Users/me/code/app', 'a draft doesn’t linger');
});

test('the sidebar’s width stays usable, and leaves the chat room', () => {
  assert.equal(sidebarWidth(320), 320);
  assert.equal(sidebarWidth(50), 200);
  assert.equal(sidebarWidth(5000), 440);
  assert.equal(sidebarWidth(380, 820), 380);
  assert.equal(sidebarWidth(440, 700), 268);
  assert.equal(sidebarWidth('nonsense'), SIDEBAR_DEFAULT);
  assert.equal(sidebarWidth('300'), 300);
});

test('a chat whose file has gone leaves the list', async t => {
  const { store, make, dir } = await setup(t);
  await store.save(chat('Gone'));
  await rm(join(dir, `${store.active}.json`));
  const reopened = make(); await reopened.load();
  assert.equal(reopened.sessions.length, 0);
  assert.equal(reopened.active, null);
});

test('reflection can read every chat in time order', async t => {
  const { store } = await setup(t);
  await store.save(chat('Second', '2026-11-02T10:00:00.000Z'));
  await store.create();
  await store.save(chat('First', '2026-11-01T10:00:00.000Z'));
  const all = await store.allHistory();
  assert.deepEqual(all.filter(entry => entry.role === 'user').map(entry => entry.content), ['First', 'Second']);
  assert.equal(all.length, 4);
});

test('the sidebar shows pinned chats, then folders, then the rest, newest first', () => {
  const sessions: SessionSummary[] = [
    { id: 'old', title: 'Old', updatedAt: '2026-01-01', folder: null },
    { id: 'new', title: 'New', updatedAt: '2026-03-01', folder: null },
    { id: 'pin', title: 'Pinned', updatedAt: '2026-02-01', pinned: true, folder: 'f' },
    { id: 'in', title: 'In folder', updatedAt: '2026-02-01', folder: 'f' },
    { id: 'lost', title: 'Lost', updatedAt: '2026-04-01', folder: 'gone' },
  ];
  const { pinned, folders, rest } = arrangeSessions({ sessions, folders: [{ id: 'f', name: 'Thesis' }] });
  assert.deepEqual(pinned.map(session => session.id), ['pin']);
  assert.deepEqual(folders[0].sessions.map(session => session.id), ['in']);
  assert.deepEqual(rest.map(session => session.id), ['lost', 'new', 'old']);
});

test('nothing on disk needs the sessions folder to exist first', async t => {
  const legacyDir = await mkdtemp(join(tmpdir(), 'fairy-sessions-'));
  t.after(() => rm(legacyDir, { recursive: true, force: true }));
  await mkdir(legacyDir, { recursive: true });
  const store = new SessionStore({ dir: join(legacyDir, 'sessions'), legacyDir, readJSON, writeJSON, trash: async () => {} });
  await store.load();
  assert.deepEqual(store.state().sessions, []);
});

test('a status update during a reply doesn’t redraw the chat and lose the message just sent', () => {
  const renderer = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  assert.match(renderer, /if \(!busy && !workSending && drawnHistory !== historySignature\(\)\) renderHistory\(\);/);
  assert.match(renderer, /message\(entry\.role, entry\.content, entry\.mode, \{ drawingAll: true[,} ]/, 'drawing a chat doesn’t lay out and refresh the panel per message');
});

test('a work session started from another app is added off screen and named by its first message', async t => {
  const { store, make } = await setup(t);
  await store.create();
  const id = await store.addWork({ folder: '/Users/me/OnyxVault', permission: 'auto' });
  assert.equal(store.active, null);
  assert.deepEqual(store.find(id).work, { folder: '/Users/me/OnyxVault', permission: 'auto' });
  await store.append(id, [turn('user', 'Link the eigenvalue notes', '2026-11-02T12:00:00.000Z', 'work')]);
  assert.equal(store.find(id).title, 'Link the eigenvalue notes');
  const again = make(); await again.load();
  assert.equal(again.state().sessions.find(s => s.id === id)!.work, 'OnyxVault');
});

test('sections group folders in the order you drag them, and deleting one keeps its folders', async t => {
  const { store, make } = await setup(t);
  await store.save(chat('A chat'));
  const id = store.active!;
  for (const name of ['Papers', 'Code', 'Notes']) await store.createFolder(name);
  const [papers, code, notes] = store.folders.map(folder => folder.id);
  await store.move(id, papers);
  await store.createCategory('Research');
  await store.createCategory('Development');
  const [research, development] = store.categories.map(category => category.id);
  await store.placeFolder(papers, { category: research });
  await store.placeFolder(notes, { category: research, before: papers });
  await store.placeFolder(code, { category: development });
  await store.placeCategory(development, research);
  await store.collapseCategory(research, true);
  await store.renameCategory(research, 'Reading');
  const reopened = make(); await reopened.load();
  assert.deepEqual(reopened.categories.map(category => category.name), ['Development', 'Reading']);
  assert.deepEqual(reopened.folders.map(folder => [folder.name, folder.category]), [['Notes', research], ['Papers', research], ['Code', development]]);
  assert.equal(reopened.category(research).collapsed, true);
  assert.equal(reopened.find(id).folder, papers);
  // Dropped on itself, a folder stays where it is.
  await store.placeFolder(notes, { category: research, before: notes });
  assert.deepEqual(store.folders.map(folder => folder.name), ['Notes', 'Papers', 'Code']);
  await assert.rejects(store.placeFolder(code, { category: 'nope' }), /no longer here/);
  await store.removeCategory(research);
  assert.deepEqual(store.folders.map(folder => folder.category ?? null), [null, null, development]);
  assert.equal(store.find(id).folder, papers);
  // Out of a section, just above another folder.
  await store.placeFolder(code, { category: null, before: notes });
  assert.deepEqual(store.folders.map(folder => [folder.name, folder.category ?? null]), [['Code', null], ['Notes', null], ['Papers', null]]);
});

test('the list shows sections with their folders, then folders in no section', () => {
  const sessions: SessionSummary[] = [{ id: 'a', folder: 'f1', updatedAt: '2' }, { id: 'b', folder: 'f2', updatedAt: '1' }, { id: 'c', updatedAt: '3' }];
  const { categories, folders, rest } = arrangeSessions({ sessions, folders: [{ id: 'f1', name: 'Papers', category: 's' }, { id: 'f2', name: 'Loose' }, { id: 'f3', name: 'Lost', category: 'gone' }], categories: [{ id: 's', name: 'Research' }] });
  assert.deepEqual(categories.map(category => [category.name, category.folders.map(folder => folder.name)]), [['Research', ['Papers']]]);
  assert.deepEqual(categories[0].folders[0].sessions.map(session => session.id), ['a']);
  // A folder whose section has gone shows with the loose ones rather than vanishing.
  assert.deepEqual(folders.map(folder => folder.name), ['Loose', 'Lost']);
  assert.deepEqual(rest.map(session => session.id), ['c']);
});

// The sidebar's Chat and Work modes (src/session-list.js), as in Claude Code.
test('Chat lists ordinary chats; Work lists sections, folders and work sessions; a chat opened elsewhere shows in its own mode', async () => {
  const { arrangeSessions, forMode, modeOf } = await import('../src/session-list.js');
  const folders = [{ id: 'f1', name: 'Fairy', category: 'c1' }, { id: 'f2', name: 'Loose' }];
  const categories = [{ id: 'c1', name: 'DESKTOP BUDDIES' }, { id: 'c2', name: 'RESEARCH' }];
  const sessions: SessionSummary[] = [
    { id: 'a', title: 'Dinner ideas', updatedAt: '3' },
    { id: 'b', title: 'Fix the build', updatedAt: '2', work: '/Github/Fairy' },
    { id: 'c', title: 'In a folder', updatedAt: '1', folder: 'f1' },
    { id: 'd', title: 'Pinned chat', updatedAt: '4', pinned: true },
    { id: 'e', title: 'Pinned work', updatedAt: '5', pinned: true, work: '/Github/Fairy' },
  ];
  const all = arrangeSessions({ sessions, folders, categories });
  const chat = forMode(all, 'chat'), work = forMode(all, 'work');
  assert.deepEqual(chat.rest.map(s => s.id), ['a']);
  assert.deepEqual(chat.pinned.map(s => s.id), ['d']);
  assert.deepEqual([chat.categories.length, chat.folders.length], [0, 0], 'sections and folders are Work’s');
  assert.deepEqual(work.categories.map(c => c.name), ['DESKTOP BUDDIES', 'RESEARCH']);
  assert.deepEqual(work.categories[0].folders[0].sessions.map(s => s.id), ['c'], 'a folder keeps its chats, whatever they are');
  assert.deepEqual(work.folders.map(f => f.id), ['f2']);
  assert.deepEqual(work.rest.map(s => s.id), ['b']);
  assert.deepEqual(work.pinned.map(s => s.id), ['e']);
  assert.equal(modeOf(sessions[0], folders), 'chat');
  assert.equal(modeOf(sessions[1], folders), 'work');
  assert.equal(modeOf(sessions[2], folders), 'work', 'in a folder');
  assert.equal(modeOf(sessions[3], folders), 'chat', 'a pinned chat shows under Chat’s Pinned');
  assert.equal(modeOf(undefined, folders), null);
});

test('SessionStore.state includes workPath, branch, and provider for work folder cards', async t => {
  const { store, make } = await setup(t);
  await store.createWork('/Users/me/Github/Lyra');
  await store.setWork({ root: '/Users/me/Github/Lyra', branch: 'research-t3-redesign', provider: 'claude' });
  await store.save(chat('Audit folder card metadata', '2026-11-23T09:00:00.000Z'));
  const summary = store.state().sessions[0];
  assert.equal(summary.work, 'Lyra');
  assert.equal(summary.workPath, '/Users/me/Github/Lyra');
  assert.equal(summary.branch, 'research-t3-redesign');
  assert.equal(summary.provider, 'claude');

  const reopened = make(); await reopened.load();
  const persisted = reopened.state().sessions[0];
  assert.equal(persisted.work, 'Lyra');
  assert.equal(persisted.workPath, '/Users/me/Github/Lyra');
  assert.equal(persisted.branch, 'research-t3-redesign');
  assert.equal(persisted.provider, 'claude');
});

test('folderProjectMeta and relativeAge derive monogram, repo, branch, stats, and timestamps', async () => {
  const { folderProjectMeta, relativeAge } = await import('../src/session-list.js');
  const now = Date.UTC(2026, 10, 23, 12, 0, 0);
  assert.equal(relativeAge(now - 30_000, now), 'now');
  assert.equal(relativeAge(now - 22 * 60_000, now), '22m');
  assert.equal(relativeAge(now - 18 * 3600_000, now), '18h');
  assert.equal(relativeAge(now - 3 * 86_400_000, now), '3d');

  const folder = {
    id: 'f1',
    name: 'UI polish overhaul',
    sessions: [
      { id: 's1', updatedAt: new Date(now - 18 * 3600_000).toISOString(), work: 't3code', workPath: '/code/t3code', branch: 'main', provider: 'claude' },
      { id: 's2', updatedAt: new Date(now - 2 * 3600_000).toISOString(), work: 't3code', workPath: '/code/t3code', provider: 'codex' },
      { id: 's3', updatedAt: new Date(now - 72 * 3600_000).toISOString(), work: 'other', workPath: '/code/other', provider: 'gemini' },
    ],
  };
  const meta = folderProjectMeta(folder, {
    '/code/t3code': { repo: 'pingdotgg/t3code', branch: 't3/ui-polish', changed: 12, ahead: 3, behind: 0, isRepo: true },
  }, now);
  assert.deepEqual(meta, {
    workPath: '/code/t3code',
    repo: 'pingdotgg/t3code',
    branch: 't3/ui-polish',
    changed: 12,
    ahead: 3,
    behind: 0,
    updatedAt: new Date(now - 2 * 3600_000).toISOString(),
    age: '2h',
    provider: 'codex',
    sessionCount: 3,
    monogram: 'T3',
  });
});

test('projectBrief returns git repo slug, branch, and change count, and degrades cleanly for non-git folders', async t => {
  const { execFileSync } = await import('node:child_process');
  const { realpath } = await import('node:fs/promises');
  const { projectBrief } = await import('../desktop/git-tools.mjs');
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-brief-')));
  const plain = await realpath(await mkdtemp(join(tmpdir(), 'fairy-plain-')));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(plain, { recursive: true, force: true });
  });

  const nonGit = await projectBrief(plain);
  assert.equal(nonGit.isRepo, false);
  assert.equal(nonGit.branch, '');
  assert.equal(nonGit.changed, 0);

  const run = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  run('init', '-q', '-b', 'main');
  run('config', 'user.name', 'Test');
  run('config', 'user.email', 'test@example.com');
  run('remote', 'add', 'origin', 'https://github.com/pingdotgg/t3code.git');
  await writeFile(join(root, 'a.txt'), 'hello\n');
  run('add', '-A');
  run('commit', '-qm', 'init');
  await writeFile(join(root, 'b.txt'), 'untracked change\n');

  const brief = await projectBrief(root);
  assert.deepEqual(brief, {
    repo: 'pingdotgg/t3code',
    branch: 'main',
    changed: 1,
    ahead: 0,
    behind: 0,
    isRepo: true,
  });
});

test('SessionStore.state preserves isolate and sessionFolderMeta resolves branch, agent provider, and local/remote', async t => {
  const { store } = await setup(t);
  await store.createWork('/Users/me/Github/Lyra');
  await store.setWork({ isolate: true, provider: 'gemini' });
  await store.save(chat('Isolated branch work', '2026-11-23T10:00:00.000Z'));
  const isolated = store.state().sessions[0];
  assert.equal(isolated.isolate, true);
  assert.equal(isolated.provider, 'gemini');

  const { sessionFolderMeta } = await import('../src/session-list.js');
  assert.deepEqual(
    sessionFolderMeta(
      { id: 's1', workPath: '/code/app', branch: 'feat/ui', provider: 'codex' },
      { folderBranch: 'main', statsMap: { '/code/app': { branch: 'develop' } }, isRemote: false, defaultProvider: 'claude' },
    ),
    { branch: 'feat/ui', provider: 'codex', family: 'openai', providerLabel: 'Codex', remote: false },
  );
  assert.deepEqual(
    sessionFolderMeta(
      { id: 's2', workPath: '/code/app', provider: 'antigravity', remote: true },
      { folderBranch: 'main', statsMap: { '/code/app': { branch: 'release' } }, isRemote: false, defaultProvider: 'claude' },
    ),
    { branch: 'release', provider: 'antigravity', family: 'google', providerLabel: 'Gemini', remote: true },
  );
  assert.deepEqual(
    sessionFolderMeta(
      { id: 's3', isolate: true },
      { folderBranch: '', statsMap: {}, isRemote: true, defaultProvider: 'claude' },
    ),
    { branch: 'own branch', provider: 'claude', family: 'anthropic', providerLabel: 'Claude', remote: true },
  );
});

test('WorkRuns finished tracking and SessionStore.state finished/swarms fields', async t => {
  const { WorkRuns } = await import('../desktop/work-runs.mjs');
  const runs = new WorkRuns();
  runs.start({ session: 'c1', root: '/tmp/repo-a', at: 't1', request: 'hi' });
  runs.finish('c1', { markFinished: true });
  assert.deepEqual(runs.finishedIds(), ['c1']);
  // Re-running the session clears its finished indicator.
  runs.start({ session: 'c1', root: '/tmp/repo-a', at: 't2', request: 'again' });
  assert.deepEqual(runs.finishedIds(), []);
  runs.finish('c1', { markFinished: true });
  assert.deepEqual(runs.finishedIds(), ['c1']);
  runs.clearFinished('c1');
  assert.deepEqual(runs.finishedIds(), []);

  const { store } = await setup(t);
  store.finished = () => ['c1'];
  store.swarms = () => ({ c2: { status: 'running', active: 3, total: 4 } });
  const state = store.state();
  assert.deepEqual(state.finished, ['c1']);
  assert.deepEqual(state.swarms, { c2: { status: 'running', active: 3, total: 4 } });
});
