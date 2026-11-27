import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

export const SHARED_WORKSPACE_RESTORE_MESSAGE =
  'File restore requires an isolated worktree. This workspace may contain changes from another session or a side chat. Rewind the conversation without restoring files instead.';

function canonicalPath(target) {
  if (!target || typeof target !== 'string') return '';
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

export function pathsOverlap(a, b) {
  if (!a || !b) return false;
  const pa = canonicalPath(a);
  const pb = canonicalPath(b);
  const r1 = relative(pa, pb);
  if (r1 === '' || (!isAbsolute(r1) && r1 !== '..' && !r1.startsWith('..'))) return true;
  const r2 = relative(pb, pa);
  return r2 === '' || (!isAbsolute(r2) && r2 !== '..' && !r2.startsWith('..'));
}

/**
 * Checks whether restoring a whole-workspace checkpoint in `cwd` is isolated to `session`
 * without clobbering uncommitted edits made by any other work session in the same checkout.
 */
export function isCheckpointRestoreIsolated({ session, sessions = [], running = {}, cwd }) {
  const targetCwd = canonicalPath(cwd || session?.work?.root || session?.work?.folder || '');
  if (!session || !targetCwd) {
    return { isolated: false, reason: SHARED_WORKSPACE_RESTORE_MESSAGE, sharedWith: [] };
  }

  const workPath = session.workPath || session.work?.folder || '';
  const rootPath = session.work?.root || '';
  const hasDedicatedWorktree = Boolean(
    session.work?.worktree ||
    (session.work?.isolate && rootPath && canonicalPath(rootPath) === targetCwd) ||
    (session.branch && rootPath && canonicalPath(rootPath) === targetCwd),
  );
  const isScratch = Boolean(workPath && /(?:^|\/)Fairy Scratch(?:\/|$)/.test(workPath));

  const sharedWith = [];
  for (const other of sessions) {
    if (!other || other.id === session.id) continue;
    if (other.sideChat === true && !(other.turns > 0) && !running?.[other.id]) continue;
    const otherRoot = other.work?.root || other.workPath || other.work?.folder || (typeof other.work === 'string' ? '' : '');
    if (!otherRoot) continue;
    if (pathsOverlap(targetCwd, otherRoot)) {
      sharedWith.push({ id: other.id, title: other.title || 'Session', active: Boolean(running?.[other.id]) });
    }
  }

  if ((hasDedicatedWorktree || isScratch) && sharedWith.length === 0) {
    return { isolated: true, reason: '', sharedWith: [] };
  }

  return {
    isolated: false,
    reason: SHARED_WORKSPACE_RESTORE_MESSAGE,
    sharedWith,
  };
}
