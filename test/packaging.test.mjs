import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

// The packaged app ships only listed files from src/, so anything the main process imports must be listed.
test('every source file the desktop code imports is packaged', async () => {
  const desktop = new URL('../desktop/', import.meta.url), needed = new Set();
  for (const name of await readdir(desktop)) {
    if (!/\.(?:mjs|cjs)$/.test(name)) continue;
    const code = await readFile(new URL(name, desktop), 'utf8');
    for (const [, path] of code.matchAll(/['"]\.\.\/(src\/[\w-]+\.js)['"]/g)) needed.add(path);
  }
  assert(needed.has('src/wake-profile.js'));
  const seen = new Set();
  const collect = async file => {
    for (const [, path] of (await readFile(new URL(`../${file}`, import.meta.url), 'utf8')).matchAll(/from ['"]\.\/([\w-]+\.js)['"]/g)) {
      const next = `src/${path}`; if (!seen.has(next)) { seen.add(next); await collect(next); }
    }
  };
  for (const file of needed) await collect(file);
  for (const script of ['package-fairy.mjs']) {
    const listing = await readFile(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    for (const file of new Set([...needed, ...seen])) assert(listing.includes(`'${file}'`), `${script} must package ${file}`);
  }
});
