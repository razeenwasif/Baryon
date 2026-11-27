// Electron's own files are mostly checked as text by the other tests, which would miss a file that doesn't load at all
// (found in Away 5: a name declared twice). Each is compiled here as Node would wrap it, without running it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';

for (const file of ['main.cjs', 'face-main.cjs', 'preload.cjs', 'role.cjs']) {
  test(`desktop/${file} compiles`, async () => {
    const source = await readFile(new URL(`../desktop/${file}`, import.meta.url), 'utf8').catch(() => null);
    if (source === null) return;
    assert.doesNotThrow(() => new Script(`(function (exports, require, module, __filename, __dirname) {${source}\n})`, { filename: file }));
  });
}

// The window's own scripts too, which tests read as text and Vite alone parses (found 16 Nov: a name declared twice in
// src/notebook-view.js). node --check parses each as a module without running it.
test('every page script in src/ parses', async () => {
  const { readdirSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir).filter(name => name.endsWith('.js'));
  assert.ok(files.length > 20);
  for (const name of files) {
    try { execFileSync(process.execPath, ['--check', new URL(name, dir).pathname], { stdio: 'pipe' }); }
    catch (error) { assert.fail(`src/${name} doesn’t parse: ${String(error.stderr).split('\n').slice(0, 5).join(' ')}`); }
  }
});
