// Antigravity artifacts (read-only discovery & import): reads user-facing HTML and Markdown artifacts from
// ~/.gemini/antigravity/brain/<conversation-id>/ (identified by sibling *.metadata.json with userFacing: true)
// and imports them into Fairy's Pages store under origin: 'antigravity' with collision-free agy-* ids so they
// stay strictly separate from Claude artifacts even when both have the same title.
import { createHash } from 'node:crypto';
import type { Dirent, Stats } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { MAX_FILE, MAX_FILES, MAX_PAGE, plainPath, type FoundExternalArtifact } from './artifacts.mjs';

export interface AntigravityArtifact {
  id: string;
  origin: 'antigravity';
  kind: 'doc' | 'page';
  title: string;
  description: string;
  source: string;
  ext: string;
  hash: string;
  files: Array<[string, string[]]>;
  conversationId: string;
  filename: string;
  session: string;
  at: number;
}

export interface DiscoverAntigravityArtifactsOptions {
  brainDir?: string;
}

export interface AntigravityArtifactStore {
  importAntigravity(found: FoundExternalArtifact | null | undefined, options?: { respectRemoved?: boolean }): Promise<'copied' | 'updated' | 'skipped'>;
  changed(): Promise<unknown> | unknown;
}

export interface ImportAntigravityArtifactsOptions {
  respectRemoved?: boolean;
}

export interface ImportAntigravityCounts {
  found: number;
  copied: number;
  updated: number;
  skipped: number;
}

interface AntigravityMetadata {
  userFacing?: boolean;
  summary?: unknown;
  updatedAt?: string;
}

export const ANTIGRAVITY_ID = /^agy-[0-9a-f]{24}$/;
export const ANTIGRAVITY_MAIN_EXT: readonly string[] = Object.freeze(['.html', '.htm', '.md']);
const ASSET_EXT = new Set([
  '.css', '.js', '.mjs', '.json', '.csv', '.txt', '.svg',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.m4v', '.webm', '.ogv', '.mov',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.vtt',
  '.pdf', '.glb', '.wasm',
]);
const SKIP_DIRS = new Set(['scratch', 'tempmediaStorage']);
const CONV_DIR = /^[A-Za-z0-9._-]{1,120}$/;

const decodeEntities = (value: unknown): string => String(value ?? '')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&');

const cleanText = (value: unknown, limit = 120): string => decodeEntities(value).replace(/\s+/g, ' ').trim().slice(0, limit);

export function antigravityArtifactId(conversationId: string, filename: string): string {
  const digest = createHash('sha256').update(`${String(conversationId)}/${String(filename)}`).digest('hex').slice(0, 24);
  return `agy-${digest}`;
}

export function humanizeFilename(filename: string): string {
  const stem = String(filename || '').replace(/\.[^.]+$/, '');
  const words = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Antigravity Artifact';
  return words.replace(/\b[a-z]/g, ch => ch.toUpperCase()).slice(0, 120);
}

export function extractArtifactTitle(content: string, filename: string, ext: string): string {
  const head = String(content ?? '').slice(0, 16_384);
  if (ext === '.html' || ext === '.htm') {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
    if (title && cleanText(title)) return cleanText(title);
    const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(head)?.[1]?.replace(/<[^>]+>/g, ' ');
    if (h1 && cleanText(h1)) return cleanText(h1);
  } else if (ext === '.md') {
    const h1 = /^#\s+(.+)$/m.exec(head)?.[1]?.replace(/[*_`~]/g, '');
    if (h1 && cleanText(h1)) return cleanText(h1);
  }
  return humanizeFilename(filename);
}

async function siblingAssets(convPath: string): Promise<Array<[string, string[]]>> {
  const out: Array<[string, string[]]> = [];
  async function walk(dir: string, relPrefix: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (relPrefix === '' && SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.endsWith('.metadata.json')) continue;
      const full = join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      let info: Stats;
      try { info = await lstat(full); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (depth > 0) await walk(full, rel, depth - 1);
        continue;
      }
      if (!info.isFile() || info.size > MAX_FILE) continue;
      const ext = extname(entry.name).toLowerCase();
      if (!ASSET_EXT.has(ext)) continue;
      const safe = plainPath(rel);
      if (!safe) continue;
      out.push([safe, [full]]);
      if (out.length >= MAX_FILES) return;
    }
  }
  await walk(convPath, '', 3);
  return out;
}

// Read-only scan of ~/.gemini/antigravity/brain/<conversation-id>/*.metadata.json for userFacing: true artifacts.
export async function discoverAntigravityArtifacts({
  brainDir = join(homedir(), '.gemini/antigravity/brain'),
}: DiscoverAntigravityArtifactsOptions = {}): Promise<AntigravityArtifact[]> {
  let dirs: Dirent[];
  try { dirs = await readdir(brainDir, { withFileTypes: true }); } catch { return []; }
  const found: AntigravityArtifact[] = [];

  for (const dir of dirs) {
    if (dir.name.startsWith('.') || SKIP_DIRS.has(dir.name) || !CONV_DIR.test(dir.name)) continue;
    const convPath = join(brainDir, dir.name);
    let convInfo: Stats;
    try { convInfo = await lstat(convPath); } catch { continue; }
    if (convInfo.isSymbolicLink() || !convInfo.isDirectory()) continue;

    let entries: Dirent[];
    try { entries = await readdir(convPath, { withFileTypes: true }); } catch { continue; }
    let assetsCache: Array<[string, string[]]> | null = null;

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.name.endsWith('.metadata.json')) continue;
      const metaPath = join(convPath, entry.name);
      const artifactName = entry.name.slice(0, -'.metadata.json'.length);
      const ext = extname(artifactName).toLowerCase();
      if (!ANTIGRAVITY_MAIN_EXT.includes(ext) || !plainPath(artifactName)) continue;

      let meta: AntigravityMetadata | null;
      try {
        const metaInfo = await lstat(metaPath);
        if (metaInfo.isSymbolicLink() || !metaInfo.isFile() || metaInfo.size > 1024 * 1024) continue;
        meta = JSON.parse(await readFile(metaPath, 'utf8')) as AntigravityMetadata | null;
      } catch { continue; }
      if (meta?.userFacing !== true) continue;

      const sourcePath = join(convPath, artifactName);
      let info: Stats;
      try { info = await lstat(sourcePath); } catch { continue; }
      if (info.isSymbolicLink() || !info.isFile() || info.size === 0 || info.size > MAX_PAGE) continue;

      let bytes: Buffer;
      try { bytes = await readFile(sourcePath); } catch { continue; }
      const content = bytes.toString('utf8');
      const title = extractArtifactTitle(content, artifactName, ext);
      const description = typeof meta.summary === 'string' ? cleanText(meta.summary, 300) : '';
      const metaAt = Date.parse(meta.updatedAt || '');
      const at = Math.max(Number.isFinite(metaAt) ? metaAt : 0, Math.round(info.mtimeMs || 0));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const kind: 'doc' | 'page' = ext === '.md' ? 'doc' : 'page';
      const files = kind === 'page' ? (assetsCache ??= await siblingAssets(convPath)) : [];

      found.push({
        id: antigravityArtifactId(dir.name, artifactName),
        origin: 'antigravity',
        kind,
        title,
        description,
        source: sourcePath,
        ext,
        hash,
        files,
        conversationId: dir.name,
        filename: artifactName,
        session: `antigravity:${dir.name.slice(0, 48)}`,
        at,
      });
    }
  }

  return found.sort((a, b) => a.at - b.at);
}

export async function importAntigravityArtifacts(
  store: AntigravityArtifactStore,
  found: readonly FoundExternalArtifact[],
  { respectRemoved = false }: ImportAntigravityArtifactsOptions = {},
): Promise<ImportAntigravityCounts> {
  const counts: ImportAntigravityCounts = { found: found.length, copied: 0, updated: 0, skipped: 0 };
  for (const one of found) {
    try {
      const result = await store.importAntigravity(one, { respectRemoved });
      counts[result] = (counts[result] || 0) + 1;
    } catch (error) {
      console.warn('Could not import an Antigravity artifact:', error instanceof Error ? error.message : String(error));
      counts.skipped++;
    }
  }
  await store.changed();
  return counts;
}
