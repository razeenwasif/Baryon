import { createReadStream } from 'node:fs';
import { open, readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

// A publish's answer names its artifact; an upload's names what it stored.
const ANSWERS = [Buffer.from('"artifact_id"'), Buffer.from('"asset_upload')];
const LONGEST = Math.max(...ANSWERS.map(answer => answer.length));
const CHUNK = 1 << 20;

export const sameURL = (a, b) => {
  const clean = url => String(url || '').trim().replace(/\/+$/, '').split(/[?#]/)[0].toLowerCase();
  return Boolean(clean(a)) && clean(a) === clean(b);
};
const when = value => {
  if (typeof value === 'number') return value < 1e11 ? value * 1000 : value;
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : 0;
};
// Keeps the newest details for each address, filling gaps from the older records.
export function mergeFound(found, one) {
  const existing = found.find(entry => sameURL(entry.url, one.url));
  if (!existing) { found.push({ ...one }); return found; }
  if (one.at > existing.at) {
    existing.at = one.at;
    if (one.title) existing.title = one.title;
    if (one.source) existing.source = one.source;
    if (one.files) existing.files = one.files;
    if (one.input) existing.input = one.input;
    if (one.project) existing.project = one.project;
    if (one.chat) { existing.chat = one.chat; existing.chatTitle = one.chatTitle || ''; }
  }
  existing.chat ||= one.chat; existing.chatTitle ||= one.chatTitle;
  existing.id ||= one.id;
  existing.seq = Math.max(existing.seq || 0, one.seq || 0) || undefined;
  existing.description ||= one.description;
  existing.source ||= one.source;
  existing.files ||= one.files;
  return found;
}
// Where a publish's supporting files are, best first, as the Artifact tool looks for them.
export function supportingFiles({ input, source, project }) {
  const files = input?.files;
  if (!files) return null;
  const bases = [];
  const root = typeof input.root === 'string' ? input.root : '';
  if (root && isAbsolute(root)) bases.push(root);
  else if (root && project) bases.push(join(project, root));
  if (project) bases.push(project);
  if (source) bases.push(dirname(source));
  const places = from => isAbsolute(from) ? [from] : [...new Set(bases)].map(base => resolve(base, from));
  const out = [];
  if (Array.isArray(files)) {
    for (const entry of files) {
      const path = typeof entry === 'string' ? entry : entry?.path;
      if (typeof path === 'string') out.push([path, places(path)]);
    }
  } else if (typeof files === 'object') {
    for (const [published, from] of Object.entries(files)) {
      const path = typeof from === 'string' ? from : from?.from;
      if (typeof path === 'string') out.push([published, places(path)]);
    }
  }
  return out.length ? out : null;
}
export function foundFromAnswer(entry, input) {
  const result = entry.toolUseResult || entry.tool_use_result;
  if (typeof result?.artifact_id !== 'string' || typeof result?.url !== 'string') return null;
  const source = typeof result.path === 'string' ? result.path : typeof input?.file_path === 'string' ? input.file_path : null;
  const project = typeof entry.cwd === 'string' ? entry.cwd : '';
  const absolute = source && !isAbsolute(source) && project ? resolve(project, source) : source;
  return { url: result.url, id: result.artifact_id, title: result.title || input?.title || '', description: input?.description || '', source: absolute,
    files: supportingFiles({ input, source: absolute, project }), project, seq: Number(result.seq) || undefined, at: when(entry.timestamp),
    chat: typeof entry.sessionId === 'string' ? entry.sessionId : '' };
}
// What an upload answer stored in an artifact's asset store (the Artifact tool with asset: true): one file
// (asset_upload) or several (asset_uploads.results), each with the file it was read from, kept to copy it later.
export function uploadsFromAnswer(entry, input) {
  const result = entry.toolUseResult || entry.tool_use_result;
  if (!result || (!result.asset_upload && !result.asset_uploads)) return null;
  const url = typeof result.written?.url === 'string' ? result.written.url : typeof result.asset_uploads?.url === 'string' ? result.asset_uploads.url : typeof input?.url === 'string' ? input.url : '';
  if (!url) return null;
  const project = typeof entry.cwd === 'string' ? entry.cwd : '';
  const each = result.asset_upload ? [{ file_path: input?.file_path, ...result.asset_upload }] : Array.isArray(result.asset_uploads?.results) ? result.asset_uploads.results : [];
  const assets = each.filter(one => (!one?.status || one.status === 'uploaded') && typeof one?.id === 'string' && /^[0-9a-f]{32}$/.test(one.id) && typeof one.file_path === 'string')
    .map(one => ({ id: one.id, path: !isAbsolute(one.file_path) && project ? resolve(project, one.file_path) : one.file_path, type: typeof one.content_type === 'string' ? one.content_type : '', sha256: typeof one.sha256 === 'string' ? one.sha256 : '' }));
  return assets.length ? { url, assets, at: when(entry.timestamp) } : null;
}
// Each artifact's uploads, from whichever session made them, newest copy of an id kept.
export function attachUploads(found, uploads) {
  for (const upload of [...uploads].sort((a, b) => a.at - b.at)) {
    const page = found.find(entry => sameURL(entry.url, upload.url));
    if (!page) continue;
    const kept = new Map((page.assets || []).map(asset => [asset.id, asset]));
    for (const asset of upload.assets) kept.set(asset.id, asset);
    page.assets = [...kept.values()];
  }
  return found;
}
// Most session files name no artifact, so a raw search skips them without reading any lines.
async function mentionsArtifact(path) {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(CHUNK + LONGEST);
    let position = 0, carried = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buffer, carried, CHUNK, position);
      if (!bytesRead) return false;
      const filled = carried + bytesRead;
      if (ANSWERS.some(answer => buffer.subarray(0, filled).includes(answer))) return true;
      position += bytesRead;
      carried = Math.min(LONGEST, filled);
      buffer.copy(buffer, 0, filled - carried, filled);
    }
  } finally { await handle.close(); }
}
// uploads: where the session's asset uploads go, as they're matched to pages from every session at the end.
export async function sessionFile(path, uploads = []) {
  const inputs = new Map(), found = [], titles = new Map();
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    // The session's name as the desktop app shows it; the last one written is the current one.
    if (line.startsWith('{"type":"custom-title"')) { try { const named = JSON.parse(line); if (named.sessionId && named.customTitle) titles.set(named.sessionId, String(named.customTitle)); } catch {} continue; }
    const call = line.includes('"name":"Artifact"');
    if (!call && !line.includes('"artifact_id"') && !line.includes('"asset_upload')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    const blocks = Array.isArray(entry.message?.content) ? entry.message.content : [];
    if (call) for (const block of blocks) if (block?.type === 'tool_use' && block.name === 'Artifact' && block.id) inputs.set(block.id, block.input);
    const tool = blocks.find(block => block?.tool_use_id)?.tool_use_id;
    const one = foundFromAnswer(entry, inputs.get(tool));
    if (one) found.push(one);
    const uploaded = uploadsFromAnswer(entry, inputs.get(tool));
    if (uploaded) uploads.push(uploaded);
  }
  for (const one of found) one.chatTitle = titles.get(one.chat) || '';
  return found;
}
async function walk(dir, depth, onFile) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (depth > 0) await walk(path, depth - 1, onFile); }
    else if (entry.isFile()) await onFile(path, entry.name);
  }
}
// The desktop app keeps what each of its Code sessions published.
export function desktopRecord(record) {
  return (Array.isArray(record?.publishedArtifacts) ? record.publishedArtifacts : []).filter(item => typeof item?.url === 'string').map(item => ({
    url: item.url, id: null, title: item.title || '', description: '', source: typeof item.sourcePath === 'string' ? item.sourcePath : null, files: null,
    project: typeof record.cwd === 'string' ? record.cwd : '', seq: undefined, at: when(item.updatedAt),
    chat: typeof record.cliSessionId === 'string' ? record.cliSessionId : '', chatTitle: typeof record.title === 'string' ? record.title : '',
  }));
}
// Each desktop session's title by every Claude Code session id it has had, so a transcript's publish gets the name
// the sidebar shows.
export function desktopTitles(record, titles = new Map()) {
  const title = typeof record?.title === 'string' ? record.title.trim() : '';
  if (title) for (const id of [record.cliSessionId, ...(Array.isArray(record.priorCliSessionIds) ? record.priorCliSessionIds : [])]) if (typeof id === 'string' && id) titles.set(id, { chat: record.cliSessionId || id, title });
  return titles;
}
// Reads only: every artifact published from this Mac, from Claude Code's sessions and the desktop app's records.
export async function discoverArtifacts({ claudeDir = join(homedir(), '.claude'), desktopDir = join(homedir(), 'Library/Application Support/Claude/claude-code-sessions') } = {}) {
  const found = [], titles = new Map(), uploads = [];
  await walk(join(claudeDir, 'projects'), 4, async (path, name) => {
    if (!name.endsWith('.jsonl')) return;
    try { if (await mentionsArtifact(path)) for (const one of await sessionFile(path, uploads)) mergeFound(found, one); }
    catch (error) { console.warn('Skipping a session file:', error.message); }
  });
  await walk(desktopDir, 2, async (path, name) => {
    if (!/^local_.*\.json$/.test(name)) return;
    try { const record = JSON.parse(await readFile(path, 'utf8')); desktopTitles(record, titles); for (const one of desktopRecord(record)) mergeFound(found, one); }
    catch (error) { console.warn('Skipping a desktop record:', error.message); }
  });
  // A resumed session keeps one name across its Claude Code ids, and the sidebar's title wins over the transcript's.
  for (const one of found) { const named = titles.get(one.chat); if (named) { one.chat = named.chat; one.chatTitle = named.title; } }
  attachUploads(found, uploads);
  return found.sort((a, b) => a.at - b.at);
}
// groupOnly: name the sessions of pages already imported, and add nothing.
export async function importArtifacts(store, found, { groupOnly = false } = {}) {
  const counts = { found: found.length, copied: 0, address: 0, skipped: 0, grouped: 0 };
  for (const one of found) {
    try { counts[groupOnly ? store.groupFound(one) : await store.importFound(one)]++; }
    catch (error) { console.warn('Could not import a page:', error.message); counts.skipped++; }
  }
  if (!groupOnly) store.imported = true;
  store.grouped = true; store.foldered = true;
  await store.changed();
  return counts;
}
