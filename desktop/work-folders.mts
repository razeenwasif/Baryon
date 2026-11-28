// Discovers Git project repositories across common workspace roots and validates work session folders
// safely against home/system/settings/secrets constraints.
import { existsSync, readdirSync, realpathSync, statSync, type Dirent, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { checkWorkFolder } from './work-sandbox.mjs';

export const DEFAULT_REPO_ROOTS = Object.freeze(['Github', 'Projects', 'Code', 'Developer']);
export const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'target', 'DerivedData', 'Pods',
  'venv', '__pycache__', 'release', 'out', 'vendor',
]);
const FORBIDDEN_TOP_DIRS = new Set(['.ssh', '.gnupg', '.aws', '.gemini', '.claude', '.codex', '.config', 'Library']);
const ICLOUD_DOCS_PREFIX = `Library${sep}Mobile Documents${sep}com~apple~CloudDocs`;

export interface DiscoveredRepo {
  path: string;
  name: string;
  group: string;
  repo: boolean;
  source: string;
}

export interface DiscoverGitReposOptions {
  home?: string;
  roots?: readonly string[];
  maxDepth?: number;
  maxRepos?: number;
  dataDir?: string;
}

export interface WorkSessionSummary {
  id: string;
  work?: unknown;
  updatedAt?: string;
}

export interface WorkFolderEntry {
  path: string;
  name: string;
  group?: string;
  recent?: boolean;
  repo?: boolean;
  default?: boolean;
  source: string;
}

export interface CollectWorkFoldersOptions {
  defaultFolder?: string;
  sessions?: readonly WorkSessionSummary[];
  resolveFolder?: (sessionId: string) => string | null | undefined;
  home?: string;
  dataDir?: string;
  discoverRepos?: (() => readonly Partial<DiscoveredRepo>[]) | null;
  recentLimit?: number;
  repoLimit?: number;
}

export interface LocalWorkDirEntry {
  name: string;
  path: string;
  isRepo: boolean;
}

export interface LocalWorkDirListing {
  ok: true;
  host: string;
  via: string;
  home: string;
  path: string;
  parent: string | null;
  canWorkHere: boolean;
  isRepo: boolean;
  entries: LocalWorkDirEntry[];
}

export interface ListLocalWorkDirOptions {
  home?: string;
  dataDir?: string;
  showHidden?: boolean;
}

const realOrSelf = (p: string): string => { try { return realpathSync(p); } catch { return p; } };

function cleanRelGroup(ownHome: string, folder: string): string {
  const rel = relative(ownHome, dirname(folder));
  if (!rel || rel === '.' || rel.startsWith('..') || isAbsolute(rel)) return '';
  return rel;
}

// Walks each root up to `maxDepth` levels deep (depth 1 = ~/Github/Photon, depth 2 = ~/Github/Applications/flux).
export function discoverGitRepos({
  home = homedir(),
  roots = DEFAULT_REPO_ROOTS,
  maxDepth = 3,
  maxRepos = 250,
  dataDir = '',
}: DiscoverGitReposOptions = {}): DiscoveredRepo[] {
  const ownHome = realOrSelf(home);
  const seen = new Set<string>();
  const repos: DiscoveredRepo[] = [];

  const visit = (dir: string, depth: number): void => {
    if (repos.length >= maxRepos || depth > maxDepth) return;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (repos.length >= maxRepos) break;
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const { name } = entry;
      if (!name || name.startsWith('.') || name.endsWith('.git') || SKIP_DIRS.has(name)) continue;

      const full = join(dir, name);
      if (existsSync(join(full, '.git'))) {
        try {
          const canonical = checkWorkFolder(full, { home: ownHome, dataDir });
          if (!seen.has(canonical)) {
            seen.add(canonical);
            repos.push({
              path: canonical,
              name: basename(canonical),
              group: cleanRelGroup(ownHome, canonical),
              repo: true,
              source: 'repo',
            });
          }
        } catch {}
        // Do not recurse inside a Git repository (avoids submodules/nested worktrees/build folders).
        continue;
      }

      if (depth < maxDepth) visit(full, depth + 1);
    }
  };

  for (const root of roots) {
    if (repos.length >= maxRepos) break;
    const base = isAbsolute(root) ? root : join(ownHome, root);
    let info: Stats;
    try { info = statSync(base); } catch { continue; }
    if (!info.isDirectory()) continue;
    visit(realOrSelf(base), 1);
  }

  repos.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path));
  return repos;
}

// Merges default folder + all past work session folders + discovered Git repositories without a 10-item cap.
export function collectWorkFolders({
  defaultFolder = '',
  sessions = [],
  resolveFolder = () => null,
  home = homedir(),
  dataDir = '',
  discoverRepos = null,
  recentLimit = 200,
  repoLimit = 250,
}: CollectWorkFoldersOptions = {}): WorkFolderEntry[] {
  const ownHome = realOrSelf(home);
  const seen = new Map<string, WorkFolderEntry>();

  const addRecent = (rawPath: unknown, extra: Partial<WorkFolderEntry> = {}): void => {
    if (typeof rawPath !== 'string' || !rawPath.trim()) return;
    const canonical = realOrSelf(rawPath);
    if (seen.has(canonical)) return;
    const group = cleanRelGroup(ownHome, canonical);
    seen.set(canonical, {
      path: canonical,
      name: basename(canonical) || canonical,
      ...(group ? { group } : {}),
      recent: true,
      source: 'recent',
      ...extra,
    });
  };

  if (defaultFolder) addRecent(defaultFolder, { default: true });

  const sorted = [...(Array.isArray(sessions) ? sessions : [])].sort((a, b) => String(b?.updatedAt || '').localeCompare(String(a?.updatedAt || '')));
  for (const chat of sorted) {
    if (seen.size >= recentLimit) break;
    const folder = chat?.work ? resolveFolder(chat.id) : null;
    if (folder) addRecent(folder);
  }

  const discovered = typeof discoverRepos === 'function'
    ? discoverRepos()
    : discoverGitRepos({ home: ownHome, dataDir, maxRepos: repoLimit });

  for (const repo of Array.isArray(discovered) ? discovered : []) {
    if (!repo?.path) continue;
    const canonical = realOrSelf(repo.path);
    const group = repo.group || cleanRelGroup(ownHome, canonical);
    const existing = seen.get(canonical);
    if (existing) {
      existing.repo = true;
      if (group && !existing.group) existing.group = group;
    } else {
      seen.set(canonical, {
        path: canonical,
        name: repo.name || basename(canonical) || canonical,
        ...(group ? { group } : {}),
        repo: true,
        source: 'repo',
      });
    }
  }

  return [...seen.values()];
}

// Validates a folder chosen remotely (or via path entry): must exist as a directory strictly inside $HOME
// and pass checkWorkFolder (blocking settings, keys, Library except iCloud Drive, and Fairy's own dataDir).
export function validateRemoteWorkFolder(
  folder: unknown,
  { home = homedir(), dataDir = '' }: { home?: string; dataDir?: string } = {},
): string {
  if (typeof folder !== 'string' || !folder || folder.includes('\0') || !isAbsolute(folder)) {
    throw new Error('Choose an existing folder on your other Mac.');
  }
  let canonical: string;
  try {
    canonical = realpathSync(folder);
    if (!statSync(canonical).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('Choose an existing folder on your other Mac.');
  }
  const ownHome = realpathSync(home);
  const rel = relative(ownHome, canonical);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Choose a project folder inside your home folder.');
  }
  return checkWorkFolder(canonical, { home: ownHome, dataDir });
}

function expandHomePath(raw: unknown, ownHome: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) {
    const github = join(ownHome, 'Github');
    try { if (statSync(github).isDirectory()) return github; } catch {}
    return ownHome;
  }
  if (trimmed === '~') return ownHome;
  if (trimmed.startsWith('~/')) return join(ownHome, trimmed.slice(2));
  return trimmed;
}

function isForbiddenTarget(rel: string): boolean {
  if (!rel) return false;
  const parts = rel.split(sep).filter(Boolean);
  if (!parts.length) return false;
  if (rel === ICLOUD_DOCS_PREFIX || rel.startsWith(`${ICLOUD_DOCS_PREFIX}${sep}`)) return false;
  return FORBIDDEN_TOP_DIRS.has(parts[0]);
}

// Lists subdirectories inside `home` safely for local or bridge fallback folder browsing.
export function listLocalWorkDir(
  requestedPath = '',
  { home = homedir(), dataDir = '', showHidden = false }: ListLocalWorkDirOptions = {},
): LocalWorkDirListing {
  const ownHome = realpathSync(home);
  const ownData = dataDir ? realOrSelf(dataDir) : '';
  const expanded = expandHomePath(requestedPath, ownHome);
  if (!expanded || expanded.includes('\0') || !isAbsolute(expanded)) {
    throw new Error('Choose a folder inside your home folder.');
  }
  let target: string;
  try {
    target = realpathSync(expanded);
    if (!statSync(target).isDirectory()) throw new Error('not a directory');
  } catch {
    throw new Error('Folder not found.');
  }

  const rel = relative(ownHome, target);
  if (rel && (rel.startsWith('..') || isAbsolute(rel))) {
    throw new Error('Choose a folder inside your home folder.');
  }
  if (isForbiddenTarget(rel)) {
    throw new Error('Choose a project folder, not one that holds your settings or keys.');
  }
  if (ownData && (target === ownData || target.startsWith(`${ownData}${sep}`))) {
    throw new Error('Choose a folder outside Fairy’s own data.');
  }

  const atHome = target === ownHome;
  const entries: LocalWorkDirEntry[] = [];
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    if (entry.name === '.git') continue;
    if (!showHidden && entry.name.startsWith('.')) continue;
    if (atHome && FORBIDDEN_TOP_DIRS.has(entry.name)) continue;
    const entryPath = join(target, entry.name);
    if (ownData && (entryPath === ownData || entryPath.startsWith(`${ownData}${sep}`))) continue;
    entries.push({
      name: entry.name,
      path: entryPath,
      isRepo: existsSync(join(entryPath, '.git')),
    });
    if (entries.length >= 400) break;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  let canWorkHere = false;
  if (!atHome) {
    try { validateRemoteWorkFolder(target, { home: ownHome, dataDir: ownData }); canWorkHere = true; } catch {}
  }

  return {
    ok: true,
    host: 'this Mac',
    via: 'local',
    home: ownHome,
    path: target,
    parent: atHome ? null : dirname(target),
    canWorkHere,
    isRepo: existsSync(join(target, '.git')),
    entries,
  };
}
