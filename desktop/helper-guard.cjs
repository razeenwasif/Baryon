// Before Fairy starts one of her own programs, she checks that her team signed it.
//
// Her code is sealed in app.asar, but the programs macOS has to start sit beside it in app.asar.unpacked
// (bundle-path.cjs), outside the archive's hash. macOS only checks that such a program is validly signed by someone,
// so a helper swapped for another program would be started, as her child. This closes that: a program under
// app.asar.unpacked is started only if it satisfies "signed by an Apple-issued certificate of Fairy's team", the team
// the build wrote into the archive's package.json (scripts/package-fairy.mjs).
//
// It works by wrapping child_process's spawn, execFile and their Sync forms once, at the top of the main process and
// of each worker, so no caller has to remember, and a helper added later is covered. A path outside
// app.asar.unpacked passes straight through, untouched and unmeasured. node-pty starts its shell helper in native
// code, so that one is checked by hand with assertTrusted() where terminals are made. Native modules (.node) need
// nothing here: the hardened runtime already refuses a library her team didn't sign.
//
// A check runs /usr/bin/codesign, 30 to 50 ms for a small helper and over half a second for Codex's program, so the
// answer is remembered against the file's identity (device, inode, size, change time; the change time can't be set
// back by a program without root), and the main process checks every program in the background as it starts.
//
// What this doesn't do: the check and the start are two steps, so a program that swaps the file between them, at
// exactly the right moment, still wins. It turns "replace a file" into "win a race", no more. And a build that isn't
// signed with a Developer ID has no team written in, and checks nothing.
const { join, resolve, sep } = require('node:path');

const requirementFor = team => `anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
const TEAM = /^[A-Z0-9]{10}$/;

// The guard itself, with everything it touches passed in so it can be tested without an app.
//   root:   the folder whose programs are checked (…/Resources/app.asar.unpacked), or '' to check nothing
//   verify: path => true when Fairy's team signed it (sync)
//   stat:   path => { dev, ino, size, mtimeNs, ctimeNs }, throwing when it isn't there
function createGuard({ root = '', verify, stat, onRefused = () => {} }) {
  const trusted = new Map(), told = new Set();
  const prefix = root ? resolve(root) + sep : '';
  const covers = path => Boolean(prefix) && typeof path === 'string' && resolve(path).startsWith(prefix);
  const identity = path => { const s = stat(path); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; };

  // True for a path it doesn't cover, and for a covered one that passes; false otherwise.
  function allowed(path) {
    if (!covers(path)) return true;
    const file = resolve(path);
    let id;
    try { id = identity(file); } catch { return refuse(file, 'it isn’t there'); }
    if (trusted.get(file) === id) return true;
    trusted.delete(file);
    if (!verify(file)) return refuse(file, 'it isn’t signed by Fairy’s team');
    // The answer belongs to the file that was checked: if it changed while being checked, it's checked again next time.
    try { if (identity(file) === id) trusted.set(file, id); } catch {}
    return true;
  }
  function refuse(file, why) {
    if (!told.has(file)) { told.add(file); try { onRefused({ path: file, why }); } catch {} }
    return false;
  }
  // Records an answer found elsewhere (the background check), against the identity the file had before it was checked.
  function remember(path, id) { try { if (identity(path) === id) trusted.set(resolve(path), id); } catch {} }
  function assertTrusted(path) {
    if (!allowed(path)) throw refused(path);
  }
  const refused = path => Object.assign(new Error(`Fairy didn’t start ${path}: it isn’t one of her own programs any more. Reinstall Fairy.`), { code: 'EFAIRYHELPER', path });

  // Wraps child_process's functions in place. An async refusal looks like a program that isn't there (the callers
  // already handle that, with an 'error' event or a callback), and a Sync one throws.
  function wrap(childProcess) {
    if (childProcess.spawn.fairyGuarded) return childProcess;
    const { spawn, execFile, spawnSync, execFileSync } = childProcess;
    const missing = path => `${path}.refused-by-fairy`;
    childProcess.spawn = function guardedSpawn(file, ...rest) { return spawn.call(this, allowed(file) ? file : missing(file), ...rest); };
    childProcess.execFile = function guardedExecFile(file, ...rest) { return execFile.call(this, allowed(file) ? file : missing(file), ...rest); };
    childProcess.spawnSync = function guardedSpawnSync(file, ...rest) { if (!allowed(file)) throw refused(file); return spawnSync.call(this, file, ...rest); };
    childProcess.execFileSync = function guardedExecFileSync(file, ...rest) { if (!allowed(file)) throw refused(file); return execFileSync.call(this, file, ...rest); };
    // util.promisify(execFile) resolves to { stdout, stderr } through this symbol; keep it working.
    const custom = require('node:util').promisify.custom;
    if (execFile[custom]) childProcess.execFile[custom] = (file, ...rest) => execFile[custom](allowed(file) ? file : missing(file), ...rest);
    childProcess.spawn.fairyGuarded = true;
    return childProcess;
  }
  return { covers, allowed, assertTrusted, remember, identity, wrap, enforcing: Boolean(prefix) };
}

// What a packaged Fairy checks against: the folder beside her archive, and the team in the archive's package.json.
function packaged() {
  const marker = `${sep}app.asar${sep}`, at = __dirname.indexOf(marker);
  if (at < 0) return { root: '', team: '' };
  let team = '';
  try { team = String(require('../package.json').signedByTeam || ''); } catch {}
  return TEAM.test(team) ? { root: `${__dirname.slice(0, at)}${sep}app.asar.unpacked`, team } : { root: '', team: '' };
}

let installed;
// Puts the guard on this process's child_process, once. Call it before anything else is required, in the main
// process and at the top of each worker. `warm` (main process only) checks every program in the background.
function install({ onRefused, warm = false } = {}) {
  if (installed) return installed;
  const childProcess = require('node:child_process'), fs = require('node:fs');
  const { root, team } = packaged();
  // The real functions, taken before they're wrapped, do the checking.
  const { spawnSync, execFile } = childProcess;
  const requirement = team ? requirementFor(team) : '';
  const verify = path => spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, path], { stdio: 'ignore', timeout: 20000 }).status === 0;
  const stat = path => fs.statSync(path, { bigint: true });
  const guard = createGuard({ root, verify, stat, onRefused });
  if (guard.enforcing) {
    guard.wrap(childProcess);
    // `import { spawn } from 'node:child_process'` is a copy of the export; this refreshes the copies.
    require('node:module').syncBuiltinESMExports();
    if (warm) warmUp({ guard, root, requirement, execFile, fs });
  }
  installed = Object.assign(guard, { team, root });
  return installed;
}

// Checks every program beside the archive, one after another and smallest first, without blocking: by the time
// something is started, its answer is usually already there. A failure here is left for the real check to report.
function warmUp({ guard, root, requirement, execFile, fs }) {
  const programs = [];
  const walk = folder => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && !entry.name.endsWith('.node') && (fs.statSync(path).mode & 0o111)) programs.push({ path, size: fs.statSync(path).size });
    }
  };
  try { walk(root); } catch { return; }
  programs.sort((a, b) => a.size - b.size);
  const next = () => {
    const program = programs.shift();
    if (!program) return;
    let id; try { id = guard.identity(program.path); } catch { return next(); }
    execFile('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, program.path], { timeout: 20000 }, error => {
      if (!error) guard.remember(program.path, id);
      next();
    });
  };
  next();
}

module.exports = { createGuard, install, requirementFor, packaged };
