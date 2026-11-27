// Fairy Scratch (desktop/scratch.mjs): a folder for each scratch chat, and the hourly trim that keeps it small.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SCRATCH_LIMIT, SCRATCH_LOW_LIMIT, chatFolderName, newChatFolder, scratchLimit, scratchPlace, scratchRoot, trimScratch } from '../desktop/scratch.mjs';

const temp = async t => { const root = await mkdtemp(join(tmpdir(), 'fairy-scratch-')); t.after(() => rm(root, { recursive: true, force: true })); return root; };
const NOW = new Date(2026, 10, 21, 9, 30);

test('each chat’s folder is named for its day and first words, and a second one of the same name gets a number', async t => {
  assert.equal(scratchRoot('/Users/me'), '/Users/me/Fairy Scratch');
  assert.equal(chatFolderName('Plot the CPU temps from /var/log, please!', NOW), '2026-11-21 Plot the CPU temps from var log please');
  assert.equal(chatFolderName('/btw', NOW), '2026-11-21 Scratch');
  assert.equal(chatFolderName('a'.repeat(80), NOW), '2026-11-21 Scratch', 'one word too long for a name falls back');
  const root = join(await temp(t), 'Fairy Scratch');
  const first = await newChatFolder(root, 'make a chart', NOW), second = await newChatFolder(root, 'make a chart', NOW);
  assert.equal(first, join(root, '2026-11-21 make a chart'));
  assert.equal(second, join(root, '2026-11-21 make a chart 2'));
  assert.equal(await scratchPlace(root, root), 'root');
  assert.equal(await scratchPlace(first, root), 'chat');
  assert.equal(await scratchPlace(join(root, 'gone folder'), root), 'chat', 'a trimmed chat folder is still that chat’s');
  assert.equal(await scratchPlace(join(first, 'inner'), root), null);
  assert.equal(await scratchPlace('/Users/me/Github/proj', root), null);
});

test('the trim removes old folders, then the oldest while over the limit, and never one in use', async t => {
  const root = await temp(t), day = 86_400_000, now = Date.now();
  const folder = async (name, ageDays, bytes) => {
    const path = join(root, name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'data.bin'), Buffer.alloc(bytes));
    const at = new Date(now - ageDays * day);
    await utimes(join(path, 'data.bin'), at, at); await utimes(path, at, at);
    return path;
  };
  await folder('old', 20, 10); const oldInUse = await folder('old in use', 30, 10);
  await folder('a', 5, 400); await folder('b', 3, 400); await folder('c', 1, 400);
  const kept = new Set([oldInUse]);
  const result = await trimScratch({ root, keep: path => kept.has(path), limit: 900, now });
  assert.deepEqual(result.removed.map(entry => entry.name), ['old', 'a']);
  assert.deepEqual((await readdir(root)).sort(), ['b', 'c', 'old in use']);
  assert.ok(result.total <= 900);
});

test('Scratch may hold less when the disk is nearly full', async () => {
  assert.equal(await scratchLimit('/x', { free: async () => 40 * 1024 ** 3 }), SCRATCH_LIMIT);
  assert.equal(await scratchLimit('/x', { free: async () => 10 * 1024 ** 3 }), SCRATCH_LOW_LIMIT);
  assert.equal(await scratchLimit('/x', { free: async () => { throw new Error('no'); } }), SCRATCH_LIMIT);
});

test('a scratch session starts from the window or the other Mac, gets its folder with its first message, and is trimmed hourly', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /if \(wanted === 'scratch'\) \{/);
  assert.match(main, /if \(where === 'root'\) await sessions\.setWork\(\{ folder: await newChatFolder\(scratchRoot\(\), text\) \}\);/);
  assert.match(main, /setInterval\(\(\) => \{ if \(!suspended\) void trimScratchNow\(\)/);
  const { kindOf } = await import('../desktop/remote-channels.mjs');
  for (const channel of ['scratch-state', 'scratch-trim']) assert.equal(kindOf(channel), 'remote', channel);
  assert.notEqual(kindOf('scratch-reveal'), 'remote', 'Finder opens only on the Mac Fairy runs on');
});
