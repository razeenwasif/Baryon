import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FaceStore } from '../desktop/face-store.mjs';

const seal = text => `sealed:${Buffer.from(text).toString('hex')}`, unseal = text => Buffer.from(text.slice(7), 'hex').toString();
const PAIRING = { host: 'mini.example.ts.net', port: 47616, pin: 'ab'.repeat(32), device: 'd-1', readKey: 'READ-KEY-secret', approveKey: 'APPROVE-KEY-secret' };
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-face-store-')), path = join(dir, 'face', 'face.json');
  return { dir, path, store: new FaceStore({ path, seal, unseal }), done: () => rm(dir, { recursive: true, force: true }) };
}

test('keys are only ever written sealed, and come back unsealed', async () => {
  const { path, store, done } = await setup();
  try {
    await store.load();
    const state = await store.savePairing(PAIRING);
    const saved = await readFile(path, 'utf8');
    assert.ok(!saved.includes('READ-KEY-secret') && !saved.includes('APPROVE-KEY-secret'));
    assert.equal(store.readKey(), 'READ-KEY-secret');
    assert.equal(store.approveKey(), 'APPROVE-KEY-secret');
    // What the page and the menu see has no key in it.
    assert.deepEqual(Object.keys(state).sort(), ['device', 'follow', 'host', 'muted', 'openAtLogin', 'paired', 'place', 'port', 'screen']);
    assert.ok(!JSON.stringify(state).includes('KEY'));
    const again = new FaceStore({ path, seal, unseal });
    assert.equal((await again.load()).paired, true);
    assert.deepEqual(again.pairing(), { host: PAIRING.host, port: PAIRING.port, pin: PAIRING.pin, device: 'd-1' });
  } finally { await done(); }
});

test('forget removes both keys and the pairing', async () => {
  const { path, store, done } = await setup();
  try {
    await store.savePairing(PAIRING);
    assert.equal((await store.forget()).paired, false);
    assert.equal(store.readKey(), '');
    const saved = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(saved.pairing, null);
  } finally { await done(); }
});

test('switches take only their own values, and a damaged file loads as defaults', async () => {
  const { path, store, done } = await setup();
  try {
    assert.equal((await store.set('muted', true)).muted, true);
    assert.deepEqual((await store.set('place', { x: 10, y: 20 })).place, { x: 10, y: 20 });
    await assert.rejects(store.set('muted', 'yes'), /isn’t a value/);
    await assert.rejects(store.set('follow', 'sometimes'), /isn’t a value/);
    await assert.rejects(store.set('readKey', 'x'), /no face setting/);
    await assert.rejects(store.savePairing({ ...PAIRING, pin: 'short' }), /isn’t complete/);
    await writeFile(path, JSON.stringify({ pairing: { host: 'x', port: 'no' }, muted: 'loud', follow: 'manual' }));
    const loaded = await new FaceStore({ path, seal, unseal }).load();
    assert.equal(loaded.paired, false);
    assert.equal(loaded.muted, false);
    assert.equal(loaded.follow, 'manual');
  } finally { await done(); }
});
