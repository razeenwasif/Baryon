import { execFile } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { readFile, rm } from 'node:fs/promises';
import { basename } from 'node:path';

function safeEquals(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function defaultExecPs(pid) {
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
export async function readProcessIdentity(pid, { exec = defaultExecPs } = {}) {
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
export function verifyAuditTokenOwnership(saved, live) {
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
export async function reclaimOrphanedDaemon(lockPath, {
  readIdentity = readProcessIdentity,
  kill = (pid, sig) => process.kill(pid, sig),
  readFileFn = p => readFile(p, 'utf8'),
  rmFn = p => rm(p, { force: true }),
} = {}) {
  let saved;
  try {
    saved = JSON.parse(await readFileFn(lockPath));
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
    if (err?.code !== 'ESRCH') throw err;
  }
  await rmFn(lockPath).catch(() => {});
  return { reclaimed: true, reason: 'killed', pid };
}
