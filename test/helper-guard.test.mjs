import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createGuard, requirementFor, packaged, install } from '../desktop/helper-guard.cjs';

const ROOT = '/Apps/Fairy.app/Contents/Resources/app.asar.unpacked', IDLE = `${ROOT}/native/bin/fairy-idle`;
// A guard over a pretend folder: `files` maps a path to { id, good }, and every check and refusal is recorded.
function pretend(files, { root = ROOT } = {}) {
  const checked = [], refusals = [];
  const stat = path => { const file = files[path]; if (!file) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return { dev: 1n, ino: BigInt(file.id), size: 10n, mtimeNs: 5n, ctimeNs: BigInt(file.changed ?? 7) }; };
  const guard = createGuard({ root, verify: path => { checked.push(path); return Boolean(files[path]?.good); }, stat, onRefused: refusal => refusals.push(refusal) });
  return { guard, checked, refusals };
}
// A stand-in for child_process that records what it was asked to start.
function recorder() {
  const started = [];
  const record = kind => function (file, ...rest) { started.push({ kind, file, rest }); return kind; };
  return { started, childProcess: { spawn: record('spawn'), execFile: record('execFile'), spawnSync: record('spawnSync'), execFileSync: record('execFileSync') } };
}

test('a program outside her folder is started untouched and unchecked', () => {
  const { guard, checked } = pretend({});
  const { childProcess, started } = recorder();
  guard.wrap(childProcess);
  childProcess.spawn('/usr/bin/git', ['status'], { cwd: '/tmp' });
  childProcess.execFileSync('/bin/ls', ['-l']);
  childProcess.spawn(`${ROOT}-elsewhere/native/bin/fairy-idle`);
  assert.deepEqual(started.map(item => item.file), ['/usr/bin/git', '/bin/ls', `${ROOT}-elsewhere/native/bin/fairy-idle`]);
  assert.deepEqual(started[0].rest, [['status'], { cwd: '/tmp' }], 'arguments and options pass through');
  assert.deepEqual(checked, []);
});

test('her own program is checked once, then remembered while the file stays the same', () => {
  const files = { [IDLE]: { id: 1, good: true } };
  const { guard, checked, refusals } = pretend(files);
  const { childProcess, started } = recorder();
  guard.wrap(childProcess);
  for (let n = 0; n < 3; n++) childProcess.spawn(IDLE, ['200']);
  childProcess.spawn(`${ROOT}/native/../native/bin/fairy-idle`);
  assert.equal(started.length, 4);
  assert.deepEqual(checked, [IDLE], 'one check for four starts, however the path is spelled');
  assert.deepEqual(refusals, []);
});

test('a helper swapped for another program isn’t started, and you’re told once', () => {
  const files = { [IDLE]: { id: 1, good: true } };
  const { guard, checked, refusals } = pretend(files);
  const { childProcess, started } = recorder();
  guard.wrap(childProcess);
  childProcess.spawn(IDLE);
  files[IDLE] = { id: 2, good: false };                       // a different file under the same name
  childProcess.spawn(IDLE, ['200']);
  childProcess.execFile(IDLE, []);
  assert.deepEqual(started.map(item => item.file), [IDLE, `${IDLE}.refused-by-fairy`, `${IDLE}.refused-by-fairy`], 'the callers see a program that isn’t there');
  assert.throws(() => childProcess.spawnSync(IDLE), { code: 'EFAIRYHELPER' });
  assert.throws(() => childProcess.execFileSync(IDLE), /isn’t one of her own programs any more/);
  assert.throws(() => guard.assertTrusted(IDLE), { code: 'EFAIRYHELPER' });
  assert.equal(started.length, 3, 'the Sync forms started nothing');
  assert.equal(checked.length, 6, 'a refused file is checked again each time, never remembered');
  assert.deepEqual(refusals, [{ path: IDLE, why: 'it isn’t signed by Fairy’s team' }]);
});

test('a file edited in place is checked again, and one put back is trusted again', () => {
  const files = { [IDLE]: { id: 1, good: true } };
  const { guard, checked } = pretend(files);
  assert.equal(guard.allowed(IDLE), true);
  files[IDLE] = { id: 1, good: false, changed: 8 };           // same inode, later change time
  assert.equal(guard.allowed(IDLE), false);
  files[IDLE] = { id: 3, good: true };
  assert.equal(guard.allowed(IDLE), true);
  assert.equal(checked.length, 3);
});

test('a helper that’s gone is refused without a check, and the background answer is kept only for the file it was about', () => {
  const files = { [IDLE]: { id: 1, good: true } };
  const { guard, checked, refusals } = pretend(files);
  assert.equal(guard.allowed(`${ROOT}/native/bin/fairy-missing`), false);
  assert.deepEqual(refusals, [{ path: `${ROOT}/native/bin/fairy-missing`, why: 'it isn’t there' }]);
  const before = guard.identity(IDLE);
  files[IDLE] = { id: 9, good: false };                       // swapped while the background check ran
  guard.remember(IDLE, before);
  assert.equal(guard.allowed(IDLE), false, 'the old answer isn’t used for the new file');
  files[IDLE] = { id: 1, good: true };
  guard.remember(IDLE, guard.identity(IDLE));
  const checks = checked.length;
  assert.equal(guard.allowed(IDLE), true);
  assert.equal(checked.length, checks, 'a remembered answer saves the check');
});

test('with no folder to guard, nothing is wrapped or checked', () => {
  const { guard, checked } = pretend({}, { root: '' });
  assert.equal(guard.enforcing, false);
  assert.equal(guard.allowed(IDLE), true);
  assert.deepEqual(checked, []);
});

test('a checkout guards nothing, and child_process is left as Node made it', async () => {
  const childProcess = await import('node:child_process');
  const before = childProcess.spawn;
  assert.deepEqual(packaged(), { root: '', team: '' });
  const guard = install();
  assert.equal(guard.enforcing, false);
  assert.equal(childProcess.spawn, before);
  assert.equal(install(), guard, 'installing twice is the same guard');
});

test('the requirement is one macOS’s own tools accept, and Apple’s programs don’t satisfy it', { skip: process.platform !== 'darwin' }, () => {
  const requirement = requirementFor('C63K728GC6');
  assert.equal(requirement, 'anchor apple generic and certificate leaf[subject.OU] = "C63K728GC6"');
  assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, '/bin/echo'], { stdio: 'ignore' }).status, 3, 'validly signed, but not by this team');
  assert.equal(spawnSync('/usr/bin/codesign', ['--verify', '--strict', '-R=anchor apple', '/bin/echo'], { stdio: 'ignore' }).status, 0, 'and the same call accepts a requirement it does satisfy');
});

// The guard only helps where it's put on. These read the source so a new worker, or a reordered main file, can't
// quietly leave it off.
test('the main process puts the guard on before it takes child_process, and terminals check their shell starter', async () => {
  const { readFile } = await import('node:fs/promises');
  const main = await readFile(new URL('../desktop/main.cjs', import.meta.url), 'utf8');
  const guard = main.indexOf("require('./helper-guard.cjs').install("), taken = main.indexOf("require('node:child_process')");
  assert.ok(guard > 0 && taken > 0 && guard < taken, 'install() comes first');
  assert.match(main, /helperGuard\.assertTrusted\(beside\(`node_modules\/node-pty\/prebuilds\/darwin-\$\{process\.arch\}\/spawn-helper`\)\); return require\('node-pty'\)\.spawn/);
  assert.equal(main.split("require('node-pty')").length - 1, 1, 'and that is the only place a terminal is started');
});

test('every worker puts the guard on', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const folder = new URL('../desktop/', import.meta.url), workers = new Set();
  async function scan(url) {
    for (const entry of await readdir(url, { withFileTypes: true })) {
      if (entry.isDirectory()) { await scan(new URL(`${entry.name}/`, url)); continue; }
      if (!/\.(mjs|cjs)$/.test(entry.name)) continue;
      const source = await readFile(new URL(entry.name, url), 'utf8');
      if (!/new Worker\(/.test(source)) continue;
      const named = [...source.matchAll(/new Worker\([^)]*?['"`]\.?\/?([\w./-]+\.(?:mjs|cjs))['"`]/g)].map(match => match[1]);
      assert.ok(named.length, `${entry.name} starts a worker this test can’t name; name its file plainly`);
      for (const name of named) workers.add(new URL(name, url).href);
    }
  }
  await scan(folder);
  assert.ok(workers.size >= 3);
  for (const worker of workers) {
    const source = await readFile(new URL(worker), 'utf8');
    assert.match(source, /import \{ install as guardHelpers \} from '\.\.?\/helper-guard\.cjs';[\s\S]*\bguardHelpers\(\)/, `${worker.split('/').pop()} doesn’t put the guard on`);
  }
});
