// Efficiency audit, fix 5: Codex's server isn't started at launch, runs while it's used, and stops when idle.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { CODEX_IDLE_MS, CodexConnection, codexChosen } from '../desktop/codex.mjs';
import { PlanUsage } from '../desktop/plan-usage.mjs';
import { DEFAULTS } from '../desktop/core.mjs';

// A fake app-server per spawn, and a settle timer the test turns by hand. A turn never completes on its own.
function fixture(options = {}) {
  const children = [], timers = [], remembered = [];
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.killed = false;
    child.kill = () => { child.killed = true; child.stdout.end(); child.emit('close', 0); };
    child.stdin = new Writable({ write(chunk, _encoding, callback) {
      const message = JSON.parse(chunk); callback();
      if (!message.method || message.id === undefined) return;
      const result = { 'config/read': { config: {} }, 'account/read': { account: { type: 'chatgpt', planType: 'free' } }, 'model/list': { data: [{ id: 'gpt-luna', displayName: 'Luna', isDefault: true }] },
        'thread/start': { thread: { id: 'thread-1' } }, 'turn/start': { turn: { id: 'turn-1' } } }[message.method] || {};
      queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result }) + '\n'));
    } });
    children.push(child); return child;
  };
  const connection = new CodexConnection({ cwd: '/private/tmp', executable: '/fake/codex', spawnProcess, remember: known => remembered.push(known),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clear: id => { timers[id - 1] = null; }, ...options });
  const pending = () => timers.filter(Boolean);
  const settle = () => { const due = pending(); assert.equal(due.length, 1, 'one idle timer at a time'); timers[timers.indexOf(due[0])] = null; due[0].fn(); };
  return { connection, children, remembered, pending, settle };
}

test('nothing starts Codex until it is asked, and ten idle minutes stop it, keeping what it knew', async () => {
  const f = fixture();
  assert.equal(f.connection.running, false);
  assert.equal(f.children.length, 0, 'constructing it starts nothing');
  const account = await f.connection.account();
  assert.deepEqual(account, { connected: true, plan: 'free' });
  assert.equal(f.connection.running, true);
  assert.equal(f.pending()[0].ms, CODEX_IDLE_MS);
  f.settle();
  assert.equal(f.connection.running, false);
  assert.equal(f.children[0].killed, true);
  assert.deepEqual(f.connection.known.account, { connected: true, plan: 'free' }, 'stopping keeps what it learnt');
  assert.deepEqual(f.remembered.at(-1).account, { connected: true, plan: 'free' }, 'and it was saved for the next launch');
  assert.deepEqual(await f.connection.account({ cached: true }), account, 'a cached answer needs no server');
  assert.equal(f.children.length, 1);
  await f.connection.models();
  assert.equal(f.children.length, 2, 'the next real question starts it again');
  assert.deepEqual(f.connection.known.models, [{ id: 'gpt-luna', name: 'Luna', isDefault: true }]);
  f.connection.close();
});

test('it never stops in the middle of a turn, only once the turn is over', async () => {
  const f = fixture();
  const stop = new AbortController();
  const turn = f.connection.turn({ settings: { ...DEFAULTS, model: 'gpt-luna' }, input: [], instructions: '', signal: stop.signal });
  while (!f.connection.turns.size) await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pending().length, 0, 'a turn is running: no idle timer');
  stop.abort();
  await assert.rejects(turn, /Stopped/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.pending().length, 1, 'over: the idle timer starts');
  assert.equal(f.connection.running, true);
  f.settle();
  assert.equal(f.connection.running, false);
});

test('what was remembered is checked before it is believed', () => {
  const f = fixture({ remembered: { account: { connected: 'yes' }, models: [{ id: 'gpt-luna', name: 'Luna', isDefault: 1 }, { id: 7 }, null] } });
  assert.equal(f.connection.known.account, null, 'not a real account answer');
  assert.deepEqual(f.connection.known.models, [{ id: 'gpt-luna', name: 'Luna', isDefault: false }]);
  assert.deepEqual(fixture({ remembered: null }).connection.known, { account: null, models: null });
});

test('Codex counts as chosen only where a setting picks it', () => {
  const claude = { backend: 'claude', desktopBackend: 'claude', integrationProvider: 'claude', workProvider: 'claude', quizProvider: 'claude' };
  assert.equal(codexChosen(claude, { quiz: true }), false);
  for (const key of ['backend', 'desktopBackend', 'integrationProvider', 'workProvider']) assert.equal(codexChosen({ ...claude, [key]: 'codex' }), true, key);
  assert.equal(codexChosen({ ...claude, quizProvider: 'codex' }, { quiz: false }), false, 'quiz hints off: not in use');
  assert.equal(codexChosen({ ...claude, quizProvider: 'codex' }, { quiz: true }), true);
});

test('a plan that isn’t asked this time keeps what it showed', async () => {
  let ask = true;
  const usage = new PlanUsage({ readers: { codex: async () => ask ? [{ short: '5h', used: 10 }] : undefined, claude: async () => [{ short: '5h', used: 3 }] }, closest: 0 });
  assert.equal((await new PlanUsage({ readers: { codex: async () => undefined } }).refresh({ force: true })).codex, undefined, 'never asked: nothing shown');
  const first = await usage.refresh({ force: true });
  ask = false;
  const second = await usage.refresh({ force: true });
  assert.deepEqual(second.codex, first.codex);
  assert.equal(second.codex.failed, undefined, 'not marked as failing either');
});

test('the app asks Codex only when it’s in use, and Refresh connection always asks', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  assert.match(main, /const codexChosenNow = \(\) => Boolean\(codex\) && subscriptionModule\.codexChosen\(settings, \{ quiz: Boolean\(quiz\?\.enabled\) \}\);/);
  assert.match(main, /const codexWanted = \(\) => Boolean\(codex\) && \(codex\.running \|\| codexChosenNow\(\)\);/);
  assert.match(main, /remembered: codexKnown, remember: known =>/);
  assert.match(main, /if \(fresh !== true && !codexWanted\(\) && codex\.known\.account\) return subscription = codex\.known\.account;/);
  assert.match(main, /live \? quietly\(\(\) => codex\.account\(\{ cached: true \}\)\) : codex\.known\.account, live \? quietly\(\(\) => codex\.models\(\)\) : codex\.known\.models/);
  assert.match(main, /codex: async \(\{ explicit = false \} = \{\}\) => \(codexChosenNow\(\) \|\| \(explicit && codexSignedInNow\(\)\)\) \? parseCodexUsage\(await codex\.planUsage\(\)\) : undefined/, 'the usage timer never keeps an unchosen Codex awake');
  assert.match(main, /if \(subscription\?\.connected && \(codexWanted\(\) \|\| !codex\.known\.models\)\) codex\.models\(\)/);
  const preload = readFileSync(new URL('../desktop/preload.cjs', import.meta.url), 'utf8');
  assert.match(preload, /subscriptionStatus: fresh => ipcRenderer\.invoke\('fairy:subscription-status', fresh === true\)/);
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /\$\('#subscription-refresh'\)\.onclick = \(\) => refreshSubscription\(true\);/);
});

test('PlanUsage passes explicit:false by default and explicit:true only when requested', async () => {
  const seen = [];
  const usage = new PlanUsage({
    closest: 0,
    readers: {
      codex: async ({ force, explicit } = {}) => {
        seen.push({ force, explicit });
        return explicit ? [{ short: '5h', used: 12 }] : undefined;
      },
    },
  });
  await usage.refresh();
  await usage.refresh({ force: true });
  await usage.refresh({ force: true, explicit: true });
  assert.deepEqual(seen, [
    { force: false, explicit: false },
    { force: true, explicit: false },
    { force: true, explicit: true },
  ]);
  assert.deepEqual(usage.state().codex?.meters, [{ short: '5h', used: 12 }]);
});
