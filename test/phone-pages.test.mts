import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ArtifactStore, pagePolicy } from '../desktop/artifacts.mjs';
import { LongTermMemory } from '../desktop/long-term-memory.mjs';
import { phoneAbout, phoneBoardDetail, phoneMemory, phoneModelsCatalog, phonePageFile, phonePages, phoneUsageReport } from '../desktop/phone-pages.mjs';

async function pages() {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-pages-'));
  const store = new ArtifactStore({ dir, readJSON: (async () => null) as any, writeJSON: async () => {}, trash: async () => {} });
  return { dir, store, done: () => rm(dir, { recursive: true, force: true }) };
}
const refuses = (work: Promise<unknown>, status: number) => assert.rejects(work, (error: any) => error.status === status);

test('a phone hears only what it needs to list a page', async () => {
  const { store, done } = await pages();
  const { id } = await store.publish({ title: 'Week', description: 'The week.', html: '<!doctype html><p>1</p>', session: 'chat-1' });
  await store.publish({ id, html: '<!doctype html><p>2</p>' });
  await store.addComment(id, { text: 'A private note' });
  (store.items[0] as any).url = 'https://claude.ai/artifact/secret';
  const [page] = phonePages(store.state());
  assert.equal(page.title, 'Week');
  assert.equal(page.session, 'chat-1');
  assert.equal(page.opens, true);
  assert.deepEqual(page.versions.map(version => version.seq), [1, 2]);
  assert.deepEqual(Object.keys(page).sort(), ['description', 'id', 'kind', 'opens', 'session', 'title', 'updatedAt', 'versions']);
  assert.deepEqual(Object.keys(page.versions[0]).sort(), ['at', 'concepts', 'file', 'seq']);
  await done();
});

test('leaves out versions whose file has gone, and pages with none left', async () => {
  const { store, done } = await pages();
  const { id } = await store.publish({ title: 'Kept', html: '<!doctype html><p>1</p>' });
  store.items[0].versions.unshift({ seq: 0, file: null as any, at: '' });
  store.items.push({ ...store.items[0], id: 'gone', title: 'Gone', versions: [{ seq: 1, file: null as any, at: '' }] });
  const listed = phonePages(store.state());
  assert.deepEqual(listed.map(page => page.id), [id]);
  assert.deepEqual(listed[0].versions.map(version => version.seq), [1]);
  await done();
});

test('a page’s policy on a phone names nothing remote', () => {
  const policy = pagePolicy('p1', 1, { offline: true });
  assert.doesNotMatch(policy, /https?:|\*/);
  assert.match(policy, /connect-src fairy-artifact:\/\/page\/p1\/1\//);
  assert.match(policy, /frame-src fairy-artifact:\/\/page\/p1\/1\/; /);
  assert.match(policy, /form-action 'none'/);
  // The Mac's own window isn't changed by this.
  assert.match(pagePolicy('p1', 1), /https:\/\/cdn\.jsdelivr\.net/);
});

test('sends a page’s own files with that policy', async () => {
  const { store, done } = await pages();
  const { id, seq } = await store.publish({ title: 'Page', files: { 'index.html': '<!doctype html><p>Hi</p>', 'data.json': '{"a":1}' } });
  const page = await phonePageFile(store as any, { id, seq: String(seq), path: 'index.html' });
  assert.equal(page.status, 200);
  assert.match(page.body as unknown as string, /<p>Hi<\/p>/);
  assert.match(page.headers['Content-Type']!, /text\/html/);
  assert.doesNotMatch(page.headers['Content-Security-Policy']!, /https?:/);
  assert.equal(page.headers['X-Fairy-Needs-Internet'], undefined);
  const data = await phonePageFile(store as any, { id, seq: String(seq), path: 'data.json' });
  assert.equal(String(data.body), '{"a":1}');
  assert.match(data.headers['Content-Type']!, /json/);
  const part = await phonePageFile(store as any, { id, seq: String(seq), path: 'data.json', range: 'bytes=0-1' });
  assert.equal(part.status, 206);
  assert.equal(String(part.body), '{"');
  assert.equal(part.headers['Content-Range'], 'bytes 0-1/7');
  await done();
});

test('won’t send anything outside that page’s version', async () => {
  const { dir, store, done } = await pages();
  const { id, seq } = await store.publish({ title: 'Page', html: '<!doctype html><p>Hi</p>' });
  await writeFile(join(dir, 'index.json'), '{"secret":true}');
  const asking = (path: string) => phonePageFile(store as any, { id, seq: String(seq), path });
  for (const path of ['../../index.json', '../index.html', '/etc/passwd', '.hidden', 'a/../../../index.json', 'missing.html']) await refuses(asking(path), 404);
  await refuses(phonePageFile(store as any, { id: '../..', seq: '1', path: 'index.json' }), 404);
  await refuses(phonePageFile(store as any, { id: 'nope', seq: '1', path: 'index.html' }), 404);
  await refuses(phonePageFile(store as any, { id, seq: '99', path: 'index.html' }), 404);
  for (const missing of [{ seq: '1', path: 'a' }, { id, path: 'a' }, { id, seq: '1' }] as any[]) await refuses(phonePageFile(store as any, missing), 400);
  await done();
});

test('a dashboard stays on the Mac', async () => {
  const { store, done } = await pages();
  const { id, seq } = await store.publish({ kind: 'dashboard', title: 'Today', sources: ['calendar'], html: '<!doctype html><p>Hi</p>' });
  assert.equal(phonePages(store.state())[0].opens, false);
  await refuses(phonePageFile(store as any, { id, seq: String(seq), path: 'index.html' }), 409);
  await done();
});

test('says when a page counts on a script from the internet', async () => {
  const { store, done } = await pages();
  const check = async (html: string, expected: string | undefined) => {
    const { id, seq } = await store.publish({ title: 'Page', html });
    assert.equal((await phonePageFile(store as any, { id, seq: String(seq), path: 'index.html' })).headers['X-Fairy-Needs-Internet'], expected, html);
  };
  await check('<!doctype html><script src="https://cdn.jsdelivr.net/npm/chart.js"></script>', '1');
  await check('<!doctype html><script defer src=//unpkg.com/x></script>', '1');
  await check('<!doctype html><script src="local.js"></script><script>const a = 1;</script>', undefined);
  await check('<!doctype html><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">', undefined);
  await done();
});

test('memory goes to a phone without its history or what was forgotten', async () => {
  const memory = new LongTermMemory({ read: async () => null, write: async () => {} });
  await memory.add('you', 'Likes short answers.');
  await memory.add('projects', 'Writing up the thesis.');
  memory.items[1].source = 'reflection';
  memory.used = [memory.items[0].id];
  memory.forgotten = ['abc'];
  memory.lastReflection = { at: '2026-11-03T08:14:00Z', changes: [{ action: 'added', text: 'Writing up the thesis.' }, { action: 'removed', text: 'An old note.' }] } as any;
  memory.undoItems = [{ id: 'old', kind: 'you', text: 'A note that was undone.', source: 'you', at: '' }];
  const sent = phoneMemory(memory.state() as any, 'on');
  assert.deepEqual(sent.notes.map(note => [note.kind, note.text, note.used, note.fromReflection]), [['you', 'Likes short answers.', true, false], ['projects', 'Writing up the thesis.', false, true]]);
  assert.deepEqual(sent.reflection, { on: true, at: '2026-11-03T08:14:00Z', undone: false, added: 1, changed: 1 });
  const text = JSON.stringify(sent);
  for (const hidden of ['An old note.', 'undone.', 'abc', 'undoItems', 'forgotten']) assert.ok(!text.includes(hidden), hidden);
  assert.deepEqual(phoneMemory({ items: [], used: [], lastReflection: null }, 'off').reflection, { on: false, at: null, undone: false, added: 0, changed: 0 });
});

test('counts what’s on the Mac and names who runs its work', async () => {
  const { store, done } = await pages();
  await store.publish({ title: 'Page', html: '<!doctype html><p>Hi</p>' });
  const memory = { items: [{}, {}] }, schedules = [{ enabled: true }, { enabled: false }];
  assert.deepEqual(phoneAbout({ pages: store.state(), memory, schedules, workProvider: 'codex' } as any), { pages: 1, notes: 2, routines: 1, workProvider: 'Codex' });
  assert.equal(phoneAbout({ pages: store.state(), memory, schedules, workProvider: undefined } as any).workProvider, 'Claude');
  const extended = phoneAbout({
    pages: store.state(), memory, schedules, workProvider: 'antigravity',
    checkIns: { brief: { enabled: true, time: '07:30' }, lastBrief: '2026-11-21', lastBriefError: { at: '2026-11-22T20:30:00Z', message: 'Signed out' }, checkIns: { enabled: true, everyHours: 6 }, lastCheck: '2026-11-25T08:00:00Z', lastCheckError: null },
    providers: { claude: false, antigravity: true, codex: true, openai: false },
  } as any);
  assert.equal(extended.appName, 'Baryon');
  assert.equal((extended.brief!.lastError as any).message, 'Signed out');
  assert.equal(extended.providers!.antigravity, true);
  await done();
});

test('phoneUsageReport, phoneModelsCatalog, and phoneBoardDetail serialize finite iOS payloads', () => {
  const now = new Date('2026-11-25T10:00:00Z');
  const report = phoneUsageReport({
    now,
    events: [{ at: '2026-11-25T09:00:00Z', provider: 'gemini', model: 'gemini-4-neon-medium', input: 1000, output: 200, cached: 500, total: 1200, cost: 0.015, cacheSaved: 0.005 }],
    plans: { gemini: { meters: [{ short: '5h', label: '5-hour limit', used: 12, resets: '6pm' }] } },
  });
  assert.equal(report.daily.length, 14);
  for (const pt of report.daily) {
    assert.equal(typeof pt.tokens, 'number');
    assert.equal(Number.isFinite(pt.cost), true);
  }
  assert.ok(Math.abs(report.daily.at(-1)!.cost - 0.015) < 1e-9);
  assert.equal(report.summary30.totalTokens, 1200);
  assert.equal(report.byProvider[0].provider, 'gemini');
  assert.equal(report.byModel[0].model, 'gemini-4-neon-medium');

  const catalog = phoneModelsCatalog({ settings: { backend: 'claude', claudeModel: 'claude-opus-5-5', claudeEffort: 'high' }, connected: { claude: false, antigravity: true } });
  assert.equal(catalog.current.provider, 'claude');
  assert.equal(catalog.providers.length, 4);

  const board = phoneBoardDetail({ meta: { id: 'b1', name: 'Plan', elementCount: 1 }, document: { background: 'dots', elements: { e1: { id: 'e1', type: 'sticky', x: 10, y: 20, title: 'Hi', text: 'World' } } } });
  assert.equal(board.elements.length, 1);
  assert.equal(board.elements[0].w, 180);
});
