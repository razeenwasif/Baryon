import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { APP_SUPPORT, LEFT_OUT, QUIT_NOTE_PATH, finish, localState, miniPhoneLink, move, parseArgs, quote, runners, update } from '../scripts/fairy-to-mini.mjs';
import { QUIT_NOTE } from '../scripts/fairy-keepalive.mjs';

// A stand-in for ssh: drops the options and the host, and runs the command the way the mini's login shell would, with
// HOME set to a folder standing in for the mini's home.
async function standIn() {
  const dir = await mkdtemp(join(tmpdir(), 'fairy-to-mini-')), mini = join(dir, 'mini'), here = join(dir, 'here'), ssh = join(dir, 'ssh');
  await mkdir(mini, { recursive: true });
  // The stand-in mini runs no Fairy, whatever this Mac runs: its pgrep finds nothing.
  await mkdir(join(dir, 'bin'));
  await writeFile(join(dir, 'bin', 'pgrep'), '#!/bin/sh\nexit 1\n');
  await chmod(join(dir, 'bin', 'pgrep'), 0o755);
  // Nor may it quit or open anything on this Mac: pkill and open only leave a note.
  for (const name of ['pkill', 'open']) { await writeFile(join(dir, 'bin', name), `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(join(dir, 'calls.log'))}\n`); await chmod(join(dir, 'bin', name), 0o755); }
  await writeFile(ssh, `#!/bin/sh\nwhile [ "$1" = "-o" ]; do shift 2; done\nshift\nHOME="$FAKE_MINI_HOME" PATH=${JSON.stringify(join(dir, 'bin'))}:"$PATH" exec /bin/sh -c "$1"\n`);
  await chmod(ssh, 0o755);
  process.env.FAKE_MINI_HOME = mini;
  // This Mac: a data folder with sealed files among the rest, and an app new enough to pair with a face.
  const data = join(here, APP_SUPPORT, 'lyra');
  await mkdir(join(data, 'sessions'), { recursive: true });
  await writeFile(join(data, 'sessions', 'chat-1.json'), '{"history":["hi"]}');
  await writeFile(join(data, 'settings.json'), '{"name":"Fairy"}');
  await writeFile(join(data, 'local-folders.json'), JSON.stringify([{ id: 'a', path: join(mini, 'Courses') }, { id: 'b', path: '/nowhere/OnyxVault' }]));
  for (const name of LEFT_OUT) await writeFile(join(data, name), '{"sealed":"secret-value"}');
  await writeFile(join(data, 'phone-link.json'), JSON.stringify({ enabled: true, keepAwake: false, google: true, sealedKey: 'secret-value', cert: 'x', devices: [{ id: 'phone' }] }));
  await writeFile(join(data, 'tachyon.sock'), '');
  await writeFile(join(data, 'settings.json.123.tmp'), 'half');
  const app = join(dir, 'build', 'Baryon.app');
  await mkdir(join(app, 'Contents', 'Resources', 'app', 'desktop'), { recursive: true });
  await writeFile(join(app, 'Contents', 'Info.plist'), '<plist/>');
  await writeFile(join(app, 'Contents', 'Resources', 'app', 'desktop', 'face-main.cjs'), '// new enough');
  await mkdir(join(mini, 'Courses'));
  const local = { ...localState({ home: here, app }), running: false };
  const lines = [], log = line => lines.push(String(line));
  return { dir, mini, here, ssh, data, app, local, lines, log, done: () => rm(dir, { recursive: true, force: true }) };
}
const files = async dir => (await readdir(dir, { recursive: true })).sort();

test('the move copies the app and the data, leaves out what was sealed here, and keeps what was on the mini', async () => {
  const s = await standIn();
  try {
    // Something already on the mini: kept under a new name, never deleted.
    await mkdir(join(s.mini, APP_SUPPORT, 'lyra'), { recursive: true });
    await writeFile(join(s.mini, APP_SUPPORT, 'lyra', 'old.json'), 'old');
    await mkdir(join(s.mini, 'Applications', 'Baryon.app'), { recursive: true });
    const options = parseArgs(['move', '--host', 'mini']);
    const { when } = await move({ options, local: s.local, run: runners({ host: 'mini', ssh: s.ssh, log: s.log }), log: s.log, verify: false, now: new Date('2026-11-15T03:04:05Z') });
    assert.equal(when, '20261115-030405');
    const copied = join(s.mini, APP_SUPPORT, 'lyra');
    const names = await files(copied);
    for (const name of LEFT_OUT.filter(name => name !== 'phone-link.json')) assert.ok(!names.includes(name), name);
    assert.ok(!names.includes('tachyon.sock') && !names.includes('settings.json.123.tmp'));
    assert.deepEqual(JSON.parse(await readFile(join(copied, 'sessions', 'chat-1.json'), 'utf8')), { history: ['hi'] });
    // The phone link starts switched on there, with this Mac's choices and none of its certificate or devices.
    assert.deepEqual(JSON.parse(await readFile(join(copied, 'phone-link.json'), 'utf8')), { enabled: true, keepAwake: false, google: true });
    // grep finds nothing (status 1): nothing sealed reached the mini.
    const search = spawnSync('/usr/bin/grep', ['-rl', 'secret-value', s.mini], { encoding: 'utf8' });
    assert.equal(search.status, 1, search.stdout);
    assert.equal(await readFile(join(s.mini, APP_SUPPORT, `lyra-before-move-${when}`, 'old.json'), 'utf8'), 'old');
    assert.ok((await readdir(join(s.mini, 'Applications'))).includes(`Baryon-before-move-${when}.app`));
    assert.equal(await readFile(join(s.mini, 'Applications', 'Baryon.app', 'Contents', 'Resources', 'app', 'desktop', 'face-main.cjs'), 'utf8'), '// new enough');
    const said = s.lines.join('\n');
    assert.match(said, /Folders Fairy uses that aren’t on the mini: \/nowhere\/OnyxVault\./);
    assert.match(said, /Still yours to do:[\s\S]*Pair your iPhone again/);
  } finally { await s.done(); }
});

test('it won’t move while Fairy runs on either Mac, or an app too old to pair with a face', async () => {
  const s = await standIn();
  try {
    const options = parseArgs(['move']), run = runners({ host: 'mini', ssh: s.ssh, log: s.log });
    await assert.rejects(move({ options, local: { ...s.local, running: true }, run, log: s.log, verify: false }), /running on this Mac/);
    await assert.rejects(move({ options, local: { ...s.local, supportsFace: false }, run, log: s.log, verify: false }), /too old to pair with a face/);
    assert.deepEqual(await readdir(s.mini), ['Courses'], 'nothing reached the mini');
    // And a Fairy running on the mini stops it too.
    await writeFile(join(s.dir, 'bin', 'pgrep'), '#!/bin/sh\nexit 0\n');
    await assert.rejects(move({ options, local: s.local, run, log: s.log, verify: false }), /running on the mini/);
  } finally { await s.done(); }
});

test('a dry run says what it would do and runs nothing', async () => {
  const s = await standIn();
  try {
    const options = parseArgs(['move', '--dry-run']);
    await move({ options, local: s.local, run: runners({ host: 'mini', ssh: '/nonexistent/ssh', dryRun: true, log: s.log }), log: s.log, verify: false });
    const said = s.lines.join('\n');
    assert.match(said, /would run here: \/usr\/bin\/ditto -c -k --sequesterRsrc --keepParent/);
    assert.match(said, /would run here: \/usr\/bin\/tar -czf - -C .* --exclude lyra\/keys\.json/);
    assert.match(said, /would run on mini: Copying your data/);
    assert.deepEqual(await readdir(s.mini), ['Courses']);
  } finally { await s.done(); }
});

test('finish makes this Mac a face: its data is renamed, not deleted, and its role written', async () => {
  const s = await standIn();
  try {
    assert.throws(() => finish({ options: parseArgs(['finish']), local: { ...s.local, supportsFace: false }, log: s.log }), /too old to be a face/);
    const { kept } = finish({ options: parseArgs(['finish']), local: s.local, log: s.log, now: new Date('2026-11-15T03:04:05Z') });
    assert.ok(kept.endsWith('lyra-before-move-20261115-030405'));
    assert.ok((await files(kept)).includes(join('sessions', 'chat-1.json')));
    assert.deepEqual(JSON.parse(await readFile(join(s.here, APP_SUPPORT, 'role.json'), 'utf8')), { role: 'face' });
  } finally { await s.done(); }
});

test('words reach the mini’s shell exactly, and only real hosts and options are taken', () => {
  assert.equal(quote("it's"), "'it'\\''s'");
  assert.equal(execFileSync('/bin/sh', ['-c', `printf %s ${quote("a 'b' \"c\" $HOME `x`")}`], { encoding: 'utf8' }), "a 'b' \"c\" $HOME `x`");
  assert.deepEqual(parseArgs(['check']).host, 'mini');
  assert.throws(() => parseArgs(['move', '--host', 'mini; rm -rf ~']), /host name/);
  assert.throws(() => parseArgs(['wipe']), /check, move, finish or update/);
  assert.throws(() => parseArgs(['move', '--force']), /Not an option/);
  assert.equal(miniPhoneLink(null), '{"enabled":true,"keepAwake":true,"google":true}');
});

test('update replaces only the app on the mini, keeps the old one, and leaves her data alone', async () => {
  const s = await standIn();
  try {
    await mkdir(join(s.mini, APP_SUPPORT, 'lyra'), { recursive: true });
    await writeFile(join(s.mini, APP_SUPPORT, 'lyra', 'chat.json'), 'the mini’s own');
    await mkdir(join(s.mini, 'Applications', 'Baryon.app', 'Contents'), { recursive: true });
    await writeFile(join(s.mini, 'Applications', 'Baryon.app', 'Contents', 'old.txt'), 'old build');
    // Fairy is running there: pgrep finds her until pkill has been called.
    await writeFile(join(s.dir, 'bin', 'pgrep'), `#!/bin/sh\n[ -f ${JSON.stringify(join(s.dir, 'calls.log'))} ] && grep -q pkill ${JSON.stringify(join(s.dir, 'calls.log'))} && exit 1\nexit 0\n`);
    const result = await update({ options: parseArgs(['update']), local: s.local, run: runners({ host: 'mini', ssh: s.ssh, log: s.log }), log: s.log, verify: false, now: new Date('2026-11-15T05:00:00Z') });
    assert.equal(result.wasRunning, true);
    assert.equal(await readFile(join(s.mini, APP_SUPPORT, 'lyra', 'chat.json'), 'utf8'), 'the mini’s own');
    assert.equal(await readFile(join(s.mini, 'Applications', 'Baryon-before-move-20261115-050000.app', 'Contents', 'old.txt'), 'utf8'), 'old build');
    assert.ok((await files(join(s.mini, 'Applications', 'Baryon.app'))).includes(join('Contents', 'Resources', 'app', 'desktop', 'face-main.cjs')));
    const calls = await readFile(join(s.dir, 'calls.log'), 'utf8');
    assert.match(calls, /pkill -TERM -f .*Baryon\\\.app\/Contents\/MacOS\/Baryon/);
    assert.match(calls, /open .*Applications\/Baryon\.app/);
  } finally { await s.done(); }
});

// 18 Nov: the update's quit looked like a crash to the keep-alive, which opened the old app again while the new one was
// still arriving; the swap then pulled its files out from under it ("Cannot find module …/Resources/app/desktop/…").
test('the update tells the keep-alive it quit her, and never swaps the app under a Fairy that opened again', async () => {
  assert.equal(QUIT_NOTE_PATH, QUIT_NOTE, 'the note the keep-alive looks for');
  const s = await standIn();
  try {
    await mkdir(join(s.mini, 'Applications', 'Baryon.app', 'Contents'), { recursive: true });
    await writeFile(join(s.mini, 'Applications', 'Baryon.app', 'Contents', 'old.txt'), 'old build');
    const log = JSON.stringify(join(s.dir, 'calls.log')), count = JSON.stringify(join(s.dir, 'pgrep-after-quit'));
    // pkill notes whether the keep-alive's note was there when she was quit.
    await writeFile(join(s.dir, 'bin', 'pkill'), `#!/bin/sh\n[ -f "$HOME/${QUIT_NOTE}" ] && n=yes || n=no\necho "pkill $* note=$n" >> ${log}\n`);
    // Running until quit; then gone for the quit's own check, and running again by the time of the swap.
    await writeFile(join(s.dir, 'bin', 'pgrep'), `#!/bin/sh\ngrep -q pkill ${log} 2>/dev/null || exit 0\necho x >> ${count}\n[ "$(wc -l < ${count})" -ge 2 ] && exit 0\nexit 1\n`);
    await assert.rejects(update({ options: parseArgs(['update']), local: s.local, run: runners({ host: 'mini', ssh: s.ssh, log: s.log }), log: s.log, verify: false, now: new Date('2026-11-18T00:00:00Z') }),
      /opened again on the mini while the new app arrived/);
    const calls = await readFile(join(s.dir, 'calls.log'), 'utf8');
    assert.match(calls, /pkill -TERM -f .*Baryon\\\.app\/Contents\/MacOS\/Baryon.* note=yes/);
    // The app she's running is left as it was, and nothing was kept under another name.
    assert.equal(await readFile(join(s.mini, 'Applications', 'Baryon.app', 'Contents', 'old.txt'), 'utf8'), 'old build');
    assert.deepEqual((await readdir(join(s.mini, 'Applications'))).filter(name => !name.startsWith('.')), ['Baryon.app']);
  } finally { await s.done(); }
});
