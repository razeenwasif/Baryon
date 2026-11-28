import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { commandPath } from './work-sandbox.mjs';

export interface GitExecOptions {
  env?: Record<string, string | undefined>;
  input?: string;
  ok?: number[];
  timeout?: number;
  maxBuffer?: number;
}

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type ExecGitFn = (cwd: string, args: string[], options?: GitExecOptions) => Promise<GitExecResult>;

export interface UntrackedFileStat {
  path: string;
  stat: string;
  size: bigint;
  mode: '100755' | '100644';
  changedNs: bigint;
  regular: boolean;
}

export interface CachedBlobEntry {
  path: string;
  mode: string;
  oid: string;
  size: bigint;
  stat: string;
  attributes: string;
}

interface WorkspaceBlobSnapshot {
  head: string;
  configHash: string;
  blobs: Map<string, CachedBlobEntry>;
}

export interface UntrackedBlobCacheOptions {
  maxBlobs?: number;
  maxWorkspaces?: number;
  minTotalBytes?: number;
  settledMs?: number;
  nowMs?: () => number;
}

export interface BlobCachePrepareParams {
  cwd: string;
  head: string;
  configHash: string;
  untrackedPaths: string[];
  execGit: ExecGitFn;
  env?: Record<string, string | undefined>;
  forceCache?: boolean;
}

export interface BlobCachePrepareResult {
  reused: CachedBlobEntry[];
  toStage: string[];
  stats: Array<UntrackedFileStat | null>;
}

export interface TreeOidEntry {
  mode?: string;
  oid?: string;
}

export interface BlobCacheRememberParams {
  cwd: string;
  head: string;
  configHash: string;
  untrackedPaths: string[];
  stats: Array<UntrackedFileStat | null>;
  treeOids: Map<string, TreeOidEntry>;
  execGit: ExecGitFn;
  env?: Record<string, string | undefined>;
}

export interface UntrackedBlobCache {
  snapshotCount(): number;
  prepare(params: BlobCachePrepareParams): Promise<BlobCachePrepareResult>;
  remember(params: BlobCacheRememberParams): Promise<void>;
  clear(cwd?: string): void;
}

export interface GitCheckpointStoreOptions {
  execGit?: ExecGitFn;
  blobCache?: UntrackedBlobCache;
}

export interface CaptureCheckpointParams {
  cwd: string;
  sessionId: string;
  turnId: string;
  previousRef?: string;
  excludePaths?: string[];
  forceCache?: boolean;
}

export interface CapturedCheckpoint {
  ref: string;
  commit: string;
  tree: string;
  fastPath: boolean;
  reusedBlobs: number;
}

export interface ListCheckpointsParams {
  cwd: string;
  sessionId: string;
}

export interface CheckpointEntry {
  ref: string;
  commit: string;
  createdAt: string;
  turnId: string;
}

export interface DiffCheckpointsParams {
  cwd: string;
  fromRef: string;
  toRef: string;
  filePaths?: string[];
  ignoreWhitespace?: boolean;
  format?: 'patch' | 'numstat' | string;
  maxOutputBytes?: number;
}

export interface RestoreCheckpointParams {
  cwd: string;
  ref: string;
  excludePaths?: string[];
}

export type RestoreCheckpointResult =
  | { restored: false; reason: 'not_git' | 'missing_ref' }
  | { restored: true; filesCount: number; removedCount: number; ref: string };

export interface ForkFromCheckpointParams {
  cwd: string;
  ref: string;
  newBranch: string;
}

export interface ForkCheckpointResult {
  branch: string;
  ref: string;
}

export interface DeleteCheckpointRefsParams {
  cwd: string;
  refs?: string[];
}

export interface GitCheckpointStore {
  blobCache: UntrackedBlobCache;
  refFor: (sessionId: string, turnId: string) => string;
  isGitRepository: (cwd: string) => Promise<boolean>;
  resolveCleanHead: (cwd: string) => Promise<string | null>;
  captureCheckpoint: (params: CaptureCheckpointParams) => Promise<CapturedCheckpoint | null>;
  listCheckpoints: (params: ListCheckpointsParams) => Promise<CheckpointEntry[]>;
  diffCheckpoints: (params?: DiffCheckpointsParams) => Promise<string>;
  restoreCheckpoint: (params: RestoreCheckpointParams) => Promise<RestoreCheckpointResult>;
  forkFromCheckpoint: (params: ForkFromCheckpointParams) => Promise<ForkCheckpointResult>;
  deleteCheckpointRefs: (params: DeleteCheckpointRefsParams) => Promise<number>;
}

const SAFE_GIT = [
  '-c', 'core.fsmonitor=false',
  '-c', 'core.quotepath=false',
  '-c', 'diff.external=',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'color.ui=false',
];
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const CONVERSION_ATTRIBUTES = ['text', 'eol', 'crlf', 'ident', 'working-tree-encoding', 'filter'];
const STAT_BATCH = 512;
const SKIP_CLEAN_DIRS = new Set(['.git', 'node_modules']);
const SECRET_PATTERN = /(?:^|\/)(?:\.env(?:\.(?!example$|sample$|template$)[^/]*)?|\.ssh|\.aws|\.gnupg|\.netrc|\.npmrc|\.pypirc|id_(?:rsa|ed25519|ecdsa|dsa)|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml)|[^/]*\.(?:pem|key|p12|pfx|keystore))(?:\/|$)/i;

const safeSegment = (value: unknown, fallback = 'item'): string =>
  String(value ?? '').replace(/[^A-Za-z0-9._-]/g, '_').replace(/\.{2,}/g, '_').slice(0, 80) || fallback;

function defaultExecGit(
  cwd: string,
  args: string[],
  { env = {}, input = undefined, ok = [0], timeout = 60000, maxBuffer = 16 * 1024 * 1024 }: GitExecOptions = {},
): Promise<GitExecResult> {
  return new Promise((done, reject) => {
    const child = execFile(
      'git',
      [...SAFE_GIT, ...args],
      {
        cwd,
        timeout,
        maxBuffer,
        encoding: 'utf8',
        env: {
          PATH: commandPath(),
          HOME: homedir(),
          LANG: process.env.LANG || 'en_US.UTF-8',
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          GIT_PAGER: 'cat',
          ...env,
        },
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : -1) : 0;
        if (ok.includes(code)) done({ code, stdout: stdout || '', stderr: stderr || '' });
        else reject(Object.assign(new Error(String(stderr || error?.message || 'Git failed').trim().slice(0, 500)), { code }));
      },
    );
    if (input !== undefined && child.stdin) {
      child.stdin.end(input);
    }
  });
}

async function lstatAll(root: string, relPaths: string[]): Promise<Array<UntrackedFileStat | null>> {
  const results: Array<UntrackedFileStat | null> = [];
  for (let i = 0; i < relPaths.length; i += STAT_BATCH) {
    const batch = relPaths.slice(i, i + STAT_BATCH);
    const items = await Promise.all(
      batch.map(async (rel): Promise<UntrackedFileStat | null> => {
        try {
          const info = await lstat(join(root, rel), { bigint: true });
          const changedNs = info.mtimeNs > info.ctimeNs ? info.mtimeNs : info.ctimeNs;
          return {
            path: rel,
            stat: `${info.dev}:${info.ino}:${info.mode}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`,
            size: info.size,
            mode: (Number(info.mode) & 0o111) ? '100755' : '100644',
            changedNs,
            regular: info.isFile(),
          };
        } catch {
          return null;
        }
      }),
    );
    results.push(...items);
  }
  return results;
}

export function createUntrackedBlobCache({
  maxBlobs = 20_000,
  maxWorkspaces = 64,
  minTotalBytes = 16 * 1024 * 1024,
  settledMs = 3_000,
  nowMs = Date.now,
}: UntrackedBlobCacheOptions = {}): UntrackedBlobCache {
  const snapshots = new Map<string, WorkspaceBlobSnapshot>();

  async function readAttributes(
    cwd: string,
    paths: string[],
    execGit: ExecGitFn,
    env: Record<string, string | undefined>,
  ): Promise<string[]> {
    if (!paths.length) return [];
    const stdin = `${paths.join('\0')}\0`;
    try {
      const { stdout } = await execGit(cwd, ['check-attr', '-z', '--stdin', ...CONVERSION_ATTRIBUTES], { env, input: stdin });
      const fields = stdout.split('\0');
      return paths.map((_, idx) => {
        const vals: string[] = [];
        for (let a = 0; a < CONVERSION_ATTRIBUTES.length; a++) {
          vals.push(fields[(idx * CONVERSION_ATTRIBUTES.length + a) * 3 + 2] ?? 'unspecified');
        }
        return vals.join('\u0001');
      });
    } catch {
      return paths.map(() => '');
    }
  }

  return {
    snapshotCount() {
      return snapshots.size;
    },
    async prepare({ cwd, head, configHash, untrackedPaths, execGit, env = {}, forceCache = false }) {
      const prev = snapshots.get(cwd);
      const stats = await lstatAll(cwd, untrackedPaths);
      let totalBytes = 0n;
      for (const s of stats) if (s?.regular) totalBytes += s.size;
      const eligibleSize = forceCache || totalBytes >= BigInt(minTotalBytes) || (prev && prev.blobs.size > 0);
      if (!prev || prev.head !== head || prev.configHash !== configHash || !eligibleSize || stats.length > maxBlobs) {
        return { reused: [], toStage: untrackedPaths, stats };
      }
      const attrs = await readAttributes(cwd, untrackedPaths, execGit, env);
      const nowNs = BigInt(nowMs()) * 1_000_000n;
      const settledNs = BigInt(settledMs) * 1_000_000n;
      const reused: CachedBlobEntry[] = [];
      const toStage: string[] = [];
      for (let i = 0; i < untrackedPaths.length; i++) {
        const path = untrackedPaths[i];
        const info = stats[i];
        const cached = prev.blobs.get(path);
        const attrKey = attrs[i] ?? '';
        const settled = info && (nowNs - info.changedNs >= settledNs || info.size === 0n);
        if (
          info?.regular &&
          cached &&
          cached.stat === info.stat &&
          cached.mode === info.mode &&
          cached.attributes === attrKey &&
          settled
        ) {
          reused.push({ path, mode: cached.mode, oid: cached.oid, size: info.size, stat: info.stat, attributes: attrKey });
        } else {
          toStage.push(path);
        }
      }
      return { reused, toStage, stats };
    },
    async remember({ cwd, head, configHash, untrackedPaths, stats, treeOids, execGit, env = {} }) {
      if (!untrackedPaths.length || untrackedPaths.length > maxBlobs) {
        snapshots.delete(cwd);
        return;
      }
      const attrs = await readAttributes(cwd, untrackedPaths, execGit, env);
      const blobs = new Map<string, CachedBlobEntry>();
      for (let i = 0; i < untrackedPaths.length; i++) {
        const path = untrackedPaths[i];
        const info = stats[i];
        const entry = treeOids.get(path);
        if (!info?.regular || !entry?.oid) continue;
        blobs.set(path, {
          path,
          mode: entry.mode || info.mode,
          oid: entry.oid,
          size: info.size,
          stat: info.stat,
          attributes: attrs[i] ?? '',
        });
      }
      if (snapshots.has(cwd)) snapshots.delete(cwd);
      snapshots.set(cwd, { head, configHash, blobs });
      while (snapshots.size > maxWorkspaces) {
        const oldest = snapshots.keys().next().value;
        if (oldest !== undefined) snapshots.delete(oldest);
        else break;
      }
    },
    clear(cwd) {
      if (cwd) snapshots.delete(cwd);
      else snapshots.clear();
    },
  };
}

async function listSubtreeFiles(root: string, relDir: string, out: string[] = []): Promise<string[]> {
  const entries = await readdir(join(root, relDir), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (SKIP_CLEAN_DIRS.has(entry.name)) continue;
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (SECRET_PATTERN.test(rel)) continue;
    if (entry.isDirectory()) await listSubtreeFiles(root, rel, out);
    else if (entry.isFile() || entry.isSymbolicLink()) out.push(rel);
  }
  return out;
}

export function createGitCheckpointStore({
  execGit = defaultExecGit,
  blobCache = createUntrackedBlobCache(),
}: GitCheckpointStoreOptions = {}): GitCheckpointStore {
  const refFor = (sessionId: string, turnId: string): string =>
    `refs/fairy/checkpoints/${safeSegment(sessionId, 'session')}/${safeSegment(turnId, 'turn')}`;

  async function isGitRepository(cwd: string): Promise<boolean> {
    try {
      const { stdout } = await execGit(cwd, ['rev-parse', '--is-inside-work-tree']);
      return stdout.trim() === 'true';
    } catch {
      return false;
    }
  }

  async function resolveHead(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execGit(cwd, ['rev-parse', '--verify', 'HEAD']);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  async function resolveCleanHead(cwd: string): Promise<string | null> {
    const head = await resolveHead(cwd);
    if (!head) return null;
    const { stdout } = await execGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    return stdout === '' ? head : null;
  }

  async function conversionConfigHash(cwd: string): Promise<string> {
    const { stdout } = await execGit(cwd, ['config', '--list', '-z'], { ok: [0, 1] }).catch(() => ({ stdout: '' }));
    return createHash('sha256').update(stdout).digest('hex');
  }

  async function captureCheckpoint({
    cwd,
    sessionId,
    turnId,
    previousRef = '',
    excludePaths = [],
    forceCache = false,
  }: CaptureCheckpointParams): Promise<CapturedCheckpoint | null> {
    if (!await isGitRepository(cwd)) return null;
    const ref = refFor(sessionId, turnId);
    const cleanHead = !excludePaths.length ? await resolveCleanHead(cwd) : null;
    if (cleanHead) {
      await execGit(cwd, ['update-ref', ref, cleanHead]);
      const { stdout: treeOut } = await execGit(cwd, ['rev-parse', `${cleanHead}^{tree}`]);
      return { ref, commit: cleanHead, tree: treeOut.trim(), fastPath: true, reusedBlobs: 0 };
    }

    const head = await resolveHead(cwd);
    const baseTree = head ? `${head}^{tree}` : EMPTY_TREE;
    const configHash = await conversionConfigHash(cwd);
    const tmpDir = await mkdtemp(join(tmpdir(), 'fairy-ckpt-'));
    const env = { GIT_INDEX_FILE: join(tmpDir, 'index') };
    try {
      await execGit(cwd, ['read-tree', baseTree], { env });
      const { stdout: untrackedRaw } = await execGit(cwd, ['ls-files', '-z', '--others', '--exclude-standard']);
      const excludePrefixes = excludePaths.map(p => String(p).replace(/^\/+|\/+$/g, '')).filter(Boolean);
      const isExcluded = (p: string): boolean => excludePrefixes.some(ex => p === ex || p.startsWith(`${ex}/`));
      const untrackedPaths = untrackedRaw.split('\0').filter(p => p && !isExcluded(p));

      const prepared = await blobCache.prepare({ cwd, head: head || '', configHash, untrackedPaths, execGit, env, forceCache });
      if (prepared.reused.length) {
        const indexInfo = prepared.reused.map(b => `${b.mode} blob ${b.oid}\t${b.path}\n`).join('');
        await execGit(cwd, ['update-index', '--index-info'], { env, input: indexInfo });
      }

      const pathspecs = excludePrefixes.length ? ['--', '.', ...excludePrefixes.map(ex => `:!${ex}`)] : ['--', '.'];
      await execGit(cwd, ['add', '-A', ...pathspecs], { env });
      // Also honor explicit untracked additions if any weren't already covered
      const { stdout: treeRaw } = await execGit(cwd, ['write-tree'], { env });
      const tree = treeRaw.trim();

      let parentCommit = '';
      if (previousRef) {
        parentCommit = (await execGit(cwd, ['rev-parse', '--verify', `${previousRef}^{commit}`], { ok: [0, 128] })).stdout.trim();
      } else if (head) {
        parentCommit = head;
      }

      const commitArgs = ['commit-tree', tree, ...(parentCommit ? ['-p', parentCommit] : []), '-m', `Fairy checkpoint ${sessionId}:${turnId}`];
      const { stdout: commitRaw } = await execGit(cwd, commitArgs, { env });
      const commit = commitRaw.trim();
      await execGit(cwd, ['update-ref', ref, commit]);

      if (untrackedPaths.length) {
        const treeOids = new Map<string, TreeOidEntry>();
        const { stdout: lsOut } = await execGit(cwd, ['ls-files', '-z', '--stage'], { env });
        for (const line of lsOut.split('\0')) {
          if (!line) continue;
          const tab = line.indexOf('\t');
          if (tab < 0) continue;
          const [mode, oid] = line.slice(0, tab).split(' ');
          treeOids.set(line.slice(tab + 1), { mode, oid });
        }
        await blobCache.remember({ cwd, head: head || '', configHash, untrackedPaths, stats: prepared.stats, treeOids, execGit, env });
      }

      return { ref, commit, tree, fastPath: false, reusedBlobs: prepared.reused.length };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function listCheckpoints({ cwd, sessionId }: ListCheckpointsParams): Promise<CheckpointEntry[]> {
    if (!await isGitRepository(cwd)) return [];
    const prefix = `refs/fairy/checkpoints/${safeSegment(sessionId, 'session')}/`;
    const { stdout } = await execGit(cwd, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)%09%(objectname)%09%(creatordate:iso8601)', prefix]);
    return stdout
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const [ref, commit, createdAt = ''] = line.split('\t');
        return { ref, commit, createdAt, turnId: ref.slice(prefix.length) };
      });
  }

  async function diffCheckpoints({
    cwd,
    fromRef,
    toRef,
    filePaths = [],
    ignoreWhitespace = false,
    format = 'patch',
    maxOutputBytes = 512 * 1024,
  }: DiffCheckpointsParams = {} as DiffCheckpointsParams): Promise<string> {
    if (!await isGitRepository(cwd)) return '';
    if (Array.isArray(filePaths) && filePaths.length === 0 && format === 'patch') {
      // Fall through only if caller omitted filePaths; wait: if explicitly [] return ''? Keep optional default null vs [].
    }
    const args = ['diff', '--no-ext-diff', '--no-textconv'];
    if (format === 'numstat') args.push('--numstat');
    if (ignoreWhitespace) args.push('-w');
    args.push(fromRef, toRef);
    if (filePaths.length) args.push('--', ...filePaths);
    const { stdout } = await execGit(cwd, args, { ok: [0, 1] });
    return stdout.length > maxOutputBytes ? `${stdout.slice(0, maxOutputBytes)}\n… diff truncated at ${maxOutputBytes} bytes` : stdout;
  }

  async function restoreCheckpoint({
    cwd,
    ref,
    excludePaths = [],
  }: RestoreCheckpointParams): Promise<RestoreCheckpointResult> {
    if (!await isGitRepository(cwd)) return { restored: false, reason: 'not_git' };
    const { code, stdout: commitOut } = await execGit(cwd, ['rev-parse', '--verify', `${ref}^{commit}`], { ok: [0, 128] });
    if (code !== 0 || !commitOut.trim()) return { restored: false, reason: 'missing_ref' };
    const excludePrefixes = excludePaths.map(p => String(p).replace(/^\/+|\/+$/g, '')).filter(Boolean);
    const isExcluded = (p: string): boolean => excludePrefixes.some(ex => p === ex || p.startsWith(`${ex}/`));

    const tmpDir = await mkdtemp(join(tmpdir(), 'fairy-restore-'));
    const env = { GIT_INDEX_FILE: join(tmpDir, 'index') };
    try {
      await execGit(cwd, ['read-tree', `${ref}^{tree}`], { env });
      const { stdout: targetRaw } = await execGit(cwd, ['ls-tree', '-r', '-z', '--name-only', `${ref}^{tree}`], { env });
      const targetFiles = new Set(targetRaw.split('\0').filter(Boolean));

      // Collect non-ignored workspace files that do not exist in the snapshot so they can be removed cleanly
      const { stdout: trackedRaw } = await execGit(cwd, ['ls-files', '-z']);
      const { stdout: othersRaw } = await execGit(cwd, ['ls-files', '-z', '--others', '--exclude-standard']);
      const currentFiles = new Set([...trackedRaw.split('\0'), ...othersRaw.split('\0')].filter(Boolean));
      const rootReal = await realpath(cwd).catch(() => resolve(cwd));

      let removedCount = 0;
      for (const rel of currentFiles) {
        if (targetFiles.has(rel) || SECRET_PATTERN.test(rel) || isExcluded(rel)) continue;
        const full = resolve(rootReal, rel);
        if (!full.startsWith(rootReal + sep)) continue;
        await rm(full, { force: true }).catch(() => {});
        removedCount++;
      }

      if (targetFiles.size) {
        await execGit(cwd, ['checkout-index', '-a', '-f'], { env });
      }
      blobCache.clear(cwd);
      return { restored: true, filesCount: targetFiles.size, removedCount, ref };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async function forkFromCheckpoint({
    cwd,
    ref,
    newBranch,
  }: ForkFromCheckpointParams): Promise<ForkCheckpointResult> {
    if (!await isGitRepository(cwd)) throw new Error('This folder isn’t a Git repository.');
    if (!newBranch || !/^[A-Za-z0-9/_.-]{1,100}$/.test(newBranch) || newBranch.includes('..')) {
      throw new Error('Choose a valid branch name.');
    }
    await execGit(cwd, ['branch', newBranch, ref]);
    return { branch: newBranch, ref };
  }

  async function deleteCheckpointRefs({ cwd, refs = [] }: DeleteCheckpointRefsParams): Promise<number> {
    if (!refs.length || !await isGitRepository(cwd)) return 0;
    let deleted = 0;
    for (const ref of refs) {
      const { code } = await execGit(cwd, ['update-ref', '-d', ref], { ok: [0, 1] });
      if (code === 0) deleted++;
    }
    return deleted;
  }

  return {
    blobCache,
    refFor,
    isGitRepository,
    resolveCleanHead,
    captureCheckpoint,
    listCheckpoints,
    diffCheckpoints,
    restoreCheckpoint,
    forkFromCheckpoint,
    deleteCheckpointRefs,
  };
}
