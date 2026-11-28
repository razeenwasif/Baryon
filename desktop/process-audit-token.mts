import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { basename } from 'node:path';

export interface ProcessIdentity {
  pid: number;
  startedAt: string;
  command: string;
}

export interface ProcessIdentityLike {
  pid?: unknown;
  auditToken?: unknown;
  startedAt?: unknown;
  command?: unknown;
}

export interface AuditTokenVerdict {
  owned: boolean;
  reason:
    | 'missing_identity'
    | 'pid_mismatch'
    | 'audit_token_mismatch'
    | 'audit_token'
    | 'start_time_mismatch'
    | 'command_mismatch'
    | 'start_time_and_command';
}

export interface ReclaimOrphanedDaemonOptions {
  readIdentity?: (pid: number) => Promise<ProcessIdentityLike | null>;
  kill?: (pid: number, sig: NodeJS.Signals) => void;
  readFileFn?: (path: string) => Promise<string>;
  rmFn?: (path: string) => Promise<unknown>;
}

export type ReclaimOrphanedDaemonResult =
  | { reclaimed: false; reason: 'no_lock' | 'invalid_lock' }
  | { reclaimed: true; reason: 'already_exited' | 'killed'; pid: number }
  | { reclaimed: false; reason: 'pid_reused'; detail: AuditTokenVerdict['reason']; pid: number };

function safeEquals(a: unknown, b: unknown): boolean {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function defaultExecPs(pid: number): Promise<string> {
  return new Promise(resolve => {
    execFile('ps', ['-p', String(pid), '-o', 'lstart=,comm='], { timeout: 3000, encoding: 'utf8' }, (err, stdout) => {
      if (err) resolve('');
      else resolve(String(stdout || '').trim());
    });
  });
}

/**
 * Reads live PID identity (`pid`, `startedAt`, `command`) from `ps` without spawning a shell.
 */
export async function readProcessIdentity(
  pid: unknown,
  { exec = defaultExecPs }: { exec?: (pid: number) => Promise<string> | string } = {},
): Promise<ProcessIdentity | null> {
  const num = Math.floor(Number(pid));
  if (!Number.isSafeInteger(num) || num <= 0) return null;
  const raw = await Promise.resolve(exec(num)).catch(() => '');
  const line = String(raw || '').trim();
  if (!line) return null;
  // `lstart` has 5 whitespace tokens (e.g. `Tue Nov 24 18:10:00 2026`), followed by `comm`.
  const m = /^(\S+\s+\S+\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.+)$/.exec(line);
  if (!m) return { pid: num, startedAt: line, command: '' };
  return { pid: num, startedAt: m[1].trim(), command: m[2].trim() };
}

/**
 * Verifies PID + audit-token/start-time/executable ownership to guard against OS PID recycling before signalling.
 */
export function verifyAuditTokenOwnership(
  saved: ProcessIdentityLike | null | undefined,
  live: ProcessIdentityLike | null | undefined,
): AuditTokenVerdict {
  if (!saved || !live) return { owned: false, reason: 'missing_identity' };
  const sPid = Math.floor(Number(saved.pid));
  const lPid = Math.floor(Number(live.pid));
  if (!Number.isSafeInteger(sPid) || sPid <= 0 || sPid !== lPid) {
    return { owned: false, reason: 'pid_mismatch' };
  }
  if (saved.auditToken || live.auditToken) {
    if (!safeEquals(saved.auditToken, live.auditToken)) {
      return { owned: false, reason: 'audit_token_mismatch' };
    }
    return { owned: true, reason: 'audit_token' };
  }
  if (!saved.startedAt || !live.startedAt || saved.startedAt !== live.startedAt) {
    return { owned: false, reason: 'start_time_mismatch' };
  }
  if (saved.command && live.command) {
    const a = basename(String(saved.command));
    const b = basename(String(live.command));
    if (a !== b) return { owned: false, reason: 'command_mismatch' };
  }
  return { owned: true, reason: 'start_time_and_command' };
}

/**
 * Safely reclaims an orphaned daemon described by `lockPath` only after verifying audit/start-time ownership.
 */
export async function reclaimOrphanedDaemon(
  lockPath: string,
  {
    readIdentity = readProcessIdentity,
    kill = (pid, sig) => process.kill(pid, sig),
    readFileFn = p => readFile(p, 'utf8'),
    rmFn = p => rm(p, { force: true }),
  }: ReclaimOrphanedDaemonOptions = {},
): Promise<ReclaimOrphanedDaemonResult> {
  let saved: ProcessIdentityLike | null | undefined;
  try {
    saved = JSON.parse(await readFileFn(lockPath)) as ProcessIdentityLike | null | undefined;
  } catch {
    return { reclaimed: false, reason: 'no_lock' };
  }

  const pid = Math.floor(Number(saved?.pid));
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    await rmFn(lockPath).catch(() => {});
    return { reclaimed: false, reason: 'invalid_lock' };
  }

  const live = await readIdentity(pid);
  if (!live) {
    await rmFn(lockPath).catch(() => {});
    return { reclaimed: true, reason: 'already_exited', pid };
  }

  const verdict = verifyAuditTokenOwnership(saved, live);
  if (!verdict.owned) {
    await rmFn(lockPath).catch(() => {});
    return { reclaimed: false, reason: 'pid_reused', detail: verdict.reason, pid };
  }

  try {
    kill(pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException | null | undefined)?.code !== 'ESRCH') throw err;
  }
  await rmFn(lockPath).catch(() => {});
  return { reclaimed: true, reason: 'killed', pid };
}
