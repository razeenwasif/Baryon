// ChatGPT (Codex) artifact discovery (.html, .md, .pdf, images), storage, two-Mac face sync, and Pages UI wiring.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  CODEX_ID,
  codexArtifactId,
  discoverCodexArtifacts,
  importCodexArtifacts,
} from '../desktop/codex-artifacts.mjs';
import { ArtifactStore } from '../desktop/artifacts.mjs';
import { ClaudeSyncReceiver, ClaudeSyncSender, cleanCodexMeta } from '../desktop/claude-sync.mjs';
import { readJSON, writeJSON } from '../desktop/core.mjs';
import { LOCAL } from '../desktop/remote-channels.mjs';
import { filterByOrigin, groupPages, originDetail, originLabel } from '../src/artifacts-pane.js';

async function makeStore(t: TestContext): Promise<{ root: string; store: ArtifactStore }> {
  const root = await mkdtemp(join(tmpdir(), 'fairy-codex-artifacts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ArtifactStore({
    dir: join(root, 'artifacts'),
    readJSON,
    writeJSON,
    trash: path => rm(path, { recursive: true, force: true }),
    now: () => '2026-11-26T10:00:00.000Z',
  });
  await store.load();
  return { root, store };
}

test('discoverCodexArtifacts and importCodexArtifacts support HTML, Markdown, PDF, and PNG while skipping templates/papers/symlinks', async (t: TestContext) => {
  const root = await mkdtemp(join(tmpdir(), 'fairy-codex-src-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexDir = join(root, '.codex');
  const docsDir = join(root, 'Documents/Codex');
  const projDir = join(root, 'Research/TinyML');

  await mkdir(join(docsDir, '2026-11-24/chat/outputs'), { recursive: true });
  await mkdir(join(codexDir, 'visualizations/2026/09/20/t1/lab'), { recursive: true });
  await mkdir(join(codexDir, 'generated_images/t2'), { recursive: true });
  await mkdir(join(projDir, 'papers'), { recursive: true });

  // 1. Documents/Codex/**/outputs HTML & MD
  await writeFile(join(docsDir, '2026-11-24/chat/outputs/mockups.html'), '<!doctype html><html><head><title>Analytics Mockups</title></head><body>Hi</body></html>');
  await writeFile(join(docsDir, '2026-11-24/chat/outputs/VERDICT.md'), '# Verdict Summary\n\nAll tests passed.\n');

  // 2. ~/.codex/visualizations HTML (plus template that must be skipped)
  await writeFile(join(codexDir, 'visualizations/2026/09/20/t1/lab/memory.html'), '<!doctype html><html><head><title>Memory Lab</title></head><body>Lab</body></html>');
  await writeFile(join(codexDir, 'visualizations/2026/09/20/t1/lab/memory.template.html'), '<!doctype html><html><body>Template</body></html>');

  // 3. ~/.codex/generated_images PNG
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await writeFile(join(codexDir, 'generated_images/t2/plot.png'), pngBytes);

  // 4. Project top-level PDF (included) vs papers/ PDF (skipped) vs symlinked PDF (skipped)
  const pdfBytes = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
  await writeFile(join(projDir, 'research_paper.pdf'), pdfBytes);
  await writeFile(join(projDir, 'papers/reference.pdf'), pdfBytes);
  await writeFile(join(root, 'outside.pdf'), pdfBytes);
  await symlink(join(root, 'outside.pdf'), join(projDir, 'linked.pdf'));

  await writeFile(join(codexDir, '.codex-global-state.json'), JSON.stringify({
    'local-projects': { p1: { rootPaths: [projDir] } },
    'remote-projects': [],
  }));

  const found = await discoverCodexArtifacts({ codexDir, docsDir });
  assert.equal(found.length, 5);
  assert.ok(found.every(one => CODEX_ID.test(one.id) && one.origin === 'codex'));
  assert.ok(found.some(one => one.title === 'Analytics Mockups' && one.kind === 'page'));
  assert.ok(found.some(one => one.title === 'Verdict Summary' && one.kind === 'doc'));
  assert.ok(found.some(one => one.title === 'Memory Lab' && one.kind === 'page'));
  assert.ok(found.some(one => one.title === 'Plot' && one.ext === '.png'));
  assert.ok(found.some(one => one.title === 'Research Paper' && one.ext === '.pdf'));

  const { store } = await makeStore(t);
  const res = await importCodexArtifacts(store, found);
  assert.deepEqual(res, { found: 5, copied: 5, updated: 0, skipped: 0 });
  assert.equal(store.items.length, 5);

  const pdfItem = store.items.find(item => item.title === 'Research Paper')!;
  assert.equal(pdfItem.versions[0].file, 'document.pdf');
  const servedPdf = await store.serve(`/${pdfItem.id}/1/document.pdf`);
  assert.equal(servedPdf.status, 200);
  assert.equal(servedPdf.headers['content-type'], 'application/pdf');

  const pngItem = store.items.find(item => item.title === 'Plot')!;
  const servedPngHtml = await store.serve(`/${pngItem.id}/1/index.html`);
  assert.equal(servedPngHtml.status, 200);
  assert.match(String(servedPngHtml.body), /image\.png/);

  // Re-import unchanged skips all
  const second = await importCodexArtifacts(store, await discoverCodexArtifacts({ codexDir, docsDir }));
  assert.deepEqual(second, { found: 5, copied: 0, updated: 0, skipped: 5 });
});

test('two-Mac face sync pushes ChatGPT (Codex) artifacts and PDFs over /v1/face/claude/{plan-codex,codex}', async (t: TestContext) => {
  const { root, store: miniArtifacts } = await makeStore(t);
  const codexDir = join(root, '.codex');
  const docsDir = join(root, 'Documents/Codex');
  await mkdir(join(docsDir, '2026-11-24/c1/outputs'), { recursive: true });
  await writeFile(join(docsDir, '2026-11-24/c1/outputs/report.pdf'), Buffer.from('%PDF-1.4\n%%EOF\n'));

  const receiver = new ClaudeSyncReceiver({
    sessions: null as any,
    artifacts: miniArtifacts,
    readJSON,
    writeJSON,
    files: { manifest: join(root, 'manifest.json'), state: join(root, 'sync.json') },
    stageDir: join(root, 'stage'),
  });
  const routes: Record<string, 'planCodex' | 'codex'> = { 'plan-codex': 'planCodex', codex: 'codex' };
  const post = async (path: string, body: unknown) => JSON.parse(JSON.stringify(await (receiver as any)[routes[path.split('/').pop()!]](JSON.parse(JSON.stringify(body)))));
  const sender = new ClaudeSyncSender({ post, codexDir, docsDir, cacheFile: join(root, 'c.json'), stageDir: join(root, 's'), readJSON, writeJSON });

  const first = await sender.syncCodex({ manual: true });
  assert.deepEqual(first, { found: 1, copied: 1, updated: 0, skipped: 0, failed: 0 });
  assert.equal(miniArtifacts.items[0].origin, 'codex');
  assert.equal(miniArtifacts.items[0].versions[0].file, 'document.pdf');

  assert.equal(cleanCodexMeta({ id: '../evil', hash: 'a'.repeat(64) } as any), null);
  assert.equal(codexArtifactId('docs:x').startsWith('cdx-'), true);
});

test('Pages UI groups, filters, and wires ChatGPT (Codex) import button and IPC', async () => {
  const items = [
    { id: 'cdx-111111111111111111111111', title: 'Research Paper', origin: 'codex', session: 'codex:all' },
    { id: 'agy-111111111111111111111111', title: 'Fairy Status', origin: 'antigravity', session: 'antigravity:e6bb' },
  ];
  const groups = groupPages(items as any);
  assert.deepEqual(groups.map(g => g.title), ['ChatGPT (Codex) artifacts', 'Antigravity artifacts']);
  assert.deepEqual(filterByOrigin(items as any, 'codex').map(i => i.id), ['cdx-111111111111111111111111']);
  assert.equal(originLabel('codex'), 'ChatGPT');
  assert.equal(originDetail('codex'), 'From ChatGPT (Codex)');
  assert.ok(LOCAL.includes('artifacts-import-codex'));

  const [main, faceMain, preload, pane] = await Promise.all([
    readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/face-main.cts', import.meta.url), 'utf8'),
    readFile(new URL('../desktop/preload.cts', import.meta.url), 'utf8'),
    readFile(new URL('../src/artifacts-pane.ts', import.meta.url), 'utf8'),
  ]);
  assert.match(main, /handle\('artifacts-import-codex'/);
  assert.match(faceMain, /'artifacts-import-codex':/);
  assert.match(preload, /artifactsImportCodex:/);
  assert.match(pane, /Import from ChatGPT \(Codex\)/);
});
