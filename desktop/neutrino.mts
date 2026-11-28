import { execFile, type ChildProcess, type ExecFileException } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, basename } from 'node:path';
import { createConnection } from 'node:net';
import { commandPath } from './work-sandbox.mjs';

// Neutrino (neutrinod / ntr) client for Fairy: talks to ~/.neutrino/neutrinod.sock directly on the server Mac,
// or forwards server calls over SSH from a workstation Mac (matching `ntr`'s origin / neutrino.server routing).
// Everything read from pull requests, notes, commit messages, or CI logs is untrusted data, never instructions.
export const LIMITS = Object.freeze({ body: 12000, log: 24000, diff: 60000, list: 60, notes: 80 });

const HOST = /^(?!-)[A-Za-z0-9._@-]{1,120}$/;
const REPO = /^(?:(?!-)(?!.*\.\.)[A-Za-z0-9_.-]{1,100}(?:\/(?!\.+$)[A-Za-z0-9_.-]{1,100})?|\/(?:Users|home)\/[A-Za-z0-9_.-]+\/\.neutrino\/repos\/(?!.*\.\.)[A-Za-z0-9_.-]{1,120}\.git)$/;
const REF = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/@~^-]{1,200}$/;
const SHA = /^[0-9a-f]{7,64}$/i;
const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.quotepath=false'];
const MERGE_STRATEGIES: readonly string[] = Object.freeze(['merge', 'squash', 'rebase', 'fast_forward']);
const PYTHON_SOCKET_BRIDGE = "python3 -c \"import os,sys,socket; s=socket.socket(socket.AF_UNIX); s.connect(os.path.expanduser('~/.neutrino/neutrinod.sock')); s.sendall(sys.stdin.readline().encode()); print(s.makefile().readline(), end='')\"";

export interface ClippedText {
  text: string;
  truncated: boolean;
}

const clip = (text: unknown, limit: number): ClippedText => { const value = String(text ?? ''); return value.length > limit ? { text: value.slice(0, limit), truncated: true } : { text: value, truncated: false }; };
const tail = (text: unknown, limit: number): ClippedText => { const value = String(text ?? ''); return value.length > limit ? { text: value.slice(-limit), truncated: true } : { text: value, truncated: false }; };
const stripAnsi = (text: unknown): string => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
const count = (value: unknown, fallback: number, most: number = LIMITS.list): number => Math.min(most, Math.max(1, Math.floor(Number(value)) || fallback));
const whole = (value: unknown, what = 'number'): number => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Give the ${what} as a whole number.`); return n; };
const words = (value: unknown, what: string, limit = 65000): string => { const text = String(value ?? '').trim(); if (!text) throw new Error(`Write the ${what} first.`); if (text.length > limit) throw new Error(`The ${what} is too long.`); return text; };
const toIso = (secs: unknown): string | null => (typeof secs === 'number' && Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString() : null);

function checkPath(value: unknown, what = 'file path'): string {
  if (typeof value !== 'string') throw new Error(`Give a valid relative ${what}.`);
  const path = value.trim();
  if (!path || path.startsWith('-') || path.length > 1024 || path.includes('\0') || path.includes('\\') || isAbsolute(path) || path.split('/').includes('..')) {
    throw new Error(`Give a valid relative ${what}.`);
  }
  return path;
}

function checkRef(value: unknown, what = 'branch'): string {
  if (typeof value !== 'string') throw new Error(`That isn’t a valid ${what}.`);
  const ref = value.trim();
  if (!REF.test(ref)) throw new Error(`That isn’t a valid ${what}.`);
  return ref;
}

export function defaultSocketPath(): string {
  return process.env.NEUTRINO_SOCKET || join(homedir(), '.neutrino', 'neutrinod.sock');
}

export interface NeutrinoRemoteInfo {
  host: string;
  port?: number;
  path: string;
  name: string;
}

export interface NeutrinoRpcPayload {
  method: string;
  params?: Record<string, unknown>;
}

export interface NeutrinoSocketResponse<T = any> {
  id?: number;
  type?: string;
  data?: T;
}

export interface SocketRequestOptions {
  timeout?: number;
}

export interface SshTarget {
  host: string;
  port?: number | null;
}

export type SshExecFn = (
  file: string,
  args: readonly string[],
  options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number; encoding: 'utf8' },
  callback: (error: ExecFileException | null, stdout: string, stderr: string) => void,
) => ChildProcess;

export interface SshSocketRequestOptions {
  timeout?: number;
  exec?: SshExecFn;
}

export interface NeutrinoRunnerOptions {
  cwd?: string | null;
  socketPath?: string;
  server?: string;
}

export interface NeutrinoCallOptions {
  scope?: 'server' | 'local';
  timeout?: number;
}

export interface NeutrinoContext {
  role: string | null;
  host: string | null;
}

export interface NeutrinoCaller {
  <T = any>(method: string, params?: Record<string, unknown>, options?: NeutrinoCallOptions): Promise<T>;
  context?: () => Promise<NeutrinoContext>;
}

export interface DiffLine {
  kind: 'added' | 'removed' | 'context' | string;
  old_line?: number | null;
  new_line?: number | null;
  text: string;
}

export interface DiffHunk {
  old_start: number;
  old_lines: number;
  new_start: number;
  new_lines: number;
  lines?: DiffLine[];
}

export interface RawFileDiff {
  path?: string;
  old_path?: string | null;
  status?: string;
  binary?: boolean;
  too_large?: boolean;
  additions?: number;
  deletions?: number;
  hunks?: DiffHunk[];
}

export interface RawPull {
  repo: string;
  number: number;
  title?: string;
  body?: string | null;
  source: string;
  target: string;
  state: string;
  head_sha: string;
  versions: number;
  open_notes: number;
  created_at?: number | null;
  updated_at?: number | null;
  merged_at?: number | null;
  merge_sha?: string | null;
}

export interface PullSummary {
  repo: string;
  number: number;
  title: string;
  body: string;
  source: string;
  target: string;
  state: string;
  headSha: string;
  versions: number;
  openNotes: number;
  createdAt: string | null;
  updatedAt: string | null;
  mergedAt: string | null;
  mergeSha: string | null;
  neutrino: true;
  host?: string;
}

export interface RawRun {
  id: number;
  repo: string;
  number: number;
  workflow: string;
  name: string;
  event: string;
  branch?: string | null;
  sha: string;
  pull?: number | null;
  state: string;
  error?: string | null;
  created_at?: number | null;
  started_at?: number | null;
  finished_at?: number | null;
}

export interface RunSummary {
  id: number;
  repo: string;
  number: number;
  workflow: string;
  name: string;
  event: string;
  branch: string | null;
  sha: string;
  pull: number | null;
  state: string;
  error: string | null;
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface CloneIntoOptions {
  neutrino: Neutrino;
  repo: string;
  parent: string;
  originOf: (folder: string) => string | null | undefined | Promise<string | null | undefined>;
  exists?: (path: string) => boolean;
  gitClone?: ((from: string, into: string) => Promise<void>) | null;
}

export interface CloneIntoResult {
  folder: string;
  cloned: boolean;
  repo: string;
}

// Parses ssh://[user@]host[:port]/path or [user@]host:/path remotes pointing at a Neutrino bare repository.
export function neutrinoRemoteInfo(url: unknown = ''): NeutrinoRemoteInfo | null {
  const raw = String(url || '').trim();
  if (!raw || /github\.com/i.test(raw)) return null;
  let host = '', port: number | null = null, path = '';
  if (raw.startsWith('ssh://')) {
    const rest = raw.slice(6);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const authority = rest.slice(0, slash);
    path = `/${rest.slice(slash + 1)}`;
    const colon = authority.lastIndexOf(':');
    if (colon > 0 && /^\d+$/.test(authority.slice(colon + 1))) {
      host = authority.slice(0, colon);
      port = Number(authority.slice(colon + 1));
    } else host = authority;
  } else if (!raw.includes('://')) {
    const colon = raw.indexOf(':');
    if (colon <= 0 || raw.slice(0, colon).includes('/')) return null;
    host = raw.slice(0, colon);
    path = raw.slice(colon + 1);
  } else {
    return null;
  }
  if (!HOST.test(host) || !path.startsWith('/') || (!path.includes('/.neutrino/') && !path.endsWith('.git'))) return null;
  const repoName = basename(path).replace(/\.git$/i, '');
  if (!repoName) return null;
  return { host, ...(port ? { port } : {}), path, name: repoName };
}

function gitRead(cwd: string | null | undefined, args: readonly string[]): Promise<string> {
  return new Promise(resolve => {
    execFile('git', [...SAFE, ...args], { cwd: cwd || homedir(), env: { ...process.env, PATH: commandPath(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? '' : String(stdout || '').trim());
    });
  });
}

export function socketRequest(socketPath: string, payload: NeutrinoRpcPayload | Record<string, unknown>, { timeout = 30000 }: SocketRequestOptions = {}): Promise<NeutrinoSocketResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error: Error | null, value?: NeutrinoSocketResponse): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      error ? reject(error) : resolve(value as NeutrinoSocketResponse);
    };
    const socket = createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => done(new Error('Neutrino timed out waiting for neutrinod.')), timeout);
    socket.on('error', (error: NodeJS.ErrnoException) => done(Object.assign(new Error(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? 'Neutrino isn’t running on this Mac.' : error.message), { code: error.code, missing: error.code === 'ENOENT' })));
    socket.on('connect', () => { socket.write(`${JSON.stringify({ id: 1, ...payload })}\n`); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try { done(null, JSON.parse(buffer.slice(0, nl)) as NeutrinoSocketResponse); }
      catch { done(new Error('Neutrino returned unreadable JSON.')); }
    });
    socket.on('end', () => {
      if (settled) return;
      if (!buffer.trim()) done(new Error('Neutrino closed the connection before answering.'));
      else {
        try { done(null, JSON.parse(buffer.trim()) as NeutrinoSocketResponse); }
        catch { done(new Error('Neutrino returned unreadable JSON.')); }
      }
    });
  });
}

export function sshSocketRequest({ host, port = null }: SshTarget, payload: NeutrinoRpcPayload | Record<string, unknown>, { timeout = 45000, exec = execFile }: SshSocketRequestOptions = {}): Promise<NeutrinoSocketResponse> {
  if (!HOST.test(String(host || ''))) return Promise.reject(new Error('That Neutrino server host name isn’t valid.'));
  if (port != null && (!Number.isInteger(port) || port < 1 || port > 65535)) return Promise.reject(new Error('That SSH port isn’t valid.'));
  return new Promise((resolve, reject) => {
    const args = ['-T', '-o', 'LogLevel=ERROR', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', ...(port ? ['-p', String(port)] : []), host, PYTHON_SOCKET_BRIDGE];
    const child = exec('ssh', args, { env: { ...process.env, PATH: commandPath() }, timeout, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        const msg = String(stderr || error.message).trim();
        reject(new Error(/No such file|Connection refused/i.test(msg) ? `Neutrino isn’t running on ${host}.` : msg || `Couldn’t reach Neutrino on ${host}.`));
        return;
      }
      const line = String(stdout || '').trim().split('\n')[0];
      if (!line) { reject(new Error(`Neutrino on ${host} closed without answering.`)); return; }
      try { resolve(JSON.parse(line) as NeutrinoSocketResponse); }
      catch { reject(new Error(`Neutrino on ${host} returned unreadable JSON.`)); }
    });
    child.stdin?.end(`${JSON.stringify({ id: 1, ...payload })}\n`);
  });
}

export function neutrinoRunner({ cwd = null, socketPath = defaultSocketPath(), server = '' }: NeutrinoRunnerOptions = {}): NeutrinoCaller {
  let localRole: string | null = null;
  let serverTarget: SshTarget | null = server ? { host: server, port: null } : null;

  async function detectRole(): Promise<string | null> {
    try {
      const resp = await socketRequest(socketPath, { method: 'engine_info' }, { timeout: 2500 });
      if (resp?.type === 'engine' && resp.data?.role) localRole = resp.data.role;
    } catch {
      localRole = null;
    }
    return localRole;
  }

  async function resolveServer(): Promise<SshTarget> {
    if (serverTarget) return serverTarget;
    const envServer = process.env.NEUTRINO_SERVER?.trim();
    if (envServer && HOST.test(envServer)) { serverTarget = { host: envServer, port: null }; return serverTarget; }
    if (cwd) {
      const originUrl = await gitRead(cwd, ['remote', 'get-url', 'origin']);
      const remote = neutrinoRemoteInfo(originUrl);
      if (remote) { serverTarget = { host: remote.host, port: remote.port || null }; return serverTarget; }
    }
    const configured = await gitRead(cwd, ['config', '--get', 'neutrino.server']);
    if (configured && HOST.test(configured)) { serverTarget = { host: configured, port: null }; return serverTarget; }
    throw new Error('No Neutrino server is set up. Run `git config --global neutrino.server mini` once, or open a repository whose origin is on your Neutrino server.');
  }

  async function call<T = any>(method: string, params: Record<string, unknown> | undefined = undefined, { scope = 'server', timeout = 45000 }: NeutrinoCallOptions = {}): Promise<T> {
    const payload: NeutrinoRpcPayload = params === undefined ? { method } : { method, params };
    const role = localRole || await detectRole();
    let raw: NeutrinoSocketResponse<any>;
    if (scope === 'local' || role === 'server') {
      raw = await socketRequest(socketPath, payload, { timeout });
    } else {
      const target = await resolveServer();
      raw = await sshSocketRequest(target, payload, { timeout });
    }
    if (raw?.type === 'error') throw new Error(raw.data?.message || 'Neutrino returned an error.');
    return raw?.data as T;
  }

  call.context = async (): Promise<NeutrinoContext> => ({
    role: localRole || await detectRole(),
    host: (await resolveServer().catch(() => null))?.host || null,
  });
  return call;
}

export function formatFileDiff(diff?: RawFileDiff | null): string {
  if (!diff) return '';
  if (diff.binary) return 'Binary file — no text diff.';
  if (diff.too_large) return 'File is too large to diff.';
  const lines = [`diff --git a/${diff.old_path || diff.path} b/${diff.path}`];
  for (const hunk of diff.hunks || []) {
    lines.push(`@@ -${hunk.old_start},${hunk.old_lines} +${hunk.new_start},${hunk.new_lines} @@`);
    for (const line of hunk.lines || []) {
      const prefix = line.kind === 'added' ? '+' : line.kind === 'removed' ? '-' : ' ';
      lines.push(`${prefix}${line.text}`);
    }
  }
  return lines.join('\n');
}

function summarizePull(raw: RawPull, host = ''): PullSummary {
  return {
    repo: raw.repo,
    number: raw.number,
    title: String(raw.title || '').slice(0, 300),
    body: clip(raw.body || '', LIMITS.body).text,
    source: raw.source,
    target: raw.target,
    state: raw.state,
    headSha: raw.head_sha,
    versions: raw.versions,
    openNotes: raw.open_notes,
    createdAt: toIso(raw.created_at),
    updatedAt: toIso(raw.updated_at),
    mergedAt: toIso(raw.merged_at),
    mergeSha: raw.merge_sha || null,
    neutrino: true,
    ...(host ? { host } : {}),
  };
}

function summarizeRun(raw: RawRun): RunSummary {
  return {
    id: raw.id,
    repo: raw.repo,
    number: raw.number,
    workflow: raw.workflow,
    name: raw.name,
    event: raw.event,
    branch: raw.branch || null,
    sha: raw.sha,
    pull: raw.pull ?? null,
    state: raw.state,
    error: raw.error || null,
    createdAt: toIso(raw.created_at),
    startedAt: toIso(raw.started_at),
    finishedAt: toIso(raw.finished_at),
  };
}

export async function cloneInto({ neutrino, repo, parent, originOf, exists = existsSync, gitClone = null }: CloneIntoOptions): Promise<CloneIntoResult> {
  const listed = await neutrino.repos({ kind: 'server', limit: 200 });
  const targetRepo = (listed.repos || []).find(r => r.id.toLowerCase() === String(repo || '').toLowerCase() || r.name.toLowerCase() === String(repo || '').toLowerCase());
  if (!targetRepo) throw new Error(`Couldn’t find “${String(repo || '').slice(0, 60)}” on Neutrino.`);
  const folderName = targetRepo.name || targetRepo.id;
  if (!folderName || folderName === '.' || folderName === '..' || folderName.includes('/')) throw new Error('That isn’t a repository Fairy can clone.');
  if (typeof parent !== 'string' || !isAbsolute(parent)) throw new Error('Choose a folder to clone it into.');
  const destination = join(parent, folderName);
  const url = neutrino.cloneUrl(targetRepo);
  if (exists(destination)) {
    const existing = await Promise.resolve().then(() => originOf(destination)).catch(() => null);
    const info = existing ? neutrinoRemoteInfo(existing) : null;
    if (info && (info.path === targetRepo.path || info.name.toLowerCase() === targetRepo.name.toLowerCase())) {
      return { folder: destination, cloned: false, repo: targetRepo.id };
    }
    throw new Error(`There’s already a folder called ${folderName} in ${parent}. Choose another place, or move that folder.`);
  }
  const clone = gitClone || ((from: string, into: string) => new Promise<void>((resolve, reject) => {
    execFile('git', ['clone', '--quiet', from, into], { env: { ...process.env, PATH: commandPath(), GIT_TERMINAL_PROMPT: '0' }, timeout: 15 * 60 * 1000, encoding: 'utf8' }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      else resolve();
    });
  }));
  await clone(url, destination);
  return { folder: destination, cloned: true, repo: targetRepo.id };
}

export interface NeutrinoOptions {
  call?: NeutrinoCaller | null;
  cwd?: string | null;
  socketPath?: string;
  server?: string;
}

export interface RawRepoHead {
  kind?: string;
  name?: string;
  sha?: string;
}

export interface RawRepo {
  id: string;
  name: string;
  path: string;
  bare?: boolean;
  head?: RawRepoHead | null;
  error?: string | null;
}

export interface RawMirror {
  repo: string;
  url: string;
  state: string;
  last_ok?: number | null;
  last_attempt?: number | null;
  last_error?: string | null;
  mirror_only?: string[];
}

export interface MirrorSummary {
  repo?: string;
  url: string;
  state: string;
  lastOk: string | null;
  lastAttempt: string | null;
  lastError: string | null;
  mirrorOnly: string[];
}

export interface RawEngineInfo {
  version?: string;
  protocol?: number;
  role?: string;
  repos?: number;
}

export interface RawBranch {
  name: string;
  kind?: string;
  sha?: string;
  subject?: string;
  time?: number;
  is_head?: boolean;
  upstream?: string | null;
  ahead?: number | null;
  behind?: number | null;
}

export interface RawAuthor {
  name?: string;
  email?: string;
  time?: number;
  offset?: number;
}

export interface RawCommitRef {
  name: string;
  kind?: string;
  is_head?: boolean;
}

export interface RawCommitFile {
  path: string;
  old_path?: string | null;
  status: string;
  additions?: number;
  deletions?: number;
  binary?: boolean;
}

export interface RawCommit {
  sha: string;
  parents?: string[];
  subject?: string;
  body?: string;
  author?: RawAuthor;
  time?: number;
  refs?: RawCommitRef[];
  files?: RawCommitFile[];
  truncated?: boolean;
}

export interface RawNote {
  id: number;
  version: number;
  path: string;
  side: string;
  line: number;
  current_line?: number | null;
  resolved?: boolean;
  text: string;
  created_at?: number | null;
}

export interface RawPullVersion {
  version: number;
  head_sha: string;
  base_sha: string;
  created_at?: number | null;
}

export interface RawPullDetail {
  pull: RawPull;
  versions?: RawPullVersion[];
  notes?: RawNote[];
  mergeability?: Record<string, unknown> | null;
  files?: RawCommitFile[];
  commits?: RawCommit[];
  rule?: Record<string, unknown> | null;
  checks?: RawRun[];
}

export interface RawJob {
  id: number;
  key: string;
  name: string;
  executor: string;
  image?: string | null;
  state: string;
  error?: string | null;
  needs?: string[];
  environment?: string | null;
  approved_by?: string | null;
  attempt: number;
  started_at?: number | null;
  finished_at?: number | null;
  steps?: unknown[];
}

export interface RawWaiting {
  repo: string;
  run?: number;
  number?: number;
  run_name?: string;
  job?: number;
  job_name?: string;
  environment?: string;
  branch?: string;
  since?: number | null;
  [key: string]: unknown;
}

export interface RawEvent {
  at?: number | null;
  [key: string]: unknown;
}

export interface RawInbox {
  waiting?: RawWaiting[];
  ready?: RawPull[];
  open?: RawPull[];
  runs?: RawRun[];
  events?: RawEvent[];
}

export interface RawOverview {
  commit?: string | null;
  commits?: number;
  commits_capped?: boolean;
  contributors?: number;
  files?: number;
  languages?: unknown[];
  readme?: string | null;
  license?: string | null;
}

export interface RawLogPage {
  has_more?: boolean;
  lanes?: number;
  commits?: RawCommit[];
}

export interface RawRunDetail {
  run: RawRun;
  jobs?: RawJob[];
  warnings?: unknown[];
}

export interface RawJobLogChunk {
  text?: string;
  done?: boolean;
  next: number;
}

export interface RawOverride {
  at?: number | null;
  [key: string]: unknown;
}

export interface RawSecret {
  name: string;
  scope: unknown;
  updated_at?: number | null;
}

export interface RawVariable {
  name: string;
  value: unknown;
  scope: unknown;
  updated_at?: number | null;
}

export interface RawBackupFile {
  modified?: number | null;
  [key: string]: unknown;
}

export interface RawBackups {
  files?: RawBackupFile[];
  [key: string]: unknown;
}

export interface RawCreatedHosted {
  id?: string;
  name?: string;
  path: string;
  [key: string]: unknown;
}

export class Neutrino {
  cwd: string | null;
  call: NeutrinoCaller;
  _repos: RawRepo[] | null;
  _context: NeutrinoContext | null;

  constructor({ call = null, cwd = null, socketPath = defaultSocketPath(), server = '' }: NeutrinoOptions = {}) {
    this.cwd = cwd;
    this.call = call || neutrinoRunner({ cwd, socketPath, server });
    this._repos = null;
    this._context = null;
  }

  async context(): Promise<NeutrinoContext> {
    if (this._context) return this._context;
    this._context = typeof this.call.context === 'function' ? await this.call.context() : { role: 'server', host: null };
    return this._context;
  }

  cloneUrl(repo: { path: string }): string {
    const host = this._context?.host;
    return host ? `ssh://${host}${repo.path}` : repo.path;
  }

  async serverRepos(refresh = false): Promise<RawRepo[]> {
    if (!this._repos || refresh) this._repos = await this.call<RawRepo[]>('list_repos');
    return Array.isArray(this._repos) ? this._repos : [];
  }

  async repoId(repo: unknown = ''): Promise<string> {
    if (repo != null && repo !== '' && typeof repo !== 'string') throw new Error('That isn’t a valid Neutrino repository name.');
    const raw = String(repo ?? '').trim();
    if (!raw) {
      if (this.cwd) {
        const list = await this.serverRepos();
        const origin = await gitRead(this.cwd, ['remote', 'get-url', 'origin']);
        const parsed = neutrinoRemoteInfo(origin);
        if (parsed) {
          const hit = list.find(r => r.path === parsed.path || r.id.toLowerCase() === parsed.name.toLowerCase() || r.name.toLowerCase() === parsed.name.toLowerCase());
          if (hit) return hit.id;
        }
        const dir = basename(this.cwd);
        const byDir = list.find(r => r.id.toLowerCase() === dir.toLowerCase() || r.name.toLowerCase() === dir.toLowerCase());
        if (byDir) return byDir.id;
      }
      throw new Error('Name the Neutrino repository id, or run from a repository hosted on Neutrino.');
    }
    if (!REPO.test(raw)) throw new Error('That isn’t a valid Neutrino repository name.');
    const list = await this.serverRepos();
    const tailName = raw.includes('/') ? basename(raw).replace(/\.git$/i, '') : raw;
    const hit = list.find(r => r.id === raw || r.path === raw || r.id.toLowerCase() === tailName.toLowerCase() || r.name.toLowerCase() === tailName.toLowerCase());
    if (!hit && list.length) throw new Error(`Couldn’t find “${raw}” on Neutrino. Run neutrino_repos to list hosted repositories.`);
    return hit ? hit.id : raw;
  }

  /* ── info & reading ── */
  async engineInfo({ local = false }: { local?: boolean } = {}): Promise<RawEngineInfo | null> {
    return this.call<RawEngineInfo | null>('engine_info', undefined, local ? { scope: 'local' } : undefined);
  }

  async ciInfo(): Promise<Record<string, unknown> | null> {
    return this.call<Record<string, unknown> | null>('ci_info');
  }

  async status() {
    const [engine, ci, inbox, mirrors] = await Promise.all([
      this.engineInfo().catch(() => null),
      this.ciInfo().catch(() => null),
      this.inbox({ limit: 30 }).catch(() => null),
      this.mirrors().catch(() => ({ mirrors: [] as MirrorSummary[] })),
    ]);
    const failingMirrors = (mirrors?.mirrors || []).filter(m => m.state === 'failing');
    return {
      connected: Boolean(engine || inbox),
      version: engine?.version || null,
      protocol: engine?.protocol ?? null,
      role: engine?.role || null,
      repos: engine?.repos ?? 0,
      ci,
      waitingCount: inbox?.waiting?.length || 0,
      readyCount: inbox?.ready?.length || 0,
      openCount: inbox?.open?.length || 0,
      waiting: (inbox?.waiting || []).slice(0, 10),
      ready: (inbox?.ready || []).slice(0, 10),
      open: (inbox?.open || []).slice(0, 10),
      recentRuns: (inbox?.runs || []).slice(0, 10),
      events: (inbox?.events || []).slice(0, 10),
      failingMirrors,
    };
  }

  async repos({ kind = 'server', query = '', limit = 100 }: { kind?: string; query?: string; limit?: number | string } = {}) {
    if (!['server', 'workstation'].includes(kind)) throw new Error('Choose server or workstation repositories.');
    const [ctx, list, mirrors] = await Promise.all([
      this.context(),
      kind === 'workstation' ? this.call<RawRepo[]>('list_repos', undefined, { scope: 'local' }) : this.serverRepos(true),
      kind === 'server' ? this.call<RawMirror[]>('mirrors').catch(() => [] as RawMirror[]) : Promise.resolve([] as RawMirror[]),
    ]);
    const mirrorByRepo = new Map<string, RawMirror>((Array.isArray(mirrors) ? mirrors : []).map(m => [m.repo, m]));
    const needle = String(query || '').trim().toLowerCase();
    const mapped = (Array.isArray(list) ? list : []).map(r => {
      const m = mirrorByRepo.get(r.id) || null;
      return {
        id: r.id,
        name: r.name,
        path: r.path,
        bare: Boolean(r.bare),
        head: r.head || null,
        branch: r.head?.kind === 'branch' ? r.head.name : null,
        error: r.error || null,
        mirror: m ? { url: m.url, state: m.state, lastOk: toIso(m.last_ok), lastAttempt: toIso(m.last_attempt), lastError: m.last_error || null, mirrorOnly: m.mirror_only || [] } : null,
      };
    }).filter(r => !needle || r.id.toLowerCase().includes(needle) || r.name.toLowerCase().includes(needle) || r.mirror?.url?.toLowerCase().includes(needle));
    return { kind, host: ctx?.host || null, total: mapped.length, repos: mapped.slice(0, count(limit, 80, 200)) };
  }

  async repoOverview({ repo = '' }: { repo?: string } = {}) {
    const id = await this.repoId(repo);
    const list = await this.serverRepos();
    const meta: RawRepo = list.find(r => r.id === id) || { id, name: id, path: '' };
    const [overview, branches, pulls, runs, rules, environments, mirrors] = await Promise.all([
      this.call<RawOverview | null>('overview', { repo: id }).catch(() => null),
      this.call<RawBranch[]>('branches', { repo: id }).catch(() => [] as RawBranch[]),
      this.call<RawPull[]>('list_pulls', { repo: id }).catch(() => [] as RawPull[]),
      this.call<RawRun[]>('list_runs', { repo: id, limit: 15 }).catch(() => [] as RawRun[]),
      this.call<unknown[]>('branch_rules', { repo: id }).catch(() => [] as unknown[]),
      this.call<unknown[]>('list_environments', { repo: id }).catch(() => [] as unknown[]),
      this.call<RawMirror[]>('mirrors').catch(() => [] as RawMirror[]),
    ]);
    const branch = meta.head?.kind === 'branch' ? meta.head.name : branches.find(b => b.is_head)?.name || 'main';
    const mirror = (Array.isArray(mirrors) ? mirrors : []).find(m => m.repo === id) || null;
    return {
      id,
      name: meta.name,
      path: meta.path,
      branch,
      commit: overview?.commit || meta.head?.sha || null,
      commits: overview?.commits ?? 0,
      commitsCapped: Boolean(overview?.commits_capped),
      contributors: overview?.contributors ?? 0,
      files: overview?.files ?? 0,
      languages: overview?.languages || [],
      readme: overview?.readme || null,
      license: overview?.license || null,
      branches: (branches || []).slice(0, 60),
      openPrs: (pulls || []).filter(p => p.state === 'open').map(p => summarizePull(p)),
      allPrs: (pulls || []).slice(0, 40).map(p => summarizePull(p)),
      runs: (runs || []).map(summarizeRun),
      rules: rules || [],
      environments: environments || [],
      mirror: mirror ? { url: mirror.url, state: mirror.state, lastOk: toIso(mirror.last_ok), lastAttempt: toIso(mirror.last_attempt), lastError: mirror.last_error || null, mirrorOnly: mirror.mirror_only || [] } : null,
    };
  }

  async branches({ repo = '' }: { repo?: string } = {}) {
    const id = await this.repoId(repo);
    return { repo: id, branches: await this.call<RawBranch[]>('branches', { repo: id }) };
  }

  async commits({ repo = '', branch = '', skip = 0, limit = 50, query = '' }: { repo?: string; branch?: string; skip?: number | string; limit?: number | string; query?: string } = {}) {
    if (branch) checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    const page = await this.call<RawLogPage | null>('log', { repo: id, rev: branch || null, all: false, skip: Math.max(0, Math.floor(Number(skip)) || 0), limit: count(limit, 50, 100), query: query ? String(query).slice(0, 200) : null });
    return {
      repo: id,
      more: Boolean(page?.has_more),
      lanes: page?.lanes ?? 1,
      commits: (page?.commits || []).map(c => ({
        sha: c.sha,
        short: String(c.sha || '').slice(0, 7),
        author: c.author?.name || '',
        email: c.author?.email || '',
        date: toIso(c.time),
        subject: c.subject,
        parents: c.parents || [],
        refs: (c.refs || []).map(r => (r.is_head ? `→ ${r.name}` : r.kind === 'tag' ? `# ${r.name}` : r.name)),
      })),
    };
  }

  async commitDetail({ repo = '', sha }: { repo?: string; sha?: string } = {}) {
    if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('That isn’t a commit SHA.');
    const id = await this.repoId(repo);
    const raw = await this.call<RawCommit>('commit', { repo: id, sha });
    return {
      repo: id,
      sha: raw.sha,
      message: [raw.subject, raw.body].filter(Boolean).join('\n\n'),
      author: raw.author?.name || '',
      date: toIso(raw.author?.time),
      files: (raw.files || []).slice(0, 300).map(f => ({
        path: f.path,
        oldPath: f.old_path || null,
        status: f.status,
        added: f.binary ? null : f.additions ?? 0,
        removed: f.binary ? null : f.deletions ?? 0,
        binary: Boolean(f.binary),
      })),
      more: Boolean(raw.truncated),
    };
  }

  async commitFileDiff({ repo = '', sha, path, context = 3 }: { repo?: string; sha?: string; path?: string; context?: number } = {}) {
    if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('That isn’t a commit SHA.');
    const cleanPath = checkPath(path);
    const id = await this.repoId(repo);
    return formatFileDiff(await this.call<RawFileDiff>('file_diff', { repo: id, sha, path: cleanPath, context }));
  }

  async inbox({ limit = 30 }: { limit?: number | string } = {}) {
    const per = count(limit, 30, 80);
    const [ctx, raw] = await Promise.all([this.context(), this.call<RawInbox | null>('inbox')]);
    const latestByPull = new Map<string, RawRun>();
    for (const run of raw?.runs || []) {
      if (!run.pull) continue;
      const key = `${run.repo}#${run.pull}`;
      if (!latestByPull.has(key)) latestByPull.set(key, run);
    }
    const pullChecks = (p: RawPull): string => {
      const r = latestByPull.get(`${p.repo}#${p.number}`);
      if (!r) return '';
      if (r.state === 'success') return 'passing';
      if (r.state === 'failure' || r.state === 'cancelled') return 'failing';
      if (r.state === 'running' || r.state === 'queued' || r.state === 'waiting') return 'running';
      return r.state;
    };
    const mapPull = (p: RawPull) => ({ ...summarizePull(p, ctx?.host || ''), checks: pullChecks(p) });
    return {
      host: ctx?.host || null,
      waiting: (raw?.waiting || []).slice(0, per).map(w => ({ ...w, sinceIso: toIso(w.since) })),
      ready: (raw?.ready || []).slice(0, per).map(mapPull),
      open: (raw?.open || []).slice(0, per).map(mapPull),
      runs: (raw?.runs || []).slice(0, per).map(summarizeRun),
      events: (raw?.events || []).slice(0, per).map(e => ({ ...e, atIso: toIso(e.at) })),
    };
  }

  async prs({ repo = '', state = 'open', limit = 30 }: { repo?: string; state?: string; limit?: number | string } = {}) {
    if (!['open', 'closed', 'merged', 'all'].includes(state)) throw new Error('Choose open, closed, merged, or all.');
    const id = await this.repoId(repo);
    const list = await this.call<RawPull[]>('list_pulls', { repo: id });
    const filtered = (Array.isArray(list) ? list : [])
      .filter(p => state === 'all' || p.state === state)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, count(limit, 30, 100));
    return { repo: id, prs: filtered.map(p => summarizePull(p)) };
  }

  async pr({ repo = '', number: n }: { repo?: string; number?: number | string } = {}) {
    const num = whole(n, 'pull request number');
    const id = await this.repoId(repo);
    const d = await this.call<RawPullDetail>('pull', { repo: id, number: num });
    return {
      ...summarizePull(d.pull),
      versionsList: (d.versions || []).map(v => ({ version: v.version, headSha: v.head_sha, baseSha: v.base_sha, createdAt: toIso(v.created_at) })),
      notes: (d.notes || []).slice(-LIMITS.notes).map(note => ({
        id: note.id, version: note.version, path: note.path, side: note.side, line: note.line, currentLine: note.current_line ?? null,
        resolved: Boolean(note.resolved), text: clip(note.text, 2000).text, createdAt: toIso(note.created_at),
      })),
      mergeability: d.mergeability || null,
      files: (d.files || []).slice(0, 150).map(f => ({ path: f.path, oldPath: f.old_path || null, status: f.status, additions: f.additions, deletions: f.deletions, binary: Boolean(f.binary) })),
      commits: (d.commits || []).slice(-50).map(c => ({ sha: c.sha, short: c.sha.slice(0, 7), subject: c.subject, author: c.author?.name || '', date: toIso(c.time) })),
      rule: d.rule || null,
      checks: (d.checks || []).map(summarizeRun),
    };
  }

  async prDiff({ repo = '', number: n, path = '' }: { repo?: string; number?: number | string; path?: string } = {}): Promise<ClippedText> {
    const num = whole(n, 'pull request number');
    const cleanPath = path === '' || path === undefined ? '' : checkPath(path);
    const id = await this.repoId(repo);
    const detail = await this.call<RawPullDetail>('pull', { repo: id, number: num });
    const base = detail.versions?.at(-1)?.base_sha || detail.pull?.target;
    const head = detail.pull?.head_sha || detail.pull?.source;
    if (cleanPath) {
      const diff = await this.call<RawFileDiff>('compare_diff', { repo: id, base, head, path: cleanPath });
      return clip(formatFileDiff(diff), LIMITS.diff);
    }
    const files = (detail.files || []).filter(f => !f.binary).slice(0, 20);
    const parts: string[] = [];
    for (let i = 0; i < files.length; i += 5) {
      const batch = await Promise.all(files.slice(i, i + 5).map(f => this.call<RawFileDiff>('compare_diff', { repo: id, base, head, path: f.path }).catch(() => null)));
      for (const item of batch) if (item) parts.push(formatFileDiff(item));
    }
    return clip(parts.join('\n\n'), LIMITS.diff);
  }

  async runs({ repo = '', pull = null, branch = '', limit = 20 }: { repo?: string; pull?: number | string | null; branch?: string; limit?: number | string } = {}) {
    const pNum = pull != null && pull !== '' ? whole(pull, 'pull request number') : null;
    if (branch) checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    const list = await this.call<RawRun[]>('list_runs', { repo: id, pull: pNum, limit: count(limit, 20, 60) });
    const b = String(branch || '').trim();
    const runs = (Array.isArray(list) ? list : []).filter(r => !b || r.branch === b).map(summarizeRun);
    return { repo: id, runs };
  }

  async run({ repo = '', id: runId }: { repo?: string; id?: number | string } = {}) {
    const num = whole(runId, 'run id');
    const repoId = await this.repoId(repo);
    const detail = await this.call<RawRunDetail>('run', { repo: repoId, id: num });
    return {
      run: summarizeRun(detail.run),
      jobs: (detail.jobs || []).map(j => ({
        id: j.id, key: j.key, name: j.name, executor: j.executor, image: j.image || null, state: j.state,
        error: j.error || null, needs: j.needs || [], environment: j.environment || null, approvedBy: j.approved_by || null,
        attempt: j.attempt, startedAt: toIso(j.started_at), finishedAt: toIso(j.finished_at), steps: j.steps || [],
      })),
      warnings: detail.warnings || [],
    };
  }

  async ciLog({ repo = '', run: runId, job = null }: { repo?: string; run?: number | string; job?: number | string | null } = {}) {
    const id = whole(runId, 'run id');
    let jobId = job != null && job !== '' ? whole(job, 'job id') : null;
    const repoId = await this.repoId(repo);
    let jobName = '', state = '';
    if (!jobId) {
      const detail = await this.run({ repo: repoId, id });
      const picked = detail.jobs.find(j => j.state === 'failure') || detail.jobs.find(j => j.state === 'waiting') || detail.jobs.find(j => j.state === 'running') || detail.jobs.at(-1);
      if (!picked) return { repo: repoId, run: id, job: null, log: '', truncated: false, note: detail.run?.error || 'This run has no jobs yet.' };
      jobId = picked.id; jobName = picked.name; state = picked.state;
    }
    let offset = 0, text = '', reads = 0;
    while (reads < 24) {
      reads++;
      const chunk = await this.call<RawJobLogChunk | null>('job_log', { repo: repoId, job: jobId, offset });
      if (chunk?.text) text += chunk.text;
      if (text.length > LIMITS.log * 3) text = text.slice(-LIMITS.log * 2);
      if (!chunk || chunk.done || chunk.next === offset) break;
      offset = chunk.next;
    }
    const kept = tail(stripAnsi(text), LIMITS.log);
    return { repo: repoId, run: id, job: jobId, ...(jobName ? { jobName } : {}), ...(state ? { state } : {}), log: kept.text, truncated: kept.truncated };
  }

  async workflows({ repo = '', branch = 'main' }: { repo?: string; branch?: string } = {}) {
    const ref = checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    return { repo: id, branch: ref, workflows: await this.call<unknown[]>('workflows', { repo: id, branch: ref }) };
  }

  async artifacts({ repo = '', run: runId }: { repo?: string; run?: number | string } = {}) {
    const num = whole(runId, 'run id');
    const id = await this.repoId(repo);
    return { repo: id, run: num, artifacts: await this.call<unknown[]>('list_artifacts', { repo: id, run: num }) };
  }

  async mirrors(): Promise<{ mirrors: MirrorSummary[] }> {
    const list = await this.call<RawMirror[]>('mirrors');
    return {
      mirrors: (Array.isArray(list) ? list : []).map(m => ({
        repo: m.repo, url: m.url, state: m.state, lastOk: toIso(m.last_ok), lastAttempt: toIso(m.last_attempt),
        lastError: m.last_error || null, mirrorOnly: m.mirror_only || [],
      })),
    };
  }

  async rules({ repo = '' }: { repo?: string } = {}) {
    const id = await this.repoId(repo);
    const [rules, overrides] = await Promise.all([
      this.call<unknown[]>('branch_rules', { repo: id }),
      this.call<RawOverride[]>('overrides', { repo: id }).catch(() => [] as RawOverride[]),
    ]);
    return { repo: id, rules: rules || [], overrides: (overrides || []).map(o => ({ ...o, atIso: toIso(o.at) })) };
  }

  async environments({ repo = '' }: { repo?: string } = {}) {
    const id = await this.repoId(repo);
    return { repo: id, environments: await this.call<unknown[]>('list_environments', { repo: id }) };
  }

  // Only ever returns secret names and scopes — Neutrino Vault has no API to read secret values.
  async secrets({ repo = '', environment = '' }: { repo?: string; environment?: string } = {}) {
    if (environment != null && environment !== '' && (typeof environment !== 'string' || !REF.test(environment))) throw new Error('That isn’t a valid environment name.');
    const scope = { ...(repo ? { repo: await this.repoId(repo) } : {}), ...(environment ? { environment: environment.slice(0, 120) } : {}) };
    const list = await this.call<RawSecret[]>('list_secrets', { scope });
    return { secrets: (Array.isArray(list) ? list : []).map(s => ({ name: s.name, scope: s.scope, updatedAt: toIso(s.updated_at) })) };
  }

  async variables({ repo = '', environment = '' }: { repo?: string; environment?: string } = {}) {
    if (environment != null && environment !== '' && (typeof environment !== 'string' || !REF.test(environment))) throw new Error('That isn’t a valid environment name.');
    const scope = { ...(repo ? { repo: await this.repoId(repo) } : {}), ...(environment ? { environment: environment.slice(0, 120) } : {}) };
    const list = await this.call<RawVariable[]>('list_variables', { scope });
    return { variables: (Array.isArray(list) ? list : []).map(v => ({ name: v.name, value: v.value, scope: v.scope, updatedAt: toIso(v.updated_at) })) };
  }

  async backups({ local = false }: { local?: boolean } = {}) {
    const data = await this.call<RawBackups | null>('list_backups', undefined, local ? { scope: 'local' } : undefined);
    return { ...data, files: (data?.files || []).map(f => ({ ...f, modifiedIso: toIso(f.modified) })) };
  }

  /* ── essential tasks / writes (approval-gated) ── */
  async prCreate({ repo = '', title, body = '', source = '', target = '' }: { repo?: string; title?: string; body?: string; source?: string; target?: string } = {}) {
    const cleanTitle = words(title, 'title', 256);
    let src = source ? checkRef(source, 'source branch') : '';
    let dst = target ? checkRef(target, 'target branch') : '';
    const id = await this.repoId(repo);
    if (!src && this.cwd) src = checkRef(await gitRead(this.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), 'source branch');
    if (!src || src === 'HEAD') throw new Error('Name the source branch for this pull request.');
    if (!dst) {
      const ov = await this.repoOverview({ repo: id }).catch(() => null);
      dst = ov?.branch && ov.branch !== src ? ov.branch : 'main';
    }
    const detail = await this.call<RawPullDetail>('create_pull', { repo: id, title: cleanTitle, body: String(body || '').slice(0, 65000), source: src, target: dst });
    return { created: true as const, ...summarizePull(detail.pull) };
  }

  async prUpdate({ repo = '', number: n, title, body, state }: { repo?: string; number?: number | string; title?: string; body?: string; state?: string } = {}) {
    const num = whole(n, 'pull request number');
    if (state !== undefined && !['open', 'closed'].includes(state)) throw new Error('State must be open or closed.');
    const cleanTitle = title !== undefined ? words(title, 'title', 256) : undefined;
    const id = await this.repoId(repo);
    const detail = await this.call<RawPullDetail>('update_pull', {
      repo: id, number: num,
      ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      ...(body !== undefined ? { body: String(body).slice(0, 65000) } : {}),
      ...(state !== undefined ? { state } : {}),
    });
    return { updated: true as const, ...summarizePull(detail.pull) };
  }

  async prNote({ repo = '', number: n, path, side = 'new', line, text }: { repo?: string; number?: number | string; path?: string; side?: string; line?: number | string; text?: string } = {}) {
    const num = whole(n, 'pull request number');
    if (!['old', 'new'].includes(side)) throw new Error('Side must be new or old.');
    const cleanPath = checkPath(path), lineNum = whole(line, 'line number'), noteText = words(text, 'note');
    const id = await this.repoId(repo);
    const detail = await this.call<{ notes?: unknown[] } | null>('add_note', { repo: id, number: num, path: cleanPath, side, line: lineNum, text: noteText });
    return { posted: true as const, repo: id, number: num, notes: (detail?.notes || []).length };
  }

  async prResolveNote({ repo = '', number: n, note, resolved = true }: { repo?: string; number?: number | string; note?: number | string; resolved?: boolean } = {}) {
    const num = whole(n, 'pull request number'), noteId = whole(note, 'note id');
    const id = await this.repoId(repo);
    const detail = await this.call<{ pull?: { open_notes?: number } } | null>('resolve_note', { repo: id, number: num, note: noteId, resolved: resolved !== false });
    return { updated: true as const, repo: id, number: num, openNotes: detail?.pull?.open_notes ?? 0 };
  }

  async prMerge({ repo = '', number: n, strategy = 'merge', message = '', deleteSource = false }: { repo?: string; number?: number | string; strategy?: string; message?: string; deleteSource?: boolean } = {}) {
    const num = whole(n, 'pull request number');
    if (!MERGE_STRATEGIES.includes(strategy)) throw new Error(`Strategy must be one of: ${MERGE_STRATEGIES.join(', ')}.`);
    const id = await this.repoId(repo);
    const res = await this.call<{ sha?: string } | null>('merge_pull', {
      repo: id, number: num, strategy,
      ...(message ? { message: String(message).trim().slice(0, 2000) } : {}),
      delete_source: deleteSource === true,
    });
    return { merged: true as const, repo: id, number: num, strategy, sha: res?.sha || '' };
  }

  async runStart({ repo = '', workflow, branch }: { repo?: string; workflow?: string; branch?: string } = {}) {
    const wf = words(workflow, 'workflow file or name', 200), br = checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    const res = await this.call<{ run: RawRun }>('dispatch_run', { repo: id, workflow: wf, branch: br });
    return { started: true as const, ...summarizeRun(res.run) };
  }

  async runRerun({ repo = '', id: runId }: { repo?: string; id?: number | string } = {}) {
    const num = whole(runId, 'run id');
    const repoId = await this.repoId(repo);
    const res = await this.call<{ run: RawRun }>('rerun_run', { repo: repoId, id: num });
    return { rerun: true as const, ...summarizeRun(res.run) };
  }

  async runCancel({ repo = '', id: runId }: { repo?: string; id?: number | string } = {}) {
    const num = whole(runId, 'run id');
    const repoId = await this.repoId(repo);
    const res = await this.call<{ run: RawRun }>('cancel_run', { repo: repoId, id: num });
    return { cancelledRun: true as const, ...summarizeRun(res.run) };
  }

  async jobApprove({ repo = '', job, approve = true }: { repo?: string; job?: number | string; approve?: boolean } = {}) {
    const jobId = whole(job, 'job id');
    const repoId = await this.repoId(repo);
    const res = await this.call<{ run: RawRun }>('approve_job', { repo: repoId, job: jobId, approve: approve !== false });
    return { approved: approve !== false, ...summarizeRun(res.run) };
  }

  async mirrorNow({ repo = '' }: { repo?: string } = {}) {
    const id = await this.repoId(repo);
    const mirrors = await this.call<RawMirror[]>('mirror_now', { repo: id });
    return { mirrored: true as const, repo: id, mirror: (Array.isArray(mirrors) ? mirrors : []).find(m => m.repo === id) || null };
  }

  async setRule({ repo = '', pattern, requirePull = false, blockForce = false, blockDelete = false, requiredChecks = [] }: { repo?: string; pattern?: string; requirePull?: boolean; blockForce?: boolean; blockDelete?: boolean; requiredChecks?: unknown[] } = {}) {
    const cleanPattern = words(pattern, 'branch pattern', 120);
    const id = await this.repoId(repo);
    const rules = await this.call<unknown[]>('set_branch_rule', {
      repo: id,
      rule: {
        pattern: cleanPattern,
        require_pull: Boolean(requirePull),
        block_force: Boolean(blockForce),
        block_delete: Boolean(blockDelete),
        required_checks: Array.isArray(requiredChecks) ? requiredChecks.slice(0, 20).map(c => String(c).slice(0, 120)) : [],
      },
    });
    return { updated: true as const, repo: id, rules };
  }

  async deleteRule({ repo = '', pattern }: { repo?: string; pattern?: string } = {}) {
    const cleanPattern = words(pattern, 'branch pattern', 120);
    const id = await this.repoId(repo);
    const rules = await this.call<unknown[]>('delete_branch_rule', { repo: id, pattern: cleanPattern });
    return { deleted: true as const, repo: id, rules };
  }

  async createHosted({ name, description = '' }: { name?: string; description?: string } = {}) {
    if (typeof name !== 'string') throw new Error('Use letters, numbers, dashes, dots or underscores for the repository name.');
    const cleanName = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(cleanName)) throw new Error('Use letters, numbers, dashes, dots or underscores for the repository name.');
    const created = await this.call<RawCreatedHosted>('create_hosted', { name: cleanName, ...(description ? { description: String(description).trim().slice(0, 300) } : {}) });
    this._repos = null;
    const ctx = await this.context();
    return { created: true as const, ...created, cloneUrl: ctx?.host ? `ssh://${ctx.host}${created.path}` : created.path };
  }

  async backupNow() {
    const res = await this.call<{ output?: string } | null>('backup');
    return { backedUp: true as const, path: res?.output || '' };
  }
}
