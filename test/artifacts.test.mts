import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, type ReadStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ArtifactStore, RANGE_CHUNK, artifactURL, blobType, byteRange, pagePolicy, plainPath, pointBlobs, preparePage } from '../desktop/artifacts.mjs';
import { attachUploads, desktopRecord, discoverArtifacts, importArtifacts, mergeFound, sameURL, sessionFile, supportingFiles, uploadsFromAnswer, type FoundArtifact } from '../desktop/artifact-import.mjs';
import { DASHBOARD_SOURCES, buildPage, pageFileHandler, pageHistory, pagePrompt, parseCanvas, parseDashboard, parseDoc, parsePage, parseSlides, runPage, type PageFilesReader, type PageProvider, type PublishPagePayload } from '../desktop/page-agent.mjs';
import { deckPage, docPage } from '../desktop/page-types.mjs';
import { pageKind, requestMode, type ChatRoutingHistoryEntry } from '../src/chat-routing.js';
import { readJSON, writeJSON } from '../desktop/core.mjs';

async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'fairy-artifacts-')), trashed: string[] = [];
  t.after(() => rm(root, { recursive: true, force: true }));
  let ids = 0, clock = 0;
  const make = () => new ArtifactStore({ dir: join(root, 'artifacts'), readJSON, writeJSON, trash: async path => { trashed.push(path); await rm(path, { recursive: true, force: true }); },
    now: () => new Date(Date.UTC(2026, 10, 2, 12, 0, clock++)).toISOString(), id: () => `page-${++ids}` });
  const store = make(); await store.load();
  return { root, store, make, trashed };
}
const page = '<!doctype html><html><head><title>A</title></head><body>Hi</body></html>';

test('Fairy’s pages keep every version, and survive a restart', async t => {
  const { store, make } = await setup(t);
  const first = await store.publish({ title: 'Week plan', description: 'A plan', html: page, session: 'chat-1' });
  assert.deepEqual(first, { id: 'page-1', seq: 1, title: 'Week plan' });
  const second = await store.publish({ id: first.id, title: 'Week plan two', html: page.replace('Hi', 'Bye') });
  assert.equal(second.seq, 2);
  const reopened = make(); await reopened.load();
  const [item] = reopened.state().items;
  assert.equal(item.title, 'Week plan two');
  assert.equal(item.session, 'chat-1');
  assert.deepEqual(item.versions.map(version => version.src), [artifactURL('page-1', 1), artifactURL('page-1', 2)]);
  assert.match((await reopened.serve('/page-1/1/index.html')).body as string, /Hi/);
  assert.match((await reopened.serve('/page-1/2/index.html')).body as string, /Bye/);
  await assert.rejects(store.publish({ title: 'Empty', html: '  ' }), /HTML/);
  await assert.rejects(store.publish({ id: 'nope', title: 'x', html: page }), /no longer here/);
});

test('only a version’s own files can be served', async t => {
  const { store, root } = await setup(t);
  const { id } = await store.publish({ title: 'A', html: page });
  await writeFile(join(root, 'secret.txt'), 'secret');
  await writeFile(join(store.dir, 'index-copy.json'), 'secret');
  for (const path of ['/page-1/1/../../index.json', '/page-1/1/%2e%2e/%2e%2e/index.json', '/page-1/1/..%2f..%2f..%2fsecret.txt', '/../secret.txt', '/page-1/9/index.html', '/nope/1/index.html', '/page-1/1/.hidden', '/page-1/1/%00'])
    assert.equal((await store.serve(path)).status, 404, path);
  await symlink(join(root, 'secret.txt'), join(store.versionDir(id, 1), 'link.txt'));
  assert.equal((await store.serve('/page-1/1/link.txt')).status, 404, 'symbolic links are refused');
  for (const bad of ['../x', '/etc/passwd', 'a/../../b', '.env', 'a\\b', '']) assert.equal(plainPath(bad), null, bad);
  assert.equal(plainPath('assets/./a.png'), 'assets/a.png');
});

test('every page gets a policy that keeps it to its own version and away from the app', async t => {
  const { store } = await setup(t);
  await store.publish({ title: 'A', html: page });
  const { headers, status } = await store.serve('/page-1/1/index.html');
  assert.equal(status, 200);
  assert.equal(headers['content-security-policy'], pagePolicy('page-1', '1'));
  assert.match(headers['content-security-policy'], /connect-src fairy-artifact:\/\/page\/page-1\/1\/ /);
  // It may frame its own files (a Design's artboards), and nothing else.
  assert.match(headers['content-security-policy'], /frame-src fairy-artifact:\/\/page\/page-1\/1\/; /);
  assert.match(headers['content-security-policy'], /form-action 'none'/);
  assert.doesNotMatch(headers['content-security-policy'], /ipc:|file:|localhost/);
  assert.equal(headers['x-content-type-options'], 'nosniff');
});

test('pages written for claude.ai still render', () => {
  const full = preparePage(page);
  assert.ok(full.indexOf('window.claude') > full.indexOf('<head>') && full.indexOf('window.claude') < full.indexOf('<title>'), 'the runtime stub comes before page scripts');
  const partial = preparePage('<title>Plan</title><style>a{}</style><main>Hi</main>');
  assert.match(partial, /^<!doctype html>/);
  assert.match(partial, /<body><title>Plan<\/title>/);
  assert.match(preparePage('<!-- note --><!DOCTYPE html><html><body>x</body></html>'), /window\.claude/);
  const markdown = preparePage('# Title <script>alert(1)</script>', 'index.md');
  assert.doesNotMatch(markdown, /<script>alert/);
  assert.match(markdown, /&lt;script&gt;/);
});

test('media can be read in ranges', async t => {
  const { store } = await setup(t);
  await store.publish({ title: 'A', html: page });
  await writeFile(join(store.versionDir('page-1', 1), 'clip.mp4'), Buffer.from('0123456789'));
  const whole = await store.serve('/page-1/1/clip.mp4');
  assert.equal(whole.headers['content-type'], 'video/mp4');
  assert.equal(whole.body.toString(), '0123456789');
  const part = await store.serve('/page-1/1/clip.mp4', 'bytes=2-5');
  assert.equal(part.status, 206);
  assert.equal(part.body.toString(), '2345');
  assert.equal(part.headers['content-range'], 'bytes 2-5/10');
  assert.equal((await store.serve('/page-1/1/clip.mp4', 'bytes=50-')).status, 416);
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(byteRange('nonsense', 10), null);
});

test('a window’s video gets the whole range it asks for, streamed, not the first 2 MB of it', async t => {
  const { store } = await setup(t);
  await store.publish({ title: 'A', html: page });
  const size = RANGE_CHUNK * 2 + 10, clip = Buffer.from(Array.from({ length: size }, (_, i) => i & 0xff));
  await writeFile(join(store.versionDir('page-1', 1), 'clip.mp4'), clip);
  const read = async (stream: AsyncIterable<Buffer>) => { const parts: Buffer[] = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); };
  // Chromium's open-ended ask: a 2 MB answer to it was taken as the end, and the video froze there.
  const open = await store.serve('/page-1/1/clip.mp4', 'bytes=0-', { stream: true });
  assert.equal(open.status, 206);
  assert.equal(open.headers['content-range'], `bytes 0-${size - 1}/${size}`);
  assert.equal(open.headers['content-length'], String(size));
  assert.equal(typeof (open.body as ReadStream).pipe, 'function', 'read as it is sent, not first');
  assert.ok((await read(open.body as ReadStream)).equals(clip));
  const seek = await store.serve('/page-1/1/clip.mp4', 'bytes=3000000-', { stream: true });
  assert.ok((await read(seek.body as ReadStream)).equals(clip.subarray(3_000_000)));
  const exact = await store.serve('/page-1/1/clip.mp4', 'bytes=2-5', { stream: true });
  assert.equal((await read(exact.body as ReadStream)).toString('hex'), '02030405');
  const whole = await store.serve('/page-1/1/clip.mp4', null, { stream: true });
  assert.equal(whole.status, 200); assert.equal(whole.headers['content-length'], String(size)); assert.ok((await read(whole.body as ReadStream)).equals(clip));
  assert.equal((await store.serve('/page-1/1/clip.mp4', 'bytes=99999999-', { stream: true })).status, 416);
  assert.equal(typeof (await store.serve('/page-1/1/index.html', 'bytes=0-', { stream: true })).body, 'string', 'the page itself is never a stream');
  // Both windows ask this way; the phone, whose player asks exact ranges, keeps the 2 MB pieces.
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /artifacts\.serve\(url\.pathname, request\.headers\.get\('range'\), \{ stream: true \}\)/);
  assert.match(main, /artifacts\.serve\(path, range, \{ stream: Boolean\(range\) \}\)/);
  const face = await readFile(new URL('../desktop/face-main.cts', import.meta.url), 'utf8');
  assert.match(face, /Readable\.toWeb\(stream\)/);
});

test('a page made in a new chat joins that chat once it has an id', async t => {
  const { store } = await setup(t);
  const { id } = await store.publish({ title: 'A', html: page, session: '' });
  await store.linkSession(id, 'chat-1');
  await store.linkSession(id, 'chat-2');
  assert.equal(store.state().items[0].session, 'chat-1');
});

test('deleting a page moves its folder to the Trash', async t => {
  const { store, trashed } = await setup(t);
  await store.publish({ title: 'A', html: page });
  await store.remove('page-1');
  assert.deepEqual(trashed, [join(store.dir, 'page-1')]);
  assert.deepEqual(store.state().items, []);
  await assert.rejects(store.remove('../..'), /no longer here/);
});

async function transcripts(root: string, { pagePath, extra = [] }: { pagePath: string; extra?: unknown[] }) {
  const projects = join(root, 'claude', 'projects', 'proj');
  await mkdir(projects, { recursive: true });
  const call = { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'Artifact', input: { file_path: pagePath, description: 'About it', files: { 'assets/a.png': 'a.png', 'evil.sh': 'run.sh', '../up.png': 'a.png' } } }] } };
  const answer = { type: 'user', cwd: join(root, 'work'), timestamp: '2026-10-01T10:00:00.000Z', message: { content: [{ tool_use_id: 'tool-1', type: 'tool_result', content: 'ok' }] },
    toolUseResult: { artifact_id: '46040c81-6f21-497d-b151-cabd337c4ef1', url: 'https://claude.ai/artifact/abc123', title: 'Status page', seq: 3, path: pagePath } };
  const lines = [{ type: 'user', message: { content: 'unrelated' } }, call, answer, ...extra].map(line => JSON.stringify(line)).join('\n');
  await writeFile(join(projects, 'one.jsonl'), `${lines}\n`);
  await writeFile(join(projects, 'none.jsonl'), '{"type":"user"}\nnot json\n');
}

test('past artifacts are found in Claude Code’s sessions and copied with their files', async t => {
  const { root, store, make } = await setup(t);
  const work = join(root, 'work'), pagePath = join(work, 'status.html');
  await mkdir(work, { recursive: true });
  await writeFile(pagePath, page); await writeFile(join(work, 'a.png'), 'png'); await writeFile(join(work, 'run.sh'), 'rm -rf');
  await transcripts(root, { pagePath });
  const found = await discoverArtifacts({ claudeDir: join(root, 'claude'), desktopDir: join(root, 'none') });
  assert.equal(found.length, 1);
  assert.equal(found[0].seq, 3);
  const counts = await importArtifacts(store, found);
  assert.deepEqual(counts, { found: 1, copied: 1, address: 0, skipped: 0, grouped: 0 });
  const [item] = store.state().items;
  assert.equal(item.origin, 'claude');
  assert.equal(item.url, 'https://claude.ai/artifact/abc123');
  assert.equal(item.versions[0].src, artifactURL(item.id, 3, 'index.html'));
  const id = item.id;
  assert.match((await store.serve(`/${id}/3/index.html`)).body as string, /Hi/);
  assert.equal((await store.serve(`/${id}/3/assets/a.png`)).status, 200);
  assert.equal((await store.serve(`/${id}/3/evil.sh`)).status, 404, 'only web file types come along');
  assert.equal((await store.serve(`/${id}/3/up.png`)).status, 404);
  assert.deepEqual(await importArtifacts(store, found), { found: 1, copied: 0, address: 0, skipped: 1, grouped: 0 }, 'importing again adds nothing');
  const reopened = make(); await reopened.load();
  assert.equal(reopened.imported, true);
  assert.equal(await readFile(pagePath, 'utf8'), page, 'the original is left alone');
});

test('a page whose file has gone is kept as its address, then filled in if it comes back', async t => {
  const { root, store } = await setup(t);
  const missing = { url: 'https://claude.ai/artifact/gone', id: 'gone', title: 'Old', source: join(root, 'cleared.html'), seq: 2, at: 1000 } as any;
  assert.equal((await importArtifacts(store, [missing])).address, 1);
  assert.equal(store.state().items[0].versions[0].src, '');
  await writeFile(join(root, 'cleared.html'), page);
  assert.equal((await importArtifacts(store, [missing])).copied, 1);
  assert.equal(store.state().items[0].versions.length, 1);
  assert.notEqual(store.state().items[0].versions[0].src, '');
});

test('only pages are copied as pages, and a link is never followed', async t => {
  const { root, store } = await setup(t);
  await writeFile(join(root, 'canvas.json'), '{}');
  await writeFile(join(root, 'real.html'), page);
  await symlink(join(root, 'real.html'), join(root, 'link.html'));
  assert.equal((await importArtifacts(store, [{ url: 'https://claude.ai/artifact/typed', id: 'typed', title: 'Typed', source: join(root, 'canvas.json'), at: 1 } as any])).address, 1);
  assert.equal((await importArtifacts(store, [{ url: 'https://claude.ai/artifact/linked', id: 'linked', title: 'Linked', source: join(root, 'link.html'), at: 1 } as any])).address, 1);
  assert.equal((await importArtifacts(store, [{ url: 'https://claude.ai/artifact/x', id: '../../evil', title: 'Bad', at: 1 } as any])).copied, 0);
});

test('an address outside claude.ai isn’t kept as a link', async t => {
  const { store } = await setup(t);
  await importArtifacts(store, [{ url: 'https://evil.example/artifact/abc', id: 'abc', title: 'Bad', at: 1 } as any]);
  assert.equal(store.state().items[0].url, '');
});

test('records of one artifact merge, newest details first', () => {
  const found: FoundArtifact[] = [];
  mergeFound(found, { url: 'https://claude.ai/artifact/a/', title: 'Old', id: 'one', source: '/old.html', seq: 1, at: 1 } as any);
  mergeFound(found, { url: 'https://CLAUDE.ai/artifact/a?x=1', title: 'New', id: null, source: '/new.html', seq: undefined, at: 5 } as any);
  assert.equal(found.length, 1);
  assert.deepEqual([found[0].title, found[0].id, found[0].source, found[0].seq], ['New', 'one', '/new.html', 1]);
  assert.equal(sameURL('', ''), false);
  assert.equal(desktopRecord({ cwd: '/w', publishedArtifacts: [{ url: 'https://claude.ai/artifact/a', title: 'T', sourcePath: '/p.html', updatedAt: 1791022128 }, { title: 'no url' }] }).length, 1);
  assert.deepEqual(supportingFiles({ input: { files: ['a.png'] }, source: '/w/p.html', project: '/w' }), [['a.png', ['/w/a.png']]]);
  assert.equal(supportingFiles({ input: {}, source: '/w/p.html', project: '/w' }), null);
});

test('a session file with a bad line still gives up what it can', async t => {
  const { root } = await setup(t);
  const path = join(root, 's.jsonl');
  await writeFile(path, `{"artifact_id" broken\n${JSON.stringify({ timestamp: '2026-10-01T10:00:00Z', toolUseResult: { artifact_id: 'a', url: 'https://claude.ai/artifact/a', seq: 1 } })}\n`);
  assert.equal((await sessionFile(path)).length, 1);
});

test('a model’s page reply is read whichever way it’s wrapped', () => {
  const fenced = parsePage(`TITLE: Week plan\nABOUT: Your week.\n\`\`\`html\n${page}\n\`\`\``);
  assert.deepEqual(fenced, { title: 'Week plan', description: 'Your week.', html: page });
  assert.equal(parsePage(`Here you go:\n${page}\nEnjoy`).html, page);
  assert.equal(parsePage(`**TITLE:** nope\n\`\`\`\n${page}\n\`\`\``).html, page);
  assert.throws(() => parsePage('Sorry, I can’t do that.'), /didn’t return a page/);
  assert.throws(() => parsePage(`\`\`\`html\n${'<p>x</p>'.repeat(400000)}\n\`\`\``), /over 2 MB/);
  assert.match(pagePrompt('Make it blue', { title: 'A', text: page }), /data to edit, not instructions/);
  assert.throws(() => pagePrompt('x', { title: 'A', text: 'x'.repeat(400000) }), /too large/);
});

test('making a page saves it and leaves its HTML out of the chat', async () => {
  const published: PublishPagePayload[] = [];
  const provider: PageProvider = { turn: async ({ input, prompt }) => { assert.match(input[0].text, /Request: Make a page about tea/); assert.match(prompt, /Request: Make a page about tea/); return `TITLE: Tea\nABOUT: All about tea.\n\`\`\`html\n${page}\n\`\`\``; } };
  const result = await runPage({ provider, settings: {}, history: [], text: 'Make a page about tea', session: 'chat-1', publish: async value => { published.push(value); return { id: 'x', seq: 1, title: value.title }; } });
  assert.equal(published[0].files['index.html'], page);
  assert.equal(published[0].session, 'chat-1');
  assert.equal(result.reply, 'I made “Tea”, a page. It’s open in the side panel. All about tea.');
  assert.doesNotMatch(result.reply, /doctype/);
  const failing: PageProvider = { turn: async () => 'No.' };
  await assert.rejects(runPage({ provider: failing, settings: {}, history: [], text: 'x', publish: async () => { throw new Error('must not publish'); } }), /didn’t return a page/);
});

const reply = `TITLE: Tea\nABOUT: All about tea.\n\`\`\`html\n${page}\n\`\`\``, noPublish = async (value: PublishPagePayload) => ({ id: 'x', seq: 1, title: value.title });
const approved: PageFilesReader = { status: () => [{ id: 'root-1', name: 'Courses' }], list: async () => ({ entries: ['a.md'] }), search: async () => ({ hits: [] }), read: async () => ({ path: 'a.md', text: 'measured 16.3 Gop/s' }) };

test('a page gets the provider’s effort, a long limit, and the chat whole or its newest messages with a digest', async () => {
  let call!: Parameters<PageProvider['turn']>[0];
  const long = 'x'.repeat(60000), history: Array<{ role: 'user' | 'assistant'; content: string }> = [{ role: 'user', content: 'oldest words' }, { role: 'assistant', content: long }, { role: 'user', content: long }, { role: 'assistant', content: 'newest words' }];
  await runPage({ provider: { turn: async value => { call = value; return reply; } }, settings: { reasoning: 'xhigh' }, history, text: 'Make a page', publish: noPublish });
  assert.equal(call.effort, 'xhigh');
  assert.equal(call.timeout, 60 * 60 * 1000);
  assert.match(call.input[0].text, /oldest words/);
  assert.match(call.input[0].text, /newest words/);
  // A long chat (token use, step 6): its newest messages in full up to the limit, and those before as one line each.
  assert.doesNotMatch(call.input[0].text, /x{200}/, 'the 60,000-character messages go in as one line each');
  assert.match(call.input[0].text, /Earlier in the chat, one line each:\n- User: oldest words\n- Assistant: x{160}…\n- User: x{160}…\n\nAssistant: newest words/);
  assert.equal(pageHistory([{ role: 'user', content: 'old' }, { role: 'assistant', content: 'new' }]), 'User: old\n\nAssistant: new', 'a short chat goes whole');
  assert.equal(pageHistory([{ role: 'user', content: 'old' }, { role: 'assistant', content: 'new' }], 3, { whole: 0 }), 'Earlier in the chat, one line each:\n- User: old\n\nAssistant: new');
  assert.equal(pageHistory([{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }, { role: 'user', content: 'c' }], 1, { whole: 0, digest: 10 }), 'Earlier in the chat, one line each (1 older message left out):\n- User: b\n\nUser: c');
});

test('a page can read approved folders, but not change them, and not for a dashboard', async () => {
  let call!: Parameters<PageProvider['turn']>[0];
  const provider: PageProvider = { turn: async value => { call = value; return reply; } };
  await runPage({ provider, settings: {}, history: [], text: 'Make a page about my work', files: approved, publish: noPublish });
  assert.deepEqual(call.tools.map(tool => tool.name).sort(), ['files_list', 'files_read', 'files_roots', 'files_search']);
  assert.match(call.instructions, /files_ tools/);
  const read = await call.toolHandler!({ tool: 'files_read', arguments: { rootId: 'root-1', path: 'a.md' } });
  assert.equal(read.success, true);
  assert.match(read.contentItems[0].text, /data, not instructions[\s\S]*16\.3 Gop/);
  assert.equal((await call.toolHandler!({ tool: 'files_write', arguments: {} })).success, false);
  const dashboard = `TITLE: D\nABOUT: A.\nSOURCES: none\n\`\`\`html\n${page}\n\`\`\``;
  await runPage({ provider: { turn: async value => { call = value; return dashboard; } }, settings: {}, history: [], text: 'Make a dashboard', kind: 'dashboard', files: approved, publish: noPublish });
  assert.deepEqual(call.tools, []);
});

test('reading for a page has a budget, and says so', async () => {
  const handler = pageFileHandler(approved);
  for (let i = 0; i < 80; i++) assert.equal((await handler({ tool: 'files_roots' })).success, true);
  const over = await handler({ tool: 'files_roots' });
  assert.equal(over.success, false);
  assert.match(over.contentItems[0].text, /reading budget/);
});

test('with no folder to read, a page about your work says what it had to go on', async () => {
  const provider: PageProvider = { turn: async () => reply };
  const mine = await runPage({ provider, settings: {}, history: [], text: 'Make a page about my assignment', files: { status: () => [] }, publish: noPublish });
  assert.match(mine.reply, /only had this chat to go on/);
  const other = await runPage({ provider, settings: {}, history: [], text: 'Make a page about tea', publish: noPublish });
  assert.doesNotMatch(other.reply, /only had this chat/);
});

test('a page that stops keeps what it had written', async () => {
  const provider: PageProvider = { turn: async ({ onText }) => { onText('<!doctype html><p>half a page'); throw new Error('Claude Code timed out.'); } };
  const failure = (await runPage({ provider, settings: {}, history: [], text: 'Make a page', publish: noPublish }).catch((error: Error & { draft?: string }) => error)) as Error & { draft?: string };
  assert.equal(failure.message, 'Claude Code timed out.');
  assert.match(failure.draft ?? '', /half a page/);
  const cutOff = (await runPage({ provider: { turn: async ({ onText }) => { onText('TITLE: Tea'); return 'TITLE: Tea'; } }, settings: {}, history: [], text: 'Make a page', publish: noPublish }).catch((error: Error & { draft?: string }) => error)) as Error & { draft?: string };
  assert.equal(cutOff.draft, 'TITLE: Tea');
});

test('asking for a page routes to pages, and other uses of the word don’t', () => {
  const settings = { autoDesktop: 'off', autoScreen: 'off' };
  for (const text of ['Make me a dashboard of my study hours', 'Can you build a landing page for my app?', 'create an artifact showing the timeline', 'Design a web page about tea', 'build a one-pager on this'])
    assert.equal(requestMode(text, 'chat', settings), 'page', text);
  for (const text of ['What page of the book was that?', 'Write a page on the Roman empire', 'turn the page', 'how do I make a page break in Word?', 'What is a dashboard?', 'How do I make a good presentation?', 'I read the report', 'make a design decision for me', 'Summarize this document'])
    assert.equal(requestMode(text, 'chat', settings), 'chat', text);
  assert.equal(requestMode('Make me a dashboard of my upcoming calendar events and unread email count', 'chat', settings), 'page', 'a dashboard isn’t an email request');
  assert.equal(requestMode('Make an artifact about my project. Read the files in my approved folder first.', 'chat', settings), 'page', 'a page reads folders itself');
  assert.equal(requestMode('Read the files in my folder and tell me what they do', 'chat', settings), 'files', 'without a page it’s still a file question');
  assert.equal(requestMode('Check my unread email', 'chat', settings), 'gmail');
  const after: ChatRoutingHistoryEntry[] = [{ role: 'assistant', content: 'I made it', mode: 'page' } as any];
  assert.equal(requestMode('Make it blue', 'chat', settings, after), 'page');
  assert.equal(requestMode('What is tea?', 'chat', settings, after), 'chat');
  assert.equal(requestMode('Make it blue', 'chat', settings, []), 'chat');
  assert.equal(requestMode('Make me a dashboard', 'desktop', settings), 'desktop');
});

test('artifact frames are sandboxed away from the app', () => {
  const pane = readFileSync(new URL('../src/artifacts-pane.ts', import.meta.url), 'utf8');
  const sandbox = /sandbox', '([^']*)'/.exec(pane)?.[1] || '';
  assert.match(sandbox, /allow-scripts/);
  assert.doesNotMatch(sandbox, /allow-same-origin|allow-top-navigation|allow-popups/);
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /will-frame-navigate/);
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /frame-src fairy-artifact:/);
});

test('each kind is asked for by name, and routes to the right type', () => {
  const settings = { autoDesktop: 'off', autoScreen: 'off' };
  const cases = { 'Make a slide deck about tides': 'slides', 'Create a presentation on my thesis': 'slides', 'Write a report on solar power': 'doc', 'Draft a proposal for the lab': 'doc', 'Make me a dashboard of my week': 'dashboard', 'Build a study tracker': 'dashboard', 'Make design concepts for the new window': 'canvas', 'Create a mockup of a login screen': 'canvas', 'Make a landing page for my app': 'page' };
  for (const [text, kind] of Object.entries(cases)) { assert.equal(requestMode(text, 'chat', settings), 'page', text); assert.equal(pageKind(text), kind, text); }
});

test('documents become readable pages, and their text can’t become markup', () => {
  const doc = parseDoc('TITLE: Solar\nABOUT: A report.\n```markdown\n# Solar\n\n<script>alert(1)</script> text\n\n```js\ncode()\n```\n```');
  assert.deepEqual([doc.title, doc.description], ['Solar', 'A report.']);
  assert.match(doc.markdown, /```js\ncode\(\)\n```$/, 'code blocks inside survive');
  const html = docPage(doc.markdown, doc.title);
  assert.match(html, /<h1>Solar<\/h1>/);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(docPage('x', '</title><script>bad()</script>'), /&lt;\/title&gt;/);
  assert.equal(parseDoc('No fences here.').markdown, 'No fences here.');
  assert.throws(() => parseDoc('  '), /didn’t return a document/);
  const built = buildPage('doc', 'TITLE: T\n```markdown\n# Hi\n```');
  assert.deepEqual(Object.keys(built.files), ['index.html', 'doc.md']);
});

test('slides are wrapped in a frame with navigation and print pages', () => {
  const reply = 'TITLE: Tides\nABOUT: A talk.\n```html\n<style>section{color:red}</style>\n<section><h1>One</h1></section>\n<section class="x"><h1>Two</h1></section>\n```';
  const deck = parseSlides(reply);
  assert.equal(deck.sections.length, 2);
  const html = deckPage(deck.sections, deck.styles, deck.title);
  assert.match(html, /<section><h1>One/);
  assert.match(html, /section\{color:red\}/);
  assert.match(html, /ArrowRight/);
  assert.match(html, /@media print/);
  assert.match(html, /:where\(#deck>section\)\{background:#fff/, 'a deck’s own colours beat the frame’s defaults');
  assert.doesNotMatch(html.match(/<style>[\s\S]*?<\/style>/)![0].replace(/:where\([^)]*\)\{[^}]*\}/g, ''), /#deck>section[^{]*\{[^}]*(?:background|color:|padding|display)/, 'the frame forces no colours or layout on a slide');
  assert.throws(() => parseSlides('<p>no slides</p>'), /any slides/);
  assert.deepEqual(Object.keys(buildPage('slides', reply).files), ['index.html', 'slides.html']);
});

test('a design comes back as separate concepts, and is capped', () => {
  const concept = (name: string, body: string | number) => `CONCEPT: ${name}\n\`\`\`html\n<!doctype html><p>${body}</p>\n\`\`\`\n`;
  const built = buildPage('canvas', `TITLE: Window\nABOUT: Options.\n${concept('Calm', 'a')}${concept('**Bold**', 'b')}`);
  assert.deepEqual(built.concepts, [{ name: 'Calm', file: 'concept-1.html' }, { name: 'Bold', file: 'concept-2.html' }]);
  assert.match(built.files['concept-2.html'], /<p>b/);
  assert.equal(parseCanvas(Array.from({ length: 7 }, (_, i) => concept(`C${i}`, i)).join('')).concepts.length, 4);
  assert.throws(() => parseCanvas('Nothing.'), /any design concepts/);
});

test('a dashboard names only the sources Fairy offers', () => {
  const parsed = parseDashboard(`TITLE: Week\nABOUT: My week.\nSOURCES: calendar, passwords, email\n\`\`\`html\n${page}\n\`\`\``);
  assert.deepEqual(parsed.sources, ['calendar', 'email']);
  assert.deepEqual(parseDashboard(`SOURCES: none\n\`\`\`html\n${page}\n\`\`\``).sources, []);
  assert.deepEqual(Object.keys(DASHBOARD_SOURCES), ['calendar', 'email']);
});

test('a dashboard’s page can’t send anything out, and gets its data by asking', async t => {
  const { store } = await setup(t);
  const { id } = await store.publish({ kind: 'dashboard', title: 'Week', files: { 'index.html': page }, sources: ['calendar', 'email'] });
  const { headers, body } = await store.serve(`/${id}/1/index.html`);
  const policy = headers['content-security-policy'];
  assert.match(policy, /connect-src 'none'/);
  assert.match(policy, /img-src fairy-artifact:\/\/page\/[^;]+ data:;/);
  assert.doesNotMatch(policy, /https:/);
  assert.match(body as string, /fairy-data-request/);
  await store.publish({ title: 'Plain', html: page });
  const plain = await store.serve('/page-2/1/index.html');
  assert.match(plain.headers['content-security-policy'], /img-src [^;]*https:/);
  assert.doesNotMatch(plain.body as string, /fairy-data-request/);
});

test('a dashboard reads nothing until you allow it, and asks again for anything new', async t => {
  const { store, make } = await setup(t);
  const { id } = await store.publish({ kind: 'dashboard', title: 'Week', html: page, sources: ['calendar'] });
  assert.deepEqual(store.find(id)!.granted, []);
  await store.grant(id, ['calendar', 'email', 'passwords']);
  assert.deepEqual(store.find(id)!.granted, ['calendar'], 'only what it asked for');
  await store.publish({ id, title: 'Week', html: page, sources: ['email'] });
  assert.deepEqual(store.find(id)!.sources, ['email']);
  assert.deepEqual(store.find(id)!.granted, [], 'dropping a source drops its permission, and a new one starts unallowed');
  await store.publish({ id, title: 'Week', html: page });
  const reopened = make(); await reopened.load();
  assert.equal(reopened.find(id)!.kind, 'dashboard');
  assert.deepEqual(reopened.find(id)!.sources, ['email']);
});

test('design comments are kept until the next version, and reach the prompt', async t => {
  const { store, make } = await setup(t);
  const { id } = await store.publish({ kind: 'canvas', title: 'W', files: { 'concept-1.html': page, 'concept-2.html': page }, entry: 'concept-1.html', concepts: [{ name: 'Calm', file: 'concept-1.html' }, { name: 'Bold', file: 'concept-2.html' }] });
  await store.addComment(id, { concept: 'Calm', text: ' More contrast ' });
  await assert.rejects(store.addComment(id, { concept: 'Calm', text: '  ' }), /Write a comment/);
  const reopened = make(); await reopened.load();
  assert.equal(reopened.find(id)!.comments![0].text, 'More contrast');
  const source = (await store.source(id))!;
  assert.deepEqual(source.concepts!.map(concept => concept.name), ['Calm', 'Bold']);
  assert.match(pagePrompt('Apply', source), /On Calm: More contrast/);
  assert.match(pagePrompt('Apply', source), /CONCEPT: Bold/);
  await store.removeComment(id, store.find(id)!.comments![0].id);
  assert.equal(store.find(id)!.comments!.length, 0);
  await store.addComment(id, { text: 'General' });
  await store.publish({ id, title: 'W', files: { 'concept-1.html': page }, entry: 'concept-1.html', concepts: [{ name: 'Calm', file: 'concept-1.html' }] });
  assert.equal(store.find(id)!.comments!.length, 0, 'a new version starts fresh');
  assert.equal(store.state().items[0].versions.at(-1)!.concepts![0].src, artifactURL(id, 2, 'concept-1.html'));
});

test('editing a document keeps its source, and older versions stay', async t => {
  const { store } = await setup(t);
  const { id } = await store.publish({ kind: 'doc', title: 'Doc', files: { 'index.html': docPage('# One'), 'doc.md': '# One' } });
  assert.equal((await store.source(id))!.text, '# One');
  await store.publish({ id, kind: 'doc', title: 'Doc', files: { 'index.html': docPage('# Two'), 'doc.md': '# Two' } });
  assert.equal((await store.source(id))!.text, '# Two');
  assert.equal((await store.source(id, 1))!.text, '# One');
  await assert.rejects(store.publish({ title: 'Bad', files: { '../evil.html': page }, entry: '../evil.html' }), /HTML/);
  await assert.rejects(store.publish({ title: 'Bad', files: { 'a.html': page }, entry: 'b.html' }), /HTML/);
});

test('the frame talks to Fairy only about the dashboard on screen', () => {
  const pane = readFileSync(new URL('../src/artifacts-pane.ts', import.meta.url), 'utf8');
  assert.match(pane, /event\.source !== shownFrame\.contentWindow/);
  assert.match(pane, /shownItem\?\.kind !== 'dashboard'/);
  const main = readFileSync(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /item\.granted\.includes\('calendar'\)/);
  assert.match(main, /item\.granted\.includes\('email'\)/);
  assert.match(main, /\(\{ title, start: from, end, allDay \}\) =>/, 'only these event fields');
  for (const script of ['package-fairy']) assert.match(readFileSync(new URL(`../build-ts/scripts/${script}.mjs`, import.meta.url), 'utf8'), /copyDependency\('markdown-it'\)/);
});

test('imported pages know their Claude Code session, by the name the desktop app shows', async t => {
  const { root, store, make } = await setup(t);
  const work = join(root, 'work'), pagePath = join(work, 'status.html');
  await mkdir(work, { recursive: true }); await writeFile(pagePath, page);
  const titled = (title: string, _at?: unknown) => ({ type: 'custom-title', customTitle: title, sessionId: 'cli-new' });
  await transcripts(root, { pagePath, extra: [titled('Old name'), titled('Fairy status page')] });
  // The transcript's answer line carries the session id, as Claude Code writes it.
  const file = join(root, 'claude', 'projects', 'proj', 'one.jsonl');
  await writeFile(file, (await readFile(file, 'utf8')).replace('"toolUseResult"', '"sessionId":"cli-old","toolUseResult"'));
  let found = await discoverArtifacts({ claudeDir: join(root, 'claude'), desktopDir: join(root, 'none') });
  assert.deepEqual([found[0].chat, found[0].chatTitle], ['cli-old', ''], 'the title belongs to another id until the desktop app links them');
  // The desktop app's record names the session and every id it has had.
  const desktop = join(root, 'desktop'); await mkdir(desktop, { recursive: true });
  await writeFile(join(desktop, 'local_1.json'), JSON.stringify({ title: 'Status page work', cliSessionId: 'cli-new', priorCliSessionIds: ['cli-old'] }));
  found = await discoverArtifacts({ claudeDir: join(root, 'claude'), desktopDir: desktop });
  assert.deepEqual([found[0].chat, found[0].chatTitle], ['cli-new', 'Status page work']);
  await importArtifacts(store, found);
  const [item] = store.state().items;
  assert.deepEqual([item.session, item.sessionTitle], ['claude-code:cli-new', 'Status page work']);
  // Pages imported before grouping learn their session from a group-only pass, which never adds one back.
  const plain = make(); await plain.load();
  plain.items[0].session = ''; delete plain.items[0].sessionTitle; plain.grouped = false;
  await plain.remove(plain.items[0].id);
  assert.deepEqual(await importArtifacts(plain, found, { groupOnly: true }), { found: 1, copied: 0, address: 0, skipped: 1, grouped: 0 });
  assert.equal(plain.items.length, 0, 'a removed page stays removed');
  const kept = make(); await kept.load();
  assert.equal(kept.grouped, true);
});

test('the Pages list groups by session: this chat, then the newest session first, then the rest', async () => {
  const { groupPages } = await import('../src/artifacts-pane.js');
  const items: Array<{ id: string; session: string; sessionTitle?: string }> = [
    { id: 'a', session: 'claude-code:x', sessionTitle: 'Status page work' },
    { id: 'b', session: 'chat-2' }, { id: 'c', session: '' }, { id: 'd', session: 'chat-1' },
    { id: 'e', session: 'claude-code:x', sessionTitle: 'Status page work' }, { id: 'f', session: 'claude-code:y' },
  ];
  const groups = groupPages(items, { current: 'chat-1', titleOf: id => ({ 'chat-2': 'Trip planning' } as Record<string, string>)[id] || '' });
  assert.deepEqual(groups.map(g => [g.title, g.items.map(i => i.id).join('')]), [['This chat', 'd'], ['Status page work', 'ae'], ['Trip planning', 'b'], ['A Claude Code session', 'f'], ['Other pages', 'c']]);
  assert.equal(groupPages([{ id: 'z', session: 'gone' }]).at(0)!.title, 'An earlier chat');
  const forks = groupPages([{ id: 'p', session: 'claude-code:1', sessionTitle: 'Same' }, { id: 'q', session: 'claude-code:2', sessionTitle: 'Same' }]);
  assert.deepEqual(forks.map(g => g.items.length), [2], 'a fork and its parent share a group');
});

test('a long video is sent a piece at a time, so it starts and seeks without reading the whole file', async t => {
  const { store } = await setup(t);
  await store.publish({ title: 'A', html: page });
  const size = RANGE_CHUNK * 2 + 10, clip = Buffer.alloc(size, 7);
  clip.write('tail', size - 4);
  await writeFile(join(store.versionDir('page-1', 1), 'clip.webm'), clip);
  await writeFile(join(store.versionDir('page-1', 1), 'captions.vtt'), 'WEBVTT\n');
  const first = await store.serve('/page-1/1/clip.webm', 'bytes=0-');
  assert.equal(first.status, 206);
  assert.equal(first.headers['content-type'], 'video/webm');
  assert.equal(first.headers['content-range'], `bytes 0-${RANGE_CHUNK - 1}/${size}`);
  assert.equal(first.headers['content-length'], String(RANGE_CHUNK));
  assert.equal((first.body as Buffer).length, RANGE_CHUNK);
  const last = await store.serve('/page-1/1/clip.webm', `bytes=${RANGE_CHUNK * 2}-`);
  assert.equal(last.headers['content-range'], `bytes ${RANGE_CHUNK * 2}-${size - 1}/${size}`);
  assert.equal((last.body as Buffer).subarray(-4).toString(), 'tail');
  assert.equal(((await store.serve('/page-1/1/clip.webm', 'bytes=-4')).body as Buffer).toString(), 'tail', 'the end, for a file whose index comes last');
  const track = await store.serve('/page-1/1/captions.vtt');
  assert.equal(track.headers['content-type'], 'text/vtt; charset=utf-8', 'a caption track is read only as text/vtt');
  assert.equal(track.headers['access-control-allow-origin'], '*', 'a track is read in CORS mode from the sandboxed frame');
  // …which the page's video asks for only if it's told to, so a video given a track is, unless it plays from elsewhere.
  for (const prepared of [preparePage(page), preparePage('<p>bare</p>')]) {
    const runtime = /<script>window\.claude[^<]*<\/script>/.exec(prepared)?.[0] || '';
    assert.match(runtime, /MutationObserver/); assert.match(runtime, /"TRACK"/); assert.match(runtime, /crossOrigin="anonymous"/);
    assert.match(runtime, /hasAttribute\("crossorigin"\)/, 'a page’s own choice stands');
    assert.match(runtime, /if\(!\/\^https\?:\/i\.test\(s\)\)/, 'a remote video keeps loading as before');
  }
});

test('a page’s uploads are pointed at its own copies, and nothing else is changed', () => {
  const a = 'a'.repeat(32), b = 'b'.repeat(32), c = 'c'.repeat(32);
  const html = `<video src="/_blob/${a}"></video><img srcset="/_blob/${b} 2x"><div style="background:url(/_blob/${a})"></div><p>Uploads live at /_blob/${c}.</p><a href="https://claude.ai/_blob/${a}">x</a>`;
  const out = pointBlobs(html, '/p/2/', [a, b]);
  assert.match(out, new RegExp(`<video src="/p/2/_blob/${a}">`));
  assert.match(out, new RegExp(`srcset="/p/2/_blob/${b} 2x"`));
  assert.match(out, new RegExp(`url\\(/p/2/_blob/${a}\\)`));
  assert.match(out, new RegExp(`at /_blob/${c}\\.`), 'an upload Fairy doesn’t have is left as written');
  assert.match(out, new RegExp(`https://claude.ai/_blob/${a}`), 'a full address is left alone');
  assert.equal(pointBlobs(html, '/p/2/', []), html);
  assert.equal(preparePage(`# /_blob/${a}`, 'index.md', { blobs: { base: '/p/2/', ids: [a] } }).includes('/p/2/'), false, 'markdown is shown as written');
  assert.equal(blobType('video/mp4', 'x'), 'video/mp4');
  assert.equal(blobType('', 'clip.MOV'), 'video/quicktime');
  assert.equal(blobType('application/x-evil', 'x.sh'), 'application/octet-stream');
});

test('files uploaded to a claude.ai artifact are found, copied as uploaded, and served at the page’s /_blob/ addresses', async t => {
  const { root, store, make } = await setup(t);
  const work = join(root, 'work'), pagePath = join(work, 'status.html');
  const clipId = '1'.repeat(32), posterId = '2'.repeat(32), changedId = '3'.repeat(32), failedId = '4'.repeat(32), laterId = '5'.repeat(32), otherId = '6'.repeat(32);
  await mkdir(work, { recursive: true });
  await writeFile(pagePath, `<!doctype html><html><head></head><body><video controls poster="/_blob/${posterId}" src="/_blob/${clipId}"></video><img src="/_blob/${changedId}"></body></html>`);
  const clip = Buffer.from('ftyp-clip-bytes'), sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  await writeFile(join(work, 'clip.mp4'), clip); await writeFile(join(work, 'poster.jpg'), 'jpg'); await writeFile(join(work, 'changed.png'), 'now different');
  const upload = (id: string, input: Record<string, unknown>, toolUseResult: Record<string, unknown>) => [{ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Artifact', input }] } },
    { type: 'user', cwd: work, timestamp: '2026-10-02T10:00:00.000Z', message: { content: [{ tool_use_id: id, type: 'tool_result', content: 'Asset uploaded' }] }, toolUseResult }];
  await transcripts(root, { pagePath, extra: upload('up-1', { url: 'https://claude.ai/artifact/abc123', file_path: 'clip.mp4', asset: true },
    { written: { url: 'https://claude.ai/artifact/abc123' }, asset_upload: { id: clipId, url: `/_blob/${clipId}`, content_type: 'video/mp4', sha256: sha(clip), file_name: 'clip.mp4' } }) });
  // Others, from another session: several at once, one changed since and one that failed; and one for a page that isn't here.
  const later = join(root, 'claude', 'projects', 'proj', 'two.jsonl');
  await writeFile(later, [...upload('up-2', { url: 'https://claude.ai/artifact/abc123', asset: true, file_paths: ['poster.jpg', 'changed.png', 'missing.png'] },
    { written: { url: 'https://claude.ai/artifact/abc123' }, asset_uploads: { url: 'https://claude.ai/artifact/abc123', results: [
      { file_path: join(work, 'poster.jpg'), status: 'uploaded', id: posterId, content_type: 'image/jpeg' },
      { file_path: join(work, 'changed.png'), status: 'uploaded', id: changedId, content_type: 'image/png', sha256: sha('as uploaded') },
      { file_path: join(work, 'missing.png'), status: 'failed', id: failedId }] } }),
    ...upload('up-3', { url: 'https://claude.ai/artifact/elsewhere', file_path: 'clip.mp4', asset: true }, { asset_upload: { id: otherId, content_type: 'video/mp4' } })].map(line => JSON.stringify(line)).join('\n') + '\n');
  const found = await discoverArtifacts({ claudeDir: join(root, 'claude'), desktopDir: join(root, 'none') });
  assert.equal(found.length, 1, 'an upload alone doesn’t make a page');
  assert.deepEqual(found[0].assets!.map(asset => asset.id).sort(), [clipId, posterId, changedId].sort());
  assert.equal(found[0].assets!.find(asset => asset.id === clipId)!.path, join(work, 'clip.mp4'), 'a relative path is the session’s folder');
  await importArtifacts(store, found);
  const [item] = store.state().items, id = item.id;
  assert.deepEqual(item.assets, { [clipId]: 'video/mp4', [posterId]: 'image/jpeg' }, 'a file changed since its upload is left out');
  const body = (await store.serve(`/${id}/3/index.html`)).body as string;
  assert.match(body, new RegExp(`src="/${id}/3/_blob/${clipId}"`));
  assert.match(body, new RegExp(`poster="/${id}/3/_blob/${posterId}"`));
  assert.match(body, new RegExp(`src="/_blob/${changedId}"`));
  const video = await store.serve(`/${id}/3/_blob/${clipId}`, 'bytes=0-');
  assert.equal(video.status, 206);
  assert.equal(video.headers['content-type'], 'video/mp4');
  assert.equal(video.headers['content-range'], `bytes 0-${clip.length - 1}/${clip.length}`);
  assert.equal(video.body.toString(), clip.toString());
  assert.match(video.headers['content-security-policy'], new RegExp(`media-src fairy-artifact://page/${id}/3/`), 'the policy that lets the page play it covers the address');
  assert.equal((await store.serve(`/${id}/3/_blob/${changedId}`)).status, 404);
  assert.equal((await store.serve(`/${id}/3/_blob/${'f'.repeat(31)}`)).status, 404);
  assert.equal((await store.serve(`/${id}/9/_blob/${clipId}`)).status, 404, 'only through a version it has');
  const reopened = make(); await reopened.load();
  assert.deepEqual(reopened.state().items[0].assets, item.assets, 'kept across a restart');
  assert.equal((await reopened.serve(`/${id}/3/_blob/${clipId}`)).status, 200);
  // An upload made after the page was copied comes along on the next import, though the page itself hasn't changed.
  await writeFile(join(work, 'later.png'), 'png');
  await writeFile(later, (await readFile(later, 'utf8')) + upload('up-4', { url: 'https://claude.ai/artifact/abc123', file_path: 'later.png', asset: true }, { asset_upload: { id: laterId, content_type: 'image/png' } }).map(line => JSON.stringify(line)).join('\n') + '\n');
  const again = await discoverArtifacts({ claudeDir: join(root, 'claude'), desktopDir: join(root, 'none') });
  assert.deepEqual(await importArtifacts(reopened, again), { found: 1, copied: 1, address: 0, skipped: 0, grouped: 0 });
  assert.equal(reopened.state().items[0].assets![laterId], 'image/png');
  assert.deepEqual(await importArtifacts(reopened, again), { found: 1, copied: 0, address: 0, skipped: 1, grouped: 0 }, 'and only once');
});

test('upload answers are read whichever form they take, and only what was stored counts', () => {
  const id = 'a'.repeat(32);
  assert.equal(uploadsFromAnswer({ toolUseResult: { artifact_id: 'x', url: 'https://claude.ai/artifact/x' } }, {}), null);
  assert.equal(uploadsFromAnswer({ toolUseResult: { asset_upload: { id, content_type: 'video/mp4' } } }, { file_path: '/a.mp4' }), null, 'no artifact named');
  assert.deepEqual(uploadsFromAnswer({ cwd: '/w', toolUseResult: { asset_upload: { id, content_type: 'video/mp4' } } }, { url: 'https://claude.ai/artifact/x', file_path: 'a.mp4' })!.assets,
    [{ id, path: '/w/a.mp4', type: 'video/mp4', sha256: '' }]);
  assert.equal(uploadsFromAnswer({ toolUseResult: { asset_uploads: { url: 'https://claude.ai/artifact/x', results: [{ file_path: '/a', id: 'not-hex', status: 'uploaded' }, { file_path: '/b', id, status: 'too_large' }] } } }, {}), null);
  const found: FoundArtifact[] = [{ url: 'https://claude.ai/artifact/x' } as any];
  attachUploads(found, [{ url: 'https://claude.ai/artifact/x/', at: 2, assets: [{ id, path: '/new' }] } as any, { url: 'https://claude.ai/artifact/x', at: 1, assets: [{ id, path: '/old' }] } as any]);
  assert.deepEqual(found[0].assets, [{ id, path: '/new' }], 'the newest upload of an id wins');
});
