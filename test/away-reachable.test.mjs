// Fairy away from the mini, Away 1: staying reachable. The other Mac's checks and restart over the face link, the keep-alive
// agent, and the move script reaching the mini by its Tailscale name when its home address doesn't answer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { call, setup } from './helpers/face-pair.mjs';
import { faceTrayTemplate, tailscalePath } from '../desktop/presence.mjs';
import { agentPlist, install, LABEL, parseArgs as keepaliveArgs, QUIT_NOTE, REMOTE_INSTALL, WATCHER } from '../scripts/fairy-keepalive.mjs';
import { execFile } from 'node:child_process';
import { REMOTE_OPEN, runners, tailscaleFallback, APP_SUPPORT } from '../scripts/fairy-to-mini.mjs';
import { KEEPALIVE_LABEL } from '../desktop/home-health.mjs';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

test('the face asks the other Mac for its checks, and can restart Fairy there only with the approve key', async () => {
  const restarts = [];
  const s = await setup(async () => ({ text: '' }));
  s.face.health = async () => [{ id: 'power', ok: true, label: 'Never sleeps', fix: '' }];
  s.face.restart = () => restarts.push(Date.now());
  s.face.timers = { ...globalThis, setTimeout: (run) => { run(); return 0; } };
  try {
    const health = await call(s.link, '/v1/face/health', { key: s.key });
    assert.equal(health.status, 200);
    assert.deepEqual(health.json.checks, [{ id: 'power', ok: true, label: 'Never sleeps', fix: '' }]);
    assert.equal((await call(s.link, '/v1/face/restart', { method: 'POST', key: s.key, body: {} })).status, 403, 'no approve key');
    assert.equal((await call(s.link, '/v1/face/restart', { method: 'POST', key: s.key, body: { approveKey: s.key } })).status, 403, 'the read key isn’t the approve key');
    assert.equal(restarts.length, 0);
    const restarted = await call(s.link, '/v1/face/restart', { method: 'POST', key: s.key, body: { approveKey: s.approveKey } });
    assert.equal(restarted.status, 200);
    assert.equal(restarts.length, 1);
    assert.equal((await call(s.link, '/v1/face/health', {})).status, 401, 'nothing without the face’s key');
    s.face.health = null; s.face.restart = null;
    assert.equal((await call(s.link, '/v1/face/health', { key: s.key })).status, 404);
  } finally { await s.done(); }
});

test('a normal quit leaves the watcher a note, a restart for a face doesn’t, and every sign-in is asked', async () => {
  const main = await read('../desktop/main.cjs');
  assert.match(main, /const quitNotePath = \(\) => restartingForFace \? '' : join\(app\.getPath\('userData'\), 'quit-cleanly'\);/);
  assert.match(main, /const leaveQuitNote = \(\) => \{ const path = quitNotePath\(\); if \(path\) \{ try \{ require\('node:fs'\)\.writeFileSync\(path,/);
  assert.match(main, /app\.on\('will-quit', \(\) => \{ quitWatch\.report\('will-quit'\); leaveQuitNote\(\); \}\);/);
  assert.match(main, /function restartFairy\(\) \{\n\s+restartingForFace = true;\n\s+if \(process\.env\.FAIRY_KEPT_ALIVE !== '1'\) app\.relaunch\(\);\n\s+app\.quit\(\);/);
  assert.equal(QUIT_NOTE, 'Library/Application Support/lyra-companion/quit-cleanly');
  assert.match(main, /health: async \(\) => \{ const \{ healthReport, runCommand \} = await import\('\.\/home-health\.mjs'\); return healthReport\(\{ run: runCommand, signIns: faceSignIns\(\)/);
  for (const name of ['Claude Code', 'Codex', 'Google', 'Her voice']) assert.ok(main.includes(`name: '${name}'`), name);
  assert.equal(LABEL, KEEPALIVE_LABEL);
});

test('Tailscale’s path to the other Mac: direct with an address, relayed without one', () => {
  const status = { Peer: { a: { DNSName: 'kagutsuchi.tailbc1fab.ts.net.', CurAddr: '192.168.68.61:41641', Relay: 'syd', Online: true }, b: { DNSName: 'other.ts.net.', CurAddr: '', Relay: 'syd', Online: true } } };
  assert.equal(tailscalePath(JSON.stringify(status), 'kagutsuchi.tailbc1fab.ts.net'), 'direct');
  assert.equal(tailscalePath(status, 'other.ts.net'), 'relayed');
  assert.equal(tailscalePath(status, 'missing.ts.net'), '');
  assert.equal(tailscalePath('not json', 'kagutsuchi.tailbc1fab.ts.net'), '');
  const menu = faceTrayTemplate({ link: 'connected', host: 'kagutsuchi.tailbc1fab.ts.net', path: 'relayed' });
  assert.match(menu[0].label, /\(relayed\)$/);
  assert.deepEqual(menu.filter(item => ['check', 'restart'].includes(item.id)).map(item => item.id), ['check', 'restart']);
  assert.ok(!faceTrayTemplate({ link: 'unreachable', path: 'direct' }).some(item => item.id === 'check'), 'only while connected');
  assert.doesNotMatch(faceTrayTemplate({ link: 'unreachable', path: 'direct' })[0].label, /direct/);
});

test('the keep-alive agent runs a watcher that opens Fairy as the Finder does, not Fairy herself', () => {
  const plist = agentPlist('/Users/someone/Applications/Fairy.app', '/Users/someone/Library/Logs/Fairy/keepalive.log');
  assert.match(plist, /<key>Label<\/key><string>dev\.razeen\.fairy\.keepalive<\/string>/);
  // Started by launchd, Fairy couldn't use Tailscale's tool, so her link would stay closed: the watcher opens her instead.
  assert.match(plist, /<array><string>\/bin\/sh<\/string><string>-c<\/string><string>[^<]+<\/string><string>sh<\/string><string>\/Users\/someone\/Applications\/Fairy\.app<\/string><\/array>/);
  assert.doesNotMatch(plist, /Contents\/MacOS\/Fairy</);
  assert.match(WATCHER, /\/usr\/bin\/open -W --env FAIRY_KEPT_ALIVE=1 "\$app"/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plist, /<key>KeepAlive<\/key><dict><key>SuccessfulExit<\/key><false\/><\/dict>/);
  assert.match(plist, /<key>StandardErrorPath<\/key><string>\/Users\/someone\/Library\/Logs\/Fairy\/keepalive\.log<\/string>/);
  assert.match(agentPlist('/a&b<c', '/log'), /\/a&amp;b&lt;c</);
  // Installing leaves a running Fairy running, and checks the list before loading it.
  assert.doesNotMatch(REMOTE_INSTALL, /to quit/);
  assert.match(REMOTE_INSTALL, /plutil -lint/);
  assert.throws(() => keepaliveArgs(['start']), /install or remove/);
  assert.throws(() => keepaliveArgs(['install', '--host', 'mini; rm -rf ~']), /host name/);
});

// The watcher itself, run with a stand-in `open` that exits as Fairy would: after a quit (with the note), or a crash.
async function watch(exits) {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-watch-')), bin = join(dir, 'bin'), home = join(dir, 'home'), count = join(dir, 'count');
  await mkdir(bin); await mkdir(join(home, 'Library', 'Application Support', 'lyra-companion'), { recursive: true });
  const script = WATCHER.replace('/usr/bin/open', join(bin, 'open')).replace('sleep 30', 'sleep 0').replace('sleep 2', 'sleep 0').replace('sleep 10', 'sleep 0');
  // Each run: the next exit from the list; "quit" leaves the note, as main.cjs does on will-quit.
  await writeFile(join(bin, 'open'), `#!/bin/sh\nn=$(cat ${JSON.stringify(count)} 2>/dev/null || echo 0); n=$((n+1)); echo $n > ${JSON.stringify(count)}\nwhat=$(echo ${JSON.stringify(exits.join(' '))} | cut -d' ' -f$n)\n[ "$what" = quit ] && echo done > "$HOME/${QUIT_NOTE}"\nexit 0\n`);
  await chmod(join(bin, 'open'), 0o755);
  const out = await new Promise(resolve => execFile('/bin/sh', ['-c', script, 'sh', '/Applications/Fairy.app'], { env: { HOME: home, PATH: '/usr/bin:/bin' }, timeout: 10000 }, (error, stdout) => resolve({ error, stdout })));
  const runs = Number((await readFile(count, 'utf8')).trim());
  await rm(dir, { recursive: true, force: true });
  return { ...out, runs };
}
test('the watcher opens Fairy again after a crash, and stops when she was quit', async () => {
  const quit = await watch(['quit']);
  assert.equal(quit.error, null); assert.equal(quit.runs, 1);
  const crashes = await watch(['crash', 'crash', 'quit']);
  assert.equal(crashes.error, null); assert.equal(crashes.runs, 3);
  assert.equal((crashes.stdout.match(/opening her again/g) || []).length, 2);
});

test('installing sends the agent to the mini and says whether Fairy is running there', async () => {
  const sent = [], lines = [];
  const run = { remote: async (script, args) => { sent.push({ script, args }); return 'running=yes\n'; } };
  const said = await install({ options: { host: 'mini', dryRun: false }, run, log: line => lines.push(line) });
  assert.equal(said.running, 'yes');
  assert.equal(sent[0].script, REMOTE_INSTALL);
  assert.match(sent[0].args[0], /<string>__APP__<\/string>/);
  assert.match(sent[0].args[0], /<string>__LOG__<\/string>/);
  assert.ok(lines.some(line => /watched by the agent/.test(line)));
});

test('updating opens Fairy through the agent when it’s there, so she stays kept alive', async () => {
  assert.match(REMOTE_OPEN, /launchctl kickstart "gui\/\$\(id -u\)\/dev\.razeen\.fairy\.keepalive"; else open "\$HOME\/Applications\/Baryon\.app"; fi/);
  const script = await read('../scripts/fairy-to-mini.mjs');
  const update = script.slice(script.indexOf('export async function update('));
  assert.ok(update.includes('run.remote(REMOTE_OPEN'));
  assert.ok(!update.includes(`run.remote('open "$HOME/Applications/Baryon.app"'`));
});

test('when the mini’s home address doesn’t answer, the script tries its Tailscale name, once, and keeps it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-reach-')), ssh = join(dir, 'ssh'), hosts = join(dir, 'hosts.log');
  // A stand-in ssh: "mini" can't be reached; any other name runs the command.
  await writeFile(ssh, `#!/bin/sh\nwhile [ "$1" = "-o" ]; do shift 2; done\necho "$1" >> ${JSON.stringify(hosts)}\nif [ "$1" = "mini" ]; then echo "ssh: connect to host 192.168.68.62 port 22: Operation timed out" >&2; exit 255; fi\nshift\nexec /bin/sh -c "$1"\n`);
  await chmod(ssh, 0o755);
  try {
    const lines = [], run = runners({ host: 'mini', fallback: 'me@kagutsuchi.tailbc1fab.ts.net', ssh, log: line => lines.push(line) });
    assert.equal((await run.remote('echo one')).trim(), 'one');
    assert.equal((await run.remote('echo two')).trim(), 'two');
    assert.deepEqual((await readFile(hosts, 'utf8')).trim().split('\n'), ['mini', 'me@kagutsuchi.tailbc1fab.ts.net', 'me@kagutsuchi.tailbc1fab.ts.net']);
    assert.ok(lines.some(line => /didn’t answer; trying me@kagutsuchi/.test(line)));
    // A command that fails on a reachable Mac isn't retried elsewhere.
    const plain = runners({ host: 'other', fallback: 'me@kagutsuchi.tailbc1fab.ts.net', ssh, log: () => {} });
    await assert.rejects(plain.remote('exit 3'), /failed on other/);
    // The Tailscale name comes from this Mac's face pairing, with the SSH config's user.
    const home = join(dir, 'home');
    await mkdir(join(home, APP_SUPPORT, 'face'), { recursive: true });
    await writeFile(join(home, APP_SUPPORT, 'face', 'face.json'), JSON.stringify({ pairing: { host: 'kagutsuchi.tailbc1fab.ts.net' } }));
    assert.equal(tailscaleFallback('mini', { home, sshConfig: () => 'hostname 192.168.68.62\nuser razeen\n' }), 'razeen@kagutsuchi.tailbc1fab.ts.net');
    assert.equal(tailscaleFallback('mini', { home: join(dir, 'nobody'), sshConfig: () => '' }), null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the face’s menu offers the check and the restart, with Touch ID for the restart', async () => {
  const face = await read('../desktop/face-main.cjs');
  assert.match(face, /if \(id === 'check'\) return checkBeforeLeaving\(\);/);
  assert.match(face, /await systemPreferences\.promptTouchID\('restart Fairy on your other Mac'\);\n\s+await connected\(\)\.restart\(store\.approveKey\(\)\);/);
  assert.match(face, /buttons: fixes\.length \? \['OK', 'Copy the fixes'\] : \['OK'\]/);
});
