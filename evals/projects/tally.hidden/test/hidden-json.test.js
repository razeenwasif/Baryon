import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const folder = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-'));
  writeFileSync(join(dir, 'a.txt'), 'one two three');
  writeFileSync(join(dir, 'b.txt'), "it's four words here");
  return dir;
};

test('--json prints each file and a total', () => {
  const out = execFileSync(process.execPath, [cli, '--json', 'a.txt', 'b.txt'], { cwd: folder(), encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { files: { 'a.txt': 3, 'b.txt': 4 }, total: 7 });
});

test('without --json the lines stay as they were', () => {
  const out = execFileSync(process.execPath, [cli, 'a.txt'], { cwd: folder(), encoding: 'utf8' });
  assert.equal(out.trim(), 'a.txt: 3 words');
});
