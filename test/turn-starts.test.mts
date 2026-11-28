import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { MAX_PATCH, TurnStarts, startState } from '../desktop/turn-starts.mjs';

const run = promisify(execFile);
const temp = () => mkdtemp(join(tmpdir(), 'fairy-starts-'));
const g = (root: string, ...args: string[]) => run('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args]);
// Every file under a folder, but .git, as { path: contents }.
async function tree(dir: string, base = dir, out: Record<string, string> = {}) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await tree(full, base, out); else out[full.slice(base.length + 1)] = (await readFile(full)).toString('base64');
  }
  return out;
}

test('a turn’s start rebuilds the folder exactly: its commit, then the patch and the untracked files', async () => {
  const root = await temp(), copy = await temp();
  try {
    await g(root, 'init', '-q', '-b', 'main');
    await mkdir(join(root, 'src'));
    await writeFile(join(root, 'src', 'parse.js'), 'export const parse = s => s.trim();\n');
    await writeFile(join(root, 'README.md'), '# demo\n');
    await writeFile(join(root, 'logo.bin'), Buffer.from([0, 1, 2, 3, 255]));
    await writeFile(join(root, '.gitignore'), 'node_modules\n');
    await g(root, 'add', '.'); await g(root, 'commit', '-qm', 'one');
    // Uncommitted: a change, a staged change, a deletion, a binary change, new files, and something ignored.
    await writeFile(join(root, 'src', 'parse.js'), 'export const parse = s => s.trim().toLowerCase();\n');
    await writeFile(join(root, 'README.md'), '# demo\n\nStaged words.\n'); await g(root, 'add', 'README.md');
    await writeFile(join(root, 'logo.bin'), Buffer.from([9, 8, 7]));
    await writeFile(join(root, 'src', 'new.js'), 'export const two = 2;\n');
    await mkdir(join(root, 'node_modules')); await writeFile(join(root, 'node_modules', 'big.js'), 'ignored');
    await g(root, 'rm', '-q', '.gitignore'); await writeFile(join(root, '.gitignore'), 'node_modules\n');
    const state: any = await startState(root);
    assert.deepEqual([state.git, state.branch, state.dirty, state.kept], [true, 'main', true, true]);
    assert.match(state.commit, /^[0-9a-f]{40}$/);
    assert.deepEqual(state.untracked.map((u: any) => u.path).sort(), ['.gitignore', 'src/new.js']);
    // Rebuilt elsewhere from those alone, it matches the folder, but what git ignores.
    await g(root, 'worktree', 'add', '--detach', join(copy, 'w'), state.commit);
    const w = join(copy, 'w');
    await writeFile(join(copy, 'p.patch'), Buffer.from(state.patch, 'base64'));
    await g(w, 'apply', '--binary', join(copy, 'p.patch'));
    for (const u of state.untracked) { await mkdir(join(w, u.path, '..'), { recursive: true }); await writeFile(join(w, u.path), Buffer.from(u.data, 'base64')); }
    const original = await tree(root); delete original['node_modules/big.js'];
    assert.deepEqual(await tree(w), original);
    await g(root, 'worktree', 'remove', '--force', w);
    // Clean: no patch at all.
    await g(root, 'add', '-A'); await g(root, 'commit', '-qm', 'two');
    const clean: any = await startState(root);
    assert.deepEqual([clean.dirty, clean.kept, 'patch' in clean, 'untracked' in clean], [false, true, false, false]);
  } finally { await rm(root, { recursive: true, force: true }); await rm(copy, { recursive: true, force: true }); }
});

test('outside git, before a first commit, and too much to keep are said, not guessed', async () => {
  const root = await temp();
  try {
    assert.deepEqual(await startState(root), { git: false });
    await g(root, 'init', '-q');
    await writeFile(join(root, 'a.txt'), 'a');
    const none: any = await startState(root);
    assert.deepEqual([none.git, none.commit, none.kept], [true, null, false]);
    assert.match(none.why, /no commit yet/);
    await g(root, 'add', '.'); await g(root, 'commit', '-qm', 'one');
    await writeFile(join(root, 'huge.bin'), Buffer.alloc(1024 * 1024 + 1));
    const big: any = await startState(root);
    assert.deepEqual([big.kept, big.dirty, 'patch' in big], [false, true, false]); assert.match(big.why, /huge\.bin is over 1 MB/);
    await rm(join(root, 'huge.bin'));
    for (let i = 0; i < 6; i++) await writeFile(join(root, `part${i}.bin`), Buffer.alloc(1024 * 1000, i));
    const many: any = await startState(root);
    assert.equal(many.kept, false); assert.match(many.why, /over 5 MB/);
    assert.equal(MAX_PATCH, 5 * 1024 * 1024);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the store keeps one file per turn, never fails a turn, and prunes after 90 days', async () => {
  const dir = await temp(), root = await temp();
  try {
    let now = Date.parse('2026-11-18T12:00:00Z');
    const starts = new TurnStarts({ dir, now: () => now });
    await g(root, 'init', '-q'); await writeFile(join(root, 'x'), '1'); await g(root, 'add', '.'); await g(root, 'commit', '-qm', 'one');
    await writeFile(join(root, 'x'), '2');
    const at = '2026-11-18T11:59:00.000Z';
    const summary: any = await starts.record({ session: 's-1', at, root });
    assert.deepEqual([summary.git, summary.dirty, summary.kept, 'patch' in summary], [true, true, true, false], 'the summary leaves the patch out');
    const kept: any = await starts.get('s-1', at);
    assert.match(Buffer.from(kept.patch, 'base64').toString(), /^-1$[\s\S]*^\+2$/m);
    assert.equal(kept.root, root);
    // A failure to look is kept as the reason, not thrown.
    const broken = new TurnStarts({ dir, now: () => now, take: async () => { throw new Error('git went away'); } });
    assert.deepEqual(await broken.record({ session: 's-1', at: '2026-11-18T11:58:00Z', root }), { at: '2026-11-18T11:58:00Z', root, taken: '2026-11-18T12:00:00.000Z', git: false, why: 'git went away', untracked: 0 });
    for (const bad of [['../x', at], ['s-1', 'not a date'], ['', at]]) await assert.rejects(starts.record({ session: bad[0], at: bad[1], root }), /isn’t a turn/);
    assert.equal(await starts.get('../x', at), null);
    now += 91 * 86400000;
    assert.equal(await starts.prune(), 2);
    assert.equal(await starts.get('s-1', at), null);
  } finally { await rm(dir, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

test('every work turn notes where it started before its first step, but a swarm’s build step', async () => {
  const main = await readFile(new URL('../build-ts/desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /const turnStarts = new \(await import\('\.\/turn-starts\.mjs'\)\)\.TurnStarts\(\{ dir: file\('turn-starts'\) \}\);/);
  const drive = main.slice(main.indexOf('async function driveWork('), main.indexOf('async function driveWork(') + 1200);
  assert.match(drive, /if \(!build\)[\s\S]{0,120}Promise\.race\(\[turnStarts\.record\(\{ session: id, at, root \}\)/);
});
