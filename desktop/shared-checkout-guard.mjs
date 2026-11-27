import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

function canon(target) {
  if (!target || typeof target !== 'string') return '';
  try {
    return realpathSync(target);
  } catch {
    return resolve(target);
  }
}

function overlaps(a, b) {
  if (!a || !b) return false;
  const r1 = relative(a, b);
  if (r1 === '' || (!isAbsolute(r1) && r1 !== '..' && !r1.startsWith('..'))) return true;
  const r2 = relative(b, a);
  return r2 === '' || (!isAbsolute(r2) && r2 !== '..' && !r2.startsWith('..'));
}

/** Filters active sessions currently working inside any of `checkoutPaths`. */
export function busySessionsInCheckout({ checkoutPaths = [], sessions = [], running = {}, excludeSessionId = '' } = {}) {
  const normalized = checkoutPaths.map(canon).filter(Boolean);
  if (!normalized.length) return [];
  return sessions.filter(session => {
    if (!session || session.id === excludeSessionId) return false;
    if (!running?.[session.id]) return false;
    const sessionCwd = canon(session.work?.root || session.workPath || session.work?.folder || '');
    if (!sessionCwd) return false;
    return normalized.some(cp => overlaps(cp, sessionCwd));
  });
}

/** Throws before switching refs / popping stashes in a checkout shared with an actively running work session. */
export async function assertCheckoutIdle({
  operation = 'checkout',
  cwd,
  sessions = [],
  running = {},
  resolveRepoRoot = null,
  excludeSessionId = '',
} = {}) {
  if (!cwd) return;
  let root = '';
  if (typeof resolveRepoRoot === 'function') {
    root = await Promise.resolve(resolveRepoRoot(cwd)).catch(() => '');
  }
  const checkoutPaths = [...new Set([cwd, root].filter(Boolean))];
  const busy = busySessionsInCheckout({ checkoutPaths, sessions, running, excludeSessionId });
  if (!busy.length) return;

  const titles = busy.map(s => `'${s.title || s.id}'`);
  const summary = titles.length <= 2
    ? titles.join(' and ')
    : `${titles.slice(0, 2).join(', ')} and ${titles.length - 2} more`;
  throw new Error(
    `${summary} ${titles.length === 1 ? 'is' : 'are'} still working in this checkout. Wait before running ${operation}, or use a worktree for a separate branch.`,
  );
}
