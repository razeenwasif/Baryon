// A saved eval task's world (docs/evals-from-sessions.md): a repository as it was when a request was made, rebuilt in
// a folder of its own. Used by the eval runner (evals/runner.mjs) and by Fairy when she checks a task before saving it.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

export interface GitWorldUntrackedFile {
  path: string;
  data: string;
}

export interface GitWorldSpec {
  repo: string;
  commit: string;
  patch?: string;
  untracked?: readonly GitWorldUntrackedFile[];
  dependencies?: boolean;
}

export interface GitWorldOptions {
  base: string;
  name?: string;
}

export interface FolderTreeOptions {
  repo?: boolean;
}

// The repository as it was when the request was made. A shared clone, which
// reads the repository's objects and never writes to it, checked out at the saved commit with no remote, then the
// changes that weren't committed then applied, and the dependencies git ignores copied in as own-branch sessions do.
const execGit = (cwd: string, args: readonly string[]): Promise<string> => new Promise((done, fail) => execFile('git', args, { cwd, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
  (error, stdout, stderr) => (error ? fail(new Error(String(stderr || error.message).trim().split('\n').slice(-3).join(' '))) : done(stdout))));
export async function gitWorld({ repo, commit, patch, untracked = [], dependencies = true }: GitWorldSpec, { base, name = 'Project' }: GitWorldOptions): Promise<string> {
  try { await execGit(repo, ['cat-file', '-e', `${commit}^{commit}`]); }
  catch { throw new Error(`The commit ${String(commit).slice(0, 10)} isn’t in ${repo} any more, so this saved task can’t start where it did.`); }
  const root = join(base, name);
  await execGit(base, ['clone', '--quiet', '--shared', '--no-checkout', repo, root]);
  await execGit(root, ['checkout', '--quiet', '--detach', commit]);
  await execGit(root, ['remote', 'remove', 'origin']).catch(() => {});
  if (patch) {
    const file = join(base, 'start.patch');
    await writeFile(file, Buffer.from(patch, 'base64'));
    await execGit(root, ['apply', '--binary', '--whitespace=nowarn', file]);
    await rm(file, { force: true });
  }
  for (const { path, data } of untracked) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), Buffer.from(data, 'base64')); }
  if (dependencies) {
    const { copyIgnored } = await import('./work-helpers.mjs'), { ignoredPaths } = await import('./git-tools.mjs');
    await copyIgnored({ from: repo, to: root, ignored: await ignoredPaths(repo) }).catch(() => {});
  }
  return root;
}

// What a folder holds, path by path. A real repository (a saved task's world) leaves out .git and dependency folders,
// and a file over 2 MB stands as its size and hash rather than its text.
const SKIP_IN_REPO = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build', '.next', '.cache', '.DS_Store']);
export async function folderTree(root: string, { repo = false }: FolderTreeOptions = {}): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (repo && SKIP_IN_REPO.has(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) { await walk(path); continue; }
      if (!entry.isFile()) continue;
      if (repo && (await stat(path)).size > 2 * 1024 * 1024) { const data = await readFile(path); found[relative(root, path)] = `<${data.length} bytes, sha256 ${createHash('sha256').update(data).digest('hex')}>`; continue; }
      found[relative(root, path)] = await readFile(path, 'utf8');
    }
  };
  await walk(root);
  return found;
}
