import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const { unpacked, nativeBin, beside } = createRequire(import.meta.url)('../desktop/bundle-path.cjs') as {
  unpacked: (path: string) => string;
  nativeBin: (name: string) => string;
  beside: (relative: string) => string;
};

const root = fileURLToPath(new URL('..', import.meta.url));

test('a path inside the archive is moved beside it, and any other is left alone', () => {
  const app = '/Users/someone/Applications/Fairy.app/Contents/Resources';
  assert.equal(unpacked(`${app}/app.asar/native/bin/fairy-screen`), `${app}/app.asar.unpacked/native/bin/fairy-screen`);
  assert.equal(unpacked(`${app}/app.asar.unpacked/native/bin/fairy-screen`), `${app}/app.asar.unpacked/native/bin/fairy-screen`, 'once is enough');
  assert.equal(unpacked('/Users/someone/code/Fairy/native/bin/fairy-screen'), '/Users/someone/code/Fairy/native/bin/fairy-screen');
  assert.equal(unpacked('/Users/someone/my-app.asar-notes/file'), '/Users/someone/my-app.asar-notes/file', 'only a folder called exactly app.asar');
});

test('in a checkout the helpers and the tray picture are where they always were', () => {
  assert.equal(nativeBin('fairy-screen'), join(root, 'native/bin/fairy-screen'));
  assert.equal(beside('assets/tray/trayTemplate.png'), join(root, 'assets/tray/trayTemplate.png'));
  assert.ok(existsSync(beside('assets/tray/trayTemplate.png')));
});

// spawn() can't start a program inside the archive, and nothing fails until the feature is used in a packaged app.
// So the only place that may spell out these folders is bundle-path.cjs.
test('every path to a program in the app goes through bundle-path', async () => {
  const offenders: string[] = [];
  async function scan(folder: string): Promise<void> {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) { await scan(path); continue; }
      if (!/\.(mjs|cjs|js)$/.test(entry.name) || entry.name === 'bundle-path.cjs') continue;
      (await readFile(path, 'utf8')).split('\n').forEach((line, index) => {
        const code = line.replace(/^\s*(\/\/|\*).*$/, '').replace(/\s\/\/ .*$/, '');
        if (/['"`][^'"`]*(native\/bin|assets\/tray|node_modules\/@openai|node-pty\/prebuilds)/.test(code) && !/beside\(/.test(code)) offenders.push(`${path.slice(root.length).split(sep).join('/')}:${index + 1}`);
      });
    }
  }
  await scan(join(root, 'desktop'));
  assert.deepEqual(offenders, [], 'use nativeBin(name) or beside(path) from desktop/bundle-path.cjs');
});
