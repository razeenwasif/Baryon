// Antigravity artifact discovery, duplicate separation from Claude artifacts, two-Mac face sync, and Pages UI grouping/filtering.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ANTIGRAVITY_ID,
  antigravityArtifactId,
  discoverAntigravityArtifacts,
  extractArtifactTitle,
  humanizeFilename,
  importAntigravityArtifacts,
} from '../desktop/antigravity-artifacts.mjs';
import { ArtifactStore } from '../desktop/artifacts.mjs';
import { ClaudeSyncReceiver, ClaudeSyncSender, cleanAntigravityMeta } from '../desktop/claude-sync.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { LOCAL } from '../desktop/remote-channels.mjs';
import { filterByOrigin, groupPages, originDetail, originLabel } from '../src/artifacts-pane.js';

async function makeStore(t) {
  const root = await mkdtemp(join(tmpdir(), 'fairy-agy-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ArtifactStore({
    dir: join(root, 'artifacts'),
    readJSON,
    writeJSON,
    trash: path => rm(path, { recursive: true, force: true }),
    now: () => '2026-11-21T07:10:00.000Z',
  });
  await store.load();
  return { root, store };
}

test('discoverAntigravityArtifacts finds userFacing HTML & Markdown artifacts, skips internal/non-userFacing/symlinks, and collects sibling assets', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fairy-agy-brain-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const convA = join(root, '11111111-2222-3333-4444-555555555555');
  const convB = join(root, 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  await mkdir(join(convA, '.system_generated'), { recursive: true });
  await mkdir(join(convA, 'scratch'), { recursive: true });
  await mkdir(join(root, 'tempmediaStorage'), { recursive: true });
  await mkdir(convB, { recursive: true });

  // 1. User-facing HTML artifact with title entities and sibling PNG asset
  await writeFile(join(convA, 'fairy-status.html'), '<!doctype html><html><head><title>Fairy Status &amp; Plan</title></head><body><img src="chart.png"></body></html>');
  await writeFile(join(convA, 'fairy-status.html.metadata.json'), JSON.stringify({ userFacing: true, summary: 'Editable Fairy status dashboard', updatedAt: '2026-11-21T07:00:00Z' }));
  await writeFile(join(convA, 'chart.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  // 2. Non-userFacing internal artifact -> MUST be skipped
  await writeFile(join(convA, 'internal_plan.md'), '# Internal Notes\nNot user facing.');
  await writeFile(join(convA, 'internal_plan.md.metadata.json'), JSON.stringify({ userFacing: false, summary: 'Hidden' }));

  // 3. Unmarked file without .metadata.json -> MUST be skipped
  await writeFile(join(convA, 'draft.html'), '<html><body>Untracked</body></html>');

  // 4. Symlinked artifact -> MUST be skipped
  await writeFile(join(root, 'secret.html'), '<html><body>Outside</body></html>');
  await symlink(join(root, 'secret.html'), join(convA, 'evil.html'));
  await writeFile(join(convA, 'evil.html.metadata.json'), JSON.stringify({ userFacing: true, summary: 'Symlink' }));

  // 5. User-facing Markdown artifact in another conversation
  await writeFile(join(convB, 'roadmap.md'), '# Graviton Roadmap\n\n- Stage 1\n- Stage 2\n');
  await writeFile(join(convB, 'roadmap.md.metadata.json'), JSON.stringify({ userFacing: true, summary: 'Roadmap summary', updatedAt: '2026-11-21T07:05:00Z' }));

  const found = await discoverAntigravityArtifacts({ brainDir: root });
  assert.equal(found.length, 2);
  const [htmlArt, mdArt] = found;
  assert.match(htmlArt.id, ANTIGRAVITY_ID);
  assert.equal(htmlArt.id, antigravityArtifactId('11111111-2222-3333-4444-555555555555', 'fairy-status.html'));
  assert.equal(htmlArt.title, 'Fairy Status & Plan');
  assert.equal(htmlArt.description, 'Editable Fairy status dashboard');
  assert.equal(htmlArt.kind, 'page');
  assert.deepEqual(htmlArt.files.map(([rel]) => rel), ['chart.png'], 'bundled PNG asset without bundling .metadata.json or sibling HTML/MD');

  assert.equal(mdArt.title, 'Graviton Roadmap');
  assert.equal(mdArt.kind, 'doc');
  assert.equal(mdArt.origin, 'antigravity');
  assert.equal(extractArtifactTitle('<html><body><h1>Only Heading</h1></body></html>', 'foo.html', '.html'), 'Only Heading');
  assert.equal(humanizeFilename('my_cool-status.html'), 'My Cool Status');
});

test('Antigravity and Claude artifacts with the exact same title stay completely separate, version independently, and render Markdown cleanly', async t => {
  const { root, store } = await makeStore(t);

  // Import a Claude artifact named "Fairy Status & Plan"
  const claudeFile = join(root, 'claude-fairy.html');
  await writeFile(claudeFile, '<!doctype html><html><head><title>Fairy Status &amp; Plan</title></head><body>Claude copy</body></html>');
  await store.importFound({
    url: 'https://claude.ai/artifact/5UTdCvnmAu83yw13ie8x72',
    id: '243a0b50-8dd2-4bb5-8493-487c3382f7a1',
    title: 'Fairy Status & Plan',
    source: claudeFile,
    seq: 510,
    at: Date.parse('2026-11-21T05:00:00Z'),
    chat: 'cc-1',
    chatTitle: 'Fairy | Agentic Harness',
  });

  // Import an Antigravity HTML artifact ALSO named "Fairy Status & Plan" + an Antigravity Markdown doc
  const brain = join(root, 'brain');
  const conv = join(brain, 'e6bb0553-7fc0-4576-87f0-e397d4533b4f');
  await mkdir(conv, { recursive: true });
  await writeFile(join(conv, 'fairy-status-and-plan.html'), '<!doctype html><html><head><title>Fairy Status &amp; Plan</title></head><body>Antigravity copy v1</body></html>');
  await writeFile(join(conv, 'fairy-status-and-plan.html.metadata.json'), JSON.stringify({ userFacing: true, summary: 'Antigravity editable copy', updatedAt: '2026-11-21T07:00:00Z' }));
  await writeFile(join(conv, 'notes.md'), '# Release Notes\n\n| Item | Status |\n| --- | --- |\n| Part A | Done |\n');
  await writeFile(join(conv, 'notes.md.metadata.json'), JSON.stringify({ userFacing: true, summary: 'Release notes doc', updatedAt: '2026-11-21T07:01:00Z' }));

  const first = await importAntigravityArtifacts(store, await discoverAntigravityArtifacts({ brainDir: brain }));
  assert.deepEqual(first, { found: 2, copied: 2, updated: 0, skipped: 0 });
  assert.equal(store.items.length, 3, 'Claude copy and both Antigravity copies live side by side');

  const claudeItem = store.items.find(item => item.origin === 'claude');
  const agyHtml = store.items.find(item => item.origin === 'antigravity' && item.kind === 'page');
  const agyMd = store.items.find(item => item.origin === 'antigravity' && item.kind === 'doc');
  assert.ok(claudeItem && agyHtml && agyMd);
  assert.equal(claudeItem.title, 'Fairy Status & Plan');
  assert.equal(agyHtml.title, 'Fairy Status & Plan');
  assert.notEqual(claudeItem.id, agyHtml.id);

  // Markdown artifact rendered as formatted HTML and preserved doc.md source
  const renderedMd = await store.serve(`/${agyMd.id}/1/index.html`);
  assert.equal(renderedMd.status, 200);
  assert.match(renderedMd.body, /<h1>Release Notes<\/h1>/);
  assert.match(renderedMd.body, /<table>/);
  assert.match((await store.source(agyMd.id, 1)).text, /# Release Notes/);

  // Re-importing unchanged artifacts skips them (no duplicate versions)
  const same = await importAntigravityArtifacts(store, await discoverAntigravityArtifacts({ brainDir: brain }));
  assert.deepEqual(same, { found: 2, copied: 0, updated: 0, skipped: 2 });

  // Editing the Antigravity HTML file creates v2 ONLY on the Antigravity item; Claude item stays untouched at v510!
  await writeFile(join(conv, 'fairy-status-and-plan.html'), '<!doctype html><html><head><title>Fairy Status &amp; Plan</title></head><body>Antigravity copy v2</body></html>');
  const edited = await importAntigravityArtifacts(store, await discoverAntigravityArtifacts({ brainDir: brain }));
  assert.deepEqual(edited, { found: 2, copied: 0, updated: 1, skipped: 1 });
  assert.deepEqual(agyHtml.versions.map(v => v.seq), [1, 2]);
  assert.deepEqual(claudeItem.versions.map(v => v.seq), [510], 'Claude copy untouched');

  // Removing an Antigravity item records it in removed: auto-sync (respectRemoved: true) skips it, manual re-import restores it
  await store.remove(agyHtml.id);
  assert.equal(store.wasRemoved({ id: agyHtml.id }), true);
  const autoAgain = await importAntigravityArtifacts(store, await discoverAntigravityArtifacts({ brainDir: brain }), { respectRemoved: true });
  assert.equal(autoAgain.copied, 0);
  const manualAgain = await importAntigravityArtifacts(store, await discoverAntigravityArtifacts({ brainDir: brain }), { respectRemoved: false });
  assert.equal(manualAgain.copied, 1);
});

test('two-Mac face sync pushes Antigravity artifacts from MacBook to mini over /v1/face/claude/{plan-antigravity,antigravity}', async t => {
  const { root, store: miniArtifacts } = await makeStore(t);
  const brain = join(root, 'macbook-brain');
  const conv = join(brain, '32b8cb69-0427-43f4-ba57-433d18ae217e');
  await mkdir(conv, { recursive: true });
  await writeFile(join(conv, 'graviton-status.html'), '<!doctype html><html><head><title>Graviton Status &amp; Plan</title></head><body>Graviton v1</body></html>');
  await writeFile(join(conv, 'graviton-status.html.metadata.json'), JSON.stringify({ userFacing: true, summary: 'Graviton dashboard', updatedAt: '2026-11-21T06:31:00Z' }));

  const receiver = new ClaudeSyncReceiver({
    sessions: null,
    artifacts: miniArtifacts,
    readJSON,
    writeJSON,
    files: { manifest: join(root, 'manifest.json'), state: join(root, 'sync.json') },
    stageDir: join(root, 'stage'),
  });
  const routes = { 'plan-antigravity': 'planAntigravity', antigravity: 'antigravity' };
  const post = async (path, body) => JSON.parse(JSON.stringify(await receiver[routes[path.split('/').pop()]](JSON.parse(JSON.stringify(body)))));
  const sender = new ClaudeSyncSender({ post, brainDir: brain, cacheFile: join(root, 'c.json'), stageDir: join(root, 's'), readJSON, writeJSON });

  const first = await sender.syncAntigravity({ manual: true });
  assert.deepEqual(first, { found: 1, copied: 1, updated: 0, skipped: 0, failed: 0 });
  assert.equal(miniArtifacts.items.length, 1);
  assert.equal(miniArtifacts.items[0].origin, 'antigravity');
  assert.equal(miniArtifacts.items[0].title, 'Graviton Status & Plan');

  // Second run skips unchanged artifact
  const second = await sender.syncAntigravity({ manual: true });
  assert.deepEqual(second, { found: 1, copied: 0, updated: 0, skipped: 1, failed: 0 });

  // Hostile payloads are rejected by cleanAntigravityMeta / receiver.antigravity
  assert.equal(cleanAntigravityMeta({ id: '../evil', hash: 'a'.repeat(64) }), null);
  assert.equal(cleanAntigravityMeta({ id: '243a0b50-8dd2-4bb5-8493-487c3382f7a1', hash: 'a'.repeat(64) }), null, 'cannot spoof a Claude artifact id');
  await assert.rejects(receiver.antigravity({ page: { id: 'not-agy', hash: 'a'.repeat(64) }, main: { ext: '.html', data: 'PGh0bWw+' } }), /wasn’t understood/);
});

test('Pages UI separates Antigravity and Claude duplicates into distinct groups, filters by source, and wires LOCAL IPC on both Macs', async () => {
  const items = [
    { id: '243a0b50', title: 'Fairy Status & Plan', origin: 'claude', session: 'claude-code:1', sessionTitle: 'Fairy | Agentic Harness' },
    { id: 'agy-111111111111111111111111', title: 'Fairy Status & Plan', origin: 'antigravity', session: 'antigravity:e6bb0553' },
    { id: 'fairy-1', title: 'Scratch Diagram', origin: 'fairy', session: 'chat-1' },
  ];
  const groups = groupPages(items, { current: 'chat-1' });
  assert.deepEqual(
    groups.map(g => [g.title, g.items.map(i => i.id)]),
    [
      ['This chat', ['fairy-1']],
      ['Fairy | Agentic Harness', ['243a0b50']],
      ['Antigravity artifacts', ['agy-111111111111111111111111']],
    ],
  );
  assert.deepEqual(filterByOrigin(items, 'antigravity').map(i => i.id), ['agy-111111111111111111111111']);
  assert.deepEqual(filterByOrigin(items, 'claude').map(i => i.id), ['243a0b50']);
  assert.deepEqual(filterByOrigin(items, 'fairy').map(i => i.id), ['fairy-1']);
  assert.equal(originLabel('antigravity'), 'Antigravity');
  assert.equal(originDetail('antigravity'), 'From Antigravity');
  assert.equal(originLabel('claude'), 'Claude');
  assert.ok(LOCAL.includes('artifacts-import-antigravity'));

  const [main, faceMain, preload, pane] = await Promise.all([
    readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/face-main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/preload.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/artifacts-pane.js', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /handle\('artifacts-import-antigravity'/);
  assert.match(faceMain, /'artifacts-import-antigravity':/);
  assert.match(preload, /artifactsImportAntigravity:/);
  assert.match(pane, /Import from Antigravity/);
  assert.match(pane, /page-origin-tabs/);
});
