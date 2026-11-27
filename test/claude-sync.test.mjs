// Claude sync (desktop/claude-sync.mjs): Claude Code's chats and pages, read on the MacBook and kept by the mini.
import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../desktop/artifacts.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { SessionStore } from '../desktop/sessions.mjs';
import { convertSessions, findSessions } from '../desktop/claude-import.mjs';
import { ClaudeSyncReceiver, ClaudeSyncSender, cleanHistory, cleanPage, pageMeta, scanArtifacts, scanFrom } from '../desktop/claude-sync.mjs';

const temp = async t => { const root = await mkdtemp(join(tmpdir(), 'fairy-claude-sync-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
const URL_A = 'https://claude.ai/artifact/aaaaaaaa-1111-2222-3333-444444444444', URL_B = 'https://claude.ai/code/artifact/bbbbbbbb-1111-2222-3333-444444444444';
const SESSION = '0a1b2c3d-0000-4000-8000-000000000001';
const line = value => `${JSON.stringify(value)}\n`;
// One publish in a transcript: the Artifact call, then its answer.
const call = (tool, input) => line({ type: 'assistant', sessionId: SESSION, cwd: '/Users/me/proj', timestamp: '2026-11-21T10:00:00Z', message: { content: [{ type: 'tool_use', id: tool, name: 'Artifact', input }] } });
const answer = (tool, result, at = '2026-11-21T10:00:05Z') => line({ type: 'user', sessionId: SESSION, cwd: '/Users/me/proj', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: tool, content: 'Published' }] }, toolUseResult: result });
const said = (role, text, n) => line({ type: role, sessionId: SESSION, uuid: `u-${role}-${n}`, cwd: '/Users/me/proj', timestamp: `2026-11-21T10:0${n}:00Z`, message: role === 'user' ? { content: text } : { content: [{ type: 'text', text }] } });

test('a transcript is read from where the last run stopped, and a half-written line waits for the next', async t => {
  const root = await temp(t), path = join(root, 's.jsonl');
  await writeFile(path, call('t1', { file_path: join(root, 'a.html') }) + answer('t1', { artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444', url: URL_A, title: 'A', seq: 1 }) + call('t2', { file_path: join(root, 'b.html'), title: 'B page' }));
  const entry = { offset: 0, found: [], uploads: [], titles: {}, inputs: {} };
  await scanFrom(path, entry);
  assert.deepEqual(entry.found.map(one => one.url), [URL_A]);
  assert.ok(entry.inputs.t2, 'the call still waiting for its answer is kept');
  const size = (await stat(path)).size;
  assert.equal(entry.offset, size);
  // The answer arrives, cut off half way, then finished.
  const rest = answer('t2', { artifact_id: 'bbbbbbbb-1111-2222-3333-444444444444', url: URL_B, seq: 2 });
  await appendFile(path, rest.slice(0, 40));
  await scanFrom(path, entry);
  assert.equal(entry.offset, size, 'nothing past the last whole line is counted');
  await appendFile(path, rest.slice(40));
  await scanFrom(path, entry);
  assert.deepEqual(entry.found.map(one => [one.url, one.title, one.seq]), [[URL_A, 'A', 1], [URL_B, 'B page', 2]]);
  assert.deepEqual(entry.inputs, {});
});

test('a scan finds every page once, says whether its file is here, and reads only what changed next time', async t => {
  const root = await temp(t), claudeDir = join(root, 'claude'), project = join(claudeDir, 'projects', '-Users-me-proj');
  await mkdir(project, { recursive: true });
  const page = join(root, 'page.html');
  await writeFile(page, '<title>A</title>');
  const path = join(project, `${SESSION}.jsonl`);
  await writeFile(path, call('t1', { file_path: page }) + answer('t1', { artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444', url: URL_A, title: 'A', seq: 3 })
    + call('t2', { file_path: join(root, 'gone.html') }) + answer('t2', { artifact_id: 'bbbbbbbb-1111-2222-3333-444444444444', url: URL_B, title: 'B', seq: 1 }));
  const first = await scanArtifacts({ claudeDir, desktopDir: join(root, 'none') });
  assert.deepEqual(first.found.map(one => [one.url, one.seq, one.hasSource]), [[URL_A, 3, true], [URL_B, 1, false]]);
  // Unchanged, the file isn't read again: what was found comes from the cache.
  first.cache.files[path].found[0].title = 'From the cache';
  const again = await scanArtifacts({ claudeDir, desktopDir: join(root, 'none'), cache: first.cache });
  assert.equal(again.found.find(one => one.url === URL_A).title, 'From the cache');
  // A transcript Claude Code cleared out drops from the cache.
  await rm(path);
  assert.deepEqual((await scanArtifacts({ claudeDir, desktopDir: join(root, 'none'), cache: again.cache })).cache.files, {});
});

test('what crosses the link is checked: claude.ai pages only, and a chat’s turns without anything extra', () => {
  assert.equal(cleanPage({ url: 'https://example.com/artifact/aaaaaaaa' }), null);
  assert.equal(cleanPage({ url: 'https://claude.ai/artifact/../../x' }), null);
  const page = cleanPage({ url: `${URL_A}/`, seq: 2, project: 'relative/path', assets: [{ id: 'nope' }, { id: 'a'.repeat(32), sha256: 'B'.repeat(64) }], extra: 'x' });
  assert.equal(page.url, URL_A); assert.equal(page.id, 'aaaaaaaa-1111-2222-3333-444444444444'); assert.equal(page.project, '');
  assert.deepEqual(page.assets, [{ id: 'a'.repeat(32), type: '', sha256: 'b'.repeat(64) }]);
  assert.equal('extra' in page, false);
  const history = cleanHistory([{ role: 'user', content: 'hi', at: 'x', secret: 1 }, { role: 'system', content: 'no' }, { role: 'assistant', content: 'yo', activity: [{ tool: 'run', status: 'done', summary: 'ls', id: 1, extra: 2 }] }]);
  assert.deepEqual(history, [{ role: 'user', content: 'hi', at: 'x', mode: 'claude-code' }, { role: 'assistant', content: 'yo', at: '', mode: 'claude-code', activity: [{ id: '1', tool: 'run', status: 'done', summary: 'ls' }] }]);
});

async function mini(t, { download = null } = {}) {
  const root = await temp(t);
  const artifacts = new ArtifactStore({ dir: join(root, 'artifacts'), readJSON, writeJSON, trash: path => rm(path, { recursive: true, force: true }) });
  await artifacts.load();
  const sessions = new SessionStore({ dir: join(root, 'sessions'), legacyDir: root, readJSON, writeJSON, trash: async () => {} });
  await sessions.load();
  const receiver = new ClaudeSyncReceiver({ sessions, artifacts, readJSON, writeJSON, files: { manifest: join(root, 'claude-code-import.json'), state: join(root, 'claude-sync.json') },
    stageDir: join(root, 'stage'), download, sessionById: id => { try { return sessions.find(id); } catch { return null; } } });
  return { root, artifacts, sessions, receiver };
}
const b64 = text => Buffer.from(text).toString('base64');

test('the mini asks for new and republished pages, keeps their files, and leaves removed and old ones gone', async t => {
  const { artifacts, receiver } = await mini(t);
  const at = Date.parse('2026-11-21T10:00:00Z');
  let plan = await receiver.planPages({ pages: [{ url: URL_A, seq: 1, at, hasSource: true, title: 'A', chat: SESSION, chatTitle: 'Talk', project: '/Users/me/proj' }] });
  assert.deepEqual(plan, { send: [URL_A], fetch: [], assets: [] });
  const { result } = await receiver.page({ page: { url: URL_A, seq: 1, at, title: 'A', chat: SESSION, chatTitle: 'Talk', project: '/Users/me/proj' }, main: { ext: '.html', data: b64('<p>one</p>') }, files: [{ path: 'img/x.png', data: b64('png') }, { path: '../escape.png', data: b64('no') }] });
  assert.equal(result, 'copied');
  const item = artifacts.items[0];
  assert.equal(item.sessionTitle, 'Talk');
  assert.equal(await readFile(join(artifacts.versionDir(item.id, 1), 'index.html'), 'utf8'), '<p>one</p>');
  assert.equal(await readFile(join(artifacts.versionDir(item.id, 1), 'img/x.png'), 'utf8'), 'png');
  // Nothing new: nothing asked for. Published again: asked for again.
  assert.deepEqual((await receiver.planPages({ pages: [{ url: URL_A, seq: 1, at, hasSource: true }] })).send, []);
  assert.deepEqual((await receiver.planPages({ pages: [{ url: URL_A, seq: 2, at, hasSource: true }] })).send, [URL_A]);
  // Removed here: never brought back.
  await artifacts.remove(item.id);
  assert.deepEqual((await receiver.planPages({ pages: [{ url: URL_A, seq: 3, at, hasSource: true }] })).send, []);
});

test('the first sync starts from the old import’s newest page; anything older it doesn’t have counts as removed', async t => {
  const { artifacts, receiver } = await mini(t);
  artifacts.items.push({ id: 'old', title: 'Old', url: 'https://claude.ai/artifact/oooooooo-1111', origin: 'claude', updatedAt: '2026-11-16T21:40:14.000Z', versions: [{ seq: 1, file: 'index.html', at: '2026-11-16T21:40:14.000Z' }], comments: [] });
  const plan = await receiver.planPages({ pages: [
    { url: URL_A, seq: 1, at: Date.parse('2026-11-10T00:00:00Z'), hasSource: true },
    { url: URL_B, seq: 1, at: Date.parse('2026-11-20T00:00:00Z'), hasSource: true },
  ] });
  assert.deepEqual(plan.send, [URL_B]);
});

test('a page without its files on the MacBook is downloaded here once per version; a Doc isn’t tried again', async t => {
  let downloads = 0;
  const root = await temp(t);
  const download = async url => {
    downloads++;
    if (url === URL_B) throw new Error('That link is a claude.ai Docs artifact, which Fairy can’t show as a page yet.');
    const folder = join(root, 'scratchpad', 'artifact-files', `x${downloads}`);
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, 'index.html'), '<p>from claude.ai</p>');
    return folder;
  };
  const { artifacts, receiver } = await mini(t, { download });
  const pages = [{ url: URL_A, seq: 2, at: 1, hasSource: false }, { url: URL_B, seq: 1, at: 1, hasSource: false }];
  assert.deepEqual((await receiver.planPages({ pages })).fetch, [URL_A, URL_B]);
  assert.equal((await receiver.fetch({ page: pages[0] })).result, 'copied');
  assert.equal((await receiver.fetch({ page: pages[1] })).result, 'failed');
  const item = artifacts.items.find(entry => entry.url === URL_A);
  assert.deepEqual(item.versions.map(version => version.seq), [2]);
  assert.equal(await readFile(join(artifacts.versionDir(item.id, 2), 'index.html'), 'utf8'), '<p>from claude.ai</p>');
  assert.deepEqual((await receiver.planPages({ pages })).fetch, [], 'neither is asked for again');
  assert.deepEqual((await receiver.planPages({ pages: [{ ...pages[1], seq: 2 }] })).fetch, [URL_B], 'until it’s published anew');
});

test('chats: new ones are added, changed ones updated, and one you carried on with here is kept', async t => {
  const { sessions, receiver } = await mini(t);
  const id = 'cc-abc';
  assert.deepEqual(await receiver.planChats({ groups: [{ id, signature: 's1' }, { id: 'not ok', signature: 'x' }] }), { todo: [id], kept: 0 });
  const history = [{ role: 'user', content: 'hello', at: '2026-11-21T10:00:00Z' }, { role: 'assistant', content: 'hi', at: '2026-11-21T10:00:05Z' }];
  assert.equal((await receiver.chat({ id, signature: 's1', title: 'Hello', cwd: '/nowhere/proj', history })).result, 'added');
  assert.equal(sessions.find(id).title, 'Hello');
  assert.deepEqual(await receiver.planChats({ groups: [{ id, signature: 's1' }] }), { todo: [], kept: 0 });
  assert.equal((await receiver.chat({ id, signature: 's2', history: [...history, { role: 'user', content: 'more', at: 'z' }] })).result, 'updated');
  assert.equal(sessions.find(id).turns, 3);
  // Carried on here: the turn count no longer matches the import's, so it's left alone.
  sessions.find(id).turns = 5;
  assert.deepEqual(await receiver.planChats({ groups: [{ id, signature: 's3' }] }), { todo: [], kept: 1 });
  assert.equal((await receiver.chat({ id, signature: 's3', history })).result, 'kept');
  // A program's session is only recorded.
  assert.deepEqual(await receiver.skipped({ chats: [{ id: 'cc-prog', signature: 'p' }] }), { skipped: 1 });
  assert.deepEqual(await receiver.planChats({ groups: [{ id: 'cc-prog', signature: 'p' }] }), { todo: [], kept: 0 });
});

test('a whole run, MacBook to mini: a chat and a page cross, and a second run sends nothing', async t => {
  const root = await temp(t), claudeDir = join(root, 'claude'), project = join(claudeDir, 'projects', '-Users-me-proj');
  await mkdir(project, { recursive: true });
  const page = join(root, 'scratch', 'page.html');
  await mkdir(join(root, 'scratch'), { recursive: true });
  await writeFile(page, '<p>the page</p>');
  await writeFile(join(root, 'scratch', 'style.css'), 'p{}');
  await writeFile(join(project, `${SESSION}.jsonl`), said('user', 'make me a page', 1) + said('assistant', 'Here it is.', 2)
    + call('t1', { file_path: page, files: { 'style.css': join(root, 'scratch', 'style.css') } }) + answer('t1', { artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444', url: URL_A, title: 'The page', seq: 1 }, '2026-11-21T10:05:00Z'));
  const other = await mini(t);
  const routes = { 'plan-chats': 'planChats', skipped: 'skipped', chat: 'chat', 'plan-pages': 'planPages', page: 'page', asset: 'asset', fetch: 'fetch', done: 'done' };
  // The link, in process: each body goes through JSON as it would over the wire.
  const post = async (path, body) => JSON.parse(JSON.stringify(await other.receiver[routes[path.split('/').pop()]](JSON.parse(JSON.stringify(body)))));
  const worker = async data => (data.task === 'convert' ? convertSessions(data) : { ...(await findSessions({ claudeDir, desktopDir: join(root, 'none') })), ...(await scanArtifacts({ claudeDir, desktopDir: join(root, 'none'), cache: data.cache })) });
  const sender = new ClaudeSyncSender({ post, worker, cacheFile: join(root, 'cache.json'), stageDir: join(root, 'stage'), readJSON, writeJSON, claudeDir, now: () => Date.now() + 10 * 60_000 });
  const counts = await sender.run();
  assert.equal(counts.chatsAdded, 1);
  assert.equal(counts.pagesCopied, 1);
  const chat = other.sessions.find(`cc-${SESSION}`);
  assert.equal(chat.turns, 2);
  const item = other.artifacts.items[0];
  assert.equal(item.title, 'The page');
  assert.equal(await readFile(join(other.artifacts.versionDir(item.id, 1), 'style.css'), 'utf8'), 'p{}');
  assert.equal(sender.state().last.counts.pagesCopied, 1);
  const again = await sender.run();
  assert.deepEqual([again.chatsAdded, again.chatsUpdated, again.pagesCopied, again.pagesFetched], [0, 0, 0, 0]);
  assert.equal((await other.receiver.report()).last.counts.pagesCopied, 0);
  assert.deepEqual(pageMeta({ url: URL_A, source: '/secret/path.html', files: [['x', ['/secret/x']]] }).source, undefined, 'where files are on the MacBook stays there');
});

test('the link hands /v1/face/claude/… to the sync, each step with its own size limit, and the window’s channel stays on its own Mac', async t => {
  const source = await readFile(new URL('../desktop/face-link.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathname\.startsWith\('\/v1\/face\/claude\/'\) && this\.claudeSync\) return this\.claudeSync\.handle\(request, response, \{ pathname, link, device \}\)/);
  const { LOCAL } = await import('../desktop/remote-channels.mjs');
  assert.ok(LOCAL.includes('claude-sync'));
  const { receiver } = await mini(t);
  const asked = [], link = { body: async (_request, limit) => { asked.push(limit); return { groups: [] }; }, send: (_response, status, value) => ({ status, value }) };
  assert.deepEqual(await receiver.handle({ method: 'POST' }, null, { pathname: '/v1/face/claude/plan-chats', link }), { status: 200, value: { todo: [], kept: 0 } });
  assert.equal(asked[0], 8 * 1024 * 1024);
  await assert.rejects(receiver.handle({ method: 'POST' }, null, { pathname: '/v1/face/claude/anything', link }), /Not found/);
  await assert.rejects(receiver.handle({ method: 'GET' }, null, { pathname: '/v1/face/claude/plan-chats', link }), /Not found/);
});

test('something that fails three times isn’t sent again, so a slow link doesn’t resend it every run', async t => {
  const root = await temp(t);
  let tries = 0;
  const sender = new ClaudeSyncSender({ post: async () => { tries++; throw new Error('Your other Mac took too long to answer.'); }, cacheFile: join(root, 'c.json'), stageDir: root, readJSON, writeJSON });
  for (let i = 0; i < 5; i++) assert.equal(await sender.attempt('page x 1', () => sender.post()), null);
  assert.equal(tries, 3);
  assert.deepEqual(await sender.attempt('page y 1', async () => ({ result: 'copied' })), { result: 'copied' });
});

test('a page saved by hand in the drop folder is sent for its version, and only that one', async t => {
  const root = await temp(t), claudeDir = join(root, 'claude'), project = join(claudeDir, 'projects', '-Users-me-proj'), drop = join(root, 'drop');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, `${SESSION}.jsonl`), call('t1', { file_path: join(root, 'gone.html') }) + answer('t1', { artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444', url: URL_A, title: 'A', seq: 4 }));
  const saved = join(drop, URL_A.split('/').pop(), '4');
  await mkdir(join(saved, 'img'), { recursive: true });
  await writeFile(join(saved, 'index.html'), '<p>saved</p>'); await writeFile(join(saved, 'img', 'a.png'), 'png');
  const [one] = (await scanArtifacts({ claudeDir, desktopDir: join(root, 'none'), dropDir: drop })).found;
  assert.equal(one.hasSource, true);
  assert.equal(one.source, join(saved, 'index.html'));
  assert.deepEqual(one.files, [['img/a.png', [join(saved, 'img', 'a.png')]]]);
  // Saved for an older version: not used for a newer one.
  await writeFile(join(project, `${SESSION}.jsonl`), call('t2', { file_path: join(root, 'gone.html') }) + answer('t2', { artifact_id: 'aaaaaaaa-1111-2222-3333-444444444444', url: URL_A, seq: 5 }), { flag: 'a' });
  assert.equal((await scanArtifacts({ claudeDir, desktopDir: join(root, 'none'), dropDir: drop })).found[0].hasSource, false);
});

test('without an Artifact tool, the mini says so once and the MacBook stops asking for downloads that run', async t => {
  const { NO_ARTIFACT_TOOL } = await import('../desktop/artifact-link.mjs');
  let downloads = 0;
  const { receiver } = await mini(t, { download: async () => { downloads++; throw new Error(NO_ARTIFACT_TOOL); } });
  assert.deepEqual(await receiver.fetch({ page: { url: URL_A, seq: 1 } }), { result: 'unavailable', why: NO_ARTIFACT_TOOL });
  assert.equal((await receiver.fetch({ page: { url: URL_B, seq: 1 } })).result, 'unavailable');
  assert.equal(downloads, 1, 'Claude Code isn’t started again to hear the same thing');
  assert.deepEqual((await receiver.state()).unfetchable, {}, 'and no page is marked as failed for it');
});

test('a fresh start gives pages that failed for a passing reason their tries back; a Doc stays given up on', async t => {
  const root = await temp(t), state = join(root, 'claude-sync.json');
  await writeJSON(state, { since: 'none', unfetchable: { [URL_A]: { seq: 1, tries: 3, why: 'timeout' }, [URL_B]: { seq: 1, tries: 1, why: 'Doc', never: true } } });
  const receiver = new ClaudeSyncReceiver({ sessions: null, artifacts: null, readJSON, writeJSON, files: { manifest: join(root, 'm.json'), state }, stageDir: root });
  assert.deepEqual(Object.keys((await receiver.state()).unfetchable), [URL_B]);
});

test('Claude Code with no Artifact tool is stopped at its first event, before any model call', async t => {
  const { downloadArtifact, NO_ARTIFACT_TOOL } = await import('../desktop/artifact-link.mjs');
  const { EventEmitter } = await import('node:events');
  let killed = false;
  const spawnProcess = () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => { killed = true; setImmediate(() => child.emit('close', null)); } });
    setImmediate(() => child.stdout.emit('data', Buffer.from(`${JSON.stringify({ type: 'system', subtype: 'init', tools: ['Read', 'Bash'] })}\n`)));
    return child;
  };
  await assert.rejects(downloadArtifact({ executable: 'claude', cwd: '/tmp', url: URL_A, spawnProcess }), error => error.message === NO_ARTIFACT_TOOL);
  assert.ok(killed);
});
