// Discovers Git project repositories across common workspace roots and validates work session folders
// safely against home/system/settings/secrets constraints.
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
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

const realOrSelf = p => { try { return realpathSync(p); } catch { return p; } };

function cleanRelGroup(ownHome, folder) {
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
} = {}) {
  const ownHome = realOrSelf(home);
  const seen = new Set();
  const repos = [];

  const visit = (dir, depth) => {
    if (repos.length >= maxRepos || depth > maxDepth) return;
    let entries;
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
    let info;
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
} = {}) {
  const ownHome = realOrSelf(home);
  const seen = new Map();

  const addRecent = (rawPath, extra = {}) => {
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
export function validateRemoteWorkFolder(folder, { home = homedir(), dataDir = '' } = {}) {
  if (typeof folder !== 'string' || !folder || folder.includes('\0') || !isAbsolute(folder)) {
    throw new Error('Choose an existing folder on your other Mac.');
  }
  let canonical;
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

function expandHomePath(raw, ownHome) {
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

function isForbiddenTarget(rel) {
  if (!rel) return false;
  const parts = rel.split(sep).filter(Boolean);
  if (!parts.length) return false;
  if (rel === ICLOUD_DOCS_PREFIX || rel.startsWith(`${ICLOUD_DOCS_PREFIX}${sep}`)) return false;
  return FORBIDDEN_TOP_DIRS.has(parts[0]);
}

// Lists subdirectories inside `home` safely for local or bridge fallback folder browsing.
export function listLocalWorkDir(requestedPath = '', { home = homedir(), dataDir = '', showHidden = false } = {}) {
  const ownHome = realpathSync(home);
  const ownData = dataDir ? realOrSelf(dataDir) : '';
  const expanded = expandHomePath(requestedPath, ownHome);
  if (!expanded || expanded.includes('\0') || !isAbsolute(expanded)) {
    throw new Error('Choose a folder inside your home folder.');
  }
  let target;
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
  const entries = [];
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
