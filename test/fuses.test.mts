import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { SENTINEL, LOCKED, readFuses, setFuses, lockFuses, assertFuses, frameworkBinary } from '../scripts/fuses.mjs';

// A stand-in for the Electron Framework binary: some bytes, the sentinel, the version, the count, the fuses, more bytes.
const binary = (fuses = '101100011', version = 1) => Buffer.concat([Buffer.from('machine code '), Buffer.from(SENTINEL), Buffer.from([version, fuses.length]), Buffer.from(fuses), Buffer.from(' and more')]);

test('the fuses are read as Electron ships them', () => {
  assert.deepEqual(readFuses(binary()), { runAsNode: true, cookieEncryption: false, nodeOptions: true, nodeCliInspect: true, asarIntegrity: false, onlyLoadAppFromAsar: false, browserV8Snapshot: false, grantFileProtocolExtraPrivileges: true });
  assert.equal(readFuses(binary('r01')).runAsNode, null, 'a removed fuse is neither on nor off');
});

test('locking turns off running as Node, NODE_OPTIONS and --inspect, turns on the two asar fuses, and nothing else', () => {
  const bytes = binary(), before = Buffer.from(bytes);
  assert.equal(setFuses(bytes), 5);
  const fuses = readFuses(bytes);
  assert.deepEqual([fuses.runAsNode, fuses.nodeOptions, fuses.nodeCliInspect], [false, false, false]);
  assert.deepEqual([fuses.asarIntegrity, fuses.onlyLoadAppFromAsar], [true, true], 'her code runs only from the archive, and only if it matches its hash');
  assert.equal(fuses.grantFileProtocolExtraPrivileges, true, 'her window still loads from a file');
  assert.deepEqual([fuses.cookieEncryption, fuses.browserV8Snapshot], [false, false], 'the others are as Electron ships them');
  // Only the five fuse bytes changed, so the rest of the binary is as Electron built it.
  const differing = [...bytes.keys()].filter(index => bytes[index] !== before[index]);
  assert.equal(differing.length, 5);
  assert.equal(setFuses(bytes), 0, 'locking a locked binary changes nothing');
});

test('every architecture in a universal binary is locked', () => {
  const bytes = Buffer.concat([binary(), binary()]);
  assert.equal(setFuses(bytes), 10);
  assert.equal(readFuses(bytes).runAsNode, false);
  assert.throws(() => readFuses(Buffer.concat([binary('101100011'), binary('001100011')])), /differ between the architectures/);
});

test('a binary it can’t lock fails loudly rather than passing as locked', () => {
  assert.throws(() => setFuses(Buffer.from('no sentinel here')), /No fuses were found/);
  assert.throws(() => setFuses(binary('101100011', 2)), /format this build doesn’t know|format this build doesn't know/);
  assert.throws(() => setFuses(binary('r01100011')), /removed the runAsNode fuse/);
  assert.throws(() => setFuses(binary('10')), /no fuse called nodeOptions/);
  assert.throws(() => setFuses(binary(), { madeUp: false } as any), /no fuse called madeUp/);
});

test('an app on disk is locked in place, and a build is checked before it can be installed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'fairy-fuses-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'Electron.app'), file = frameworkBinary(app);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, binary());
  await assert.rejects(assertFuses(app), /runAsNode fuse is on in the built app/);
  assert.equal((await lockFuses(app)).runAsNode, false);
  assert.equal(readFuses(await readFile(file)).nodeOptions, false, 'the change is on disk');
  assert.equal(Object.keys(LOCKED).length, 5);
  await assertFuses(app);
  // A build whose archive isn't checked is refused too.
  const loose = Buffer.from(await readFile(file)); setFuses(loose, { asarIntegrity: false }); await writeFile(file, loose);
  await assert.rejects(assertFuses(app), /asarIntegrity fuse is off in the built app; it should be on/);
});
