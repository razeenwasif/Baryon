import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { InputWatch } from '../desktop/input-watch.mjs';

const limits = { answer: 30, input: 30, busy: 60, busyCheck: 5, gap: 1000, settle: 1 };
function fixture({ answers = true, input = 'answered', attach = true, draft = ['half a message', ''] }: { answers?: boolean; input?: string; attach?: boolean; draft?: string[] } = {}) {
  const contents: any = new EventEmitter(), scripts: string[] = [];
  let attached = false;
  Object.assign(contents, {
    reloads: 0, isDestroyed: () => false,
    reload() { contents.reloads++; queueMicrotask(() => contents.emit('did-finish-load')); },
    executeJavaScript: (code: string) => {
      scripts.push(code);
      if (!answers) return new Promise(() => {});
      return Promise.resolve(code.startsWith('[document') ? draft : 1);
    },
    debugger: {
      isAttached: () => attached,
      attach() { if (!attach) throw new Error('Another debugger is attached'); attached = true; },
      detach() { attached = false; },
      sendCommand: () => input === 'silent' ? new Promise(() => {}) : input === 'failed' ? Promise.reject(new Error('Target closed')) : Promise.resolve({}),
    },
  });
  return { contents, scripts, isAttached: () => attached };
}
const watch = (contents: any, options: Record<string, any> = {}) => { const logged: string[] = [], told: string[] = []; return { logged, told, watcher: new InputWatch({ contents, limits, log: (entry: any) => logged.push(entry.event), notify: (text: string) => told.push(text), ...options } as any) }; };

test('a page that answers while its input doesn’t is reloaded, keeping what was being typed', async () => {
  const { contents, scripts, isAttached } = fixture({ input: 'silent' }), { watcher, logged, told } = watch(contents);
  await watcher.check();
  assert.equal(contents.reloads, 1);
  assert.deepEqual(logged, ['input-lost', 'input-recovered']);
  assert.match(told[0], /reloaded/);
  assert.match(scripts.at(-1)!, /half a message/);
  assert.equal(isAttached(), false, 'the debugger is let go');
});

test('it leaves the page alone unless input is really lost', async () => {
  for (const options of [{ answers: false, input: 'silent' }, { input: 'answered' }, { input: 'failed' }, { attach: false, input: 'silent' }]) {
    const { contents } = fixture(options), { watcher, logged } = watch(contents);
    await watcher.check();
    assert.equal(contents.reloads, 0, JSON.stringify(options));
    assert.deepEqual(logged, []);
  }
});

test('it waits for a request to finish, but not forever', async () => {
  let busy = true;
  const first = fixture({ input: 'silent' }), a = watch(first.contents, { isBusy: () => busy });
  setTimeout(() => { busy = false; }, 15);
  const started = Date.now();
  await a.watcher.check();
  assert(Date.now() - started >= 10);
  assert.equal(first.contents.reloads, 1);
  const second = fixture({ input: 'silent' }), b = watch(second.contents, { isBusy: () => true });
  await b.watcher.check();
  assert.equal(second.contents.reloads, 1, 'a stuck window is worse than an interrupted reply');
});

test('it doesn’t keep reloading if a reload doesn’t help', async () => {
  const { contents } = fixture({ input: 'silent' }), { watcher, logged } = watch(contents);
  await watcher.check();
  await watcher.check();
  assert.equal(contents.reloads, 1);
  assert.deepEqual(logged, ['input-lost', 'input-recovered', 'input-lost', 'input-lost-again']);
});

test('only Chromium’s report starts a check, and one at a time', async () => {
  const { contents } = fixture({ input: 'silent' }), { watcher } = watch(contents);
  watcher.start();
  contents.emit('unresponsive'); contents.emit('unresponsive');
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(contents.reloads, 1);
});

// A page whose listener hears moves, or times out, as its answer says.
function mover({ heard = true, pointer = { x: 40, y: 50 }, answers = true, input = 'silent' }: { heard?: boolean; pointer?: { x: number; y: number } | null; answers?: boolean; input?: string } = {}) {
  const { contents } = fixture({ input }), moves: any[] = [], run = contents.executeJavaScript;
  contents.sendInputEvent = (event: any) => moves.push(event);
  contents.executeJavaScript = (code: string) => code.startsWith('new Promise') ? (answers ? new Promise(resolve => setTimeout(() => resolve(heard), 5)) : new Promise(() => {})) : run(code);
  const logged: any[] = [], watcher = new InputWatch({ contents, pointer: () => pointer, limits: { ...limits, move: 10, moveGap: 2, afterSwitch: [1, 40] }, log: (entry: any) => logged.push(entry) } as any);
  return { contents, moves, logged, watcher };
}

test('a mouse move to where the pointer is shows whether the page hears input', async () => {
  const healthy = mover();
  assert.equal(await healthy.watcher.moveHeard(), 'heard');
  assert.deepEqual(healthy.moves[0], { type: 'mouseMove', x: 40, y: 50 });
  assert.equal(await mover({ heard: false }).watcher.moveHeard(), 'silent');
});

test('it can’t tell with the pointer off the window, or a page too busy to answer', async () => {
  const away = mover({ pointer: null });
  assert.equal(await away.watcher.moveHeard(), 'unknown');
  assert.deepEqual(away.moves, [], 'nothing is sent');
  assert.equal(await mover({ answers: false }).watcher.moveHeard(), 'unknown');
});

test('leaving floating mode with input dead reloads the page without waiting for a lost click', async () => {
  const { contents, watcher, logged } = mover({ heard: false });
  watcher.switched(false);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(contents.reloads, 1);
  assert.deepEqual(logged.map(entry => entry.event).slice(0, 3), ['input-silent', 'input-lost', 'input-recovered']);
  assert.equal(typeof logged[0].afterSwitchMs, 'number');
});

test('a page that hears input is left alone after a switch', async () => {
  const { contents, watcher, logged } = mover();
  watcher.switched(false);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(contents.reloads, 0);
  assert.deepEqual(logged, []);
});

test('a silent move alone doesn’t reload a page whose input answers', async () => {
  const { contents, watcher, logged } = mover({ heard: false, input: 'answered' });
  watcher.switched(false);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(contents.reloads, 0);
  assert.equal(logged[0].event, 'input-silent');
  assert(!logged.some(entry => entry.event === 'input-lost'));
});

test('floating again stops the checks', async () => {
  const { contents, moves, watcher } = mover({ heard: false });
  watcher.switched(false);
  watcher.switched(true);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.deepEqual(moves, []);
  assert.equal(contents.reloads, 0);
});

test('input dead before the switch is noted, using a corner if the pointer is elsewhere', async () => {
  const { watcher, moves, logged } = mover({ heard: false, pointer: null });
  watcher.beforeLeavingFloating();
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.deepEqual(moves[0], { type: 'mouseMove', x: 1, y: 1 });
  assert.deepEqual(logged, [{ event: 'input-silent-before-switch' }]);
});
