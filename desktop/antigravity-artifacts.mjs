// Antigravity artifacts (read-only discovery & import): reads user-facing HTML and Markdown artifacts from
// ~/.gemini/antigravity/brain/<conversation-id>/ (identified by sibling *.metadata.json with userFacing: true)
// and imports them into Fairy's Pages store under origin: 'antigravity' with collision-free agy-* ids so they
// stay strictly separate from Claude artifacts even when both have the same title.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, join } from 'node:path';
import { MAX_FILE, MAX_FILES, MAX_PAGE, plainPath } from './artifacts.mjs';

export const ANTIGRAVITY_ID = /^agy-[0-9a-f]{24}$/;
export const ANTIGRAVITY_MAIN_EXT = Object.freeze(['.html', '.htm', '.md']);
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

const decodeEntities = value => String(value ?? '')
  .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
  .replace(/&nbsp;/gi, ' ')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&');

const cleanText = (value, limit = 120) => decodeEntities(value).replace(/\s+/g, ' ').trim().slice(0, limit);

export function antigravityArtifactId(conversationId, filename) {
  const digest = createHash('sha256').update(`${String(conversationId)}/${String(filename)}`).digest('hex').slice(0, 24);
  return `agy-${digest}`;
}

export function humanizeFilename(filename) {
  const stem = String(filename || '').replace(/\.[^.]+$/, '');
  const words = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'Antigravity Artifact';
  return words.replace(/\b[a-z]/g, ch => ch.toUpperCase()).slice(0, 120);
}

export function extractArtifactTitle(content, filename, ext) {
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

async function siblingAssets(convPath) {
  const out = [];
  async function walk(dir, relPrefix, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (relPrefix === '' && SKIP_DIRS.has(entry.name)) continue;
      if (entry.name.endsWith('.metadata.json')) continue;
      const full = join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      let info;
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
export async function discoverAntigravityArtifacts({ brainDir = join(homedir(), '.gemini/antigravity/brain') } = {}) {
  let dirs;
  try { dirs = await readdir(brainDir, { withFileTypes: true }); } catch { return []; }
  const found = [];

  for (const dir of dirs) {
    if (dir.name.startsWith('.') || SKIP_DIRS.has(dir.name) || !CONV_DIR.test(dir.name)) continue;
    const convPath = join(brainDir, dir.name);
    let convInfo;
    try { convInfo = await lstat(convPath); } catch { continue; }
    if (convInfo.isSymbolicLink() || !convInfo.isDirectory()) continue;

    let entries;
    try { entries = await readdir(convPath, { withFileTypes: true }); } catch { continue; }
    let assetsCache = null;

    for (const entry of entries) {
      if (entry.name.startsWith('.') || !entry.name.endsWith('.metadata.json')) continue;
      const metaPath = join(convPath, entry.name);
      const artifactName = entry.name.slice(0, -'.metadata.json'.length);
      const ext = extname(artifactName).toLowerCase();
      if (!ANTIGRAVITY_MAIN_EXT.includes(ext) || !plainPath(artifactName)) continue;

      let meta;
      try {
        const metaInfo = await lstat(metaPath);
        if (metaInfo.isSymbolicLink() || !metaInfo.isFile() || metaInfo.size > 1024 * 1024) continue;
        meta = JSON.parse(await readFile(metaPath, 'utf8'));
      } catch { continue; }
      if (meta?.userFacing !== true) continue;

      const sourcePath = join(convPath, artifactName);
      let info;
      try { info = await lstat(sourcePath); } catch { continue; }
      if (info.isSymbolicLink() || !info.isFile() || info.size === 0 || info.size > MAX_PAGE) continue;

      let bytes;
      try { bytes = await readFile(sourcePath); } catch { continue; }
      const content = bytes.toString('utf8');
      const title = extractArtifactTitle(content, artifactName, ext);
      const description = typeof meta.summary === 'string' ? cleanText(meta.summary, 300) : '';
      const metaAt = Date.parse(meta.updatedAt || '');
      const at = Math.max(Number.isFinite(metaAt) ? metaAt : 0, Math.round(info.mtimeMs || 0));
      const hash = createHash('sha256').update(bytes).digest('hex');
      const kind = ext === '.md' ? 'doc' : 'page';
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

export async function importAntigravityArtifacts(store, found, { respectRemoved = false } = {}) {
  const counts = { found: found.length, copied: 0, updated: 0, skipped: 0 };
  for (const one of found) {
    try {
      const result = await store.importAntigravity(one, { respectRemoved });
      counts[result] = (counts[result] || 0) + 1;
    } catch (error) {
      console.warn('Could not import an Antigravity artifact:', error.message);
      counts.skipped++;
    }
  }
  await store.changed();
  return counts;
}
