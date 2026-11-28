// Two Macs: Ride along goes with her when she crosses between the Macs (desktop/ride-carry.cjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { FaceLink } from '../desktop/face-link.mjs';

const { rideOf, rideState, leaveRide, arriveRide } = createRequire(import.meta.url)('../desktop/ride-carry.cjs');
const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');

// A page's web contents, running what main sends it against a stand-in of the page's hook.
function page(hook: any) {
  const context = vm.createContext({ window: { fairyRideAlong: hook }, Promise });
  const sent: string[] = [];
  return { sent, isDestroyed: () => false, executeJavaScript: async (code: string) => { sent.push(code); return vm.runInContext(code, context); } };
}

test('only the switch and whether she’s riding cross between the Macs', () => {
  assert.deepEqual(rideOf({ enabled: true, riding: true, secret: 'x' }), { enabled: true, riding: true });
  assert.deepEqual(rideOf({ enabled: false }), { enabled: false, riding: false });
  assert.equal(rideOf({ riding: true }), null);
  assert.equal(rideOf('on'), null);
});

test('the Mac she leaves reads her ride and tells the page she’s away; the Mac she reaches rides on', async () => {
  const calls: any[] = [];
  const hook = { state: () => ({ enabled: true, riding: true }), leave: () => calls.push('leave'), arrive: (ride: any) => { calls.push(['arrive', ride]); return Promise.resolve(ride.riding === true); } };
  const contents = page(hook);
  assert.deepEqual(await rideState(contents), { enabled: true, riding: true });
  await leaveRide(contents);
  assert.equal(await arriveRide(contents, { enabled: true, riding: true, extra: 1 }), true);
  // The page's objects come from its own realm, so they're compared as the JSON they travel as.
  assert.equal(JSON.stringify(calls), JSON.stringify(['leave', ['arrive', { enabled: true, riding: true }]]));
  // With no word from the other Mac (the face went away), the page keeps its own switch and doesn't ride.
  assert.equal(await arriveRide(contents, null), false);
  assert.equal(JSON.stringify(calls.at(-1)), JSON.stringify(['arrive', {}]));
});

test('a page without the hook, or a closed window, carries nothing and never throws', async () => {
  const bare = page(undefined);
  assert.equal(await rideState(bare), null);
  await leaveRide(bare);
  assert.equal(await arriveRide(bare, { enabled: true, riding: true }), false);
  const gone = { isDestroyed: () => true, executeJavaScript: async () => { throw new Error('closed'); } };
  assert.equal(await rideState(gone), null);
  assert.equal(await arriveRide(gone, { enabled: true, riding: true }), false);
  const broken = { isDestroyed: () => false, executeJavaScript: async () => { throw new Error('page gone'); } };
  assert.equal(await rideState(broken), null);
  assert.equal(await arriveRide(broken, { enabled: true, riding: true }), false);
});

test('the link carries the face’s ride in its reports, and the mini’s with the show event', async () => {
  const reports: any[] = [], written: any[] = [];
  const face = new FaceLink({ ask: async () => ({ text: '' }), onPresence: (report: any) => reports.push(report) } as any);
  face.stream = { response: { write: (chunk: any) => written.push(chunk) } } as any;
  const link = { body: async () => body, send: () => {} };
  let body: any = { activeAgoMs: 10, ride: { enabled: true, riding: true, extra: 'no' } };
  await face.handle({ method: 'POST' } as any, {} as any, { pathname: '/v1/face/presence', link } as any);
  body = { activeAgoMs: 10, ride: 'yes' };
  await face.handle({ method: 'POST' } as any, {} as any, { pathname: '/v1/face/presence', link } as any);
  assert.deepEqual(reports[0].ride, { enabled: true, riding: true });
  assert.equal('ride' in reports[1], false);
  face.show(true, { ride: { enabled: true, riding: true } });
  face.show(false, { ride: { enabled: true, riding: true } });
  assert.match(written[0], /"on":true,"ride":\{"enabled":true,"riding":true\}/);
  assert.match(written[1], /data: \{"on":false\}\n/);
});

test('both pages that run Ride along answer the Macs’ hook, and stop asking to ride while she’s away', async () => {
  for (const path of ['../src/companion.ts', '../src/app.ts']) {
    const source = await read(path);
    assert.match(source, /window\.fairyRideAlong ?= ?\{/, path);
    for (const name of ['state', 'leave', 'arrive']) assert.match(source, new RegExp(`${name}: ?\\(`), `${path} ${name}`);
    assert.match(source, /setInterval\(\(\) ?=> ?\{\n\s*if ?\(rideAway\) ?return;/, `${path} waits while she’s away`);
  }
});

test('each Mac carries the ride across its handover, riding on rather than gliding', async () => {
  const main = await read('../build-ts/desktop/main.cjs');
  assert.match(main, /faceLink\.show\(true, \{ ride: page \? await rideCarry\.rideState\(page\.webContents\) : null \}\);\n\s+if \(page\)\s*await rideCarry\.leaveRide\(page\.webContents\);/);
  assert.match(main, /await rideCarry\.arriveRide\(page\.webContents, faceLink\.connected\(\) \? carried : null\)/);
  assert.match(main, /if \(comes && !rode\)\s*await glide\.glideIn/);
  assert.match(main, /onPresence: \(?report\)? => \{ if \(report\.ride\)\s*faceRide = report\.ride;/);
  const face = await read('../desktop/face-main.cts');
  assert.match(face, /const rode = await rideCarry\.arriveRide\(win\.webContents, glideBy \? ride : null\);\n\s+if \(glideBy && !rode\) await glide\.glideIn/);
  assert.match(face, /await rideCarry\.leaveRide\(win\.webContents\);/);
  assert.match(face, /return applyShown\(\{ glideBy: true, ride: (?:data|payload)\.ride \?\? null \}\)/);
  assert.match(face, /\.\.\.\(ride \? \{ ride \} : \{\}\)/);
});
