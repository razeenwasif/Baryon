// Two Macs, step 2 (docs/fairy-on-two-macs-plan.md): moves Fairy's home to the Mac mini over SSH, as far as a script can.
//
//   node scripts/fairy-to-mini.mjs check  [--host mini] [--app <Fairy.app>]
//   node scripts/fairy-to-mini.mjs move   [--host mini] [--app <Fairy.app>] [--quit] [--start] [--dry-run]
//   node scripts/fairy-to-mini.mjs finish [--start] [--dry-run]          (on this Mac, once the mini's Fairy works)
//   node scripts/fairy-to-mini.mjs update [--host mini] [--app <Fairy.app>] [--dry-run]   (a new build, later)
//
// check looks at both Macs and changes nothing. move copies the app to ~/Applications on the mini and this Mac's data
// folder into the mini's, leaving out everything sealed with this Mac's Keychain (sign-ins, keys, the phone link's
// certificate), which can't be opened there anyway. It streams through SSH, so no copy of your chats is left lying
// anywhere, and anything already on the mini is renamed, never deleted. finish makes this Mac a face of the mini's
// Fairy: its own data folder is renamed, not deleted, and its role set to face.
// update replaces only the app on the mini, for a new build: her data there isn't touched.
// What no script can do (permissions, sign-ins, pairing) is listed at the end of each run.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Sealed with this Mac's Keychain, or tied to this Mac: left out of the copy (the plan's list, plus sockets and the
// atomic writer's temporary files). phone-link.json is written fresh on the mini, switched on, without a certificate.
export const LEFT_OUT = ['keys.json', 'gmail.json', 'calendar.json', 'drive.json', 'spotify.json', 'push-key.json', 'phone-link.json', 'phone.json', 'window.json'];
const LEFT_OUT_PATTERNS = [...LEFT_OUT.map(name => `lyra/${name}`), '*.sock', '*.tmp'];
export const APP_SUPPORT = join('Library', 'Application Support', 'lyra-companion');
const RUNNING = '(Baryon\\.app/Contents/MacOS/Baryon|Fairy\\.app/Contents/MacOS/Fairy)';

// One word in single quotes for a POSIX shell.
export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
export const stamp = (date = new Date()) => date.toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-');

export function parseArgs(argv) {
  // fallback: where to try when the host's home address doesn't answer (away from home, the mini's Tailscale name).
  const [command, ...rest] = argv, options = { command, host: 'mini', fallback: undefined, app: null, quit: false, start: false, dryRun: false };
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === '--host') options.host = rest[++i];
    else if (word === '--app') options.app = rest[++i];
    else if (word === '--tailscale') options.fallback = rest[++i];
    else if (word === '--quit') options.quit = true;
    else if (word === '--start') options.start = true;
    else if (word === '--dry-run') options.dryRun = true;
    else throw new Error(`Not an option: ${word}`);
  }
  if (!['check', 'move', 'finish', 'update'].includes(command)) throw new Error('Say check, move, finish or update.');
  if (!/^[A-Za-z0-9._@-]+$/.test(options.host ?? '')) throw new Error('That isn’t a host name from your SSH config.');
  if (options.fallback !== undefined && !/^[A-Za-z0-9._@-]+$/.test(options.fallback ?? '')) throw new Error('That isn’t a Tailscale name.');
  return options;
}

// What the mini says about itself, as key=value lines; folders are this Mac's folders Fairy uses, checked there too.
export const REMOTE_CHECK = `set -u
echo "macos=$(sw_vers -productVersion 2>/dev/null)"
echo "arch=$(uname -m)"
echo "free_kb=$(df -k "$HOME" | awk 'NR==2 {print $4}')"
[ -d "$HOME/Applications/Baryon.app" ] || [ -d "$HOME/Applications/Fairy.app" ] && echo "app=yes" || echo "app=no"
[ -d "$HOME/${APP_SUPPORT}/lyra" ] && echo "data=yes" || echo "data=no"
pgrep -f ${quote(RUNNING)} >/dev/null 2>&1 && echo "running=yes" || echo "running=no"
T=""
for c in /Applications/Tailscale.app/Contents/MacOS/Tailscale /opt/homebrew/bin/tailscale /usr/local/bin/tailscale; do [ -x "$c" ] && T="$c" && break; done
if [ -n "$T" ]; then
  S=$("$T" status --json 2>/dev/null)
  echo "tailscale_state=$(printf '%s' "$S" | grep -o '"BackendState": *"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"$/\\1/')"
  echo "tailscale_name=$(printf '%s' "$S" | grep -o '"DNSName": *"[^"]*"' | head -1 | sed 's/.*"\\([^"]*\\)"$/\\1/')"
else echo "tailscale_state=missing"; fi
for c in "$HOME/.local/bin/claude" /opt/homebrew/bin/claude /usr/local/bin/claude "$HOME/.claude/local/claude"; do [ -x "$c" ] && echo "claude=$c" && break; done
for f in "$@"; do [ -d "$f" ] && echo "folder=yes:$f" || echo "folder=no:$f"; done
`;
// Quits Fairy on the mini and waits for her to go, saying whether she was running. It leaves the note a clean quit leaves
// first (scripts/fairy-keepalive.mjs, QUIT_NOTE), so the keep-alive takes this for a quit, not a crash, and stands down
// instead of opening her again while the new app is still arriving (18 Nov: it reopened the old app mid-copy, and the
// swap then pulled its files out from under it). REMOTE_OPEN starts the keep-alive again afterwards.
// Opening Fairy on the mini: through the keep-alive agent when it's there (scripts/fairy-keepalive.mjs), so the Fairy
// that runs is the one it starts again after a crash, and otherwise as the Finder would.
export const REMOTE_OPEN = `if launchctl print "gui/$(id -u)/dev.razeen.fairy.keepalive" >/dev/null 2>&1; then launchctl kickstart "gui/$(id -u)/dev.razeen.fairy.keepalive"; else open "$HOME/Applications/Baryon.app"; fi`;
export const QUIT_NOTE_PATH = `${APP_SUPPORT}/quit-cleanly`;
export const REMOTE_QUIT = `if pgrep -f ${quote(RUNNING)} >/dev/null 2>&1; then echo "was_running=yes"; else echo "was_running=no"; exit 0; fi
mkdir -p "$HOME/${APP_SUPPORT}" && date +%s > "$HOME/${QUIT_NOTE_PATH}"
pkill -TERM -f ${quote(RUNNING)}
i=0; while [ $i -lt 60 ]; do pgrep -f ${quote(RUNNING)} >/dev/null 2>&1 || exit 0; sleep 0.5; i=$((i + 1)); done
echo "Fairy didn't quit on the mini." >&2; exit 1
`;
// Unpacks the new app from stdin (a ditto zip) beside the one that's there, checks it, and only then swaps them: the old
// app is renamed, never deleted. A copy cut short, a signature that doesn't check out or ($3 "hardened") a copy without
// the hardened runtime stops here with the old app untouched; if the swap itself fails, the old app is put back.
export const REMOTE_APP = `set -eu
A="$HOME/Applications"
N="$A/.fairy-new-$1"
stay() { rm -rf "$N"; echo "$1 Fairy on the mini is as she was." >&2; exit 1; }
mkdir -p "$A"
rm -rf "$N"
mkdir "$N"
/usr/bin/ditto -x -k - "$N" || stay "The new app didn't arrive whole."
[ -d "$N/Baryon.app/Contents" ] || stay "The new app didn't arrive whole."
xattr -dr com.apple.quarantine "$N/Baryon.app" 2>/dev/null || true
if [ "$2" = "verify" ]; then
  /usr/bin/codesign --verify --deep --strict "$N/Baryon.app" || stay "The new app's signature didn't check out."
  echo "signature=ok"
  if [ "\${3:-}" = "hardened" ]; then
    /usr/bin/codesign -dvv "$N/Baryon.app" 2>&1 | grep -Eq 'flags=0x[0-9a-f]+\\([^)]*runtime' || stay "The new app arrived without the hardened runtime."
    echo "hardened=yes"
  fi
fi
# Never swap the files under a running app: one that started while the copy arrived would go on running the old code
# with its files gone.
if pgrep -f ${quote(RUNNING)} >/dev/null 2>&1; then stay "Fairy opened again on the mini while the new app arrived."; fi
OLD_KEPT=""
if [ -e "$A/Baryon.app" ]; then mv "$A/Baryon.app" "$A/Baryon-before-move-$1.app"; OLD_KEPT="Baryon-before-move-$1.app"; echo "kept=$OLD_KEPT";
elif [ -e "$A/Fairy.app" ]; then mv "$A/Fairy.app" "$A/Fairy-before-move-$1.app"; OLD_KEPT="Fairy-before-move-$1.app"; echo "kept=$OLD_KEPT"; fi
if ! mv "$N/Baryon.app" "$A/Baryon.app"; then
  if [ "$OLD_KEPT" = "Baryon-before-move-$1.app" ] && [ -e "$A/$OLD_KEPT" ]; then mv "$A/$OLD_KEPT" "$A/Baryon.app";
  elif [ -n "$OLD_KEPT" ] && [ -e "$A/$OLD_KEPT" ]; then mv "$A/$OLD_KEPT" "$A/Fairy.app"; fi
  stay "The new app couldn't be put in place."
fi
rm -rf "$N"
echo "app=installed"
`;
// The build about to be sent, checked here first: its signature, and for a Developer ID (hardened) build that the
// three fuses are locked, as scripts/package-fairy.mjs checks them. The mini then checks the signature of what arrived,
// which covers the fuses too, since they're inside the signed framework. Resolves { hardened }.
export async function checkBuild(appPath, { run = (command, args) => spawnSync(command, args, { encoding: 'utf8' }) } = {}) {
  const checked = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]);
  if (checked.status !== 0) throw new Error(`This build’s signature doesn’t check out, so it wasn’t sent: ${String(checked.stderr || '').trim().split('\n').pop()}`);
  const hardened = /flags=0x[0-9a-f]+\([^)]*runtime[^)]*\)/.test(String(run('/usr/bin/codesign', ['-dvv', appPath]).stderr || ''));
  if (hardened) { const { assertFuses } = await import('./fuses.mjs'); await assertFuses(appPath); }
  return { hardened };
}
// Renames any data folder already there, unpacks this Mac's from stdin (a tar), and writes the phone link's settings.
export const REMOTE_DATA = `set -eu
P="$HOME/${APP_SUPPORT}"
mkdir -p "$P"
if [ -e "$P/lyra" ]; then mv "$P/lyra" "$P/lyra-before-move-$1"; echo "kept=lyra-before-move-$1"; fi
/usr/bin/tar -xzf - -C "$P"
chmod 700 "$P/lyra"
printf '%s\\n' "$2" > "$P/lyra/phone-link.json"
chmod 600 "$P/lyra/phone-link.json"
echo "data_kb=$(du -sk "$P/lyra" | cut -f1)"
`;

export const parseLines = text => Object.fromEntries(String(text).split('\n').filter(line => line.includes('=') && !line.startsWith('folder=')).map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
export const parseFolders = text => String(text).split('\n').filter(line => line.startsWith('folder=')).map(line => ({ present: line.startsWith('folder=yes:'), path: line.replace(/^folder=(yes|no):/, '') }));

// The phone link's settings for the mini: switched on, as this Mac had its other choices, with no certificate or devices
// (the mini makes its own, and the iPhone pairs with it again).
export function miniPhoneLink(saved) {
  return JSON.stringify({ enabled: true, keepAwake: saved?.keepAwake !== false, google: saved?.google !== false });
}

// Runs a command, or under --dry-run says what it would run. remote() runs a script on the mini through SSH, with
// stdin from `input` (a stream), and resolves to its output.
// fallback: another name for the same Mac (its Tailscale name), tried once when the host can't be reached at all; it is
// then used for the rest of the run. Only a step with no input is retried, as an input stream can't be sent twice.
export function runners({ host, fallback = null, dryRun = false, log = console.log, ssh = 'ssh' }) {
  const shell = (script, args) => ['/bin/sh', '-c', quote(script), 'sh', ...args.map(quote)].join(' ');
  let target = host;
  const once = (script, args, input, label) => new Promise((done, fail) => {
    const child = spawn(ssh, ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', target, shell(script, args)], { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', part => { out += part; }); child.stderr.on('data', part => { err += part; });
    if (input) { input.pipe(child.stdin); input.on('error', fail); }
    child.on('error', fail);
    child.on('close', code => code === 0 ? done(out) : fail(Object.assign(new Error(`${label || 'The step'} failed on ${target}: ${(err || out).trim().split('\n').slice(-3).join(' ')}`),
      { unreachable: code === 255 && /timed out|Could not resolve|No route|Connection refused|Network is unreachable|Host is down/i.test(err) })));
  });
  return {
    remote(script, args = [], { input = null, label = '' } = {}) {
      if (dryRun) { log(`  would run on ${target}: ${label || script.split('\n').find(line => line && !line.startsWith('set ')) || 'a script'}`); return Promise.resolve(''); }
      return once(script, args, input, label).catch(error => {
        if (!error.unreachable || !fallback || target === fallback || input) throw error;
        log(`  ${host} didn’t answer; trying ${fallback} over Tailscale.`);
        target = fallback;
        return once(script, args, input, label);
      });
    },
    // A local command's output as a stream (tar, ditto), for remote()'s input.
    stream(command, args) {
      if (dryRun) { log(`  would run here: ${[command, ...args].join(' ')}`); return null; }
      const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let err = ''; child.stderr.on('data', part => { err += part; });
      child.on('close', code => { if (code !== 0) child.stdout.emit('error', new Error(`${command} failed here: ${err.trim()}`)); });
      return child.stdout;
    },
  };
}

// This Mac's side of things.
export function localState({ home = homedir(), app } = {}) {
  const data = join(home, APP_SUPPORT, 'lyra');
  const running = spawnSync('pgrep', ['-f', RUNNING]).status === 0;
  const appPath = resolve(app ?? defaultApp());
  const appThere = existsSync(join(appPath, 'Contents', 'Info.plist'));
  const signature = appThere ? (spawnSync('/usr/bin/codesign', ['-dvv', appPath], { encoding: 'utf8' }).stderr || '') : '';
  const authority = /Authority=(.*)/.exec(signature)?.[1] ?? '';
  const supportsFace = appThere && (existsSync(join(appPath, 'Contents', 'Resources', 'app.asar')) || existsSync(join(appPath, 'Contents', 'Resources', 'app', 'desktop', 'face-main.cjs')));
  let folders = [];
  try { folders = JSON.parse(readFileSync(join(data, 'local-folders.json'), 'utf8')).map(item => item.path).filter(path => typeof path === 'string'); } catch { folders = []; }
  let phoneLink = null;
  try { phoneLink = JSON.parse(readFileSync(join(data, 'phone-link.json'), 'utf8')); } catch { phoneLink = null; }
  return { home, data, dataThere: existsSync(data), running, appPath, appThere, authority, supportsFace, folders, phoneLink };
}
// The newest packaged build in this repo, else the installed one.
function defaultApp() {
  const built = join(dirname(new URL(import.meta.url).pathname), '..', 'release', 'Baryon-darwin-arm64', 'Baryon.app');
  return existsSync(built) ? built : join(homedir(), 'Applications', 'Baryon.app');
}

const STILL_YOURS = [
  'On the mini, open Fairy once and allow what macOS asks: Screen & System Audio Recording, Accessibility and Microphone (System Settings, Privacy & Security). Each needs a click on the mini itself; Screen Sharing works.',
  'Sign in again on the mini: Claude Code (run `claude` there once), Codex if you use it, and in Fairy’s Settings, Google and Spotify.',
  'Enter your API keys again in Fairy’s Settings on the mini (DeepSeek, Fish, Gemini), and choose your APNs key file again under Phone, Notifications.',
  'Pair your iPhone again: Fairy’s Settings on the mini, Phone, Pair an iPhone.',
  'Keep the mini awake: System Settings, Energy, “Prevent automatic sleeping when the display is off”.',
  'When the mini’s Fairy works, run `node scripts/fairy-to-mini.mjs finish` here to make this Mac a face, then pair it from the mini with Pair a Mac.',
];

export async function check({ options, local = localState({ app: options.app }), run = runners(options), log = console.log }) {
  log(`This Mac: data ${local.dataThere ? 'found' : 'MISSING'} at ${local.data}; Fairy ${local.running ? 'is running' : 'is not running'}.`);
  log(`App to copy: ${local.appPath} — ${local.appThere ? `signed by ${local.authority || 'no one'}${local.supportsFace ? ', can pair with a face' : ', TOO OLD to pair with a face (build it from main first)'}` : 'NOT FOUND (build it with npm run package:fairy)'}.`);
  const out = await run.remote(REMOTE_CHECK, local.folders, { label: 'Looking at the mini' });
  if (options.dryRun) return { ok: true };
  const mini = parseLines(out), folders = parseFolders(out);
  log(`The mini (${options.host}): macOS ${mini.macos || '?'} on ${mini.arch || '?'}, ${Math.round(Number(mini.free_kb || 0) / 1048576)} GB free.`);
  log(`  Fairy there: ${mini.app === 'yes' ? 'installed' : 'not installed'}${mini.running === 'yes' ? ', RUNNING' : ''}; data folder ${mini.data === 'yes' ? 'exists (it will be renamed, not deleted)' : 'none'}.`);
  log(`  Tailscale: ${mini.tailscale_state === 'Running' ? `running as ${String(mini.tailscale_name || '').replace(/\.$/, '')}` : mini.tailscale_state === 'missing' ? 'NOT INSTALLED (the iPhone and the face reach Fairy through it)' : `not running (${mini.tailscale_state || 'unknown'})`}.`);
  log(`  Claude Code: ${mini.claude ? `found at ${mini.claude}` : 'NOT FOUND (install it there and sign in, if Fairy uses Claude)'}.`);
  const missing = folders.filter(folder => !folder.present);
  if (missing.length) log(`  Folders Fairy uses that aren’t on the mini: ${missing.map(folder => folder.path).join(', ')}.`);
  const problems = [];
  if (!local.dataThere) problems.push('this Mac has no Fairy data folder');
  if (!local.appThere) problems.push('the app to copy isn’t there');
  if (local.appThere && !local.supportsFace) problems.push('the app is too old to pair with a face');
  if (mini.arch && mini.arch !== 'arm64') problems.push(`the mini is ${mini.arch}, and this build is for Apple silicon`);
  if (Number(mini.free_kb || 0) < 2 * 1048576) problems.push('the mini has less than 2 GB free');
  return { ok: problems.length === 0, problems, mini, folders };
}

export async function move({ options, local = localState({ app: options.app }), run = runners(options), log = console.log, verify = true, now = new Date() }) {
  const checked = await check({ options, local, run, log });
  if (!options.dryRun && !checked.ok) throw new Error(`Not moving: ${checked.problems.join('; ')}.`);
  if (!options.dryRun && checked.mini.running === 'yes') {
    if (!options.quit) throw new Error('Fairy is running on the mini. Quit it there, or run again with --quit.');
    await run.remote(REMOTE_QUIT, [], { label: 'Quitting Fairy on the mini' });
  }
  // Her data must be still while it's copied.
  if (local.running) {
    if (!options.quit) throw new Error('Fairy is running on this Mac. Quit it, or run again with --quit.');
    if (options.dryRun) log('  would quit Fairy here');
    else {
      spawnSync('pkill', ['-TERM', '-f', RUNNING]);
      for (let i = 0; i < 20 && spawnSync('pgrep', ['-f', RUNNING]).status === 0; i++) spawnSync('/bin/sleep', ['0.5']);
      if (spawnSync('pgrep', ['-f', RUNNING]).status === 0) throw new Error('Fairy didn’t quit on this Mac.');
    }
  }
  const when = stamp(now);
  const build = verify && !options.dryRun ? await checkBuild(local.appPath) : { hardened: false };
  log('Copying the app…');
  const app = run.stream('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', local.appPath, '-']);
  log((await run.remote(REMOTE_APP, [when, verify ? 'verify' : 'skip', build.hardened ? 'hardened' : 'any'], { input: app, label: 'Copying the app' })).trim());
  log(`Copying your data (leaving out ${LEFT_OUT.join(', ')})…`);
  const tarArgs = ['-czf', '-', '-C', join(local.home, APP_SUPPORT), ...LEFT_OUT_PATTERNS.flatMap(pattern => ['--exclude', pattern]), 'lyra'];
  const data = run.stream('/usr/bin/tar', tarArgs);
  log((await run.remote(REMOTE_DATA, [when, miniPhoneLink(local.phoneLink)], { input: data, label: 'Copying your data' })).trim());
  if (options.start) { await run.remote('open "$HOME/Applications/Baryon.app"', [], { label: 'Opening Baryon on the mini' }); log('Opened Baryon on the mini.'); }
  log('\nDone. Still yours to do:');
  STILL_YOURS.forEach((item, i) => log(`${i + 1}. ${item}`));
  return { when };
}

// A new build for the mini: Fairy there is quit, the old app kept under a new name, the new one copied and checked, and
// she's opened again if she was running. Her data isn't touched.
export async function update({ options, local = localState({ app: options.app }), run = runners(options), log = console.log, verify = true, now = new Date() }) {
  if (!local.appThere) throw new Error(`No app at ${local.appPath}. Build it with npm run package:fairy.`);
  if (!local.supportsFace) throw new Error('That app is too old to pair with a face.');
  log(`App to copy: ${local.appPath} (signed by ${local.authority || 'no one'}).`);
  // Before Fairy on the mini is quit: a build that doesn't check out here never gets that far.
  const build = verify && !options.dryRun ? await checkBuild(local.appPath) : { hardened: false };
  const quit = parseLines(await run.remote(REMOTE_QUIT, [], { label: 'Quitting Fairy on the mini' }));
  const when = stamp(now);
  log('Copying the app…');
  const app = run.stream('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', local.appPath, '-']);
  const reopen = async words => { if (quit.was_running === 'yes' || options.start) { await run.remote(REMOTE_OPEN, [], { label: 'Opening Fairy on the mini' }); log(words); } };
  // A failed copy or check leaves the app that was there: she's opened again as she was, and the update says it failed.
  try { log((await run.remote(REMOTE_APP, [when, verify ? 'verify' : 'skip', build.hardened ? 'hardened' : 'any'], { input: app, label: 'Copying the app' })).trim()); }
  catch (error) { await reopen('Opened the Fairy that was already on the mini.').catch(() => {}); throw error; }
  await reopen('Opened Fairy on the mini again.');
  return { when, wasRunning: quit.was_running === 'yes' };
}

// This Mac becomes a face of the mini's Fairy: its data folder is renamed (not deleted) and its role written.
export function finish({ options, local = localState({ app: join(homedir(), 'Applications', 'Baryon.app') }), log = console.log, now = new Date() }) {
  if (!local.supportsFace) throw new Error('The Fairy installed on this Mac is too old to be a face. Install a build from main first (npm run install:fairy).');
  if (local.running && !options.quit && !options.dryRun) throw new Error('Fairy is running on this Mac. Quit it, or run again with --quit.');
  const userData = join(local.home, APP_SUPPORT), kept = join(userData, `lyra-before-move-${stamp(now)}`);
  if (options.dryRun) { if (local.running) log(`  would quit Fairy here${options.quit ? '' : ' (needs --quit)'}`); log(`  would rename ${local.data} to ${kept}`); log(`  would write ${join(userData, 'role.json')}: face`); return { kept }; }
  if (local.running) { spawnSync('pkill', ['-TERM', '-f', RUNNING]); for (let i = 0; i < 20 && spawnSync('pgrep', ['-f', RUNNING]).status === 0; i++) spawnSync('/bin/sleep', ['0.5']); }
  if (local.dataThere) renameSync(local.data, kept);
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'role.json'), `${JSON.stringify({ role: 'face' })}\n`);
  log(`This Mac is now a face. Its old data is kept at ${kept}.`);
  log('Open Baryon here, then on the mini choose Settings, Phone, Pair a Mac, and paste the link into this Mac’s Baryon.');
  if (options.start) spawnSync('open', [join(local.home, 'Applications', 'Baryon.app')]);
  return { kept };
}

// The mini's Tailscale name, for when its home address doesn't answer: from this Mac's face pairing, with the user name
// the SSH config gives the host.
export function tailscaleFallback(host, { home = homedir(), sshConfig = () => spawnSync('ssh', ['-G', host], { encoding: 'utf8' }).stdout || '' } = {}) {
  let name = '';
  try { name = JSON.parse(readFileSync(join(home, APP_SUPPORT, 'face', 'face.json'), 'utf8')).pairing?.host || ''; } catch { name = ''; }
  if (!/^[A-Za-z0-9.-]+$/.test(name) || name === host) return null;
  const user = /^user (\S+)$/m.exec(sshConfig())?.[1];
  return user && /^[A-Za-z0-9._-]+$/.test(user) ? `${user}@${name}` : name;
}

async function main(argv) {
  const options = parseArgs(argv);
  if (options.fallback === undefined) options.fallback = tailscaleFallback(options.host);
  if (options.command === 'check') {
    const { ok, problems = [] } = await check({ options });
    console.log(ok ? '\nReady to move.' : `\nNot ready: ${problems.join('; ')}.`);
  }
  if (options.command === 'move') await move({ options });
  if (options.command === 'finish') finish({ options });
  if (options.command === 'update') await update({ options });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exit(1); });
}
