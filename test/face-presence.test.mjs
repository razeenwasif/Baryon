import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { DWELL_MS, FRESH_MS, FacePresence, STALE_MS } from '../desktop/face-presence.mjs';
import { IdleReader } from '../desktop/idle-reader.mjs';
import { NEVER_MS, PointerSampler } from '../desktop/pointer-sampler.mjs';

const require = createRequire(import.meta.url);
const { edgePlace, glidePath, nearestEdge } = require('../desktop/glide.cjs');

function clock() { const c = { t: 1_000_000 }; c.now = () => c.t; return c; }
// A presence with the face connected and both Macs quiet for a minute, shown on the full Fairy's Mac.
function quiet() {
  const c = clock(), p = new FacePresence({ now: c.now });
  p.connected(true); p.homeSample({ activeAgoMs: 60000 }); p.faceReport({ activeAgoMs: 60000 });
  return { c, p };
}

test('she moves to the face once it is in use and the full Fairy’s Mac has been quiet for the dwell', () => {
  const { c, p } = quiet();
  p.homeSample({ activeAgoMs: 0 }); // the pointer just left this Mac
  c.t += 100; p.faceReport({ activeAgoMs: 0 });
  assert.equal(p.decide().shownOn, 'home', 'not before the dwell');
  c.t += DWELL_MS - 100; p.faceReport({ activeAgoMs: 0 });
  assert.deepEqual(p.decide(), { shownOn: 'face', changed: true });
  assert.equal(p.decide().changed, false);
});

test('and back when the full Fairy’s Mac is in use and the face has been quiet for the dwell', () => {
  const { c, p } = quiet();
  p.claim('face');
  p.faceReport({ activeAgoMs: 0 });
  c.t += 200; p.homeSample({ activeAgoMs: 0 });
  assert.equal(p.decide().shownOn, 'face');
  c.t += DWELL_MS; p.homeSample({ activeAgoMs: 0 });
  assert.equal(p.decide().shownOn, 'home');
});

test('both Macs in use at once, or input that stopped too long ago, moves her nowhere', () => {
  const { c, p } = quiet();
  for (let i = 0; i < 20; i++) { c.t += 200; p.homeSample({ activeAgoMs: 0 }); p.faceReport({ activeAgoMs: 0 }); assert.equal(p.decide().shownOn, 'home'); }
  // The face's last input was longer ago than "fresh" when the dwell ran out: she stays.
  p.faceReport({ activeAgoMs: FRESH_MS + 1 }); c.t += DWELL_MS;
  assert.equal(p.decide().shownOn, 'home');
});

test('a face that stops reporting, locks or disconnects gives her back; a locked full Fairy hands her over', () => {
  let { c, p } = quiet();
  p.claim('face'); c.t += STALE_MS + 1;
  assert.equal(p.decide().shownOn, 'home', 'stale');
  ({ c, p } = quiet()); p.claim('face'); p.faceReport({ activeAgoMs: 0, locked: true });
  assert.equal(p.decide().shownOn, 'home', 'face locked');
  ({ c, p } = quiet()); p.claim('face'); p.connected(false);
  assert.equal(p.decide().shownOn, 'home', 'disconnected');
  ({ c, p } = quiet()); p.homeSample({ activeAgoMs: 0, locked: true });
  assert.equal(p.decide().shownOn, 'face', 'home locked');
});

test('Bring Fairy here moves her at once; with following off, only that does', () => {
  const { c, p } = quiet();
  assert.equal(p.decide().changed, false);
  // A claim between two decisions is still a change for the next one to report.
  p.faceReport({ activeAgoMs: 60000, claim: true });
  assert.deepEqual(p.decide(), { shownOn: 'face', changed: true });
  assert.equal(p.decide().changed, false);
  p.claim('home');
  assert.deepEqual(p.decide(), { shownOn: 'home', changed: true });
  p.faceReport({ activeAgoMs: 0, follow: 'manual' }); c.t += DWELL_MS * 3; p.faceReport({ activeAgoMs: 0, follow: 'manual' });
  assert.equal(p.decide().shownOn, 'home', 'no pointer following');
  // A face that never reported can't claim her.
  const fresh = new FacePresence(); fresh.connected(true); fresh.claim('face');
  assert.equal(fresh.decide().shownOn, 'home');
});

test('the sampler counts a moved pointer, a fall in idle time and a fresh idle time, and knows the edges', () => {
  const c = clock(), s = new PointerSampler({ now: c.now });
  assert.equal(s.sample({ point: { x: 10, y: 10 }, idle: 30 }).activeAgoMs, NEVER_MS);
  c.t += 200; assert.equal(s.sample({ point: { x: 10, y: 10 }, idle: 30.2 }).active, false);
  // Driven by Universal Control: the idle time falls to about half a second, with the pointer still.
  c.t += 200; let r = s.sample({ point: { x: 10, y: 10 }, idle: 0.52 });
  assert.equal(r.active, true); assert.deepEqual(r.entry, { x: 10, y: 10 });
  c.t += 200; r = s.sample({ point: { x: 300, y: 40 }, idle: 0.72 });
  assert.equal(r.active, true); assert.deepEqual(r.entry, { x: 10, y: 10 }, 'same run'); assert.deepEqual(r.exit, { x: 300, y: 40 });
  c.t += 200; r = s.sample({ point: { x: 300, y: 40 }, idle: 0.92 });
  assert.equal(r.active, false); assert.equal(r.activeAgoMs, 200);
  c.t += 1000; r = s.sample({ point: { x: 300, y: 40 }, idle: 0.05 });
  assert.equal(r.active, true); assert.deepEqual(r.entry, { x: 300, y: 40 }, 'a new run');
  // No idle time known: the pointer alone decides.
  c.t += 200; assert.equal(s.sample({ point: { x: 300, y: 40 }, idle: null }).active, false);
});

test('her window leaves by the edge nearest the pointer, lined up with it, and the path ends where it should', () => {
  const area = { x: 0, y: 0, width: 1512, height: 982 }, size = { width: 340, height: 520 };
  assert.deepEqual(nearestEdge({ x: 0, y: 491 }, area), { edge: 'left', along: 0.5 });
  assert.equal(nearestEdge({ x: 1511, y: 100 }, area).edge, 'right');
  assert.equal(nearestEdge({ x: 700, y: 981 }, area).edge, 'bottom');
  assert.deepEqual(edgePlace({ edge: 'left', along: 0.5 }, area, size), { x: -204, y: 231 });
  assert.deepEqual(edgePlace({ edge: 'right', along: 1 }, area, size), { x: 1376, y: 462 });
  const path = glidePath({ x: 100, y: 100 }, { x: 400, y: 200 }, 12);
  assert.equal(path.length, 12);
  assert.deepEqual(path.at(-1), { x: 400, y: 200 });
  assert.ok(path[0].x - 100 > (400 - 100) / 12, 'eases out: the first step is the biggest');
});

test('the idle reader takes the helper’s fractions, ages them, falls back to whole seconds, and stops the helper', () => {
  const c = clock(), stdin = new PassThrough(), stdout = new PassThrough(), child = Object.assign(new EventEmitter(), { stdin, stdout, killed: false, kill() { this.killed = true; } });
  let args;
  const reader = new IdleReader({ path: '/x/fairy-idle', every: 200, now: c.now, fallback: () => 7, spawnProcess: (path, list) => { args = [path, list]; return child; } });
  assert.equal(reader.idle(), 7);
  reader.start();
  assert.deepEqual(args, ['/x/fairy-idle', ['200']]);
  reader.read('{"idle":0.4'); reader.read('12}\n{"idle":0.5');
  assert.equal(reader.idle(), 0.412);
  c.t += 100; assert.ok(Math.abs(reader.idle() - 0.512) < 1e-9);
  assert.equal(reader.fine, true);
  c.t += 2000; assert.equal(reader.idle(), 7, 'too old: whole seconds instead');
  let ended = false; stdin.on('finish', () => { ended = true; });
  reader.stop();
  assert.equal(child.killed, true);
  return new Promise(resolve => setImmediate(() => { assert.equal(ended, true); resolve(); }));
});
