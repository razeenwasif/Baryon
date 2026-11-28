import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import test from 'node:test';
import {
  ACADEMY_CALL_NAMES,
  ANALYTICS_CALL_NAMES,
  DESIGN_CALL_NAMES,
  GAME_CALL_NAMES,
  NOTEBOOK_CALL_NAMES,
  RESEARCH_CALL_NAMES,
  STUDIO_CALL_NAMES,
  WORLDS_CALL_NAMES,
} from '../desktop/ipc-contract.js';

const REPO_ROOT = resolve(new URL('..', import.meta.url).pathname);
const require = createRequire(import.meta.url);

test('compiled desktop/app-root.cjs resolves app root consistently across checkout, build-ts, and app.asar', () => {
  const { resolveAppRoot, isCompiledBuildDir } = require(join(REPO_ROOT, 'build-ts/desktop/app-root.cjs'));
  assert.equal(resolveAppRoot(join(REPO_ROOT, 'desktop')), REPO_ROOT);
  assert.equal(resolveAppRoot(join(REPO_ROOT, 'desktop/research')), REPO_ROOT);
  assert.equal(resolveAppRoot(join(REPO_ROOT, 'build-ts/desktop')), REPO_ROOT);
  assert.equal(resolveAppRoot(join(REPO_ROOT, 'build-ts/desktop/notebook')), REPO_ROOT);
  assert.equal(
    resolveAppRoot('/Applications/Baryon.app/Contents/Resources/app.asar/desktop'),
    '/Applications/Baryon.app/Contents/Resources/app.asar',
  );
  assert.equal(isCompiledBuildDir(join(REPO_ROOT, 'build-ts/desktop')), true);
  assert.equal(isCompiledBuildDir(join(REPO_ROOT, 'desktop')), false);
});

test('shared src TypeScript modules resolve cleanly via ts-build-loader after build:desktop', async () => {
  assert.equal(existsSync(join(REPO_ROOT, 'build-ts/src/defaults.js')), true);
  assert.equal(existsSync(join(REPO_ROOT, 'build-ts/src/chat-routing.js')), true);

  const { DEFAULTS, WINDOW_WALLPAPERS } = await import('../src/defaults.js');
  const { requestMode, wantsPage } = await import('../src/chat-routing.js');
  const { ConditionalTask } = await import('../src/conditional-task.js');

  assert.equal(DEFAULTS.name, 'Fairy');
  assert.ok(WINDOW_WALLPAPERS.includes('aurora'));
  assert.equal(requestMode('explain recursion', 'chat', DEFAULTS), 'chat');
  assert.equal(wantsPage('build me a web page dashboard'), true);
  assert.equal(typeof ConditionalTask, 'function');
});

test('desktop/ipc-contract call-name arrays match desktop/preload.cts verbatim', async () => {
  const preload = await readFile(join(REPO_ROOT, 'desktop/preload.cts'), 'utf8');
  const pairs: [string, readonly string[]][] = [
    ['RESEARCH_CALLS', RESEARCH_CALL_NAMES],
    ['NOTEBOOK_CALLS', NOTEBOOK_CALL_NAMES],
    ['ANALYTICS_CALLS', ANALYTICS_CALL_NAMES],
    ['ACADEMY_CALLS', ACADEMY_CALL_NAMES],
    ['DESIGN_CALLS', DESIGN_CALL_NAMES],
    ['STUDIO_CALLS', STUDIO_CALL_NAMES],
    ['WORLDS_CALLS', WORLDS_CALL_NAMES],
    ['GAME_CALLS', GAME_CALL_NAMES],
  ];
  for (const [constName, expected] of pairs) {
    const m = preload.match(new RegExp(`const ${constName} = (\\[[^;\\]]+\\])(?:\\s+as\\s+const)?;`));
    assert.ok(m, `Missing ${constName} in desktop/preload.cts`);
    const actual = Function(`return ${m[1]}`)();
    assert.deepEqual(actual, [...expected], `${constName} drifted from desktop/ipc-contract.ts`);
  }
});
