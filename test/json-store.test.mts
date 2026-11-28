import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSONWriter, atomicJSON } from '../desktop/json-store.mjs';
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };

test('100 identical pending saves share one commit and snapshot mutable input', async () => {
  const wait = gate(), commits: any[] = []; const writer = new JSONWriter(async (_path, text) => { await wait.promise; commits.push(JSON.parse(text)); });
  const value = { n: 1 }; const jobs = Array.from({ length: 100 }, () => writer.write('/tmp/fairy-fixture.json', value)); value.n = 2;
  const flush = writer.flush(); wait.release(); await Promise.all([...jobs, flush]);
  assert.deepEqual(commits, [{ n: 1 }]); assert.equal(writer.pending.size, 0);
});
test('distinct saves preserve call order; destinations run independently; failures do not poison queue', async () => {
  const wait = gate(), seen: number[] = []; const writer = new JSONWriter(async (_path, text) => { const { n } = JSON.parse(text); if (n === 1) await wait.promise; seen.push(n); if (n === 2) throw Error('disk failure'); });
  const first = writer.write('/tmp/fairy-a.json', { n: 1 });
  const failed = writer.write('/tmp/fairy-a.json', { n: 2 }); const check = assert.rejects(failed, /disk failure/);
  const last = writer.write('/tmp/fairy-a.json', { n: 3 });
  await writer.write('/tmp/fairy-b.json', { n: 4 }); assert.deepEqual(seen, [4]); wait.release();
  await Promise.all([first, check, last, writer.flush()]); assert.deepEqual(seen, [4, 1, 2, 3]); assert.equal(writer.pending.size, 0);
});
test('flush reports a pending failure and invalid JSON never enters the queue', async () => {
  const wait = gate(), writer = new JSONWriter(async () => { await wait.promise; throw Error('disk full'); });
  const pending = writer.write('/tmp/fairy-a.json', {}), check = assert.rejects(pending, /disk full/);
  const flushed = assert.rejects(writer.flush(), /could not be saved/); wait.release(); await Promise.all([check, flushed]);
  const circular: Record<string, any> = {}; circular.self = circular; await assert.rejects(writer.write('/tmp/fairy-a.json', circular)); assert.equal(writer.pending.size, 0);
});
test('atomic real saves finish with latest JSON, private permissions and no temporary debris', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-json-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'state.json'); const writer = new JSONWriter();
  await Promise.all(Array.from({ length: 60 }, (_, n) => writer.write(path, { n, body: 'x'.repeat(10000) })));
  assert.equal(JSON.parse(await readFile(path, 'utf8')).n, 59); assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(dir), ['state.json']);
  // Failed rename cleans its unique temporary and leaves the old destination alone.
  const blocked = join(dir, 'blocked'); await mkdir(blocked); await writeFile(join(blocked, 'keep'), 'old');
  await assert.rejects(atomicJSON(blocked, '{}')); assert.equal(await readFile(join(blocked, 'keep'), 'utf8'), 'old');
  assert.deepEqual((await readdir(dir)).sort(), ['blocked', 'state.json']);
});
