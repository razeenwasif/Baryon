// Electron's own files are mostly checked as text by the other tests, which would miss a file that doesn't load at all
// (found in Away 5: a name declared twice). Each is compiled here as Node would wrap it, without running it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

for (const file of ['main.cjs', 'face-main.cjs', 'preload.cjs', 'role.cjs']) {
  test(`desktop/${file} compiles`, async () => {
    const source =
      (await readFile(new URL(`../build-ts/desktop/${file}`, import.meta.url), 'utf8').catch(() => null)) ??
      (await readFile(new URL(`../desktop/${file}`, import.meta.url), 'utf8').catch(() => null));
    if (source === null) return;
    assert.doesNotThrow(() => new Script(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, { filename: file }));
  });
}

// The window's own scripts too, which tests read as text and Vite alone parses (found 16 Nov: a name declared twice in
// src/notebook-view.js). node --check parses each as a module without running it.
test('every page script in src/ parses', async () => {
  const { existsSync, readdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const dir = new URL('../src/', import.meta.url);
  const buildDir = new URL('../build-ts/src/', import.meta.url);
  const byName = new Map<string, string>();
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.js')) byName.set(name, new URL(name, dir).pathname);
  }
  if (existsSync(buildDir)) {
    for (const name of readdirSync(buildDir)) {
      if (name.endsWith('.js') && !byName.has(name)) byName.set(name, new URL(name, buildDir).pathname);
    }
  }
  assert.ok(byName.size > 20);
  for (const [name, filePath] of byName) {
    try { execFileSync(process.execPath, ['--check', filePath], { stdio: 'pipe' }); }
    catch (error: unknown) {
      const stderr = error && typeof error === 'object' && 'stderr' in error ? (error as { stderr?: unknown }).stderr : undefined;
      assert.fail(`src/${name} doesn’t parse: ${String(stderr).split('\n').slice(0, 5).join(' ')}`);
    }
  }
});
