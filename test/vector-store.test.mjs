// Efficiency audit, fix 9: note vectors as binary floats, appended rather than rewritten, migrated from the old JSON.
// These drive the real fairy-notes helper (npm run build:notes) with throwaway folders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { vectorFiles } from '../desktop/notes.mjs';

const binary = new URL('../native/bin/fairy-notes', import.meta.url).pathname;
const skip = process.platform !== 'darwin' || !existsSync(binary);
const item = (id, text) => ({ id, sourceType: 'Notes', sourceTitle: 'test.md', question: text, answer: text, keyPoints: [], category: 'Notes', vector: null });
// One run of the helper: load these items, then close it.
async function load(dir, items) {
  const [bin, legacy] = vectorFiles(join(dir, 'notes-vectors-v1.json'));
  const child = spawn(binary, [bin, legacy], { stdio: ['pipe', 'pipe', 'ignore'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  child.stdin.end(JSON.stringify({ id: 1, op: 'load', items }) + '\n');
  await new Promise(resolve => child.on('close', resolve));
  return JSON.parse(out.trim().split('\n')[0]);
}
const read = async dir => { const data = await readFile(join(dir, 'notes-vectors-v2.bin')), dim = data.readUInt32LE(4), size = 16 + dim * 4;
  return { data, dim, records: (data.length - 8) / size, size }; };
const folder = async t => { const dir = await mkdtemp(join(tmpdir(), 'fairy-vectors-')); t.after(() => rm(dir, { recursive: true, force: true })); return dir; };

test('the helper is given the binary file and the old JSON beside it', () => {
  assert.deepEqual(vectorFiles('/data/notes-vectors-v1.json'), ['/data/notes-vectors-v2.bin', '/data/notes-vectors-v1.json']);
  assert.deepEqual(vectorFiles(undefined), []);
});

test('unchanged notes write nothing, and new ones are appended to the file in place', { skip }, async t => {
  const dir = await folder(t), a = item(randomUUID().toUpperCase(), 'Gradient descent minimizes a convex objective.'), b = item(randomUUID().toUpperCase(), 'Eigenvalues of a symmetric matrix are real.');
  const first = await load(dir, [a]);
  if (!first.semanticAvailable) return t.skip('no sentence embedding on this Mac');
  const one = await read(dir), before = await stat(join(dir, 'notes-vectors-v2.bin'));
  assert.equal(one.data.subarray(0, 4).toString('latin1'), 'FNV2');
  assert.equal(one.records, 1);
  assert.ok(!one.data.includes('Gradient'), 'vectors only, never the note’s words');
  await load(dir, [a]);
  const same = await stat(join(dir, 'notes-vectors-v2.bin'));
  assert.equal(same.mtimeMs, before.mtimeMs, 'nothing changed, nothing written');
  await load(dir, [a, b]);
  const two = await read(dir), after = await stat(join(dir, 'notes-vectors-v2.bin'));
  assert.equal(two.records, 2);
  assert.equal(after.ino, before.ino, 'the same file, appended to');
  assert.ok(two.data.subarray(0, one.data.length).equals(one.data), 'what was there is untouched');
});

test('the old JSON cache is read once, its vectors kept exactly, and then removed', { skip }, async t => {
  const probe = await folder(t), id = randomUUID().toUpperCase();
  const first = await load(probe, [item(randomUUID().toUpperCase(), 'probe text')]);
  if (!first.semanticAvailable) return t.skip('no sentence embedding on this Mac');
  const { dim } = await read(probe);
  const dir = await folder(t), legacy = join(dir, 'notes-vectors-v1.json'), value = Math.fround(1 / Math.sqrt(dim));
  await writeFile(legacy, JSON.stringify({ [id]: Array(dim).fill(value) }));
  await load(dir, [item(id, 'A note whose vector the old cache already had.')]);
  const { data, records } = await read(dir);
  assert.equal(records, 1);
  for (let i = 0; i < dim; i++) assert.equal(data.readFloatLE(8 + 16 + i * 4), value, 'the cached vector, not a new one');
  assert.equal(existsSync(legacy), false, 'the 42 MB of JSON is gone');
});

test('a file mostly of vectors nothing uses is compacted, and a torn last record is repaired', { skip }, async t => {
  const dir = await folder(t), items = Array.from({ length: 70 }, (_, i) => item(randomUUID().toUpperCase(), `Note number ${i} about topic ${i * 7}.`));
  const first = await load(dir, items);
  if (!first.semanticAvailable) return t.skip('no sentence embedding on this Mac');
  assert.equal((await read(dir)).records, 70);
  await load(dir, items.slice(0, 2));
  assert.equal((await read(dir)).records, 2, '68 dead records of 70: rewritten with the two in use');
  await appendFile(join(dir, 'notes-vectors-v2.bin'), Buffer.alloc(10, 7));
  await load(dir, items.slice(0, 2));
  const repaired = await read(dir);
  assert.equal(repaired.records, 2);
  assert.equal((repaired.data.length - 8) % repaired.size, 0, 'whole records only');
});
