import { execFile } from 'node:child_process';
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
const MERGE_STRATEGIES = Object.freeze(['merge', 'squash', 'rebase', 'fast_forward']);
const PYTHON_SOCKET_BRIDGE = "python3 -c \"import os,sys,socket; s=socket.socket(socket.AF_UNIX); s.connect(os.path.expanduser('~/.neutrino/neutrinod.sock')); s.sendall(sys.stdin.readline().encode()); print(s.makefile().readline(), end='')\"";

const clip = (text, limit) => { const value = String(text ?? ''); return value.length > limit ? { text: value.slice(0, limit), truncated: true } : { text: value, truncated: false }; };
const tail = (text, limit) => { const value = String(text ?? ''); return value.length > limit ? { text: value.slice(-limit), truncated: true } : { text: value, truncated: false }; };
const stripAnsi = text => String(text ?? '').replace(/\u001b\[[0-9;]*m/g, '');
const count = (value, fallback, most = LIMITS.list) => Math.min(most, Math.max(1, Math.floor(Number(value)) || fallback));
const whole = (value, what = 'number') => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error(`Give the ${what} as a whole number.`); return n; };
const words = (value, what, limit = 65000) => { const text = String(value ?? '').trim(); if (!text) throw new Error(`Write the ${what} first.`); if (text.length > limit) throw new Error(`The ${what} is too long.`); return text; };
const toIso = secs => (typeof secs === 'number' && Number.isFinite(secs) && secs > 0 ? new Date(secs * 1000).toISOString() : null);

function checkPath(value, what = 'file path') {
  if (typeof value !== 'string') throw new Error(`Give a valid relative ${what}.`);
  const path = value.trim();
  if (!path || path.startsWith('-') || path.length > 1024 || path.includes('\0') || path.includes('\\') || isAbsolute(path) || path.split('/').includes('..')) {
    throw new Error(`Give a valid relative ${what}.`);
  }
  return path;
}

function checkRef(value, what = 'branch') {
  if (typeof value !== 'string') throw new Error(`That isn’t a valid ${what}.`);
  const ref = value.trim();
  if (!REF.test(ref)) throw new Error(`That isn’t a valid ${what}.`);
  return ref;
}

export function defaultSocketPath() {
  return process.env.NEUTRINO_SOCKET || join(homedir(), '.neutrino', 'neutrinod.sock');
}

// Parses ssh://[user@]host[:port]/path or [user@]host:/path remotes pointing at a Neutrino bare repository.
export function neutrinoRemoteInfo(url = '') {
  const raw = String(url || '').trim();
  if (!raw || /github\.com/i.test(raw)) return null;
  let host = '', port = null, path = '';
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

function gitRead(cwd, args) {
  return new Promise(resolve => {
    execFile('git', [...SAFE, ...args], { cwd: cwd || homedir(), env: { ...process.env, PATH: commandPath(), GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' }, timeout: 5000, encoding: 'utf8' }, (error, stdout) => {
      resolve(error ? '' : String(stdout || '').trim());
    });
  });
}

export function socketRequest(socketPath, payload, { timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.destroy(); } catch {}
      error ? reject(error) : resolve(value);
    };
    const socket = createConnection(socketPath);
    let buffer = '';
    const timer = setTimeout(() => done(new Error('Neutrino timed out waiting for neutrinod.')), timeout);
    socket.on('error', error => done(Object.assign(new Error(error.code === 'ENOENT' || error.code === 'ECONNREFUSED' ? 'Neutrino isn’t running on this Mac.' : error.message), { code: error.code, missing: error.code === 'ENOENT' })));
    socket.on('connect', () => { socket.write(`${JSON.stringify({ id: 1, ...payload })}\n`); });
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try { done(null, JSON.parse(buffer.slice(0, nl))); }
      catch { done(new Error('Neutrino returned unreadable JSON.')); }
    });
    socket.on('end', () => {
      if (settled) return;
      if (!buffer.trim()) done(new Error('Neutrino closed the connection before answering.'));
      else {
        try { done(null, JSON.parse(buffer.trim())); }
        catch { done(new Error('Neutrino returned unreadable JSON.')); }
      }
    });
  });
}

export function sshSocketRequest({ host, port = null }, payload, { timeout = 45000, exec = execFile } = {}) {
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
      try { resolve(JSON.parse(line)); }
      catch { reject(new Error(`Neutrino on ${host} returned unreadable JSON.`)); }
    });
    child.stdin?.end(`${JSON.stringify({ id: 1, ...payload })}\n`);
  });
}

export function neutrinoRunner({ cwd = null, socketPath = defaultSocketPath(), server = '' } = {}) {
  let localRole = null;
  let serverTarget = server ? { host: server, port: null } : null;

  async function detectRole() {
    try {
      const resp = await socketRequest(socketPath, { method: 'engine_info' }, { timeout: 2500 });
      if (resp?.type === 'engine' && resp.data?.role) localRole = resp.data.role;
    } catch {
      localRole = null;
    }
    return localRole;
  }

  async function resolveServer() {
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

  async function call(method, params = undefined, { scope = 'server', timeout = 45000 } = {}) {
    const payload = params === undefined ? { method } : { method, params };
    const role = localRole || await detectRole();
    let raw;
    if (scope === 'local' || role === 'server') {
      raw = await socketRequest(socketPath, payload, { timeout });
    } else {
      const target = await resolveServer();
      raw = await sshSocketRequest(target, payload, { timeout });
    }
    if (raw?.type === 'error') throw new Error(raw.data?.message || 'Neutrino returned an error.');
    return raw?.data;
  }

  call.context = async () => ({
    role: localRole || await detectRole(),
    host: (await resolveServer().catch(() => null))?.host || null,
  });
  return call;
}

export function formatFileDiff(diff) {
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

function summarizePull(raw, host = '') {
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

function summarizeRun(raw) {
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

export async function cloneInto({ neutrino, repo, parent, originOf, exists = existsSync, gitClone = null }) {
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
  const clone = gitClone || ((from, into) => new Promise((resolve, reject) => {
    execFile('git', ['clone', '--quiet', from, into], { env: { ...process.env, PATH: commandPath(), GIT_TERMINAL_PROMPT: '0' }, timeout: 15 * 60 * 1000, encoding: 'utf8' }, (error, _stdout, stderr) => {
      if (error) reject(new Error(String(stderr || error.message).trim().slice(0, 500)));
      else resolve();
    });
  }));
  await clone(url, destination);
  return { folder: destination, cloned: true, repo: targetRepo.id };
}

export class Neutrino {
  constructor({ call = null, cwd = null, socketPath = defaultSocketPath(), server = '' } = {}) {
    this.cwd = cwd;
    this.call = call || neutrinoRunner({ cwd, socketPath, server });
    this._repos = null;
    this._context = null;
  }

  async context() {
    if (this._context) return this._context;
    this._context = typeof this.call.context === 'function' ? await this.call.context() : { role: 'server', host: null };
    return this._context;
  }

  cloneUrl(repo) {
    const host = this._context?.host;
    return host ? `ssh://${host}${repo.path}` : repo.path;
  }

  async serverRepos(refresh = false) {
    if (!this._repos || refresh) this._repos = await this.call('list_repos');
    return Array.isArray(this._repos) ? this._repos : [];
  }

  async repoId(repo = '') {
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
  async engineInfo({ local = false } = {}) {
    return this.call('engine_info', undefined, local ? { scope: 'local' } : undefined);
  }

  async ciInfo() {
    return this.call('ci_info');
  }

  async status() {
    const [engine, ci, inbox, mirrors] = await Promise.all([
      this.engineInfo().catch(() => null),
      this.ciInfo().catch(() => null),
      this.inbox({ limit: 30 }).catch(() => null),
      this.mirrors().catch(() => ({ mirrors: [] })),
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

  async repos({ kind = 'server', query = '', limit = 100 } = {}) {
    if (!['server', 'workstation'].includes(kind)) throw new Error('Choose server or workstation repositories.');
    const [ctx, list, mirrors] = await Promise.all([
      this.context(),
      kind === 'workstation' ? this.call('list_repos', undefined, { scope: 'local' }) : this.serverRepos(true),
      kind === 'server' ? this.call('mirrors').catch(() => []) : Promise.resolve([]),
    ]);
    const mirrorByRepo = new Map((Array.isArray(mirrors) ? mirrors : []).map(m => [m.repo, m]));
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

  async repoOverview({ repo = '' } = {}) {
    const id = await this.repoId(repo);
    const list = await this.serverRepos();
    const meta = list.find(r => r.id === id) || { id, name: id, path: '' };
    const [overview, branches, pulls, runs, rules, environments, mirrors] = await Promise.all([
      this.call('overview', { repo: id }).catch(() => null),
      this.call('branches', { repo: id }).catch(() => []),
      this.call('list_pulls', { repo: id }).catch(() => []),
      this.call('list_runs', { repo: id, limit: 15 }).catch(() => []),
      this.call('branch_rules', { repo: id }).catch(() => []),
      this.call('list_environments', { repo: id }).catch(() => []),
      this.call('mirrors').catch(() => []),
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

  async branches({ repo = '' } = {}) {
    const id = await this.repoId(repo);
    return { repo: id, branches: await this.call('branches', { repo: id }) };
  }

  async commits({ repo = '', branch = '', skip = 0, limit = 50, query = '' } = {}) {
    if (branch) checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    const page = await this.call('log', { repo: id, rev: branch || null, all: false, skip: Math.max(0, Math.floor(Number(skip)) || 0), limit: count(limit, 50, 100), query: query ? String(query).slice(0, 200) : null });
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

  async commitDetail({ repo = '', sha } = {}) {
    if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('That isn’t a commit SHA.');
    const id = await this.repoId(repo);
    const raw = await this.call('commit', { repo: id, sha });
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

  async commitFileDiff({ repo = '', sha, path, context = 3 } = {}) {
    if (typeof sha !== 'string' || !SHA.test(sha)) throw new Error('That isn’t a commit SHA.');
    const cleanPath = checkPath(path);
    const id = await this.repoId(repo);
    return formatFileDiff(await this.call('file_diff', { repo: id, sha, path: cleanPath, context }));
  }

  async inbox({ limit = 30 } = {}) {
    const per = count(limit, 30, 80);
    const [ctx, raw] = await Promise.all([this.context(), this.call('inbox')]);
    const latestByPull = new Map();
    for (const run of raw?.runs || []) {
      if (!run.pull) continue;
      const key = `${run.repo}#${run.pull}`;
      if (!latestByPull.has(key)) latestByPull.set(key, run);
    }
    const pullChecks = p => {
      const r = latestByPull.get(`${p.repo}#${p.number}`);
      if (!r) return '';
      if (r.state === 'success') return 'passing';
      if (r.state === 'failure' || r.state === 'cancelled') return 'failing';
      if (r.state === 'running' || r.state === 'queued' || r.state === 'waiting') return 'running';
      return r.state;
    };
    const mapPull = p => ({ ...summarizePull(p, ctx?.host || ''), checks: pullChecks(p) });
    return {
      host: ctx?.host || null,
      waiting: (raw?.waiting || []).slice(0, per).map(w => ({ ...w, sinceIso: toIso(w.since) })),
      ready: (raw?.ready || []).slice(0, per).map(mapPull),
      open: (raw?.open || []).slice(0, per).map(mapPull),
      runs: (raw?.runs || []).slice(0, per).map(summarizeRun),
      events: (raw?.events || []).slice(0, per).map(e => ({ ...e, atIso: toIso(e.at) })),
    };
  }

  async prs({ repo = '', state = 'open', limit = 30 } = {}) {
    if (!['open', 'closed', 'merged', 'all'].includes(state)) throw new Error('Choose open, closed, merged, or all.');
    const id = await this.repoId(repo);
    const list = await this.call('list_pulls', { repo: id });
    const filtered = (Array.isArray(list) ? list : [])
      .filter(p => state === 'all' || p.state === state)
      .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0))
      .slice(0, count(limit, 30, 100));
    return { repo: id, prs: filtered.map(p => summarizePull(p)) };
  }

  async pr({ repo = '', number: n } = {}) {
    const num = whole(n, 'pull request number');
    const id = await this.repoId(repo);
    const d = await this.call('pull', { repo: id, number: num });
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

  async prDiff({ repo = '', number: n, path = '' } = {}) {
    const num = whole(n, 'pull request number');
    const cleanPath = path === '' || path === undefined ? '' : checkPath(path);
    const id = await this.repoId(repo);
    const detail = await this.call('pull', { repo: id, number: num });
    const base = detail.versions?.at(-1)?.base_sha || detail.pull?.target;
    const head = detail.pull?.head_sha || detail.pull?.source;
    if (cleanPath) {
      const diff = await this.call('compare_diff', { repo: id, base, head, path: cleanPath });
      return clip(formatFileDiff(diff), LIMITS.diff);
    }
    const files = (detail.files || []).filter(f => !f.binary).slice(0, 20);
    const parts = [];
    for (let i = 0; i < files.length; i += 5) {
      const batch = await Promise.all(files.slice(i, i + 5).map(f => this.call('compare_diff', { repo: id, base, head, path: f.path }).catch(() => null)));
      for (const item of batch) if (item) parts.push(formatFileDiff(item));
    }
    return clip(parts.join('\n\n'), LIMITS.diff);
  }

  async runs({ repo = '', pull = null, branch = '', limit = 20 } = {}) {
    const pNum = pull != null && pull !== '' ? whole(pull, 'pull request number') : null;
    if (branch) checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    const list = await this.call('list_runs', { repo: id, pull: pNum, limit: count(limit, 20, 60) });
    const b = String(branch || '').trim();
    const runs = (Array.isArray(list) ? list : []).filter(r => !b || r.branch === b).map(summarizeRun);
    return { repo: id, runs };
  }

  async run({ repo = '', id: runId } = {}) {
    const num = whole(runId, 'run id');
    const repoId = await this.repoId(repo);
    const detail = await this.call('run', { repo: repoId, id: num });
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

  async ciLog({ repo = '', run: runId, job = null } = {}) {
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
      const chunk = await this.call('job_log', { repo: repoId, job: jobId, offset });
      if (chunk?.text) text += chunk.text;
      if (text.length > LIMITS.log * 3) text = text.slice(-LIMITS.log * 2);
      if (!chunk || chunk.done || chunk.next === offset) break;
      offset = chunk.next;
    }
    const kept = tail(stripAnsi(text), LIMITS.log);
    return { repo: repoId, run: id, job: jobId, ...(jobName ? { jobName } : {}), ...(state ? { state } : {}), log: kept.text, truncated: kept.truncated };
  }

  async workflows({ repo = '', branch = 'main' } = {}) {
    const ref = checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    return { repo: id, branch: ref, workflows: await this.call('workflows', { repo: id, branch: ref }) };
  }

  async artifacts({ repo = '', run: runId } = {}) {
    const num = whole(runId, 'run id');
    const id = await this.repoId(repo);
    return { repo: id, run: num, artifacts: await this.call('list_artifacts', { repo: id, run: num }) };
  }

  async mirrors() {
    const list = await this.call('mirrors');
    return {
      mirrors: (Array.isArray(list) ? list : []).map(m => ({
        repo: m.repo, url: m.url, state: m.state, lastOk: toIso(m.last_ok), lastAttempt: toIso(m.last_attempt),
        lastError: m.last_error || null, mirrorOnly: m.mirror_only || [],
      })),
    };
  }

  async rules({ repo = '' } = {}) {
    const id = await this.repoId(repo);
    const [rules, overrides] = await Promise.all([
      this.call('branch_rules', { repo: id }),
      this.call('overrides', { repo: id }).catch(() => []),
    ]);
    return { repo: id, rules: rules || [], overrides: (overrides || []).map(o => ({ ...o, atIso: toIso(o.at) })) };
  }

  async environments({ repo = '' } = {}) {
    const id = await this.repoId(repo);
    return { repo: id, environments: await this.call('list_environments', { repo: id }) };
  }

  // Only ever returns secret names and scopes — Neutrino Vault has no API to read secret values.
  async secrets({ repo = '', environment = '' } = {}) {
    if (environment != null && environment !== '' && (typeof environment !== 'string' || !REF.test(environment))) throw new Error('That isn’t a valid environment name.');
    const scope = { ...(repo ? { repo: await this.repoId(repo) } : {}), ...(environment ? { environment: environment.slice(0, 120) } : {}) };
    const list = await this.call('list_secrets', { scope });
    return { secrets: (Array.isArray(list) ? list : []).map(s => ({ name: s.name, scope: s.scope, updatedAt: toIso(s.updated_at) })) };
  }

  async variables({ repo = '', environment = '' } = {}) {
    if (environment != null && environment !== '' && (typeof environment !== 'string' || !REF.test(environment))) throw new Error('That isn’t a valid environment name.');
    const scope = { ...(repo ? { repo: await this.repoId(repo) } : {}), ...(environment ? { environment: environment.slice(0, 120) } : {}) };
    const list = await this.call('list_variables', { scope });
    return { variables: (Array.isArray(list) ? list : []).map(v => ({ name: v.name, value: v.value, scope: v.scope, updatedAt: toIso(v.updated_at) })) };
  }

  async backups({ local = false } = {}) {
    const data = await this.call('list_backups', undefined, local ? { scope: 'local' } : undefined);
    return { ...data, files: (data?.files || []).map(f => ({ ...f, modifiedIso: toIso(f.modified) })) };
  }

  /* ── essential tasks / writes (approval-gated) ── */
  async prCreate({ repo = '', title, body = '', source = '', target = '' } = {}) {
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
    const detail = await this.call('create_pull', { repo: id, title: cleanTitle, body: String(body || '').slice(0, 65000), source: src, target: dst });
    return { created: true, ...summarizePull(detail.pull) };
  }

  async prUpdate({ repo = '', number: n, title, body, state } = {}) {
    const num = whole(n, 'pull request number');
    if (state !== undefined && !['open', 'closed'].includes(state)) throw new Error('State must be open or closed.');
    const cleanTitle = title !== undefined ? words(title, 'title', 256) : undefined;
    const id = await this.repoId(repo);
    const detail = await this.call('update_pull', {
      repo: id, number: num,
      ...(cleanTitle !== undefined ? { title: cleanTitle } : {}),
      ...(body !== undefined ? { body: String(body).slice(0, 65000) } : {}),
      ...(state !== undefined ? { state } : {}),
    });
    return { updated: true, ...summarizePull(detail.pull) };
  }

  async prNote({ repo = '', number: n, path, side = 'new', line, text } = {}) {
    const num = whole(n, 'pull request number');
    if (!['old', 'new'].includes(side)) throw new Error('Side must be new or old.');
    const cleanPath = checkPath(path), lineNum = whole(line, 'line number'), noteText = words(text, 'note');
    const id = await this.repoId(repo);
    const detail = await this.call('add_note', { repo: id, number: num, path: cleanPath, side, line: lineNum, text: noteText });
    return { posted: true, repo: id, number: num, notes: (detail?.notes || []).length };
  }

  async prResolveNote({ repo = '', number: n, note, resolved = true } = {}) {
    const num = whole(n, 'pull request number'), noteId = whole(note, 'note id');
    const id = await this.repoId(repo);
    const detail = await this.call('resolve_note', { repo: id, number: num, note: noteId, resolved: resolved !== false });
    return { updated: true, repo: id, number: num, openNotes: detail?.pull?.open_notes ?? 0 };
  }

  async prMerge({ repo = '', number: n, strategy = 'merge', message = '', deleteSource = false } = {}) {
    const num = whole(n, 'pull request number');
    if (!MERGE_STRATEGIES.includes(strategy)) throw new Error(`Strategy must be one of: ${MERGE_STRATEGIES.join(', ')}.`);
    const id = await this.repoId(repo);
    const res = await this.call('merge_pull', {
      repo: id, number: num, strategy,
      ...(message ? { message: String(message).trim().slice(0, 2000) } : {}),
      delete_source: deleteSource === true,
    });
    return { merged: true, repo: id, number: num, strategy, sha: res?.sha || '' };
  }

  async runStart({ repo = '', workflow, branch } = {}) {
    const wf = words(workflow, 'workflow file or name', 200), br = checkRef(branch, 'branch');
    const id = await this.repoId(repo);
    const res = await this.call('dispatch_run', { repo: id, workflow: wf, branch: br });
    return { started: true, ...summarizeRun(res.run) };
  }

  async runRerun({ repo = '', id: runId } = {}) {
    const num = whole(runId, 'run id');
    const repoId = await this.repoId(repo);
    const res = await this.call('rerun_run', { repo: repoId, id: num });
    return { rerun: true, ...summarizeRun(res.run) };
  }

  async runCancel({ repo = '', id: runId } = {}) {
    const num = whole(runId, 'run id');
    const repoId = await this.repoId(repo);
    const res = await this.call('cancel_run', { repo: repoId, id: num });
    return { cancelledRun: true, ...summarizeRun(res.run) };
  }

  async jobApprove({ repo = '', job, approve = true } = {}) {
    const jobId = whole(job, 'job id');
    const repoId = await this.repoId(repo);
    const res = await this.call('approve_job', { repo: repoId, job: jobId, approve: approve !== false });
    return { approved: approve !== false, ...summarizeRun(res.run) };
  }

  async mirrorNow({ repo = '' } = {}) {
    const id = await this.repoId(repo);
    const mirrors = await this.call('mirror_now', { repo: id });
    return { mirrored: true, repo: id, mirror: (Array.isArray(mirrors) ? mirrors : []).find(m => m.repo === id) || null };
  }

  async setRule({ repo = '', pattern, requirePull = false, blockForce = false, blockDelete = false, requiredChecks = [] } = {}) {
    const cleanPattern = words(pattern, 'branch pattern', 120);
    const id = await this.repoId(repo);
    const rules = await this.call('set_branch_rule', {
      repo: id,
      rule: {
        pattern: cleanPattern,
        require_pull: Boolean(requirePull),
        block_force: Boolean(blockForce),
        block_delete: Boolean(blockDelete),
        required_checks: Array.isArray(requiredChecks) ? requiredChecks.slice(0, 20).map(c => String(c).slice(0, 120)) : [],
      },
    });
    return { updated: true, repo: id, rules };
  }

  async deleteRule({ repo = '', pattern } = {}) {
    const cleanPattern = words(pattern, 'branch pattern', 120);
    const id = await this.repoId(repo);
    const rules = await this.call('delete_branch_rule', { repo: id, pattern: cleanPattern });
    return { deleted: true, repo: id, rules };
  }

  async createHosted({ name, description = '' } = {}) {
    if (typeof name !== 'string') throw new Error('Use letters, numbers, dashes, dots or underscores for the repository name.');
    const cleanName = name.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(cleanName)) throw new Error('Use letters, numbers, dashes, dots or underscores for the repository name.');
    const created = await this.call('create_hosted', { name: cleanName, ...(description ? { description: String(description).trim().slice(0, 300) } : {}) });
    this._repos = null;
    const ctx = await this.context();
    return { created: true, ...created, cloneUrl: ctx?.host ? `ssh://${ctx.host}${created.path}` : created.path };
  }

  async backupNow() {
    const res = await this.call('backup');
    return { backedUp: true, path: res?.output || '' };
  }
}
