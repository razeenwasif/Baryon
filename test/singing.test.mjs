import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SingingClip } from '../desktop/singing.mjs';
import { wantsSinging } from '../src/singing-command.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'fairy-singing-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'singing'));
  const clip = new SingingClip(directory), bytes = new Uint8Array([73, 68, 51, 1, 2, 3]);
  await writeFile(clip.path, bytes);
  return { clip, bytes };
}

test('saved singing returns the exact local recording without a provider or credentials', async t => {
  const { clip, bytes } = await fixture(t); let checks = 0;
  assert.deepEqual(await clip.status(), { available: true });
  assert.deepEqual(await clip.play({ checkPlayback: async () => { checks++; } }), bytes);
  assert.equal(checks, 2);
});

test('missing, empty, and oversized recordings are unavailable and never played', async t => {
  const { clip } = await fixture(t);
  for (const size of [0, 8 * 1024 * 1024 + 1]) {
    await truncate(clip.path, size);
    assert.equal((await clip.status()).available, false);
    await assert.rejects(clip.play({ checkPlayback: async () => assert.fail('Should not reach playback') }), /not installed/);
  }
  await rm(clip.path);
  assert.equal((await clip.status()).available, false);
  await assert.rejects(clip.play({ checkPlayback: async () => {} }), /not installed/);
});

test('stop and Spotify starting during loading prevent returning singing audio', async t => {
  const { clip } = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(clip.play({ signal: controller.signal, checkPlayback: async () => assert.fail('Cancelled') }), { name: 'AbortError' });
  let checks = 0;
  await assert.rejects(clip.play({ checkPlayback: async () => { if (++checks === 2) throw new Error('Pause Spotify first'); } }), /Pause Spotify/);
  const duringLoad = new AbortController();
  await assert.rejects(clip.play({ signal: duringLoad.signal, checkPlayback: async () => duringLoad.abort() }), { name: 'AbortError' });
});

test('only direct singing commands play the saved song', () => {
  for (const text of ['Fairy, sing my song', 'Hey Fairy sing for me', 'Fairy, sing my song', 'Fairy, sing my song', 'Sing my song', 'Fairy, sing my original song.', 'Can you sing for me?', 'Please play my song', 'Sing', 'Could you sing something please?']) assert.equal(wantsSinging(text), true, text);
  for (const text of ['Do not sing my song', 'Can you explain how you sing my song?', 'Translate "sing my song"', 'Sing Be Kind', 'Play my song on Spotify', 'Sing my song on screen', 'I wish you could sing', '```sing```', null]) assert.equal(wantsSinging(text), false, String(text));
});
