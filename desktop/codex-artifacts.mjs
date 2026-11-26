// ChatGPT (Codex) artifacts (read-only discovery & import): reads generated HTML, Markdown, PDF, and image outputs
// from ~/Documents/Codex/**/outputs/, ~/.codex/visualizations/, ~/.codex/generated_images/, and top-level PDFs in
// Codex project roots, importing them into Fairy's Pages store under origin: 'codex' with collision-free cdx-* ids.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join, relative } from 'node:path';
import { MAX_FILE, MAX_FILES, MAX_PAGE, plainPath } from './artifacts.mjs';

export const CODEX_ID = /^cdx-[0-9a-f]{24}$/;
export const CODEX_MAIN_EXT = Object.freeze(['.html', '.htm', '.md', '.pdf', '.png', '.jpg', '.jpeg', '.webp']);
const HTML_OR_MD = new Set(['.html', '.htm', '.md']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIZ_EXT = new Set(['.html', '.htm', '.pdf']);
const ASSET_EXT = new Set([
  '.css', '.js', '.mjs', '.json', '.csv', '.txt', '.svg',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico',
  '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.m4v', '.webm', '.ogv', '.mov',
  '.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg', '.oga', '.opus', '.vtt',
  '.pdf', '.glb', '.wasm',
]);

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

export function codexArtifactId(relKey) {
  const digest = createHash('sha256').update(String(relKey)).digest('hex').slice(0, 24);
  return `cdx-${digest}`;
}

export function humanizeFilename(filename) {
  const stem = String(filename || '').replace(/\.[^.]+$/, '');
  const words = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!words) return 'ChatGPT Artifact';
  return words.replace(/\b[a-z]/g, ch => ch.toUpperCase()).slice(0, 120);
}

export function extractCodexTitle(bytes, filename, ext) {
  if (HTML_OR_MD.has(ext)) {
    const head = bytes.subarray(0, 16_384).toString('utf8');
    if (ext === '.html' || ext === '.htm') {
      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
      if (title && cleanText(title)) return cleanText(title);
      const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(head)?.[1]?.replace(/<[^>]+>/g, ' ');
      if (h1 && cleanText(h1)) return cleanText(h1);
    } else if (ext === '.md') {
      const h1 = /^#\s+(.+)$/m.exec(head)?.[1]?.replace(/[*_`~]/g, '');
      if (h1 && cleanText(h1)) return cleanText(h1);
    }
  }
  return humanizeFilename(filename);
}

async function siblingAssets(parentDir, skipName = '') {
  const out = [];
  async function walk(dir, relPrefix, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (relPrefix === '' && entry.name === skipName) continue;
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
  await walk(parentDir, '', 2);
  return out;
}

async function walkFiles(rootDir, maxDepth, onFile) {
  async function walk(dir, depth) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = join(dir, entry.name);
      let info;
      try { info = await lstat(full); } catch { continue; }
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        if (depth > 0) await walk(full, depth - 1);
      } else if (info.isFile()) {
        await onFile(full, dir, entry.name, info);
      }
    }
  }
  let rootInfo;
  try { rootInfo = await lstat(rootDir); } catch { return; }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) return;
  await walk(rootDir, maxDepth);
}

async function projectRootsFromState(codexDir) {
  const roots = new Set();
  try {
    const raw = await readFile(join(codexDir, '.codex-global-state.json'), 'utf8');
    const state = JSON.parse(raw);
    const localProjects = state?.['local-projects'];
    if (localProjects && typeof localProjects === 'object') {
      for (const proj of Object.values(localProjects)) {
        for (const p of (Array.isArray(proj?.rootPaths) ? proj.rootPaths : [])) {
          if (typeof p === 'string' && p.startsWith('/')) roots.add(p);
        }
      }
    }
    const remoteProjects = state?.['remote-projects'];
    if (Array.isArray(remoteProjects)) {
      for (const proj of remoteProjects) {
        if (typeof proj?.remotePath === 'string' && proj.remotePath.startsWith('/')) roots.add(proj.remotePath);
      }
    }
  } catch { /* No global state or unreadable; skip. */ }
  return [...roots];
}

export async function discoverCodexArtifacts({
  codexDir = join(homedir(), '.codex'),
  docsDir = join(homedir(), 'Documents/Codex'),
  extraRoots = null,
} = {}) {
  const byId = new Map();

  async function record(relKey, sourcePath, parentDir, filename, info, description = '', collectAssets = false) {
    const ext = extname(filename).toLowerCase();
    if (!CODEX_MAIN_EXT.includes(ext)) return;
    const limit = HTML_OR_MD.has(ext) ? MAX_PAGE : MAX_FILE;
    if (info.size === 0 || info.size > limit) return;
    let bytes;
    try { bytes = await readFile(sourcePath); } catch { return; }
    const id = codexArtifactId(relKey);
    if (byId.has(id)) return;
    const title = extractCodexTitle(bytes, filename, ext);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const kind = ext === '.md' ? 'doc' : 'page';
    const files = collectAssets && (ext === '.html' || ext === '.htm') ? await siblingAssets(parentDir, filename) : [];
    const at = Math.round(info.mtimeMs || 0);

    byId.set(id, {
      id,
      origin: 'codex',
      kind,
      title,
      description: cleanText(description, 300),
      source: sourcePath,
      ext,
      hash,
      files,
      filename,
      session: 'codex:all',
      at,
    });
  }

  // 1. ~/Documents/Codex/**/outputs/*
  await walkFiles(docsDir, 5, async (full, dir, name, info) => {
    const rel = relative(docsDir, full).replaceAll('\\', '/');
    const parts = rel.split('/');
    if (!parts.includes('outputs')) return;
    await record(`docs:${rel}`, full, dir, name, info, 'ChatGPT Codex output', basename(dir) === 'outputs');
  });

  // 2. ~/.codex/visualizations/**/* (.html, .htm, .pdf; skip *.template.html)
  const vizDir = join(codexDir, 'visualizations');
  await walkFiles(vizDir, 6, async (full, dir, name, info) => {
    const ext = extname(name).toLowerCase();
    if (!VIZ_EXT.has(ext) || /\.template\.html?$/i.test(name)) return;
    const rel = relative(vizDir, full).replaceAll('\\', '/');
    await record(`viz:${rel}`, full, dir, name, info, 'Codex visualization', ext === '.html' || ext === '.htm');
  });

  // 3. ~/.codex/generated_images/**/* (.png, .jpg, .jpeg, .webp)
  const imgDir = join(codexDir, 'generated_images');
  await walkFiles(imgDir, 4, async (full, dir, name, info) => {
    const ext = extname(name).toLowerCase();
    if (!IMAGE_EXT.has(ext)) return;
    const rel = relative(imgDir, full).replaceAll('\\', '/');
    await record(`img:${rel}`, full, dir, name, info, 'Codex generated image', false);
  });

  // 4. Top-level .pdf files (depth 1 only, skipping subdirectories like papers/) in Codex project roots
  const roots = Array.isArray(extraRoots) ? extraRoots : await projectRootsFromState(codexDir);
  for (const rootPath of roots) {
    if (typeof rootPath !== 'string' || !rootPath) continue;
    let rootInfo;
    try { rootInfo = await lstat(rootPath); } catch { continue; }
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) continue;
    let entries;
    try { entries = await readdir(rootPath, { withFileTypes: true }); } catch { continue; }
    const rootName = basename(rootPath);
    for (const entry of entries) {
      if (entry.name.startsWith('.') || extname(entry.name).toLowerCase() !== '.pdf') continue;
      const full = join(rootPath, entry.name);
      let info;
      try { info = await lstat(full); } catch { continue; }
      if (info.isSymbolicLink() || !info.isFile()) continue;
      await record(`proj:${rootName}/${entry.name}`, full, rootPath, entry.name, info, `PDF from ${rootName}`, false);
    }
  }

  return [...byId.values()].sort((a, b) => a.at - b.at);
}

export async function importCodexArtifacts(store, found, { respectRemoved = false } = {}) {
  const counts = { found: found.length, copied: 0, updated: 0, skipped: 0 };
  for (const one of found) {
    try {
      const result = await store.importCodex(one, { respectRemoved });
      counts[result] = (counts[result] || 0) + 1;
    } catch (error) {
      console.warn('Could not import a Codex artifact:', error.message);
      counts.skipped++;
    }
  }
  await store.changed();
  return counts;
}
