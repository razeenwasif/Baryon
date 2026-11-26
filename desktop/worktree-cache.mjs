import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { restatWorktreeIndex } from './git-index-stat.mjs';

function cloneDirCoW(src, dst) {
  return new Promise((done, fail) => {
    const child = spawn('/bin/cp', ['-cRp', src, dst], { stdio: 'ignore' });
    child.on('error', fail);
    child.on('close', code => (code === 0 ? done() : fail(new Error(`cp -cRp exited ${code}`))));
  });
}

/**
 * Wraps `createWorktree` + `copyIgnored` with APFS CoW dependency/checkout awareness and binary index restat,
 * falling back cleanly to `createWorktree` whenever CoW or restat isn't applicable.
 */
export function createWorktreeCache({
  base,
  createWorktree,
  copyIgnored,
  ignoredPaths,
  restatIndex = restatWorktreeIndex,
} = {}) {
  const warmRepos = new Map();

  async function allocate({ folder, title }) {
    const made = await createWorktree({ folder, title, ...(base ? { base } : {}) });
    if (copyIgnored && ignoredPaths) {
      const sameDev = await Promise.all([stat(made.top), stat(made.worktree)]).then(([a, b]) => a.dev === b.dev, () => false);
      if (sameDev) {
        await copyIgnored({ from: made.top, to: made.worktree, ignored: await ignoredPaths(made.top) }).catch(() => {});
      }
    }
    const indexPath = join(made.gitCommon || join(made.top, '.git'), 'worktrees', made.worktree.split('/').pop(), 'index');
    const statOk = await lstat(indexPath).then(() => true, () => false);
    if (statOk) {
      await restatIndex(made.worktree, indexPath, { verify: false }).catch(() => false);
    }
    warmRepos.set(made.top, { at: Date.now(), lastWorktree: made.worktree });
    return made;
  }

  /** Creates a fast CoW sibling worktree from an existing standby clone when available, else allocates fresh. */
  async function prewarmSibling({ fromWorktree, targetDir }) {
    const infoA = await stat(fromWorktree).catch(() => null);
    await mkdir(join(targetDir, '..'), { recursive: true, mode: 0o700 });
    const infoB = await stat(join(targetDir, '..')).catch(() => null);
    if (!infoA || !infoB || infoA.dev !== infoB.dev) return false;
    await cloneDirCoW(fromWorktree, targetDir);
    return true;
  }

  return {
    allocate,
    prewarmSibling,
    warmRepos: () => new Map(warmRepos),
  };
}

/**
 * Safely collects unreferenced, aged worktree directories under `~/.fairy-worktrees`,
 * keeping dot-prefixed internal directories (`.helpers`, `.swarms`, `.cow-cache`),
 * active sessions' worktrees, and recently created directories untouched.
 */
export async function collectOrphanedWorktrees({
  base,
  activeWorktrees = [],
  graceMs = 15 * 60_000,
  removeDir = path => rm(path, { recursive: true, force: true }),
  now = Date.now,
} = {}) {
  const entries = await readdir(base, { withFileTypes: true }).catch(err => (err.code === 'ENOENT' ? [] : Promise.reject(err)));
  const activeSet = new Set();
  for (const w of activeWorktrees) {
    if (!w) continue;
    activeSet.add(resolve(w));
    try { activeSet.add(await realpath(w)); } catch {}
  }

  const nowMs = now();
  const removed = [];
  const kept = [];
  const skipped = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) {
      skipped.push(entry.name);
      continue;
    }
    const full = join(base, entry.name);
    const canon = await realpath(full).catch(() => resolve(full));
    if (activeSet.has(full) || activeSet.has(canon)) {
      kept.push(full);
      continue;
    }
    const info = await stat(full).catch(() => null);
    if (!info || nowMs - info.mtimeMs < graceMs) {
      kept.push(full);
      continue;
    }
    try {
      await removeDir(full);
      removed.push(full);
    } catch {
      skipped.push(full);
    }
  }
  return { removed, kept, skipped };
}

export function repoCacheKey(topLevel) {
  return createHash('sha1').update(String(topLevel || '')).digest('hex').slice(0, 12);
}
