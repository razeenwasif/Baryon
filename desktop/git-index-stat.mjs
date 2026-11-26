import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const ENTRY_FIXED_BYTES = 62;
const SHA1_BYTES = 20;
const MODE_TYPE_MASK = 0o170000;
const MODE_REGULAR = 0o100000;
const MODE_SYMLINK = 0o120000;
const MODE_GITLINK = 0o160000;
const FLAG_ASSUME_VALID = 0x8000;
const FLAG_EXTENDED = 0x4000;
const FLAG_STAGE = 0x3000;
const FLAG_NAME_LENGTH = 0x0fff;
const EXTENDED_SKIP_WORKTREE = 0x4000;
const UNSAFE_EXTENSIONS = new Set(['link', 'FSMN', 'sdir', 'UNTR']);
const STAT_BATCH = 512;

const decoder = new TextDecoder();

function kindForMode(mode) {
  switch (mode & MODE_TYPE_MASK) {
    case MODE_REGULAR:
      return mode & 0o111 ? 'executable' : 'file';
    case MODE_SYMLINK:
      return 'symlink';
    case MODE_GITLINK:
      return 'directory';
    default:
      return 'other';
  }
}

/**
 * Parses a Git index (v2 or v3) after verifying its SHA-1 checksum and rejecting
 * extensions or flags that bypass working-tree stat checks.
 */
export function parseGitIndex(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12 + SHA1_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (decoder.decode(bytes.subarray(0, 4)) !== 'DIRC') return null;
  const version = view.getUint32(4);
  if (version !== 2 && version !== 3) return null;

  const expected = createHash('sha1').update(bytes.subarray(0, bytes.length - SHA1_BYTES)).digest();
  if (!expected.equals(bytes.subarray(bytes.length - SHA1_BYTES))) return null;

  const count = view.getUint32(8);
  const entries = [];
  let offset = 12;
  for (let i = 0; i < count; i++) {
    if (offset + ENTRY_FIXED_BYTES > bytes.length - SHA1_BYTES) return null;
    const flags = view.getUint16(offset + 60);
    if (flags & (FLAG_ASSUME_VALID | FLAG_STAGE)) return null;
    let nameStart = offset + ENTRY_FIXED_BYTES;
    if (flags & FLAG_EXTENDED) {
      if (version < 3 || (view.getUint16(nameStart) & EXTENDED_SKIP_WORKTREE)) return null;
      nameStart += 2;
    }
    const nameLen = flags & FLAG_NAME_LENGTH;
    const nameEnd = nameLen < FLAG_NAME_LENGTH ? nameStart + nameLen : bytes.indexOf(0, nameStart);
    if (nameEnd < 0 || bytes[nameEnd] !== 0) return null;
    entries.push({ offset, path: decoder.decode(bytes.subarray(nameStart, nameEnd)) });
    offset += (nameEnd - offset + 8) & ~7;
  }

  while (offset < bytes.length - SHA1_BYTES) {
    if (offset + 8 > bytes.length - SHA1_BYTES) return null;
    if (UNSAFE_EXTENSIONS.has(decoder.decode(bytes.subarray(offset, offset + 4)))) return null;
    offset += 8 + view.getUint32(offset + 4);
  }
  return offset === bytes.length - SHA1_BYTES ? { bytes, entries } : null;
}

/**
 * Rewrites stat fields inside an in-memory Git index copy and recomputes its SHA-1 checksum.
 * Returns `null` if file kinds mismatch, case-folding inode duplicates occur, or `verify: true` finds drift.
 */
export function restatGitIndex(parsed, stats, { verify = false } = {}) {
  if (!parsed?.bytes || !Array.isArray(stats) || stats.length !== parsed.entries.length) return null;
  const out = new Uint8Array(parsed.bytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const seenInodes = new Set();

  for (let i = 0; i < parsed.entries.length; i++) {
    const { offset } = parsed.entries[i];
    const stat = stats[i];
    const kind = kindForMode(view.getUint32(offset + 24));
    if (!stat) {
      if (kind !== 'directory') return null;
      continue;
    }
    if (stat.kind !== kind) return null;
    if (kind === 'file' || kind === 'executable' || kind === 'symlink') {
      const devIno = `${stat.dev >>> 0}:${stat.ino >>> 0}`;
      if (seenInodes.has(devIno)) return null;
      seenInodes.add(devIno);
    }

    const cSec = stat.ctimeSeconds >>> 0;
    const cNs = stat.ctimeNanoseconds >>> 0;
    const mSec = stat.mtimeSeconds >>> 0;
    const mNs = stat.mtimeNanoseconds >>> 0;
    const dev = stat.dev >>> 0;
    const ino = stat.ino >>> 0;
    const uid = stat.uid >>> 0;
    const gid = stat.gid >>> 0;
    const size = stat.size >>> 0;

    if (verify) {
      if (
        view.getUint32(offset + 8) !== mSec ||
        view.getUint32(offset + 12) !== mNs ||
        view.getUint32(offset + 36) !== size
      ) {
        return null;
      }
    }

    view.setUint32(offset + 0, cSec);
    view.setUint32(offset + 4, cNs);
    view.setUint32(offset + 8, mSec);
    view.setUint32(offset + 12, mNs);
    view.setUint32(offset + 16, dev);
    view.setUint32(offset + 20, ino);
    view.setUint32(offset + 28, uid);
    view.setUint32(offset + 32, gid);
    view.setUint32(offset + 36, size);
  }

  const digest = createHash('sha1').update(out.subarray(0, out.length - SHA1_BYTES)).digest();
  out.set(digest, out.length - SHA1_BYTES);
  return out;
}

function toIndexEntryStat(info) {
  let kind = 'other';
  if (info.isSymbolicLink()) kind = 'symlink';
  else if (info.isDirectory()) kind = 'directory';
  else if (info.isFile()) kind = (Number(info.mode) & 0o111) ? 'executable' : 'file';

  const ctimeNsTotal = info.ctimeNs;
  const mtimeNsTotal = info.mtimeNs;
  return {
    ctimeSeconds: Number(ctimeNsTotal / 1_000_000_000n) >>> 0,
    ctimeNanoseconds: Number(ctimeNsTotal % 1_000_000_000n) >>> 0,
    mtimeSeconds: Number(mtimeNsTotal / 1_000_000_000n) >>> 0,
    mtimeNanoseconds: Number(mtimeNsTotal % 1_000_000_000n) >>> 0,
    dev: Number(BigInt.asUintN(32, info.dev)) >>> 0,
    ino: Number(BigInt.asUintN(32, info.ino)) >>> 0,
    uid: Number(info.uid) >>> 0,
    gid: Number(info.gid) >>> 0,
    size: Number(BigInt.asUintN(32, info.size)) >>> 0,
    kind,
  };
}

/**
 * Restats `indexPath` directly in binary for `worktreeDir` using parallel `lstat`.
 * Returns `true` when restat succeeded, or `false` so callers can fall back to `git update-index --refresh`.
 */
export async function restatWorktreeIndex(worktreeDir, indexPath, { verify = false } = {}) {
  try {
    const raw = await readFile(indexPath);
    const parsed = parseGitIndex(raw);
    if (!parsed) return false;

    const stats = new Array(parsed.entries.length);
    for (let start = 0; start < parsed.entries.length; start += STAT_BATCH) {
      const slice = parsed.entries.slice(start, start + STAT_BATCH);
      const batch = await Promise.all(
        slice.map(async entry => {
          try {
            const info = await lstat(join(worktreeDir, entry.path), { bigint: true });
            return toIndexEntryStat(info);
          } catch {
            return undefined;
          }
        }),
      );
      for (let j = 0; j < batch.length; j++) stats[start + j] = batch[j];
    }

    const updated = restatGitIndex(parsed, stats, { verify });
    if (!updated) return false;

    const tmpPath = join(dirname(indexPath), `.index.${randomUUID()}.tmp`);
    try {
      await writeFile(tmpPath, updated, { mode: 0o644 });
      await rename(tmpPath, indexPath);
    } finally {
      await rm(tmpPath, { force: true }).catch(() => {});
    }
    return true;
  } catch {
    return false;
  }
}
