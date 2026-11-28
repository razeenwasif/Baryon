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
const { join, resolve, sep } = require('node:path') as typeof import('node:path');

interface GuardStatSnapshot {
  dev: number | bigint;
  ino: number | bigint;
  size: number | bigint;
  mtimeNs: number | bigint;
  ctimeNs: number | bigint;
}

interface GuardRefusal {
  path: string;
  why: string;
}

interface CreateGuardOptions {
  root?: string;
  verify: (path: string) => boolean;
  stat: (path: string) => GuardStatSnapshot;
  onRefused?: (refusal: GuardRefusal) => void;
}

interface InstallGuardOptions {
  onRefused?: (refusal: GuardRefusal) => void;
  warm?: boolean;
}

interface GuardedFunction {
  (...args: unknown[]): unknown;
  fairyGuarded?: boolean;
  [key: symbol]: ((...args: unknown[]) => unknown) | undefined;
}

interface ChildProcessModuleLike {
  spawn: GuardedFunction;
  execFile: GuardedFunction;
  spawnSync: GuardedFunction;
  execFileSync: GuardedFunction;
}

interface HelperGuardHandle {
  covers(path: string): boolean;
  allowed(path: string): boolean;
  assertTrusted(path: string): void;
  remember(path: string, id: string): void;
  identity(path: string): string;
  wrap<T extends ChildProcessModuleLike>(childProcess: T): T;
  enforcing: boolean;
}

interface InstalledHelperGuard extends HelperGuardHandle {
  team: string;
  root: string;
}

interface PackagedGuardInfo {
  root: string;
  team: string;
}

const requirementFor = (team: string): string =>
  `anchor apple generic and certificate leaf[subject.OU] = "${team}"`;

const TEAM = /^[A-Z0-9]{10}$/;

// The guard itself, with everything it touches passed in so it can be tested without an app.
//   root:   the folder whose programs are checked (…/Resources/app.asar.unpacked), or '' to check nothing
//   verify: path => true when Fairy's team signed it (sync)
//   stat:   path => { dev, ino, size, mtimeNs, ctimeNs }, throwing when it isn't there
function createGuard({ root = '', verify, stat, onRefused = () => {} }: CreateGuardOptions): HelperGuardHandle {
  const trusted = new Map<string, string>(), told = new Set<string>();
  const prefix = root ? resolve(root) + sep : '';
  const covers = (path: string): boolean => Boolean(prefix) && typeof path === 'string' && resolve(path).startsWith(prefix);
  const identity = (path: string): string => { const s = stat(path); return `${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`; };

  // True for a path it doesn't cover, and for a covered one that passes; false otherwise.
  function allowed(path: string): boolean {
    if (!covers(path)) return true;
    const file = resolve(path);
    let id: string;
    try { id = identity(file); } catch { return refuse(file, 'it isn’t there'); }
    if (trusted.get(file) === id) return true;
    trusted.delete(file);
    if (!verify(file)) return refuse(file, 'it isn’t signed by Fairy’s team');
    // The answer belongs to the file that was checked: if it changed while being checked, it's checked again next time.
    try { if (identity(file) === id) trusted.set(file, id); } catch {}
    return true;
  }
  function refuse(file: string, why: string): false {
    if (!told.has(file)) { told.add(file); try { onRefused({ path: file, why }); } catch {} }
    return false;
  }
  // Records an answer found elsewhere (the background check), against the identity the file had before it was checked.
  function remember(path: string, id: string): void { try { if (identity(path) === id) trusted.set(resolve(path), id); } catch {} }
  function assertTrusted(path: string): void {
    if (!allowed(path)) throw refused(path);
  }
  const refused = (path: string): Error & { code: string; path: string } =>
    Object.assign(new Error(`Fairy didn’t start ${path}: it isn’t one of her own programs any more. Reinstall Fairy.`), { code: 'EFAIRYHELPER', path });

  // Wraps child_process's functions in place. An async refusal looks like a program that isn't there (the callers
  // already handle that, with an 'error' event or a callback), and a Sync one throws.
  function wrap<T extends ChildProcessModuleLike>(childProcess: T): T {
    if (childProcess.spawn.fairyGuarded) return childProcess;
    const { spawn, execFile, spawnSync, execFileSync } = childProcess;
    const missing = (path: string): string => `${path}.refused-by-fairy`;
    const guardedSpawn = Object.assign(
      function guardedSpawn(this: unknown, file: unknown, ...rest: unknown[]) {
        return spawn.call(this, typeof file === 'string' && !allowed(file) ? missing(file) : file, ...rest);
      },
      { fairyGuarded: true },
    ) as GuardedFunction;
    const guardedExecFile = function guardedExecFile(this: unknown, file: unknown, ...rest: unknown[]) {
      return execFile.call(this, typeof file === 'string' && !allowed(file) ? missing(file) : file, ...rest);
    } as GuardedFunction;
    const guardedSpawnSync = function guardedSpawnSync(this: unknown, file: unknown, ...rest: unknown[]) {
      if (typeof file === 'string' && !allowed(file)) throw refused(file);
      return spawnSync.call(this, file, ...rest);
    } as GuardedFunction;
    const guardedExecFileSync = function guardedExecFileSync(this: unknown, file: unknown, ...rest: unknown[]) {
      if (typeof file === 'string' && !allowed(file)) throw refused(file);
      return execFileSync.call(this, file, ...rest);
    } as GuardedFunction;
    // util.promisify(execFile) resolves to { stdout, stderr } through this symbol; keep it working.
    const custom = (require('node:util') as typeof import('node:util')).promisify.custom;
    if (execFile[custom]) {
      const customExec = execFile[custom];
      guardedExecFile[custom] = (file: unknown, ...rest: unknown[]) =>
        customExec(typeof file === 'string' && !allowed(file) ? missing(file) : file, ...rest);
    }
    childProcess.spawn = guardedSpawn;
    childProcess.execFile = guardedExecFile;
    childProcess.spawnSync = guardedSpawnSync;
    childProcess.execFileSync = guardedExecFileSync;
    return childProcess;
  }
  return { covers, allowed, assertTrusted, remember, identity, wrap, enforcing: Boolean(prefix) };
}

// What a packaged Fairy checks against: the folder beside her archive, and the team in the archive's package.json.
function packaged(): PackagedGuardInfo {
  const marker = `${sep}app.asar${sep}`, at = __dirname.indexOf(marker);
  if (at < 0) return { root: '', team: '' };
  let team = '';
  try {
    const pkg = require('../package.json') as { signedByTeam?: unknown };
    team = String(pkg.signedByTeam || '');
  } catch {}
  return TEAM.test(team) ? { root: `${__dirname.slice(0, at)}${sep}app.asar.unpacked`, team } : { root: '', team: '' };
}

let installed: InstalledHelperGuard | undefined;
// Puts the guard on this process's child_process, once. Call it before anything else is required, in the main
// process and at the top of each worker. `warm` (main process only) checks every program in the background.
function install({ onRefused, warm = false }: InstallGuardOptions = {}): InstalledHelperGuard {
  if (installed) return installed;
  const childProcess = require('node:child_process') as typeof import('node:child_process');
  const fs = require('node:fs') as typeof import('node:fs');
  const { root, team } = packaged();
  // The real functions, taken before they're wrapped, do the checking.
  const { spawnSync, execFile } = childProcess;
  const requirement = team ? requirementFor(team) : '';
  const verify = (path: string): boolean =>
    spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, path], { stdio: 'ignore', timeout: 20000 }).status === 0;
  const stat = (path: string): GuardStatSnapshot => fs.statSync(path, { bigint: true }) as unknown as GuardStatSnapshot;
  const guard = createGuard({ root, verify, stat, onRefused });
  if (guard.enforcing) {
    guard.wrap(childProcess as unknown as ChildProcessModuleLike);
    // `import { spawn } from 'node:child_process'` is a copy of the export; this refreshes the copies.
    (require('node:module') as typeof import('node:module')).syncBuiltinESMExports();
    if (warm) warmUp({ guard, root, requirement, execFile, fs });
  }
  installed = Object.assign(guard, { team, root });
  return installed;
}

interface WarmUpOptions {
  guard: HelperGuardHandle;
  root: string;
  requirement: string;
  execFile: typeof import('node:child_process').execFile;
  fs: typeof import('node:fs');
}

// Checks every program beside the archive, one after another and smallest first, without blocking: by the time
// something is started, its answer is usually already there. A failure here is left for the real check to report.
function warmUp({ guard, root, requirement, execFile, fs }: WarmUpOptions): void {
  const programs: Array<{ path: string; size: number }> = [];
  const walk = (folder: string): void => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && !entry.name.endsWith('.node') && (fs.statSync(path).mode & 0o111)) {
        programs.push({ path, size: fs.statSync(path).size });
      }
    }
  };
  try { walk(root); } catch { return; }
  programs.sort((a, b) => a.size - b.size);
  const next = (): void => {
    const program = programs.shift();
    if (!program) return;
    let id: string;
    try { id = guard.identity(program.path); } catch { return next(); }
    execFile('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, program.path], { timeout: 20000 }, error => {
      if (!error) guard.remember(program.path, id);
      next();
    });
  };
  next();
}

module.exports = { createGuard, install, requirementFor, packaged };
