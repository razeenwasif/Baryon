import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

interface LeaseEntry {
  queue: Promise<unknown>;
  users: number;
}

type ReservationKind = 'restore' | 'turn-start';

interface Reservation {
  kind: ReservationKind;
  cwd: string;
}

const leases = new Map<string, LeaseEntry>();

/**
 * Non-reentrant per-cwd async semaphore serializing concurrent Git index/worktree mutations.
 */
export async function withWorkspaceLease<T>(cwd: string, fn: () => Promise<T> | T): Promise<T> {
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

const reservations = new Set<Reservation>();
const waiters: Array<() => void> = [];

function pathsOverlap(a: string, b: string): boolean {
  const r1 = relative(a, b);
  if (r1 === '' || (!isAbsolute(r1) && r1 !== '..' && !r1.startsWith('..'))) return true;
  const r2 = relative(b, a);
  return r2 === '' || (!isAbsolute(r2) && r2 !== '..' && !r2.startsWith('..'));
}

async function canonicalizeNearest(target: string): Promise<string> {
  const abs = resolve(String(target || '.'));
  try {
    return await realpath(abs);
  } catch {
    const parent = dirname(abs);
    if (parent === abs) return abs;
    return join(await canonicalizeNearest(parent), basename(abs));
  }
}

function conflicts(a: Reservation, b: Reservation): boolean {
  return (a.kind === 'restore' || b.kind === 'restore') && pathsOverlap(a.cwd, b.cwd);
}

async function withReservation<T>(kind: ReservationKind, cwd: string, fn: () => Promise<T> | T): Promise<T> {
  const canonical = await canonicalizeNearest(cwd);
  const res: Reservation = { kind, cwd: canonical };
  while ([...reservations].some(held => conflicts(held, res))) {
    await new Promise<void>(resolveWaiter => waiters.push(resolveWaiter));
  }
  reservations.add(res);
  try {
    return await fn();
  } finally {
    reservations.delete(res);
    while (waiters.length) waiters.shift()?.();
  }
}

/** Exclusive over every overlapping path while restoring a workspace checkpoint. */
export const withCheckpointRestoreReservation = <T,>(cwd: string, fn: () => Promise<T> | T): Promise<T> =>
  withReservation('restore', cwd, fn);

/** Waits for overlapping restores while allowing concurrent turn starts on distinct or same paths. */
export const withTurnStartReservation = <T,>(cwd: string, fn: () => Promise<T> | T): Promise<T> =>
  withReservation('turn-start', cwd, fn);
