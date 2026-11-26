import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

const leases = new Map();

/**
 * Non-reentrant per-cwd async semaphore serializing concurrent Git index/worktree mutations.
 */
export async function withWorkspaceLease(cwd, fn) {
  const key = resolve(String(cwd || '.'));
  let entry = leases.get(key);
  if (!entry) {
    entry = { queue: Promise.resolve(), users: 0 };
    leases.set(key, entry);
  }
  entry.users += 1;
  const run = entry.queue.then(() => fn(), () => fn());
  entry.queue = run.catch(() => {});
  try {
    return await run;
  } finally {
    entry.users -= 1;
    if (entry.users === 0 && leases.get(key) === entry) leases.delete(key);
  }
}

const reservations = new Set();
const waiters = [];

function pathsOverlap(a, b) {
  const r1 = relative(a, b);
  if (r1 === '' || (!isAbsolute(r1) && r1 !== '..' && !r1.startsWith('..'))) return true;
  const r2 = relative(b, a);
  return r2 === '' || (!isAbsolute(r2) && r2 !== '..' && !r2.startsWith('..'));
}

async function canonicalizeNearest(target) {
  const abs = resolve(String(target || '.'));
  try {
    return await realpath(abs);
  } catch {
    const parent = dirname(abs);
    if (parent === abs) return abs;
    return join(await canonicalizeNearest(parent), basename(abs));
  }
}

function conflicts(a, b) {
  return (a.kind === 'restore' || b.kind === 'restore') && pathsOverlap(a.cwd, b.cwd);
}

async function withReservation(kind, cwd, fn) {
  const canonical = await canonicalizeNearest(cwd);
  const res = { kind, cwd: canonical };
  while ([...reservations].some(held => conflicts(held, res))) {
    await new Promise(resolveWaiter => waiters.push(resolveWaiter));
  }
  reservations.add(res);
  try {
    return await fn();
  } finally {
    reservations.delete(res);
    while (waiters.length) waiters.shift()();
  }
}

/** Exclusive over every overlapping path while restoring a workspace checkpoint. */
export const withCheckpointRestoreReservation = (cwd, fn) => withReservation('restore', cwd, fn);

/** Waits for overlapping restores while allowing concurrent turn starts on distinct or same paths. */
export const withTurnStartReservation = (cwd, fn) => withReservation('turn-start', cwd, fn);
