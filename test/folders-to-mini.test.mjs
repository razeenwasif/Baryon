import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FOLDERS, copyFolders, parseArgs, rsyncArgs } from '../scripts/folders-to-mini.mjs';

// A stand-in ssh for rsync and mkdir: drops the options and the host, and runs the command in a folder standing in for
// the mini's home, as an SSH login would.
async function standIn() {
  const dir = await mkdtemp(join(tmpdir(), 'folders-to-mini-')), here = join(dir, 'here'), mini = join(dir, 'mini'), ssh = join(dir, 'ssh');
  await mkdir(mini, { recursive: true });
  await writeFile(ssh, `#!/bin/sh\nwhile [ "$1" = "-o" ]; do shift 2; done\nshift\ncd ${JSON.stringify(mini)} && HOME=${JSON.stringify(mini)} exec /bin/sh -c "$*"\n`);
  await chmod(ssh, 0o755);
  await mkdir(join(here, 'Courses', 'COMP3000', 'node_modules', 'left'), { recursive: true });
  await writeFile(join(here, 'Courses', 'COMP3000', 'notes.md'), 'from the MacBook');
  await writeFile(join(here, 'Courses', 'COMP3000', 'node_modules', 'left', 'index.js'), 'big');
  await mkdir(join(here, 'Documents', 'Books'), { recursive: true });
  await writeFile(join(here, 'Documents', 'Books', 'book.pdf'), '%PDF');
  return { dir, here, mini, ssh, done: () => rm(dir, { recursive: true, force: true }) };
}

test('folders land in the same places on the mini, without node_modules, and newer work there is kept', async () => {
  const s = await standIn();
  try {
    // Work done on the mini since: newer than this Mac's copy, so it stays.
    await mkdir(join(s.mini, 'Courses', 'COMP3000'), { recursive: true });
    await writeFile(join(s.mini, 'Courses', 'COMP3000', 'notes.md'), 'edited on the mini');
    const later = new Date(Date.now() + 3600_000);
    await utimes(join(s.mini, 'Courses', 'COMP3000', 'notes.md'), later, later);
    await writeFile(join(s.mini, 'Courses', 'only-on-mini.md'), 'stays');
    const lines = [];
    const options = parseArgs(['--host', 'mini', 'Courses', 'Documents/Books', 'Research']);
    const done = await copyFolders({ options, home: s.here, ssh: s.ssh, log: line => lines.push(line) });
    assert.deepEqual(done, ['Courses', 'Documents/Books']);
    assert.equal(await readFile(join(s.mini, 'Documents', 'Books', 'book.pdf'), 'utf8'), '%PDF');
    assert.equal(await readFile(join(s.mini, 'Courses', 'COMP3000', 'notes.md'), 'utf8'), 'edited on the mini');
    assert.equal(await readFile(join(s.mini, 'Courses', 'only-on-mini.md'), 'utf8'), 'stays');
    assert.deepEqual((await readdir(join(s.mini, 'Courses', 'COMP3000'))).sort(), ['notes.md']);
    assert.match(lines.join('\n'), /Research: not on this Mac, skipped\./);
  } finally { await s.done(); }
});

test('a dry run copies nothing, and --everything takes node_modules too', async () => {
  const s = await standIn();
  try {
    await copyFolders({ options: parseArgs(['--dry-run', 'Courses']), home: s.here, ssh: s.ssh, log: () => {} });
    assert.deepEqual(await readdir(s.mini), []);
    await copyFolders({ options: parseArgs(['--everything', 'Courses']), home: s.here, ssh: s.ssh, log: () => {} });
    assert.equal(await readFile(join(s.mini, 'Courses', 'COMP3000', 'node_modules', 'left', 'index.js'), 'utf8'), 'big');
  } finally { await s.done(); }
});

test('only folders inside your home, to a host from your SSH config', () => {
  assert.deepEqual(parseArgs([]).folders, FOLDERS);
  assert.deepEqual(parseArgs(['Documents/Books/']).folders, ['Documents/Books']);
  for (const bad of ['/etc', '../elsewhere', '.', 'a;rm -rf ~']) assert.throws(() => parseArgs([bad]), /inside your home/, bad);
  assert.throws(() => parseArgs(['--host', 'mini;x']), /host name/);
  assert.throws(() => parseArgs(['--delete']), /Not an option/);
  const args = rsyncArgs('Courses', { host: 'mini', home: '/Users/me' });
  assert.deepEqual(args.slice(0, 4), ['-a', '-u', '--partial', '--stats']);
  assert.ok(!args.includes('--delete'));
  assert.deepEqual(args.slice(-2), ['/Users/me/Courses/', 'mini:Courses/']);
});
