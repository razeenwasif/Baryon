import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitCommit, gitDiff, gitStage, gitStatus, gitUnstage, parseStatus } from '../desktop/git-tools.mjs';
import { Terminals } from '../desktop/terminal.mjs';
import { browserAddress, cleanBounds } from '../desktop/browser-pane.mjs';
import { PreviewServer, detectPreview, findLocalURL } from '../desktop/preview-server.mjs';
import { seatbeltProfile } from '../desktop/work-sandbox.mjs';

async function folder(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'fairy-panes-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
const run = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
async function repo(t) {
  const root = await folder(t);
  run(root, 'init', '-q', '-b', 'main'); run(root, 'config', 'user.name', 'T'); run(root, 'config', 'user.email', 't@example.com');
  await writeFile(join(root, 'a.txt'), 'one\ntwo\n');
  run(root, 'add', '-A'); run(root, 'commit', '-qm', 'start');
  return root;
}

test('status lists what changed, and a plain folder says so', async t => {
  const plain = await folder(t);
  assert.deepEqual(await gitStatus(plain), { repo: false, files: [] });
  const root = await repo(t);
  assert.deepEqual((await gitStatus(root)).files, []);
  assert.equal((await gitStatus(root)).branch, 'main');
  await writeFile(join(root, 'a.txt'), 'one\nTWO\n');
  await mkdir(join(root, 'sub dir')); await writeFile(join(root, 'sub dir/new ünï.txt'), 'hi\n');
  const { files } = await gitStatus(root);
  assert.deepEqual(files.map(file => [file.path, file.kind, file.staged, file.unstaged]), [['a.txt', 'Modified', false, true], ['sub dir/new ünï.txt', 'New', false, true]]);
  assert.equal(files[1].untracked, true);
});

test('status reads renames, conflicts and an empty repository', () => {
  const parsed = parseStatus('## main...origin/main [ahead 2, behind 1]\0R  new.txt\0old.txt\0UU both.txt\0 M e.txt\0');
  assert.deepEqual([parsed.branch, parsed.ahead, parsed.behind], ['main', 2, 1]);
  assert.deepEqual(parsed.files.map(file => [file.path, file.from, file.kind, file.conflict]), [['new.txt', 'old.txt', 'Renamed', false], ['both.txt', undefined, 'Conflict', true], ['e.txt', undefined, 'Modified', false]]);
  assert.equal(parseStatus('## No commits yet on main\0').branch, 'main');
});

test('diffs show changes, new files and staged changes', async t => {
  const root = await repo(t);
  await writeFile(join(root, 'a.txt'), 'one\nTWO\n');
  assert.match(await gitDiff(root, 'a.txt'), /-two\n\+TWO/);
  assert.equal(await gitDiff(root, 'a.txt', { staged: true }), '');
  await gitStage(root, 'a.txt');
  assert.match(await gitDiff(root, 'a.txt', { staged: true }), /\+TWO/);
  await writeFile(join(root, 'n.txt'), 'brand new\n');
  assert.match(await gitDiff(root, 'n.txt', { untracked: true }), /\+brand new/);
  for (const bad of ['../x', '/etc/passwd', 'a/../../b', '', 'x\0y']) await assert.rejects(gitDiff(root, bad), /isn’t a file/, bad);
});

test('staging, unstaging and committing, and only what’s staged goes in', async t => {
  const root = await repo(t);
  await writeFile(join(root, 'a.txt'), 'changed\n'); await writeFile(join(root, 'b.txt'), 'left out\n');
  await gitStage(root, 'a.txt');
  assert.equal((await gitStatus(root)).files.find(file => file.path === 'a.txt').staged, true);
  await gitUnstage(root, 'a.txt');
  assert.equal((await gitStatus(root)).files.find(file => file.path === 'a.txt').staged, false);
  await gitStage(root, 'a.txt');
  await assert.rejects(gitCommit(root, '   '), /commit message/);
  const hash = await gitCommit(root, 'Change a');
  assert.match(hash, /^[0-9a-f]{6,}$/);
  assert.equal(run(root, 'log', '-1', '--format=%s').trim(), 'Change a');
  assert.deepEqual((await gitStatus(root)).files.map(file => file.path), ['b.txt']);
  const fresh = await folder(t);
  run(fresh, 'init', '-q'); await writeFile(join(fresh, 'x.txt'), 'x');
  await gitStage(fresh, 'x.txt'); await gitUnstage(fresh, 'x.txt');
  assert.equal((await gitStatus(fresh)).files[0].untracked, true, 'unstaging works before the first commit');
});

test('looking at a repository doesn’t run programs its config names', async t => {
  const root = await repo(t), marker = join(root, 'ran.txt');
  await writeFile(join(root, 'evil.sh'), `#!/bin/sh\necho ran > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
  run(root, 'config', 'core.fsmonitor', join(root, 'evil.sh'));
  run(root, 'config', 'diff.external', join(root, 'evil.sh'));
  await writeFile(join(root, 'a.txt'), 'x\n');
  await gitStatus(root);
  assert.match(await gitDiff(root, 'a.txt'), /\+x/);
  assert.equal((await gitStatus(root)).files.some(file => file.path === 'ran.txt'), false);
});

test('terminals are real shells that start in the folder and take input', async t => {
  const pty = await import('node-pty'), root = await folder(t);
  let output = '', ended = false;
  const terminals = new Terminals({ spawn: pty.spawn, shell: '/bin/zsh', onData: (_id, data) => { output += data; }, onExit: () => { ended = true; } });
  t.after(() => terminals.stopAll());
  const { id, cwd } = await terminals.start({ cwd: root, cols: 90, rows: 20 });
  assert.equal(cwd, root);
  terminals.resize(id, 100, 30);
  terminals.write(id, 'echo "cwd=$PWD cols=$COLUMNS term=$TERM"; exit\r');
  for (let i = 0; i < 100 && !ended; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(ended, true, output.slice(-300));
  assert.match(output, new RegExp(`cwd=${root.replace(/[/.-]/g, '\\$&')}`));
  assert.match(output, /cols=100 term=xterm-256color/);
  assert.equal(terminals.running.size, 0);
});

test('a terminal in a missing folder opens at home, and limits hold', async () => {
  const started = [];
  const terminals = new Terminals({ shell: '/bin/zsh', onData() {}, onExit() {}, spawn: (shell, args, options) => { started.push(options); return { onData() {}, onExit() {}, kill() {}, write() {}, resize() {} }; } });
  const { cwd } = await terminals.start({ cwd: '/nowhere/at/all', cols: 'x', rows: 99999 });
  assert.notEqual(cwd, '/nowhere/at/all');
  assert.deepEqual([started[0].cols, started[0].rows], [80, 24]);
  for (let i = 0; i < 7; i++) await terminals.start({});
  await assert.rejects(terminals.start({}), /Close a terminal/);
  terminals.stopAll();
  assert.equal(terminals.running.size, 0);
});

test('the address bar opens web addresses, and everything else is a search', () => {
  assert.equal(browserAddress('https://example.com/a'), 'https://example.com/a');
  assert.equal(browserAddress('example.com'), 'https://example.com/');
  assert.equal(browserAddress('example.co.uk/path?q=1'), 'https://example.co.uk/path?q=1');
  assert.equal(browserAddress('localhost:5173'), 'http://localhost:5173/');
  assert.equal(browserAddress('127.0.0.1:3000/x'), 'http://127.0.0.1:3000/x');
  assert.match(browserAddress('how do tides work'), /^https:\/\/www\.google\.com\/search\?q=how/);
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'chrome://settings', 'about:blank', 'ftp://x.com/a', 'fairy-artifact://page/x/1/index.html', '', 'https://user:pw@example.com/']) assert.throws(() => browserAddress(bad), undefined, bad);
});

test('the browser view stays inside the window', () => {
  assert.deepEqual(cleanBounds({ x: 900, y: 100, width: 500, height: 2000 }, { width: 1140, height: 820 }), { x: 900, y: 100, width: 240, height: 720 });
  assert.deepEqual(cleanBounds({ x: -5, y: 'nope' }, { width: 100, height: 100 }), { x: 0, y: 0, width: 0, height: 0 });
});

test('previews suggest a command from the project, and accept only local addresses', async t => {
  const root = await folder(t);
  assert.equal(await detectPreview(root), '');
  await writeFile(join(root, 'index.html'), '<p>x</p>');
  assert.match(await detectPreview(root), /http\.server 8000/);
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { test: 'x', start: 'y' } }));
  assert.equal(await detectPreview(root), 'npm start');
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts: { start: 'y', dev: 'vite' } }));
  assert.equal(await detectPreview(root), 'npm run dev');
  assert.equal(findLocalURL('\u001b[32m  ➜  Local:   http://localhost:5173/\u001b[0m'), 'http://localhost:5173/');
  assert.equal(findLocalURL('ready on http://127.0.0.1:3000/app'), 'http://localhost:3000/app');
  assert.equal(findLocalURL('Serving HTTP on 127.0.0.1 port 8000 (http://127.0.0.1:8000/) ...'), 'http://localhost:8000/');
  assert.equal(findLocalURL('Listening on port 4321'), 'http://localhost:4321/');
  assert.equal(findLocalURL('See https://evil.example:8000/ for help'), '');
  assert.equal(findLocalURL('nothing here'), '');
});

const darwin = { skip: process.platform !== 'darwin' };
test('a preview server can serve on this Mac and reach nothing else', darwin, async t => {
  const root = await folder(t), states = [];
  const script = `import { createServer } from 'node:http';import { connect } from 'node:net';
const server = createServer((req, res) => res.end('hello from the sandbox'));
server.listen(0, '127.0.0.1', () => {
  const socket = connect({ host: '1.1.1.1', port: 443, timeout: 2000 });
  const report = result => { console.log('outbound=' + result); console.log('Listening at http://localhost:' + server.address().port + '/'); };
  socket.once('connect', () => { socket.destroy(); report('connected'); }); socket.once('error', error => report(error.code)); socket.once('timeout', () => report('timeout'));
});`;
  await writeFile(join(root, 'server.mjs'), script);
  const preview = new PreviewServer({ onState: value => states.push(value) });
  t.after(() => preview.stop());
  await preview.start({ root, command: 'node server.mjs' });
  for (let i = 0; i < 100 && !preview.status.url; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(preview.status.url, /^http:\/\/localhost:\d+\/$/, preview.status.output);
  assert.equal(await (await fetch(preview.status.url)).text(), 'hello from the sandbox');
  assert.match(preview.status.output, /outbound=(?:EPERM|EACCES|ENETUNREACH|ECONNREFUSED|timeout)/, 'outside connections are refused');
  assert.doesNotMatch(preview.status.output, /outbound=connected/);
  const url = preview.status.url;
  preview.stop();
  assert.equal(preview.status.running, false);
  await new Promise(resolve => setTimeout(resolve, 500));
  await assert.rejects(fetch(url));
});

test('a server that fails says so', darwin, async t => {
  const root = await folder(t), preview = new PreviewServer({});
  await preview.start({ root, command: 'echo nope; exit 3' });
  for (let i = 0; i < 50 && preview.status.running; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.match(preview.status.error, /exit code 3/);
  await assert.rejects(preview.start({ root, command: '  ' }), /command/);
});

test('loopback rules are added only when asked for', () => {
  const plain = seatbeltProfile({ root: '/tmp/a', temp: '/tmp/t', home: '/Users/x' });
  assert.doesNotMatch(plain, /localhost/);
  const loopback = seatbeltProfile({ root: '/tmp/a', temp: '/tmp/t', home: '/Users/x', loopback: true });
  assert.match(loopback, /\(deny network\*\)/);
  assert.match(loopback, /localhost/);
  assert.doesNotMatch(loopback, /allow network\*/, 'only serving and talking to this Mac are allowed');
});

test('the terminal and browser keep the app’s bridge out of reach', () => {
  const browser = readFileSync(new URL('../desktop/browser-pane.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(browser, /preload/);
  assert.match(browser, /sandbox: true/);
  assert.match(browser, /nodeIntegration: false/);
  const preview = readFileSync(new URL('../desktop/preview-server.mjs', import.meta.url), 'utf8');
  assert.match(preview, /sandbox-exec/);
  const packaging = readFileSync(new URL('../scripts/package-fairy.mjs', import.meta.url), 'utf8');
  assert.match(packaging, /copyDependency\('node-pty'\)/);
  assert.match(packaging, /spawn-helper/);
});
