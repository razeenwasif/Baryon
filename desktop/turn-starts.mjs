// Where each work turn started (docs/evals-from-sessions.md, stage 1): the folder's commit, and the changes not yet
// committed then, so a request can later be saved as an eval task that starts from exactly the same place. Taken before
// the turn's first step with a few git commands, no model call. Kept in Fairy's own data folder, one small file per
// turn (turn-starts/<session>/<turn>.json), never in the project; pruned after 90 days.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

function hasGitDir(root) {
  let dir = root;
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export const MAX_PATCH = 5 * 1024 * 1024, MAX_UNTRACKED_FILE = 1024 * 1024, KEEP_DAYS = 90, MAX_KEPT = 4000;
const SESSION = /^[A-Za-z0-9_-]{1,80}$/;
const git = (root, args, { maxBuffer = MAX_PATCH * 2 } = {}) => new Promise(done => execFile('git', ['-C', root, ...args], { timeout: 20000, maxBuffer, encoding: 'buffer',
  env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin', GIT_TERMINAL_PROMPT: '0', LANG: 'en_US.UTF-8', GIT_OPTIONAL_LOCKS: '0' } },
  (error, stdout) => done(error ? null : stdout)));

// The folder as it is now: { git: false } outside git; else its commit (null before the first one), branch, and the
// uncommitted changes as a binary patch against HEAD plus each untracked file. Too much to keep (over 5 MB, or an
// untracked file over 1 MB) is said, not kept: an eval can still start from the commit alone.
export async function startState(root, { run = git } = {}) {
  if (run === git && !hasGitDir(root)) return { git: false };
  const inside = (await run(root, ['rev-parse', '--is-inside-work-tree']))?.toString().trim();
  if (inside !== 'true') return { git: false };
  const commit = (await run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']))?.toString().trim() || null;
  const branch = (await run(root, ['rev-parse', '--abbrev-ref', 'HEAD']))?.toString().trim();
  const top = (await run(root, ['rev-parse', '--show-toplevel']))?.toString().trim() || root;
  const state = { git: true, commit: commit && /^[0-9a-f]{40,64}$/.test(commit) ? commit : null, ...(branch && branch !== 'HEAD' ? { branch } : {}), top };
  if (!state.commit) return { ...state, dirty: true, kept: false, why: 'The folder has no commit yet.' };
  const patch = await run(root, ['diff', '--binary', 'HEAD']);
  const others = (await run(root, ['ls-files', '--others', '--exclude-standard', '-z', '--full-name']))?.toString().split('\0').filter(Boolean) ?? [];
  if (patch === null) return { ...state, dirty: true, kept: false, why: 'git couldn’t say what was uncommitted.' };
  let size = patch.length, why = '';
  const untracked = [];
  for (const path of others) {
    let info;
    try { info = await stat(join(top, path)); } catch { continue; }
    if (!info.isFile()) continue;
    if (info.size > MAX_UNTRACKED_FILE) { why = `${path} is over 1 MB.`; break; }
    size += info.size;
    if (size > MAX_PATCH) break;
    untracked.push({ path, data: (await readFile(join(top, path))).toString('base64') });
  }
  if (size > MAX_PATCH) why ||= 'The uncommitted changes come to over 5 MB.';
  const dirty = patch.length > 0 || others.length > 0;
  if (why) return { ...state, dirty, kept: false, why, size };
  return { ...state, dirty, kept: true, size, ...(patch.length ? { patch: patch.toString('base64') } : {}), ...(untracked.length ? { untracked } : {}) };
}

export class TurnStarts {
  constructor({ dir, now = () => Date.now(), take = startState }) { Object.assign(this, { dir, now, take }); this.writes = 0; }
  path(session, at) {
    const stamp = Date.parse(at);
    if (!SESSION.test(String(session)) || !Number.isFinite(stamp)) throw new Error('That isn’t a turn.');
    return join(this.dir, String(session), `${stamp}.json`);
  }
  // Takes and keeps where a turn started. Never fails the turn: a problem is kept as the reason.
  async record({ session, at, root }) {
    let state;
    try { state = await this.take(root); } catch (error) { state = { git: false, why: String(error?.message || error).slice(0, 200) }; }
    const entry = { at, root, taken: new Date(this.now()).toISOString(), ...state };
    const path = this.path(session, at);
    await mkdir(join(this.dir, String(session)), { recursive: true, mode: 0o700 });
    await writeFile(`${path}.tmp`, JSON.stringify(entry), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
    if (++this.writes % 50 === 1) await this.prune().catch(() => {});
    const { patch, untracked, ...summary } = entry;
    return { ...summary, untracked: untracked?.length || 0 };
  }
  async get(session, at) {
    try { return JSON.parse(await readFile(this.path(session, at), 'utf8')); } catch { return null; }
  }
  // Older than 90 days goes, and past 4,000 turns the oldest go.
  async prune() {
    const files = [];
    for (const session of await readdir(this.dir).catch(() => [])) {
      if (!SESSION.test(session)) continue;
      for (const name of await readdir(join(this.dir, session)).catch(() => [])) {
        const stamp = Number(name.replace(/\.json$/, ''));
        if (/^\d+\.json$/.test(name)) files.push({ path: join(this.dir, session, name), stamp });
      }
    }
    files.sort((a, b) => b.stamp - a.stamp);
    const cutoff = this.now() - KEEP_DAYS * 86400000;
    const gone = files.filter((f, i) => f.stamp < cutoff || i >= MAX_KEPT);
    for (const f of gone) await rm(f.path, { force: true });
    return gone.length;
  }
}
