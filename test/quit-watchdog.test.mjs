import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { QUIT_HARD_LIMIT_MS, GRACE_MS, describeError } = createRequire(import.meta.url)('../desktop/quit-watchdog.cjs');
const { QUIT_LIMIT_MS } = createRequire(import.meta.url)('../desktop/quit-gate.cjs');
const WATCHDOG = fileURLToPath(new URL('../desktop/quit-watchdog.cjs', import.meta.url));

// Runs `body` in a Node process of its own with a watch started as Fairy's before-quit starts it, and says how it ended.
async function quitting(t, body, { limit = 300, grace = 300 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-watch-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const log = join(dir, 'quit.jsonl'), note = join(dir, 'quit-cleanly'), script = join(dir, 'app.cjs');
  await writeFile(script, `
    const watch = require(${JSON.stringify(WATCHDOG)}).quitWatchdog({ log: ${JSON.stringify(log)}, note: () => ${JSON.stringify(note)}, limit: ${limit}, grace: ${grace},
      onExit: stage => { process.exitCode = 3; process.exit(3); } });
    watch.start();
    ${body}
  `);
  const started = Date.now(), child = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = ''; child.stdout.on('data', chunk => { out += chunk; });
  const [code, signal] = await new Promise(resolve => child.on('exit', (...ended) => resolve(ended)));
  const lines = await readFile(log, 'utf8').then(text => text.trim().split('\n').map(line => JSON.parse(line)), () => []);
  const noted = await access(note).then(() => true, () => false);
  return { code, signal, took: Date.now() - started, lines, noted, out };
}

test('the hard limit, grace included, leaves the update script time to see her go', async () => {
  const { REMOTE_QUIT } = await import('../scripts/fairy-to-mini.mjs');
  const tries = Number(/\$i -lt (\d+)/.exec(REMOTE_QUIT)?.[1]), pause = Number(/sleep ([\d.]+)/.exec(REMOTE_QUIT)?.[1]);
  assert.ok(QUIT_HARD_LIMIT_MS > QUIT_LIMIT_MS, 'the quit gate gives up before the watch steps in');
  assert.ok(QUIT_HARD_LIMIT_MS + GRACE_MS < tries * pause * 1000 - 5000, `${QUIT_HARD_LIMIT_MS + GRACE_MS} ms against ${tries * pause} s`);
});

// 19 Nov: a modal dialog during the quit held the main thread, so nothing on it (timers included) ran for 67 s.
// Atomics.wait holds the main thread the same way.
test('a quit whose main thread is held is ended anyway, and the log says where it stopped', async t => {
  const ended = await quitting(t, `
    const helper = require('node:child_process').spawn('/bin/sleep', ['30'], { stdio: 'ignore' });
    console.log(helper.pid);
    watch.report('closing windows', { windows: [{ title: 'Fairy', page: 'index.html', visible: false }] });
    watch.report('saying what failed', { failed: ['saves'] });
    setTimeout(() => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20000), 20);
  `);
  assert.equal(ended.signal, 'SIGKILL');
  assert.ok(ended.took < 5000, `took ${ended.took} ms`);
  assert.deepEqual(ended.lines.map(line => line.forced), ['exit', 'kill']);
  assert.equal(ended.lines[1].stage, 'saying what failed');
  assert.deepEqual(ended.lines[1].detail, { failed: ['saves'] });
  assert.deepEqual(ended.lines[1].stages.map(s => s.stage), ['closing windows', 'saying what failed']);
  assert.equal(ended.noted, true, 'the keep-alive is told she quit, so it doesn’t reopen her mid-update');
  // Her helpers don't outlive her.
  const helper = Number(ended.out.trim());
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.throws(() => process.kill(helper, 0), { code: 'ESRCH' });
});

test('a quit that stalls with the main thread free is asked to exit, and nothing is killed', async t => {
  const ended = await quitting(t, `watch.report('closing windows', { windows: [] }); setInterval(() => {}, 1000);`);
  assert.equal(ended.code, 3);
  assert.equal(ended.signal, null);
  assert.deepEqual(ended.lines.map(line => [line.forced, line.stage]), [['exit', 'closing windows']]);
  assert.equal(ended.noted, false, 'onExit leaves the note itself');
});

test('a quit that finishes in time leaves no line', async t => {
  const ended = await quitting(t, `watch.report('will-quit'); setTimeout(() => process.exit(0), 50);`, { limit: 1000 });
  assert.equal(ended.code, 0);
  assert.deepEqual(ended.lines, []);
});

test('errors are logged with what failed and on which file', () => {
  const failure = Object.assign(new Error('EACCES: permission denied, open \'/x/lyra/promises.json.1.tmp\''), { code: 'EACCES', syscall: 'open', path: '/x/lyra/promises.json.1.tmp' });
  assert.deepEqual(describeError(new AggregateError([failure], 'Some pending app data could not be saved.')), {
    name: 'AggregateError', message: 'Some pending app data could not be saved.',
    errors: [{ name: 'Error', message: failure.message, code: 'EACCES', syscall: 'open', file: 'promises.json.1.tmp' }],
  });
});

test('Fairy’s quit never waits on a dialog, and every quit starts the watch', () => {
  const main = readFileSync(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const gate = main.slice(main.indexOf("require('./quit-gate.cjs').quitGate("), main.indexOf("app.on('will-quit', () => { terminals"));
  assert.ok(gate.length > 0);
  assert.doesNotMatch(gate, /\bdialog\.\w+\(|showMessageBox(Sync)?\(|showErrorBox\(/);
  assert.match(main, /app\.on\('before-quit', \(\) => \{ quitting = true; quitWatch\.start\(\);/);
  assert.match(main, /onExit: stage => \{[^\n]*leaveQuitNote\(\); app\.exit\(0\);/);
});
