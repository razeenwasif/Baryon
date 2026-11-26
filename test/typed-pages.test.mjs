// claude.ai Docs and Designs as pages (desktop/typed-pages.mjs), and how Claude sync brings them from the drop folder.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../desktop/artifacts.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { canvasLayout, designViewer, docPage } from '../desktop/typed-pages.mjs';
import { ClaudeSyncReceiver, ClaudeSyncSender, cleanTypedMeta, scanTyped, sniffType } from '../desktop/claude-sync.mjs';

const temp = async t => { const root = await mkdtemp(join(tmpdir(), 'fairy-typed-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
const DESIGN = 'https://claude.ai/artifact/X9NxfAHt5873TYaJC2o5Wf', DOC = 'https://claude.ai/artifact/6CkZtgD8eMvMc9FLzUurQm';
const CANVAS = { boards: { 'Main.dc.html': { x: 0, y: 0, w: 1280, h: 860, title: 'Home <window>' }, 'Gone.dc.html': { x: 9, y: 9, w: 10, h: 10 }, '../evil.dc.html': { x: 0, y: 0, w: 1, h: 1 } },
  order: ['Main.dc.html'], notes: { a: { x: 0, y: -200, text: 'Launcher', kind: 'title1' } } };

test('a Design’s canvas places only its own artboards, and the rest of them in a row', () => {
  const { boards, notes } = canvasLayout(CANVAS, ['project/Main.dc.html', 'project/Extra.dc.html', 'project/support.js']);
  assert.deepEqual(boards.map(board => [board.file, board.x, board.w]), [['project/Main.dc.html', 0, 1280], ['project/Extra.dc.html', 1360, 1280]]);
  assert.deepEqual(notes, [{ text: 'Launcher', x: 0, y: -200, big: true }]);
  const html = designViewer({ title: 'Nucleus & co', canvas: CANVAS, files: ['project/Main.dc.html'] });
  assert.match(html, /<iframe src="project\/Main\.dc\.html" width="1280" height="860" loading="lazy" title="Home &lt;window&gt;">/);
  assert.match(html, /<title>Nucleus &amp; co<\/title>/);
  assert.doesNotMatch(html, /evil|Gone/);
  assert.match(designViewer({ title: 'Empty' }), /no artboards/);
});

test('a Doc’s tabs are set one after another, named only when there are several', () => {
  assert.doesNotMatch(docPage({ title: 'One', tabs: [{ name: 'Tab 1', html: '<h1>Plan</h1>' }] }), /<nav>/);
  const html = docPage({ title: 'Two', tabs: [{ name: 'Plan', html: '<h1>Plan</h1>' }, { name: 'Notes <b>', html: '<p>n</p>' }] });
  assert.match(html, /<nav><a href="#tab-1">Plan<\/a><a href="#tab-2">Notes &lt;b&gt;<\/a><\/nav>/);
  assert.match(html, /<section id="tab-2"><p class="tab">Notes &lt;b&gt;<\/p><p>n<\/p><\/section>/);
});

test('what the drop folder says about one is checked, and uploads are told apart by their first bytes', () => {
  assert.equal(cleanTypedMeta({ url: DESIGN, kind: 'sheet', version: '1' }), null);
  assert.equal(cleanTypedMeta({ url: DESIGN, kind: 'design', version: 'a b' }), null);
  const page = cleanTypedMeta({ url: DOC, kind: 'doc', version: '1795163798-dfd0', title: 'Plan', tabs: [{ name: 'Tab 1', file: 'tabs/1.html' }, { name: 'x', file: '../1.html' }], assets: { ['a'.repeat(32)]: 'image/png', bad: 'x' } });
  assert.deepEqual(page.tabs, [{ name: 'Tab 1', file: 'tabs/1.html' }]);
  assert.deepEqual(page.types, { ['a'.repeat(32)]: 'image/png' });
  assert.equal(sniffType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10])), 'image/png');
  assert.equal(sniffType(Buffer.from('<svg xmlns="x"/>')), 'image/svg+xml');
  assert.equal(sniffType(Buffer.from('plain')), '');
});

async function mini(root) {
  const artifacts = new ArtifactStore({ dir: join(root, 'artifacts'), readJSON, writeJSON, trash: path => rm(path, { recursive: true, force: true }) });
  await artifacts.load();
  const receiver = new ClaudeSyncReceiver({ sessions: null, artifacts, readJSON, writeJSON, files: { manifest: join(root, 'm.json'), state: join(root, 'claude-sync.json') }, stageDir: join(root, 'stage') });
  return { artifacts, receiver };
}
async function drop(root, key, meta, files) {
  const folder = join(root, 'drop', key, 'typed');
  for (const [path, content] of Object.entries(files)) { await mkdir(join(folder, 'files', path, '..'), { recursive: true }); await writeFile(join(folder, 'files', path), content); }
  await writeFile(join(folder, 'meta.json'), JSON.stringify(meta));
}

test('from the drop folder to Pages: a Design becomes its canvas with its artboards and uploads, a Doc its page, each once per version', async t => {
  const root = await temp(t), { artifacts, receiver } = await mini(root);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);
  await drop(root, 'X9NxfAHt5873TYaJC2o5Wf', { url: DESIGN, kind: 'design', title: 'Nucleus', version: 'v1' },
    { 'project/canvas.json': JSON.stringify(CANVAS), 'project/Main.dc.html': '<!doctype html><img src="/_blob/' + 'b'.repeat(32) + '">', 'project/support.js': 'runtime', [`_blob/${'b'.repeat(32)}`]: png });
  await drop(root, '6CkZtgD8eMvMc9FLzUurQm', { url: DOC, kind: 'doc', title: 'Plan', version: 'r8', tabs: [{ name: 'Tab 1', file: 'tabs/1.html' }] }, { 'tabs/1.html': '<h1>The plan</h1>' });
  assert.equal((await scanTyped(join(root, 'drop'))).length, 2);
  // An old address-only copy of the Design is already in Pages, as the first import left it.
  artifacts.items.push({ id: 'X9NxfAHt5873TYaJC2o5Wf', title: 'Nucleus', url: DESIGN, origin: 'claude', updatedAt: '2026-10-13T00:00:00Z', versions: [{ seq: 12, file: null, at: '' }], comments: [] });
  const routes = { 'plan-typed': 'planTyped', typed: 'typed', asset: 'asset', 'plan-chats': 'planChats', 'plan-pages': 'planPages', done: 'done' };
  const post = async (path, body) => JSON.parse(JSON.stringify(await receiver[routes[path.split('/').pop()]](JSON.parse(JSON.stringify(body)))));
  const sender = new ClaudeSyncSender({ post, dropDir: join(root, 'drop'), cacheFile: join(root, 'c.json'), stageDir: join(root, 's'), readJSON, writeJSON });
  const counts = { pagesFailed: 0, typedCopied: 0, files: 0 };
  await sender.sendTyped(counts);
  assert.deepEqual(counts, { pagesFailed: 0, typedCopied: 2, files: 1 });
  const design = artifacts.items.find(item => item.url === DESIGN), doc = artifacts.items.find(item => item.url === DOC);
  assert.deepEqual(design.versions.map(version => [version.seq, version.file]), [[12, 'index.html']], 'the address-only version is filled in');
  const dir = artifacts.versionDir(design.id, 12);
  assert.match(await readFile(join(dir, 'index.html'), 'utf8'), /<iframe src="project\/Main\.dc\.html"/);
  assert.equal(await readFile(join(dir, 'project', 'support.js'), 'utf8'), 'runtime');
  assert.deepEqual(design.assets, { ['b'.repeat(32)]: 'image/png' });
  const served = await artifacts.serve(`/${design.id}/12/project/Main.dc.html`);
  assert.match(served.body, new RegExp(`/${design.id}/12/_blob/${'b'.repeat(32)}`), 'the artboard’s upload points at Fairy’s copy');
  assert.match(served.headers['content-security-policy'], new RegExp(`frame-src fairy-artifact://page/${design.id}/12/;`));
  assert.match(await readFile(join(artifacts.versionDir(doc.id, 1), 'index.html'), 'utf8'), /<h1>The plan<\/h1>/);
  // Nothing new: nothing sent. A new version of the Doc: a new version in Pages.
  const again = { pagesFailed: 0, typedCopied: 0, files: 0 };
  await sender.sendTyped(again);
  assert.equal(again.typedCopied, 0);
  await drop(root, '6CkZtgD8eMvMc9FLzUurQm', { url: DOC, kind: 'doc', title: 'Plan', version: 'r9', tabs: [{ name: 'Tab 1', file: 'tabs/1.html' }] }, { 'tabs/1.html': '<h1>The plan, again</h1>' });
  await sender.sendTyped(again);
  assert.deepEqual(doc.versions.map(version => version.seq), [1, 2]);
  // The transcripts' publish numbers don't ask for them again.
  assert.deepEqual((await receiver.planPages({ pages: [{ url: DESIGN, seq: 40, at: Date.now(), hasSource: false }] })).fetch, []);
  // Removed here: not brought back.
  await artifacts.remove(doc.id);
  await drop(root, '6CkZtgD8eMvMc9FLzUurQm', { url: DOC, kind: 'doc', title: 'Plan', version: 'r10', tabs: [] }, {});
  assert.deepEqual((await receiver.planTyped({ pages: [{ url: DOC, kind: 'doc', version: 'r10' }] })).send, []);
});

test('a Doc is exported by one small Claude Code turn, its tabs taken from Claude Code’s own output in the Doc’s order', async () => {
  const { exportDoc, allowedDocStep, firstJSON, docTabs } = await import('../desktop/doc-export.mjs');
  const { EventEmitter } = await import('node:events');
  const id = '6CkZtgD8eMvMc9FLzUurQm', b64 = text => Buffer.from(text).toString('base64');
  assert.equal(allowedDocStep('mcp__claude_ai_Claude_Docs__read', { ref: { object: 'project', id } }, id), true);
  assert.equal(allowedDocStep('mcp__claude_ai_Claude_Docs__read', { ref: { object: 'project', id: 'other-doc-1' } }, id), false);
  assert.equal(allowedDocStep('mcp__claude_ai_Claude_Docs__update', { ref: { object: 'project', id } }, id), false);
  assert.equal(allowedDocStep('Bash', { command: 'ls' }, id), false);
  assert.deepEqual(firstJSON('{"a":"}{"}\n\nAdvice after it.'), { a: '}{' });
  // As the connector answers: the Doc's name and tabs in value, its files beside it.
  const read = { verdict: 'allow', value: { name: 'Plan', tabs: { t2: { name: 'Second', order: 'W' }, t1: { name: 'First', order: 'V' } } }, files: [{ id: 't2', mime: 'application/vnd.claude.page' }, { id: 't1', mime: 'application/vnd.claude.page' }] };
  const events = [
    { type: 'system', subtype: 'init', tools: [], mcp_servers: [{ name: 'claude.ai Claude Docs', status: 'pending' }] },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c1', name: 'mcp__claude_ai_Claude_Docs__read', input: { ref: { object: 'project', id } } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: `${JSON.stringify(read)}\n\nThis doc takes suggestions.` }] }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c2', name: 'mcp__claude_ai_Claude_Docs__export', input: { container: { kind: 'project', id }, file: 't2', format: 'html' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c2', content: JSON.stringify({ verdict: 'allow', rev: 3, data: { bytes_b64: b64('<p>two</p>') } }) }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'c3', name: 'mcp__claude_ai_Claude_Docs__export', input: { container: { kind: 'project', id }, file: 't1', format: 'html' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c3', content: JSON.stringify({ verdict: 'allow', rev: 3, data: { bytes_b64: b64('<p>one</p>') } }) }] } },
    { type: 'result', subtype: 'success', result: 'DONE' },
  ];
  const fake = list => () => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => setImmediate(() => child.emit('close', null)) });
    setImmediate(() => { for (const event of list) child.stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`)); child.emit('close', 0); });
    return child;
  };
  const doc = await exportDoc({ executable: 'claude', url: `https://claude.ai/artifact/${id}`, spawnProcess: fake(events) });
  assert.deepEqual(doc, { title: 'Plan', tabs: [{ name: 'First', html: '<p>one</p>' }, { name: 'Second', html: '<p>two</p>' }] });
  // A step that writes stops the turn.
  const writes = [events[0], { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'x', name: 'mcp__claude_ai_Claude_Docs__update', input: {} }] } }];
  await assert.rejects(exportDoc({ executable: 'claude', url: `https://claude.ai/artifact/${id}`, spawnProcess: fake(writes) }), /something other than exporting/);
  assert.deepEqual(docTabs(null, new Map()), []);
});

test('a Doc on the desktop app’s list is exported on the mini when its version is new, and only then', async t => {
  const root = await temp(t), dropDir = join(root, 'drop'), { artifacts, receiver } = await mini(root);
  await mkdir(dropDir, { recursive: true });
  const list = version => writeFile(join(dropDir, '_typed.json'), JSON.stringify({ items: { [DOC]: { kind: 'doc', title: 'Plan', version }, [DESIGN]: { kind: 'design', title: 'Nucleus', version: 'd1' } } }));
  await list('2026-11-20');
  let exports = 0;
  receiver.exportDoc = async () => { exports++; return { title: 'Plan', tabs: [{ name: 'Tab 1', html: `<h1>v${exports}</h1>` }, { name: 'Notes', html: '<p>n</p>' }] }; };
  const routes = { 'plan-typed': 'planTyped', typed: 'typed', doc: 'doc', asset: 'asset' };
  const post = async (path, body) => JSON.parse(JSON.stringify(await receiver[routes[path.split('/').pop()]](JSON.parse(JSON.stringify(body)))));
  const sender = new ClaudeSyncSender({ post, dropDir, cacheFile: join(root, 'c.json'), stageDir: join(root, 's'), readJSON, writeJSON });
  const counts = { pagesFailed: 0, typedCopied: 0, docsExported: 0, files: 0 };
  await sender.sendTyped(counts);
  assert.deepEqual([counts.docsExported, exports], [1, 1]);
  const doc = artifacts.items.find(item => item.url === DOC);
  const html = await readFile(join(artifacts.versionDir(doc.id, 1), 'index.html'), 'utf8');
  assert.match(html, /<nav><a href="#tab-1">Tab 1<\/a><a href="#tab-2">Notes<\/a><\/nav>/);
  await sender.sendTyped(counts);
  assert.equal(exports, 1, 'the same day’s version isn’t exported again');
  await list('2026-11-21');
  await sender.sendTyped(counts);
  assert.deepEqual([exports, doc.versions.length], [2, 2]);
  // Without the connector, the mini says so once and the rest wait for the next start.
  receiver.exportDoc = async () => { throw new Error('Claude Code here has no Claude Docs connector, so the Doc can’t be exported.'); };
  await list('2026-11-22');
  assert.equal((await receiver.doc({ page: { url: DOC, kind: 'doc', version: '2026-11-22' } })).result, 'unavailable');
  assert.equal((await receiver.doc({ page: { url: DOC, kind: 'doc', version: '2026-11-22' } })).why, 'Claude Code here has no Claude Docs connector, so the Doc can’t be exported.');
});

test('the face’s side of the sync loads no Claude Code or sign-in module: Docs are exported on the other Mac', async () => {
  for (const name of ['claude-sync.mjs', 'typed-pages.mjs', 'claude-sync-worker.mjs']) {
    const source = await readFile(new URL(`../desktop/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from '\.\/(?:claude|doc-export|codex|antigravity)\.mjs'/, name);
  }
});

test('the daily task’s export script brings the Docs whose version is new into the drop folder, and stops when Claude Code can’t', async t => {
  const { refreshDocs } = await import('../scripts/claude-drop/export-docs.mjs');
  const { NO_CONNECTOR: fromExport } = await import('../desktop/doc-export.mjs');
  const { NO_CONNECTOR } = await import('../desktop/typed-pages.mjs');
  assert.equal(fromExport, NO_CONNECTOR);
  const root = await temp(t), dropDir = join(root, 'drop'), other = 'https://claude.ai/artifact/RrsZCLy3A9nVW2EemSbmMT';
  await mkdir(dropDir, { recursive: true });
  await writeFile(join(dropDir, '_typed.json'), JSON.stringify({ items: { [DOC]: { kind: 'doc', title: 'Plan', version: '2026-11-20' }, [other]: { kind: 'doc', title: 'Other', version: '2026-11-19' }, [DESIGN]: { kind: 'design', version: 'x' } } }));
  let calls = 0;
  const done = await refreshDocs({ dropDir, run: async url => { calls++; return { title: url === DOC ? 'Plan' : 'Other', tabs: [{ name: 'Tab 1', html: '<h1>x</h1>' }] }; } });
  assert.deepEqual([done.exported.length, done.failed.length, calls], [2, 0, 2]);
  const typed = await scanTyped(dropDir);
  assert.deepEqual(typed.map(page => [page.kind, page.version]).sort(), [['doc', '2026-11-19'], ['doc', '2026-11-20']]);
  assert.equal((await refreshDocs({ dropDir, run: async () => { throw new Error('should not run'); } })).current, 2);
  await writeFile(join(dropDir, '_typed.json'), JSON.stringify({ items: { [DOC]: { kind: 'doc', version: '2026-11-21' }, [other]: { kind: 'doc', version: '2026-11-21' } } }));
  calls = 0;
  const stopped = await refreshDocs({ dropDir, run: async () => { calls++; throw new Error(NO_CONNECTOR); } });
  assert.deepEqual([calls, stopped.failed.length], [2, 1], 'one more go for the connector, then the run stops');
  assert.equal((await scanTyped(dropDir)).find(page => page.url === DOC).version, '2026-11-20', 'the copy there is kept');
  const install = await readFile(new URL('../scripts/install-fairy.py', import.meta.url), 'utf8');
  assert.match(install, /claude-drop\.py',root\/'scripts\/claude-drop\/export-docs\.mjs',root\/'desktop\/doc-export\.mjs'/);
});

test('a big export Claude Code saved to its tool-results folder is read from there, and nothing outside it is', async () => {
  const { savedOutput } = await import('../desktop/doc-export.mjs');
  const files = new Map([['/Users/me/.claude/projects/-private-tmp/abc/tool-results/mcp-docs-export-1.txt', '{"verdict":"allow"}']]), removed = [];
  const read = path => { if (!files.has(path)) throw new Error('no'); return files.get(path); };
  const said = path => `Error: result (50,773 characters across 1 line) exceeds maximum allowed tokens. Output has been saved to ${path}\nFormat: …`;
  assert.equal(savedOutput(said('/Users/me/.claude/projects/-private-tmp/abc/tool-results/mcp-docs-export-1.txt'), read, () => 20, path => removed.push(path)), '{"verdict":"allow"}');
  assert.equal(removed.length, 1);
  for (const elsewhere of ['/etc/passwd.txt', '/Users/me/.claude/projects/x/abc/tool-results/../../../../secret.txt', '/Users/me/Documents/tool-results/a.txt']) assert.equal(savedOutput(said(elsewhere), read, () => 20), null, elsewhere);
  assert.equal(savedOutput('A plain answer', read), null);
});
