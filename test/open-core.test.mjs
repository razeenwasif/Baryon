import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { PRO_EXCLUDED_PATHS, isAdminEmail, resolveAccess, resolveEdition } from '../desktop/edition.mjs';
import { openFolderInProton } from '../desktop/proton-open.mjs';
import { kindOf } from '../desktop/remote-channels.mjs';
import { exportCore, sanitizeCorePackageJson } from '../scripts/export-core.mjs';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);

test('resolveEdition gates Pro features cleanly under BARYON_EDITION=core vs pro', () => {
  const pro = resolveEdition({ env: {}, rootDir: REPO_ROOT });
  assert.equal(pro.edition, 'pro');
  assert.equal(pro.isPro, true);
  assert.equal(pro.isCore, false);
  assert.equal(pro.features.research, true);
  assert.equal(pro.features.reproduce, true);
  assert.equal(pro.features.analytics, true);
  assert.equal(pro.features.academy, true);
  assert.equal(pro.features.notebooks, true);
  assert.equal(pro.features.studio, true);
  assert.equal(pro.features.worlds, true);
  assert.equal(pro.features.game, true);

  const core = resolveEdition({ env: { BARYON_EDITION: 'core' }, rootDir: REPO_ROOT });
  assert.equal(core.edition, 'core');
  assert.equal(core.isCore, true);
  assert.equal(core.isPro, false);
  assert.deepEqual(core.features, {
    research: false,
    reproduce: false,
    analytics: false,
    academy: false,
    notebooks: false,
    studio: false,
    worlds: false,
    game: false,
  });
});

test('exportCore excludes Pro modules, writes Apache-2.0 metadata, and Core desktop modules load standalone', async t => {
  const outDir = await mkdtemp(join(tmpdir(), 'baryon-core-test-'));
  t.after(() => rm(outDir, { recursive: true, force: true }));

  const res = await exportCore({ rootDir: REPO_ROOT, outDir, verify: false });
  assert.ok(res.keptCount > 50);
  assert.ok(res.excludedCount > 20);

  for (const excluded of [
    'desktop/research',
    'desktop/reproduce',
    'desktop/analytics',
    'desktop/academy',
    'desktop/notebook',
    'desktop/studio',
    'desktop/worlds',
    'desktop/game',
    'src/analytics',
    'src/academy',
    'src/studio',
    'src/worlds',
    'src/game',
    'native/research',
    'native/analytics',
    'native/notebook-engines',
    'SANDBOX_LOG.md',
    'VERDICT.md',
  ]) {
    assert.equal(existsSync(join(outDir, excluded)), false, `${excluded} must be excluded from Core export`);
  }
  assert.ok(PRO_EXCLUDED_PATHS.includes('desktop/research'));

  const license = await readFile(join(outDir, 'LICENSE'), 'utf8');
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0/);

  const exportedPkg = JSON.parse(await readFile(join(outDir, 'package.json'), 'utf8'));
  assert.equal(exportedPkg.name, 'baryon-core');
  assert.equal(exportedPkg.license, 'Apache-2.0');
  assert.equal(exportedPkg.baryonEdition, 'core');
  assert.equal(exportedPkg.scripts['build:research'], undefined);

  const exportedEdition = resolveEdition({ env: {}, rootDir: outDir });
  assert.equal(exportedEdition.edition, 'core');
  assert.equal(exportedEdition.isCore, true);

  const coreModules = [
    'desktop/edition.mjs',
    'desktop/work-tools.mjs',
    'desktop/goals.mjs',
    'desktop/goal-check.mjs',
    'desktop/runs.mjs',
    'desktop/benchmark-watch.mjs',
    'desktop/phone-pages.mjs',
    'desktop/web-pdf.mjs',
  ];
  const urls = coreModules.map(m => pathToFileURL(join(outDir, m)).href);
  const output = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `for (const u of ${JSON.stringify(urls)}) await import(u); console.log('STANDALONE_OK');`],
    { cwd: outDir, env: { ...process.env, BARYON_EDITION: 'core' }, encoding: 'utf8' },
  );
  assert.match(output, /STANDALONE_OK/);

  const sanitized = sanitizeCorePackageJson({ name: 'lyra-companion', private: true, scripts: { 'package:fairy': 'npm run build && npm run build:study && npm run build:engines && node scripts/package-fairy.mjs' } });
  assert.equal(sanitized.scripts['package:fairy'], 'npm run build && node scripts/package-fairy.mjs');
});

test('admin privileges grant razeen.wasif66@gmail.com full admin access and checkout/Proton/notch wiring exist', async () => {
  assert.equal(isAdminEmail('razeen.wasif66@gmail.com'), true);
  assert.equal(isAdminEmail('Razeen.Wasif66@gmail.com'), true);
  assert.equal(isAdminEmail('other@example.com'), false);

  const editionInfo = resolveEdition({ env: { BARYON_EDITION: 'core' }, rootDir: REPO_ROOT });
  const adminAccess = resolveAccess({ editionInfo, email: 'razeen.wasif66@gmail.com' });
  assert.equal(adminAccess.isAdmin, true);
  assert.equal(adminAccess.plan, 'admin');
  assert.deepEqual(adminAccess.privileges, ['pro-all', 'admin-override', 'billing-bypass', 'edition-preview']);

  assert.equal(kindOf('open-in-proton'), 'local');
  await assert.rejects(() => openFolderInProton('', { home: '/Users/tester', exists: () => true }), /Open a work session/);
  await assert.rejects(() => openFolderInProton('/Users/tester/../etc', { home: '/Users/tester', exists: () => true }), /cannot contain/);
  await assert.rejects(() => openFolderInProton('/etc/passwd', { home: '/Users/tester', exists: () => true }), /inside your home/);

  const launched = [];
  const res = await openFolderInProton('/Users/tester/Github/Lyra', {
    home: '/Users/tester',
    exists: p => p === '/Applications/Proton.app' || p === '/Users/tester/Github/Lyra',
    isDir: () => true,
    openRunner: async (cmd, args) => { launched.push({ cmd, args }); },
  });
  assert.equal(res.ok, true);
  assert.deepEqual(launched, [{ cmd: '/usr/bin/open', args: ['-a', '/Applications/Proton.app', '/Users/tester/Github/Lyra'] }]);

  const appSrc = await readFile(join(REPO_ROOT, 'src/app.js'), 'utf8');
  for (const id of ['work-notch', 'notch-worktree-btn', 'notch-branch-btn', 'chat-header-proton', 'pricing-view', 'sidebar-pricing']) {
    assert.ok(appSrc.includes(id), `src/app.js must wire ${id}`);
  }

  const pricingSrc = await readFile(join(REPO_ROOT, 'src/pricing-view.js'), 'utf8');
  assert.ok(pricingSrc.includes('Open Core'), 'pricing-view must include Open Core');
  assert.ok(pricingSrc.includes('Baryon Pro'), 'pricing-view must include Baryon Pro');
  assert.equal(pricingSrc.includes('Team / Lab'), false, 'pricing-view must not include Team / Lab');
  assert.equal(pricingSrc.includes("id: 'team'"), false, 'pricing-view must not include team tier');
});
