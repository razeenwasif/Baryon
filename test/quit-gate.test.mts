import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSONWriter, atomicJSON } from '../desktop/json-store.mjs';
const { waitToQuit, quitGate, QUIT_LIMIT_MS } = createRequire(import.meta.url)('../desktop/quit-gate.cjs');

const never = () => new Promise<void>(() => {});
const event = () => { const e = { prevented: false, preventDefault() { e.prevented = true; } }; return e; };
// A stand-in for Electron's app: quit() emits before-quit, and the app goes unless a listener prevents it.
function fakeApp() {
  const app = { listeners: [] as Array<(e: any) => void>, quitAsked: 0, quitted: false, quit() { app.quitAsked++; const e = event(); for (const listener of app.listeners) listener(e); if (!e.prevented) app.quitted = true; return e; } };
  return app;
}
const until = async (check: () => boolean, ms = 2000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw new Error('timed out waiting'); await new Promise(r => setTimeout(r, 5)); } };

test('the limit stays under the time the update script gives Fairy after SIGTERM', async () => {
  const { REMOTE_QUIT } = await import('../scripts/fairy-to-mini.mjs');
  const tries = Number(/\$i -lt (\d+)/.exec(REMOTE_QUIT)?.[1]), pause = Number(/sleep ([\d.]+)/.exec(REMOTE_QUIT)?.[1]);
  assert.ok(tries > 0 && pause > 0, 'the update script still waits in a counted loop');
  assert.ok(QUIT_LIMIT_MS > 0 && QUIT_LIMIT_MS < tries * pause * 1000 - 2000, `${QUIT_LIMIT_MS} ms against ${tries * pause} s`);
});

test('waitToQuit reports which jobs failed when everything settles in time', async () => {
  const outcome = await waitToQuit({ recognizer: Promise.resolve(), saves: Promise.reject(new Error('disk full')), 'work chats': undefined }, { limit: 1000 });
  assert.equal(outcome.timedOut, false);
  assert.deepEqual(outcome.pending, []);
  assert.deepEqual(outcome.failed, ['saves']);
  assert.match(outcome.errors.saves.message, /disk full/);
});

test('waitToQuit gives up on a job that never settles and names it', async () => {
  const started = Date.now();
  const outcome = await waitToQuit({ recognizer: Promise.resolve(), 'work chats': Promise.resolve(), saves: never() }, { limit: 40 });
  assert.equal(outcome.timedOut, true);
  assert.deepEqual(outcome.pending, ['saves']);
  assert.ok(Date.now() - started < 1000);
});

test('a save that never finishes holds the quit only until the limit, then Fairy quits and says what was pending', async () => {
  const app = fakeApp(), timeouts: any[] = [], writer = new JSONWriter(never as any);
  void writer.write('/tmp/fairy-quit/promises.json', { items: [] });
  const gate = quitGate({
    busy: () => writer.pending.size > 0,
    jobs: () => ({ recognizer: Promise.resolve(), 'work chats': Promise.resolve(), saves: writer.flush() }),
    quit: () => app.quit(), onTimeout: (outcome: any) => timeouts.push({ ...outcome, saves: writer.describe() }), limit: 50,
  });
  app.listeners.push(gate);
  // SIGTERM, then an osascript quit while still waiting: both are held, neither starts a second wait.
  assert.equal(app.quit().prevented, true);
  assert.equal(app.quit().prevented, true);
  await until(() => app.quitted);
  assert.equal(timeouts.length, 1);
  assert.deepEqual(timeouts[0].pending, ['saves']);
  assert.deepEqual(timeouts[0].saves.map((save: any) => [save.file, save.stage]), [['promises.json', 'queued']]);
  // Quits after the limit is spent go straight through, even though the save is still pending.
  assert.equal(writer.pending.size, 1);
  assert.equal(app.quit().prevented, false);
});

test('a quit with nothing pending is never held, and one that finishes in time quits without a timeout', async () => {
  const idle = fakeApp(); idle.listeners.push(quitGate({ busy: () => false, jobs: () => ({}), quit: () => idle.quit() }));
  assert.equal(idle.quit().prevented, false);
  let release!: () => void, busy = true; const saved = new Promise<void>(resolve => { release = resolve; }), timeouts: any[] = [];
  const app = fakeApp();
  app.listeners.push(quitGate({ busy: () => busy, jobs: () => ({ saves: saved.then(() => { busy = false; }) }), quit: () => app.quit(), onTimeout: (o: any) => timeouts.push(o), limit: 5000 }));
  assert.equal(app.quit().prevented, true);
  release(); await until(() => app.quitted);
  assert.deepEqual(timeouts, []);
});

test('saves that keep turning up can only hold the quit for the one limit in total', async () => {
  const app = fakeApp(); let waits = 0;
  // Every wait finishes, but there's always more to save: the deadline, not each wait, ends it.
  app.listeners.push(quitGate({ busy: () => true, jobs: () => { waits++; return { saves: new Promise(r => setTimeout(r, 15)) }; }, quit: () => app.quit(), limit: 60 }));
  app.quit();
  await until(() => app.quitted);
  assert.ok(waits >= 2, `waited ${waits} times`);
});

test('a failed save shows the error, then quits', async () => {
  const app = fakeApp(), failed: any[] = []; let busy = true;
  app.listeners.push(quitGate({ busy: () => busy, jobs: () => ({ saves: Promise.reject(new Error('disk full')) }), quit: () => app.quit(), onFailed: (o: any) => { failed.push(o.failed); busy = false; } }));
  app.quit();
  await until(() => app.quitted);
  assert.deepEqual(failed, [['saves']]);
});

test('atomicJSON names each stage, so a stuck save says where it stopped', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-quit-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const steps: string[] = [];
  await atomicJSON(join(dir, 'a.json'), '{}', step => steps.push(step));
  assert.deepEqual(steps, ['mkdir', 'open', 'write', 'sync', 'close', 'rename', 'cleanup']);
  let hold!: () => void; const gate = new Promise<void>(resolve => { hold = resolve; });
  const writer = new JSONWriter((path, text, step) => atomicJSON(path, text, step).then(() => gate));
  const saving = writer.write(join(dir, 'b.json'), { n: 1 });
  await until(() => writer.describe()[0]?.stage === 'cleanup');
  assert.equal(writer.describe()[0].file, 'b.json');
  hold(); await saving;
  assert.deepEqual(writer.describe(), []);
});
