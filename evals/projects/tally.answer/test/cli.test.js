import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
test('tally --json', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tally-'));
  writeFileSync(join(dir, 'notes.txt'), 'two words');
  const out = execFileSync(process.execPath, [cli, '--json', 'notes.txt'], { cwd: dir, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { files: { 'notes.txt': 2 }, total: 2 });
});
