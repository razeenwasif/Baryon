// Open a work session folder in the user's Proton code editor on the current Mac.
import { execFile } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface FindProtonAppOptions {
  exists?: (path: string) => boolean;
  home?: string;
}

export interface ResolveProtonTargetOptions {
  fallbackName?: string;
  home?: string;
  exists?: (path: string) => boolean;
  isDir?: (path: string) => boolean;
}

export interface OpenFolderInProtonOptions extends ResolveProtonTargetOptions {
  openRunner?: (cmd: string, args: string[]) => Promise<unknown>;
}

export function findProtonApp({ exists = existsSync, home = homedir() }: FindProtonAppOptions = {}): string {
  const candidates = [
    '/Applications/Proton.app',
    join(home, 'Applications/Proton.app'),
  ];
  for (const appPath of candidates) {
    if (exists(appPath)) return appPath;
  }
  return '';
}

function assertInsideHome(rawFolder: unknown, home = homedir()): string {
  const clean = String(rawFolder || '').trim();
  if (!clean || /[\0\r\n]/.test(clean)) {
    throw new Error('Open a work session first.');
  }
  if (clean.split(/[\\/]/).includes('..')) {
    throw new Error('Folder path cannot contain "..".');
  }
  const abs = resolve(clean);
  const homeRoot = resolve(home);
  if (abs !== homeRoot && !abs.startsWith(`${homeRoot}/`)) {
    throw new Error('Folder must be inside your home directory.');
  }
  return abs;
}

export function resolveProtonTarget(
  folder: unknown,
  {
    fallbackName = '',
    home = homedir(),
    exists = existsSync,
    isDir = path => { try { return statSync(path).isDirectory(); } catch { return false; } },
  }: ResolveProtonTargetOptions = {},
): string {
  const primary = assertInsideHome(folder, home);
  if (exists(primary) && isDir(primary)) {
    return primary;
  }
  const repoName = String(fallbackName || basename(primary)).trim();
  if (repoName && !repoName.includes('/') && !repoName.includes('\\') && !repoName.includes('..') && !repoName.startsWith('.')) {
    const candidates = [
      join(home, 'Github', repoName),
      join(home, 'Github', 'desktop-buddies', repoName),
      join(home, 'Projects', repoName),
    ];
    for (const candidate of candidates) {
      if (exists(candidate) && isDir(candidate)) return candidate;
    }
  }
  throw new Error(`Folder "${primary}" is not on this Mac.`);
}

export async function openFolderInProton(
  folder: unknown,
  {
    fallbackName = '',
    home = homedir(),
    exists = existsSync,
    isDir = path => { try { return statSync(path).isDirectory(); } catch { return false; } },
    openRunner = (cmd, args) => execFileAsync(cmd, args),
  }: OpenFolderInProtonOptions = {},
): Promise<{ ok: true; app: string; folder: string }> {
  const protonApp = findProtonApp({ exists, home });
  if (!protonApp) {
    throw new Error('Proton.app was not found in /Applications or ~/Applications.');
  }
  const target = resolveProtonTarget(folder, { fallbackName, home, exists, isDir });
  await openRunner('/usr/bin/open', ['-a', protonApp, target]);
  return { ok: true, app: protonApp, folder: target };
}
