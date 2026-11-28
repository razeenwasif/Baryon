// Claude sync: Claude Code's chats and pages, from the Mac they're made on to Fairy on the other one.
//
// Fairy runs on the mini, but Claude Code is used on the MacBook, so the mini's own imports (claude-import.mjs,
// artifact-import.mjs) only ever saw an old copy of its history. The MacBook's face sends them instead, every 10 minutes
// and when you press Sync now:
//   1. On a worker, it reads what changed in Claude Code's files there: each transcript from where it left off.
//   2. It asks the mini which chats and pages it needs (plan-chats, plan-pages), sending only signatures and versions.
//   3. It builds those chats there, with the import's own code, and sends each one; and sends each page that needs
//      copying with its files, read from where it was published, then the files the page uploaded. A page whose files
//      are gone there is downloaded by the mini from claude.ai instead (fetch), with your sign-in, once per version.
// A chat you've carried on with or deleted on the mini, and a page you've removed there, stay as you left them; a page
// published before the mini's last import that it doesn't have counts as removed, as the old import left it.
// The mini's side answers on the face link (/v1/face/claude/…), for a Mac paired with it, with that Mac's device key.
// It only ever writes chats and pages into Fairy's own lists; nothing it's sent is run.
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type Dirent } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { dirname, extname, isAbsolute, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  attachUploads, desktopRecord, desktopTitles, foundFromAnswer, mergeFound, sameURL, uploadsFromAnswer,
  type ArtifactToolInput, type ArtifactUploadBatch, type DesktopSessionRecord, type FoundArtifact, type SupportingFileEntry, type TranscriptEntry,
} from './artifact-import.mjs';
import { ANTIGRAVITY_ID, discoverAntigravityArtifacts } from './antigravity-artifacts.mjs';
import { CODEX_ID, discoverCodexArtifacts } from './codex-artifacts.mjs';
import { NO_ARTIFACT_TOOL, NOT_SIGNED_IN, clearDownload, savedFiles } from './artifact-link.mjs';
import { MAX_FILE, MAX_PAGE, plainPath, type ArtifactItem, type FoundClaudeArtifact, type FoundExternalArtifact } from './artifacts.mjs';
import {
  IMPORTED_MODE, importSignature, planImport, projectName, workFolderFor,
  type ConvertSessionsOptions, type ConvertSessionsResult, type ImportManifestEntry, type SessionGroup,
} from './claude-import.mjs';
import type { FaceDevice, FaceHttpLink } from './face-link.mjs';
import { inNotebook } from './sessions.mjs';
import { NO_CONNECTOR, TYPED_KINDS, designViewer, docPage, type CanvasInput, type TypedKind } from './typed-pages.mjs';

export const SYNC_EVERY_MS = 10 * 60_000, FIRST_AFTER_MS = 90_000;
// A chat still being written to waits until it has been quiet this long, so a conversation goes over when it pauses
// rather than every 10 minutes while it runs. Sync now sends it as it is.
export const SETTLED_MS = 3 * 60_000;
// claude.ai downloads are a small model turn each, so a run does at most this many, and a version that failed three
// times (or can't be a page: a Doc or Design) isn't tried again until it's published anew.
export const FETCHES_PER_RUN = 12, FETCH_TRIES = 3, FETCH_WAIT_MS = 6 * 60_000;
// Docs are exported on the other Mac (doc-export.mjs, a small model turn each) when the desktop app's daily list says one
// has a new version, so at most this many a run.
export const DOCS_PER_RUN = 12;
export const LIMITS = Object.freeze({ plan: 8 * 1024 * 1024, chat: 32 * 1024 * 1024, page: 48 * 1024 * 1024, asset: 96 * 1024 * 1024, small: 256 * 1024 });
// The link gives a request 10 seconds to arrive (phone-link.mjs), so what one carries stays well under what the home
// network moves in that time; a bigger page goes without its biggest files, and a bigger upload stays on the MacBook.
// Something that failed three times isn't sent again until Fairy starts anew, so a slow link doesn't resend it all day.
const PAGE_BODY = 24 * 1024 * 1024, MAX_ASSET = 32 * 1024 * 1024, MAX_PAGE_FILES = 255, SEND_TRIES = 3;
const CHAT_ID = /^cc-[a-z0-9-]{1,60}$/, SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/, BLOB_ID = /^[0-9a-f]{32}$/, BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAIN_EXT: readonly string[] = ['.html', '.htm', '.md'];
const CODEX_EXT: readonly string[] = ['.html', '.htm', '.md', '.pdf', '.png', '.jpg', '.jpeg', '.webp'];
const failure = (status: number, message: string): Error & { status: number } => Object.assign(new Error(message), { status });
const text = (value: unknown, limit: number): string => (typeof value === 'string' ? value.slice(0, limit) : '');
const errMsg = (error: unknown): string => (error instanceof Error ? error.message : String((error as { message?: unknown } | null | undefined)?.message ?? error));

export interface ScanCacheEntry {
  offset: number;
  found: FoundArtifact[];
  uploads: ArtifactUploadBatch[];
  titles: Record<string, string>;
  inputs: Record<string, ArtifactToolInput | undefined>;
  size?: number;
  mtimeMs?: number;
}

export interface ScanCache {
  files: Record<string, ScanCacheEntry>;
}

export interface ScannedArtifact extends FoundArtifact {
  hasSource?: boolean;
}

export interface TypedTab {
  name: string;
  file: string;
}

export interface CleanTypedMeta {
  url: string;
  id: string;
  title: string;
  kind: TypedKind;
  version: string;
  tabs?: TypedTab[];
  types: Record<string, string>;
}

export interface ScannedTypedPage extends CleanTypedMeta {
  folder: string;
}

export interface PageAssetMeta {
  id: string;
  type: string;
  sha256: string;
}

export interface PageMeta {
  url: string;
  id: string;
  seq: number;
  at: number;
  title: string;
  description: string;
  chat: string;
  chatTitle: string;
  project: string;
  hasSource: boolean;
  assets: PageAssetMeta[];
}

export interface ExternalArtifactMeta {
  id: string;
  hash: string;
  at: number;
  title: string;
  description: string;
  session: string;
}

export interface CleanActivityRow {
  id: string;
  tool: string;
  status: 'done' | 'failed';
  summary: string;
  reason?: string;
  output?: string;
}

export interface CleanHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  mode: string;
  activity?: CleanActivityRow[];
}

export interface UnfetchableEntry {
  seq: number;
  tries: number;
  why: string;
  never?: boolean;
}

export interface TypedStateEntry {
  version: string;
  seq: number;
}

export interface ClaudeSyncReceiverState {
  since: string;
  unfetchable: Record<string, UnfetchableEntry>;
  typed?: Record<string, TypedStateEntry>;
  last: { at: string; from: string; counts: Record<string, number> } | null;
}

export interface ClaudeSyncSessionStore {
  path(id: string): string;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  addImported(chats: Array<Record<string, any>>): Promise<number>;
}

export interface ClaudeSyncArtifactStore {
  items: ArtifactItem[];
  wasRemoved(query?: { id?: string; url?: string }): boolean;
  groupFound(found: { id?: string | null; url?: string; project?: string; chat?: string; chatTitle?: string }): string;
  changed(): Promise<unknown> | unknown;
  importFound(found: FoundClaudeArtifact): Promise<string> | string;
  copyAssets(item: ArtifactItem, assets?: Array<{ id?: string; path?: unknown; type?: unknown; sha256?: unknown }>): Promise<number>;
  importAntigravity(found: FoundExternalArtifact | null | undefined, options?: { respectRemoved?: boolean }): Promise<'copied' | 'updated' | 'skipped'>;
  importCodex(found: FoundExternalArtifact | null | undefined, options?: { respectRemoved?: boolean }): Promise<'copied' | 'updated' | 'skipped'>;
}

export interface ExportedDocPayload {
  title?: string;
  tabs: Array<{ name?: string; html: string }>;
}

export interface ClaudeSyncReceiverOptions {
  sessions: ClaudeSyncSessionStore | null;
  artifacts: ClaudeSyncArtifactStore | null;
  readJSON: <T = unknown>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<void>;
  files: { manifest: string; state: string };
  stageDir: string;
  dataDir?: string;
  download?: ((url: string) => Promise<string>) | null;
  exportDoc?: ((url: string) => Promise<ExportedDocPayload>) | null;
  sessionById?: (id: string) => { turns: number } | null | undefined;
  busy?: (id: string) => boolean;
  now?: () => Date;
}

export interface ScanWorkerData {
  task: 'scan';
  claudeDir?: string;
  desktopDir?: string;
  dropDir?: string;
  cache?: ScanCache | null;
}

export interface ConvertWorkerData extends Omit<ConvertSessionsOptions, 'onProgress'> {
  task: 'convert';
}

export type ClaudeSyncWorkerData = ScanWorkerData | ConvertWorkerData;

export interface ScanWorkerResult {
  groups: SessionGroup[];
  paths: Record<string, string>;
  found: ScannedArtifact[];
  cache: ScanCache;
}

export interface ReadPageResult {
  main: { ext: string; data: string };
  files: Array<{ path: string; data: string }>;
}

export type ReadFileFn = {
  (path: string, encoding: 'utf8'): Promise<string>;
  (path: string): Promise<Buffer>;
};

export type StatFn = (path: string) => Promise<{ isFile(): boolean; size: number }>;

export interface ClaudeSyncCounts {
  chatsAdded: number;
  chatsUpdated: number;
  chatsKept: number;
  pagesCopied: number;
  pagesFetched: number;
  pagesFailed: number;
  pagesOnline: number;
  typedCopied: number;
  docsExported: number;
  files: number;
  antigravityCopied?: number;
  codexCopied?: number;
}

export interface ClaudeSyncSenderState {
  role: 'sender';
  running: boolean;
  progress: string;
  last: { at: string; counts: ClaudeSyncCounts; manual: boolean } | null;
  error: string;
}

export interface ClaudeSyncSenderOptions {
  post: (path: string, body: unknown, timeoutMs?: number) => Promise<any>;
  cacheFile: string;
  stageDir: string;
  readJSON: <T = unknown>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  name?: string;
  claudeDir?: string;
  desktopDir?: string;
  dropDir?: string;
  brainDir?: string;
  codexDir?: string;
  docsDir?: string;
  worker?: (data: ClaudeSyncWorkerData) => Promise<ScanWorkerResult | ConvertSessionsResult>;
  read?: ReadFileFn;
  info?: StatFn;
  now?: () => number;
  log?: (message: string) => void;
  onState?: (state: ClaudeSyncSenderState) => void;
}

/* ── Reading Claude Code's files, from where the last run stopped ─────────────────────────────────────────────────── */

const CALL = Buffer.from('"name":"Artifact"'), ANSWER = Buffer.from('"artifact_id"'), UPLOAD = Buffer.from('"asset_upload'), TITLE = Buffer.from('{"type":"custom-title"');
async function walk(dir: string, depth: number, onFile: (path: string, name: string) => Promise<void> | void): Promise<void> {
  let entries: Dirent[];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) { if (depth > 0) await walk(path, depth - 1, onFile); }
    else if (entry.isFile()) await onFile(path, entry.name);
  }
}
// Reads a transcript's whole lines from entry.offset on, as artifact-import's sessionFile does, and moves the offset to
// the end of its last whole line. An Artifact call whose answer hasn't come yet is kept for the next run.
export async function scanFrom(path: string, entry: ScanCacheEntry): Promise<ScanCacheEntry> {
  const inputs = new Map<string, ArtifactToolInput | undefined>(Object.entries(entry.inputs || {}));
  let rest: Buffer = Buffer.alloc(0);
  const line = (bytes: Buffer): void => {
    if (bytes.subarray(0, TITLE.length).equals(TITLE)) {
      try { const named = JSON.parse(bytes.toString('utf8')) as { sessionId?: string; customTitle?: unknown }; if (named.sessionId && named.customTitle) entry.titles[named.sessionId] = String(named.customTitle).slice(0, 200); } catch {}
      return;
    }
    const call = bytes.includes(CALL);
    if (!call && !bytes.includes(ANSWER) && !bytes.includes(UPLOAD)) return;
    let event: TranscriptEntry;
    try { event = JSON.parse(bytes.toString('utf8')) as TranscriptEntry; } catch { return; }
    const blocks = Array.isArray(event.message?.content) ? (event.message.content as Array<{ type?: string; name?: string; id?: string; input?: ArtifactToolInput; tool_use_id?: string }>) : [];
    if (call) for (const block of blocks) if (block?.type === 'tool_use' && block.name === 'Artifact' && block.id) inputs.set(block.id, block.input);
    const tool = blocks.find(block => block?.tool_use_id)?.tool_use_id;
    const one = foundFromAnswer(event, tool ? inputs.get(tool) : undefined);
    if (one) entry.found.push(one);
    const uploaded = uploadsFromAnswer(event, tool ? inputs.get(tool) : undefined);
    if (uploaded) entry.uploads.push(uploaded);
    if ((one || uploaded) && tool) inputs.delete(tool);
  };
  for await (const chunk of createReadStream(path, { start: entry.offset })) {
    const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const buffer = rest.length ? Buffer.concat([rest, raw]) : raw;
    let from = 0, end: number;
    while ((end = buffer.indexOf(10, from)) !== -1) { line(buffer.subarray(from, end)); from = end + 1; }
    entry.offset += from;
    rest = Buffer.from(buffer.subarray(from));
  }
  entry.inputs = Object.fromEntries([...inputs].slice(-50));
  return entry;
}
const freshEntry = (): ScanCacheEntry => ({ offset: 0, found: [], uploads: [], titles: {}, inputs: {} });
// Every page published from this Mac, as discoverArtifacts finds them, but reading only what's new in each transcript.
// cache: the last run's { files: { path: entry } }; the answer has this run's. hasSource: its page file is here now.
// dropDir: pages saved by hand, as <dropDir>/<the link's last part>/<version>/index.html with the page's other files
// beside it at their published paths. One whose own file is gone is sent from there, for that version only.
export async function scanArtifacts({ claudeDir = join(homedir(), '.claude'), desktopDir = join(homedir(), 'Library/Application Support/Claude/claude-code-sessions'), cache = null, dropDir = '' }: { claudeDir?: string; desktopDir?: string; cache?: ScanCache | null; dropDir?: string } = {}): Promise<{ found: ScannedArtifact[]; cache: ScanCache }> {
  const files: Record<string, ScanCacheEntry> = { ...(cache?.files || {}) }, seen = new Set<string>();
  await walk(join(claudeDir, 'projects'), 4, async (path, name) => {
    if (!name.endsWith('.jsonl')) return;
    seen.add(path);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return;
    let entry = files[path];
    const mtimeMs = Math.round(info.mtimeMs);
    if (entry && entry.size === info.size && entry.mtimeMs === mtimeMs) return;
    // A file that got shorter was written anew, so it's read again from the start.
    if (!entry || !Number.isFinite(entry.offset) || info.size < entry.offset) entry = freshEntry();
    try { await scanFrom(path, entry); } catch (error: unknown) { console.warn('Skipping a session file:', errMsg(error)); return; }
    files[path] = { ...entry, size: info.size, mtimeMs };
  });
  for (const path of Object.keys(files)) if (!seen.has(path)) delete files[path];
  const found: ScannedArtifact[] = [], uploads: ArtifactUploadBatch[] = [], titles = new Map<string, { chat: string; title: string }>();
  for (const entry of Object.values(files)) {
    for (const one of entry.found) mergeFound(found, { ...one, chatTitle: entry.titles?.[one.chat] || one.chatTitle || '' });
    uploads.push(...entry.uploads);
  }
  await walk(desktopDir, 2, async (path, name) => {
    if (!/^local_.*\.json$/.test(name)) return;
    try { const record = JSON.parse(await readFile(path, 'utf8')) as DesktopSessionRecord; desktopTitles(record, titles); for (const one of desktopRecord(record)) mergeFound(found, one); }
    catch (error: unknown) { console.warn('Skipping a desktop record:', errMsg(error)); }
  });
  for (const one of found) { const named = titles.get(one.chat); if (named) { one.chat = named.chat; one.chatTitle = named.title; } }
  attachUploads(found, uploads);
  for (const one of found) {
    const info = one.source && MAIN_EXT.includes(extname(one.source).toLowerCase()) ? await stat(one.source).catch(() => null) : null;
    one.hasSource = Boolean(info?.isFile() && info.size <= MAX_PAGE);
    if (!one.hasSource && dropDir) await fromDrop(one, dropDir);
  }
  return { found: found.sort((a, b) => a.at - b.at), cache: { files } };
}

// A page saved by hand for this version, if there is one: it becomes the page's source, and its other files its files.
async function fromDrop(one: ScannedArtifact, dropDir: string): Promise<void> {
  const key = String(one.url || '').split('/').pop() || '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) return;
  const folder = join(dropDir, key, String(Number(one.seq) || 1));
  for (const ext of MAIN_EXT) {
    const main = join(folder, `index${ext}`), info = await stat(main).catch(() => null);
    if (!info?.isFile() || info.size > MAX_PAGE) continue;
    const files: SupportingFileEntry[] = [];
    await walk(folder, 6, async path => { const published = plainPath(path.slice(folder.length + 1)); if (published && path !== main) files.push([published, [path]]); });
    Object.assign(one, { source: main, files, hasSource: true });
    return;
  }
}

// claude.ai's Docs and Designs, saved by the Claude desktop app (the one place that can download them) in the drop
// folder as <dropDir>/<the link's last part>/typed/: meta.json ({ url, kind, title, version, tabs, assets }) and
// files/ (a Design's project/ and its uploads in _blob/; a Doc's tabs). One copy each, replaced when it changes.
export async function scanTyped(dropDir: string): Promise<ScannedTypedPage[]> {
  const out: ScannedTypedPage[] = [];
  if (!dropDir) return out;
  for (const key of await readdir(dropDir).catch(() => [] as string[])) {
    if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) continue;
    const folder = join(dropDir, key, 'typed');
    let meta: unknown;
    try { meta = JSON.parse(await readFile(join(folder, 'meta.json'), 'utf8')); } catch { continue; }
    const page = cleanTypedMeta(meta);
    if (page && page.url.endsWith(`/${key}`)) out.push({ ...page, folder: join(folder, 'files') });
  }
  return out;
}
export function cleanTypedMeta(meta: unknown): CleanTypedMeta | null {
  const page = cleanPage(meta);
  const raw = meta as { kind?: unknown; version?: unknown; tabs?: unknown; assets?: unknown } | null | undefined;
  if (!page || !TYPED_KINDS.includes(raw?.kind as TypedKind) || typeof raw?.version !== 'string' || !/^[A-Za-z0-9._:-]{1,100}$/.test(raw.version)) return null;
  const kind = raw.kind as TypedKind;
  const tabs: TypedTab[] = (Array.isArray(raw.tabs) ? raw.tabs : [])
    .filter((tab): tab is { name?: unknown; file: string } => typeof (tab as { file?: unknown } | null | undefined)?.file === 'string' && /^tabs\/[A-Za-z0-9._-]{1,100}\.html$/.test((tab as { file: string }).file))
    .slice(0, 50)
    .map(tab => ({ name: text(tab.name, 200), file: tab.file }));
  const types: Record<string, string> = raw.assets && typeof raw.assets === 'object'
    ? Object.fromEntries(
        Object.entries(raw.assets as Record<string, unknown>)
          .filter((entry): entry is [string, string] => BLOB_ID.test(entry[0]) && typeof entry[1] === 'string')
          .slice(0, 255)
          .map(([id, type]) => [id, type.slice(0, 100)]),
      )
    : {};
  return { url: page.url, id: page.id, title: page.title, kind, version: raw.version, ...(kind === 'doc' ? { tabs } : {}), types };
}
// What an upload is, when the desktop app didn't say: by its first bytes.
export function sniffType(bytes: Buffer): string {
  const head = bytes.subarray(0, 16), ascii = head.toString('latin1');
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  if (ascii.slice(4, 8) === 'ftyp') return 'video/mp4';
  if (/^\s*(<\?xml|<svg)/i.test(bytes.subarray(0, 200).toString('utf8'))) return 'image/svg+xml';
  return '';
}

/* ── What goes over the link ──────────────────────────────────────────────────────────────────────────────────────── */

// A page as the plan and the mini see it: what it is and where it belongs, never where its files are on the MacBook.
export function pageMeta(one: Partial<ScannedArtifact> & { url: string }): PageMeta {
  return { url: one.url, id: one.id || '', seq: Number(one.seq) || 1, at: Number(one.at) || 0, title: one.title || '', description: one.description || '', chat: one.chat || '', chatTitle: one.chatTitle || '',
    project: one.project || '', hasSource: one.hasSource === true, assets: (one.assets || []).map(({ id, type, sha256 }) => ({ id, type: type || '', sha256: sha256 || '' })) };
}
// The same, checked on the mini: a claude.ai page address, plain strings and numbers, and nothing else.
export function cleanPage(value: unknown): PageMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.url !== 'string') return null;
  const url = /^https:\/\/claude\.ai\/(?:code\/)?artifact\/([A-Za-z0-9-]{8,64})$/.exec(v.url.trim().replace(/\/+$/, ''));
  if (!url) return null;
  const id = typeof v.id === 'string' && SAFE_ID.test(v.id) ? v.id : url[1]!;
  const assets: PageAssetMeta[] = (Array.isArray(v.assets) ? v.assets : [])
    .filter((asset): asset is { id: string; type?: unknown; sha256?: unknown } => {
      const a = asset as { id?: unknown } | null | undefined;
      return typeof a?.id === 'string' && BLOB_ID.test(a.id);
    })
    .slice(0, 255)
    .map(asset => ({ id: asset.id, type: text(asset.type, 100), sha256: typeof asset.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(asset.sha256) ? asset.sha256.toLowerCase() : '' }));
  const seq = typeof v.seq === 'number' && Number.isInteger(v.seq) && v.seq > 0 && v.seq < 1e6 ? v.seq : 1;
  const at = typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0;
  const chat = typeof v.chat === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v.chat) ? v.chat : '';
  const project = typeof v.project === 'string' && isAbsolute(v.project) ? text(v.project, 1000) : '';
  return { url: url[0], id, seq, at, title: text(v.title, 200), description: text(v.description, 500), chat, chatTitle: text(v.chatTitle, 200),
    project, hasSource: v.hasSource === true, assets };
}
// An Antigravity artifact as the plan and the mini see it: its agy-* id, sha256 content hash, title, summary, and session.
export function antigravityMeta(one: { id?: string; hash?: string; at?: number; title?: string; description?: string; session?: string }): ExternalArtifactMeta {
  return { id: one.id || '', hash: one.hash || '', at: Number(one.at) || 0, title: one.title || '', description: one.description || '', session: one.session || '' };
}
export function cleanAntigravityMeta(value: unknown): ExternalArtifactMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' && ANTIGRAVITY_ID.test(v.id) ? v.id : '';
  const hash = typeof v.hash === 'string' && /^[0-9a-f]{64}$/i.test(v.hash) ? v.hash.toLowerCase() : '';
  if (!id || !hash) return null;
  const session = typeof v.session === 'string' && /^antigravity:[A-Za-z0-9._-]{1,64}$/.test(v.session) ? v.session : '';
  return { id, hash, at: typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0, title: text(v.title, 200), description: text(v.description, 500), session };
}
export function codexMeta(one: { id?: string; hash?: string; at?: number; title?: string; description?: string; session?: string }): ExternalArtifactMeta {
  return { id: one.id || '', hash: one.hash || '', at: Number(one.at) || 0, title: one.title || '', description: one.description || '', session: one.session || 'codex:all' };
}
export function cleanCodexMeta(value: unknown): ExternalArtifactMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const id = typeof v.id === 'string' && CODEX_ID.test(v.id) ? v.id : '';
  const hash = typeof v.hash === 'string' && /^[0-9a-f]{64}$/i.test(v.hash) ? v.hash.toLowerCase() : '';
  if (!id || !hash) return null;
  const session = typeof v.session === 'string' && /^codex:[A-Za-z0-9._-]{1,64}$/.test(v.session) ? v.session : 'codex:all';
  return { id, hash, at: typeof v.at === 'number' && Number.isFinite(v.at) && v.at > 0 ? v.at : 0, title: text(v.title, 200), description: text(v.description, 500), session };
}
const cleanRow = (row: unknown): CleanActivityRow | null => {
  if (!row || typeof row !== 'object') return null;
  const r = row as Record<string, unknown>;
  if (typeof r.tool !== 'string') return null;
  return { id: text(String(r.id ?? ''), 100), tool: r.tool.slice(0, 60), status: r.status === 'done' ? 'done' : 'failed', summary: text(r.summary, 400),
    ...(typeof r.reason === 'string' ? { reason: r.reason.slice(0, 300) } : {}), ...(typeof r.output === 'string' ? { output: r.output.slice(0, 2000) } : {}) };
};
// A chat's turns as the import makes them: who said it, what, when, and for a reply its steps. Nothing else is kept.
export function cleanHistory(value: unknown): CleanHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  const out: CleanHistoryEntry[] = [];
  for (const entry of value.slice(-1000)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if ((e.role !== 'user' && e.role !== 'assistant') || typeof e.content !== 'string') continue;
    const one: CleanHistoryEntry = { role: e.role, content: e.content.slice(0, 70000), at: text(e.at, 40), mode: IMPORTED_MODE };
    if (e.role === 'assistant' && Array.isArray(e.activity)) { const rows = e.activity.slice(-200).map(cleanRow).filter((row): row is CleanActivityRow => Boolean(row)); if (rows.length) one.activity = rows; }
    out.push(one);
  }
  return out;
}

/* ── The mini's side ──────────────────────────────────────────────────────────────────────────────────────────────── */

const emptyState = (): ClaudeSyncReceiverState => ({ since: '', unfetchable: {}, last: null });
export class ClaudeSyncReceiver {
  sessions: ClaudeSyncSessionStore | null;
  artifacts: ClaudeSyncArtifactStore | null;
  readJSON: <T = unknown>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<void>;
  files: { manifest: string; state: string };
  stageDir: string;
  dataDir: string;
  download: ((url: string) => Promise<string>) | null;
  exportDoc: ((url: string) => Promise<ExportedDocPayload>) | null;
  sessionById: (id: string) => { turns: number } | null | undefined;
  busy: (id: string) => boolean;
  now: () => Date;
  queue: Promise<unknown>;
  data: ClaudeSyncReceiverState | null;
  cannotDownload?: string;
  cannotExport?: string;

  // sessions, artifacts: Fairy's stores; manifest: the chat import's record (claude-code-import.json); state: this
  // sync's own (claude-sync.json); stageDir: where sent files wait while they're copied in; download(url): a page
  // folder from claude.ai (artifact-link's downloadArtifact), or null where Claude Code isn't signed in.
  constructor({ sessions, artifacts, readJSON, writeJSON, files, stageDir, dataDir = '', download = null, exportDoc = null, sessionById = () => null, busy = () => false, now = () => new Date() }: ClaudeSyncReceiverOptions) {
    this.sessions = sessions;
    this.artifacts = artifacts;
    this.readJSON = readJSON;
    this.writeJSON = writeJSON;
    this.files = files;
    this.stageDir = stageDir;
    this.dataDir = dataDir;
    this.download = download;
    this.exportDoc = exportDoc;
    this.sessionById = sessionById;
    this.busy = busy;
    this.now = now;
    this.queue = Promise.resolve(); this.data = null;
  }
  // One step at a time: the manifest and the page list are each read, changed and written whole.
  serial<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next; }
  async state(): Promise<ClaudeSyncReceiverState> {
    if (!this.data) {
      const saved = await this.readJSON<Partial<ClaudeSyncReceiverState> | null>(this.files.state, null);
      this.data = { ...emptyState(), ...(saved && typeof saved === 'object' ? saved : {}) };
      if (!this.data.unfetchable || typeof this.data.unfetchable !== 'object') this.data.unfetchable = {};
      // Each start gives a page that failed for a passing reason its tries again; one that can never be a page stays.
      this.data.unfetchable = Object.fromEntries(Object.entries(this.data.unfetchable).filter(([, value]) => value?.never));
    }
    return this.data;
  }
  async report(): Promise<{ role: 'receiver'; last: ClaudeSyncReceiverState['last'] }> { const { last } = await this.state(); return { role: 'receiver', last }; }
  saveState(): Promise<void> { return this.writeJSON(this.files.state, this.data); }
  manifest(): Promise<Record<string, ImportManifestEntry | undefined>> { return this.readJSON<Record<string, ImportManifestEntry | undefined> | null>(this.files.manifest, null).then(value => (value && typeof value === 'object' ? value : {})); }

  planChats({ groups }: { groups?: unknown } = {}): Promise<{ todo: string[]; kept: number }> {
    return this.serial(async () => {
      const list = (Array.isArray(groups) ? groups : [])
        .slice(0, 50_000)
        .filter((group): group is { id: string; signature: string } => {
          const g = group as { id?: unknown; signature?: unknown } | null | undefined;
          return typeof g?.id === 'string' && CHAT_ID.test(g.id) && typeof g.signature === 'string';
        })
        .map(group => ({ id: group.id, signature: group.signature.slice(0, 20_000) }));
      const { todo, kept } = planImport(list as unknown as SessionGroup[], await this.manifest(), { sessionById: this.sessionById, busy: this.busy });
      return { todo: todo.map(group => group.id), kept: kept.length };
    });
  }
  // Sessions that turned out to be a program's, not a chat: recorded so they aren't built again.
  skipped({ chats }: { chats?: unknown } = {}): Promise<{ skipped: number }> {
    return this.serial(async () => {
      const manifest = await this.manifest();
      let count = 0;
      for (const raw of (Array.isArray(chats) ? chats : []).slice(0, 5000)) {
        const chat = raw as { id?: unknown; signature?: unknown } | null | undefined;
        if (typeof chat?.id !== 'string' || !CHAT_ID.test(chat.id) || typeof chat.signature !== 'string' || (manifest[chat.id]?.turns ?? 0) > 0) continue;
        manifest[chat.id] = { signature: chat.signature.slice(0, 20_000), turns: 0 }; count++;
      }
      if (count) await this.writeJSON(this.files.manifest, manifest);
      return { skipped: count };
    });
  }
  chat(body: Record<string, unknown> = {}): Promise<{ result: 'kept' | 'skipped' | 'added' | 'updated' }> {
    return this.serial(async () => {
      const { id, signature } = body;
      if (typeof id !== 'string' || !CHAT_ID.test(id) || typeof signature !== 'string') throw failure(400, 'That chat wasn’t understood.');
      const manifest = await this.manifest(), known = manifest[id];
      // Checked again: you may have carried on with it here since the plan.
      if (this.busy(id)) return { result: 'kept' };
      if (known && known.turns > 0) { const session = this.sessionById(id); if (!session || session.turns !== known.turns) return { result: 'kept' }; }
      const history = cleanHistory(body.history);
      if (!history.some(entry => entry.role === 'user')) {
        if (!(known && known.turns > 0)) { manifest[id] = { signature: signature.slice(0, 20_000), turns: 0 }; await this.writeJSON(this.files.manifest, manifest); }
        return { result: 'skipped' };
      }
      const cwd = typeof body.cwd === 'string' && isAbsolute(body.cwd) ? body.cwd.slice(0, 1000) : '';
      const folder = cwd ? workFolderFor(cwd, { dataDir: this.dataDir }) : null;
      await this.sessions!.writeJSON(this.sessions!.path(id), history);
      const imported = body.imported && typeof body.imported === 'object' ? (body.imported as { project?: unknown }) : null;
      const project = text(imported?.project, 120) || projectName(cwd);
      const existed = Boolean(this.sessionById(id));
      await this.sessions!.addImported([{ id, turns: history.length, title: text(body.title, 200) || 'Claude Code chat', createdAt: history[0]!.at, updatedAt: history.at(-1)!.at,
        imported: { from: IMPORTED_MODE, project, turns: history.length, ...(cwd && inNotebook(cwd) ? { notebook: true } : {}) }, ...(folder ? { work: { folder, permission: 'ask' } } : {}) }]);
      manifest[id] = { signature: signature.slice(0, 20_000), turns: history.length };
      await this.writeJSON(this.files.manifest, manifest);
      return { result: existed ? 'updated' : 'added' };
    });
  }

  // Which pages need their files: new ones (unless you removed them, or they're older than the last import here), and
  // ones published since the copy here. Each page's chat and folder are brought up to date as it goes.
  planPages({ pages }: { pages?: unknown } = {}): Promise<{ send: string[]; fetch: string[]; assets: Array<{ url: string; ids: string[] }> }> {
    return this.serial(async () => {
      const state = await this.state(), store = this.artifacts!, send: string[] = [], fetch: string[] = [], assets: Array<{ url: string; ids: string[] }> = [];
      // The first sync starts from the newest page the old import brought in: anything older it didn't bring was removed.
      if (!state.since) {
        const newest = store.items.filter(item => item.origin === 'claude').map(item => item.updatedAt).filter(Boolean).sort().at(-1);
        state.since = newest || 'none';
      }
      const since = state.since === 'none' ? 0 : Date.parse(state.since) || 0;
      let grouped = 0;
      for (const raw of (Array.isArray(pages) ? pages : []).slice(0, 10_000)) {
        const page = cleanPage(raw);
        // A Doc or Design comes only from the drop folder, by its claude.ai version (planTyped), never by publish number.
        if (!page || state.typed?.[page.url]) continue;
        const item = store.items.find(entry => entry.id === page.id || (entry.url && sameURL(entry.url, page.url)));
        let need: boolean;
        if (!item) {
          if (store.wasRemoved(page) || (since && page.at <= since)) continue;
          need = true;
        } else {
          if (item.origin !== 'claude') continue;
          const before = JSON.stringify([item.session, item.sessionTitle, item.folder]);
          store.groupFound(page);
          if (JSON.stringify([item.session, item.sessionTitle, item.folder]) !== before) grouped++;
          need = !item.versions.some(version => version.seq >= page.seq && version.file);
        }
        const missing = page.assets.filter(asset => !item?.assets?.[asset.id]).map(asset => asset.id);
        if (missing.length) assets.push({ url: page.url, ids: missing });
        if (!need) continue;
        if (page.hasSource) send.push(page.url);
        else {
          const tried = state.unfetchable[page.url];
          if (!tried || tried.seq < page.seq || (tried.tries < FETCH_TRIES && !tried.never)) fetch.push(page.url);
        }
      }
      if (grouped) await store.changed();
      await this.saveState();
      return { send, fetch, assets };
    });
  }
  // A page and its files as the MacBook read them: main is the page itself ({ ext, data }), files its others.
  page({ page: raw, main, files }: { page?: unknown; main?: unknown; files?: unknown } = {}): Promise<{ result: string }> {
    return this.serial(async () => {
      const page = cleanPage(raw), mainObj = main as { ext?: unknown; data?: unknown } | null | undefined, ext = typeof mainObj?.ext === 'string' ? mainObj.ext.toLowerCase() : '';
      if (!page || !MAIN_EXT.includes(ext) || typeof mainObj?.data !== 'string' || !BASE64.test(mainObj.data)) throw failure(400, 'That page wasn’t understood.');
      const stage = join(this.stageDir, randomUUID()), source = join(stage, `index${ext}`), rest: SupportingFileEntry[] = [];
      try {
        await mkdir(stage, { recursive: true, mode: 0o700 });
        const bytes = Buffer.from(mainObj.data, 'base64');
        if (bytes.length > MAX_PAGE) throw failure(413, 'That page is too big.');
        await writeFile(source, bytes, { mode: 0o600 });
        for (const file of (Array.isArray(files) ? files : []).slice(0, MAX_PAGE_FILES)) {
          const f = file as { path?: unknown; data?: unknown } | null | undefined;
          const clean = plainPath(f?.path || '');
          if (!clean || clean === `index${ext}` || typeof f?.data !== 'string' || !BASE64.test(f.data)) continue;
          const full = join(stage, 'files', clean), data = Buffer.from(f.data, 'base64');
          if (data.length > MAX_FILE) continue;
          await mkdir(dirname(full), { recursive: true, mode: 0o700 });
          await writeFile(full, data, { mode: 0o600 });
          rest.push([clean, [full]]);
        }
        const result = await this.artifacts!.importFound({ ...page, source, files: rest, assets: [] });
        await this.artifacts!.changed();
        return { result };
      } finally { await rm(stage, { recursive: true, force: true }).catch(() => {}); }
    });
  }
  // One file a page uploaded (its asset store), checked against the sha256 it was uploaded with.
  asset({ url, asset, data }: { url?: unknown; asset?: unknown; data?: unknown } = {}): Promise<{ result: 'copied' | 'skipped' }> {
    return this.serial(async () => {
      const item = this.artifacts!.items.find(entry => entry.origin === 'claude' && entry.url && sameURL(entry.url, url));
      if (!item) throw failure(409, 'That page isn’t here yet.');
      const a = asset as { id?: unknown; type?: unknown; sha256?: unknown } | null | undefined;
      if (typeof a?.id !== 'string' || !BLOB_ID.test(a.id) || typeof data !== 'string' || !BASE64.test(data)) throw failure(400, 'That file wasn’t understood.');
      const stage = join(this.stageDir, randomUUID()), path = join(stage, a.id);
      try {
        await mkdir(stage, { recursive: true, mode: 0o700 });
        await writeFile(path, Buffer.from(data, 'base64'), { mode: 0o600 });
        const copied = await this.artifacts!.copyAssets(item, [{ id: a.id, path, type: text(a.type, 100), sha256: typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(a.sha256) ? a.sha256 : '' }]);
        if (copied) await this.artifacts!.changed();
        return { result: copied ? 'copied' : 'skipped' };
      } finally { await rm(stage, { recursive: true, force: true }).catch(() => {}); }
    });
  }
  // A page whose files are gone on the MacBook, downloaded from claude.ai here. Not inside serial(): it takes minutes,
  // and only its copy at the end needs the page list to itself.
  async fetch({ page: raw }: { page?: unknown } = {}): Promise<{ result: string; why?: string }> {
    const page = cleanPage(raw);
    if (!page) throw failure(400, 'That page wasn’t understood.');
    // Downloads can't be made here (no Artifact tool, or not signed in): said once, and not tried again until Fairy
    // starts anew, so a run doesn't start Claude Code a dozen times to hear it.
    if (!this.download || this.cannotDownload) return { result: 'unavailable', why: this.cannotDownload || 'No downloads here.' };
    const state = await this.state(), mark = (why: string, never = false): Promise<void> => {
      const before = state.unfetchable[page.url];
      state.unfetchable[page.url] = { seq: page.seq, tries: before?.seq === page.seq ? (before.tries || 0) + 1 : 1, why: String(why).slice(0, 200), ...(never ? { never: true } : {}) };
      return this.serial(() => this.saveState());
    };
    let folder: string;
    try { folder = await this.download(page.url); }
    catch (error: unknown) {
      const message = errMsg(error);
      if ([NO_ARTIFACT_TOOL, NOT_SIGNED_IN].includes(message)) { this.cannotDownload = message; return { result: 'unavailable', why: message }; }
      await mark(message, /Doc|Design|typed|can’t show/i.test(message)); return { result: 'failed', why: String(message).slice(0, 200) }; }
    try {
      const { root, files } = await savedFiles(folder);
      if (!files.includes('index.html')) { await mark('No page of its own (a Doc or Design).', true); return { result: 'failed', why: 'No page of its own.' }; }
      return await this.serial(async () => {
        const result = await this.artifacts!.importFound({ ...page, source: join(root, 'index.html'), files: files.filter(file => file !== 'index.html').map(file => [file, [join(root, file)]] as SupportingFileEntry), assets: [] });
        await this.artifacts!.changed();
        delete state.unfetchable[page.url];
        await this.saveState();
        return { result };
      });
    } finally { await clearDownload(folder); }
  }
  done({ counts, from }: { counts?: unknown; from?: unknown } = {}): Promise<{ ok: true }> {
    return this.serial(async () => {
      const state = await this.state(), number = (value: unknown): number => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0);
      const tally = counts && typeof counts === 'object' ? Object.fromEntries(Object.entries(counts as Record<string, unknown>).slice(0, 20).map(([key, value]) => [String(key).slice(0, 30), number(value)])) : {};
      state.last = { at: this.now().toISOString(), from: text(from, 60), counts: tally };
      await this.saveState();
      return { ok: true };
    });
  }

  // claude.ai Docs and Designs from the drop folder: wanted when their version is new here, unless you removed them.
  planTyped({ pages }: { pages?: unknown } = {}): Promise<{ send: string[] }> {
    return this.serial(async () => {
      const state = await this.state(), send: string[] = [];
      state.typed ||= {};
      for (const raw of (Array.isArray(pages) ? pages : []).slice(0, 2000)) {
        const page = cleanTypedMeta(raw);
        if (!page || this.artifacts!.wasRemoved(page) || state.typed[page.url]?.version === page.version) continue;
        const item = this.artifacts!.items.find(entry => entry.id === page.id || (entry.url && sameURL(entry.url, page.url)));
        if (item && item.origin !== 'claude') continue;
        send.push(page.url);
      }
      return { send };
    });
  }
  // One of them with its files: Fairy makes the page that shows it (typed-pages.mjs) and keeps it as a new version.
  typed({ page: raw, files }: { page?: unknown; files?: unknown } = {}): Promise<{ result: string }> {
    return this.serial(async () => {
      const page = cleanTypedMeta(raw);
      if (!page) throw failure(400, 'That page wasn’t understood.');
      const stage = join(this.stageDir, randomUUID()), kept: SupportingFileEntry[] = [], texts = new Map<string, string>();
      try {
        await mkdir(stage, { recursive: true, mode: 0o700 });
        for (const file of (Array.isArray(files) ? files : []).slice(0, MAX_PAGE_FILES)) {
          const f = file as { path?: unknown; data?: unknown } | null | undefined;
          const clean = plainPath(f?.path || '');
          if (!clean || clean === 'index.html' || clean.startsWith('_blob/') || typeof f?.data !== 'string' || !BASE64.test(f.data)) continue;
          const bytes = Buffer.from(f.data, 'base64');
          if (bytes.length > MAX_FILE) continue;
          if (page.kind === 'doc' ? clean.startsWith('tabs/') : clean === 'project/canvas.json') texts.set(clean, bytes.toString('utf8'));
          if (page.kind === 'doc') continue;
          const full = join(stage, 'files', clean);
          await mkdir(dirname(full), { recursive: true, mode: 0o700 });
          await writeFile(full, bytes, { mode: 0o600 });
          kept.push([clean, [full]]);
        }
        let canvas: CanvasInput | null = null;
        try { canvas = JSON.parse(texts.get('project/canvas.json') || 'null') as CanvasInput | null; } catch {}
        const html = page.kind === 'design'
          ? designViewer({ title: page.title, canvas, files: kept.map(([path]) => path) })
          : docPage({ title: page.title, tabs: (page.tabs || []).map(tab => ({ name: tab.name, html: texts.get(tab.file) ?? '' })) });
        const source = join(stage, 'index.html');
        await writeFile(source, html, { mode: 0o600 });
        const item = this.artifacts!.items.find(entry => entry.id === page.id || (entry.url && sameURL(entry.url, page.url))), latest = item?.versions.at(-1);
        const seq = !latest ? 1 : latest.file ? latest.seq + 1 : latest.seq;
        const result = await this.artifacts!.importFound({ url: page.url, id: page.id, title: page.title, description: '', source, files: kept, project: '', seq, at: this.now().getTime(), chat: '', assets: [] });
        await this.artifacts!.changed();
        const state = await this.state();
        (state.typed ||= {})[page.url] = { version: page.version, seq };
        await this.saveState();
        return { result };
      } finally { await rm(stage, { recursive: true, force: true }).catch(() => {}); }
    });
  }

  // A Doc whose version is new, exported here by Claude Code with its Claude Docs connector, then kept as typed() keeps
  // one. Not inside serial(): the export takes a while, and typed() takes its turn after.
  async doc({ page: raw }: { page?: unknown } = {}): Promise<{ result: string; why?: string }> {
    const page = cleanTypedMeta(raw);
    if (!page || page.kind !== 'doc') throw failure(400, 'That Doc wasn’t understood.');
    if (!this.exportDoc || this.cannotExport) return { result: 'unavailable', why: this.cannotExport || 'No Doc exports here.' };
    let exported: ExportedDocPayload;
    try { exported = await this.exportDoc(page.url); }
    catch (error: unknown) {
      const message = errMsg(error);
      if (message === NO_CONNECTOR || /isn’t signed in/.test(message)) { this.cannotExport = message; return { result: 'unavailable', why: message }; }
      return { result: 'failed', why: String(message).slice(0, 200) };
    }
    const tabs = exported.tabs.map((tab, i) => ({ name: tab.name, file: `tabs/${i + 1}.html` }));
    return this.typed({ page: { ...page, title: exported.title || page.title, tabs }, files: exported.tabs.map((tab, i) => ({ path: tabs[i]!.file, data: Buffer.from(tab.html).toString('base64') })) });
  }

  // Antigravity artifacts from the MacBook: wanted when new (unless removed during auto-sync) or when content hash changed.
  planAntigravity({ pages, manual = false }: { pages?: unknown; manual?: unknown } = {}): Promise<{ send: string[] }> {
    const isManual = Boolean(manual);
    return this.serial(async () => {
      const send: string[] = [];
      for (const raw of (Array.isArray(pages) ? pages : []).slice(0, 2000)) {
        const page = cleanAntigravityMeta(raw);
        if (!page) continue;
        const item = this.artifacts!.items.find(entry => entry.id === page.id);
        if (item && item.origin !== 'antigravity') continue;
        if (!item && !isManual && this.artifacts!.wasRemoved({ id: page.id })) continue;
        if (item && item.sourceHash === page.hash && item.versions.some(version => version.file)) continue;
        send.push(page.id);
      }
      return { send };
    });
  }
  antigravity({ page: raw, main, files, manual = false }: { page?: unknown; main?: unknown; files?: unknown; manual?: unknown } = {}): Promise<{ result: 'copied' | 'updated' | 'skipped' }> {
    const isManual = Boolean(manual);
    return this.serial(async () => {
      const page = cleanAntigravityMeta(raw), mainObj = main as { ext?: unknown; data?: unknown } | null | undefined, ext = typeof mainObj?.ext === 'string' ? mainObj.ext.toLowerCase() : '';
      if (!page || !MAIN_EXT.includes(ext) || typeof mainObj?.data !== 'string' || !BASE64.test(mainObj.data)) throw failure(400, 'That Antigravity artifact wasn’t understood.');
      const stage = join(this.stageDir, randomUUID()), source = join(stage, `index${ext}`), rest: SupportingFileEntry[] = [];
      try {
        await mkdir(stage, { recursive: true, mode: 0o700 });
        const bytes = Buffer.from(mainObj.data, 'base64');
        if (!bytes.length || bytes.length > MAX_PAGE) throw failure(413, 'That Antigravity artifact is too big.');
        await writeFile(source, bytes, { mode: 0o600 });
        for (const file of (Array.isArray(files) ? files : []).slice(0, MAX_PAGE_FILES)) {
          const f = file as { path?: unknown; data?: unknown } | null | undefined;
          const clean = plainPath(f?.path || '');
          if (!clean || clean === `index${ext}` || typeof f?.data !== 'string' || !BASE64.test(f.data)) continue;
          const full = join(stage, 'files', clean), data = Buffer.from(f.data, 'base64');
          if (data.length > MAX_FILE) continue;
          await mkdir(dirname(full), { recursive: true, mode: 0o700 });
          await writeFile(full, data, { mode: 0o600 });
          rest.push([clean, [full]]);
        }
        const result = await this.artifacts!.importAntigravity({ ...page, source, files: rest }, { respectRemoved: !isManual });
        await this.artifacts!.changed();
        return { result };
      } finally { await rm(stage, { recursive: true, force: true }).catch(() => {}); }
    });
  }

  // ChatGPT (Codex) artifacts from the MacBook: wanted when new (unless removed during auto-sync) or when content hash changed.
  planCodex({ pages, manual = false }: { pages?: unknown; manual?: unknown } = {}): Promise<{ send: string[] }> {
    const isManual = Boolean(manual);
    return this.serial(async () => {
      const send: string[] = [];
      for (const raw of (Array.isArray(pages) ? pages : []).slice(0, 2000)) {
        const page = cleanCodexMeta(raw);
        if (!page) continue;
        const item = this.artifacts!.items.find(entry => entry.id === page.id);
        if (item && item.origin !== 'codex') continue;
        if (!item && !isManual && this.artifacts!.wasRemoved({ id: page.id })) continue;
        if (item && item.sourceHash === page.hash && item.versions.some(version => version.file)) continue;
        send.push(page.id);
      }
      return { send };
    });
  }
  codex({ page: raw, main, files, manual = false }: { page?: unknown; main?: unknown; files?: unknown; manual?: unknown } = {}): Promise<{ result: 'copied' | 'updated' | 'skipped' }> {
    const isManual = Boolean(manual);
    return this.serial(async () => {
      const page = cleanCodexMeta(raw), mainObj = main as { ext?: unknown; data?: unknown } | null | undefined, ext = typeof mainObj?.ext === 'string' ? mainObj.ext.toLowerCase() : '';
      if (!page || !CODEX_EXT.includes(ext) || typeof mainObj?.data !== 'string' || !BASE64.test(mainObj.data)) throw failure(400, 'That ChatGPT artifact wasn’t understood.');
      const stage = join(this.stageDir, randomUUID()), source = join(stage, `index${ext}`), rest: SupportingFileEntry[] = [];
      try {
        await mkdir(stage, { recursive: true, mode: 0o700 });
        const bytes = Buffer.from(mainObj.data, 'base64');
        const limit = MAIN_EXT.includes(ext) ? MAX_PAGE : MAX_FILE;
        if (!bytes.length || bytes.length > limit) throw failure(413, 'That ChatGPT artifact is too big.');
        await writeFile(source, bytes, { mode: 0o600 });
        for (const file of (Array.isArray(files) ? files : []).slice(0, MAX_PAGE_FILES)) {
          const f = file as { path?: unknown; data?: unknown } | null | undefined;
          const clean = plainPath(f?.path || '');
          if (!clean || clean === `index${ext}` || typeof f?.data !== 'string' || !BASE64.test(f.data)) continue;
          const full = join(stage, 'files', clean), data = Buffer.from(f.data, 'base64');
          if (data.length > MAX_FILE) continue;
          await mkdir(dirname(full), { recursive: true, mode: 0o700 });
          await writeFile(full, data, { mode: 0o600 });
          rest.push([clean, [full]]);
        }
        const result = await this.artifacts!.importCodex({ ...page, source, files: rest }, { respectRemoved: !isManual });
        await this.artifacts!.changed();
        return { result };
      } finally { await rm(stage, { recursive: true, force: true }).catch(() => {}); }
    });
  }

  // The face link's requests, from a paired Mac. Each says what it is by its path.
  async handle(request: IncomingMessage, response: ServerResponse, { pathname, link, device }: { pathname: string; link: FaceHttpLink; device?: FaceDevice }): Promise<unknown> {
    if (request.method !== 'POST') throw failure(404, 'Not found.');
    const step = pathname.slice('/v1/face/claude/'.length);
    const limit = ({ 'plan-chats': LIMITS.plan, skipped: LIMITS.plan, chat: LIMITS.chat, 'plan-pages': LIMITS.plan, page: LIMITS.page, asset: LIMITS.asset, fetch: LIMITS.small, done: LIMITS.small, 'plan-typed': LIMITS.plan, typed: LIMITS.page, doc: LIMITS.small, 'plan-antigravity': LIMITS.plan, antigravity: LIMITS.page, 'plan-codex': LIMITS.plan, codex: LIMITS.asset } as Record<string, number | undefined>)[step];
    if (!limit) throw failure(404, 'Not found.');
    const body = await link.body(request, limit);
    const answer = step === 'plan-chats' ? await this.planChats(body) : step === 'skipped' ? await this.skipped(body) : step === 'chat' ? await this.chat(body)
      : step === 'plan-pages' ? await this.planPages(body) : step === 'page' ? await this.page(body) : step === 'asset' ? await this.asset(body)
      : step === 'fetch' ? await this.fetch(body) : step === 'plan-typed' ? await this.planTyped(body) : step === 'typed' ? await this.typed(body) : step === 'doc' ? await this.doc(body)
      : step === 'plan-antigravity' ? await this.planAntigravity(body) : step === 'antigravity' ? await this.antigravity(body)
      : step === 'plan-codex' ? await this.planCodex(body) : step === 'codex' ? await this.codex(body)
      : await this.done({ ...body, from: device?.name || body?.from });
    return link.send(response, 200, answer);
  }
}

/* ── The MacBook's side ───────────────────────────────────────────────────────────────────────────────────────────── */

// Runs a scan or a build on a worker thread (claude-sync-worker.mjs), so the face stays responsive.
export function runWorker(workerData: ScanWorkerData): Promise<ScanWorkerResult>;
export function runWorker(workerData: ConvertWorkerData): Promise<ConvertSessionsResult>;
export function runWorker(workerData: ClaudeSyncWorkerData): Promise<ScanWorkerResult | ConvertSessionsResult>;
export function runWorker(workerData: ClaudeSyncWorkerData): Promise<ScanWorkerResult | ConvertSessionsResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./claude-sync-worker.mjs', import.meta.url), { workerData });
    let settled = false;
    worker.on('message', (message: { result?: ScanWorkerResult | ConvertSessionsResult; error?: string }) => { if (message.result) { settled = true; resolve(message.result); } if (message.error) { settled = true; reject(new Error(message.error)); } });
    worker.on('error', error => { settled = true; reject(error); });
    worker.on('exit', code => { if (!settled) reject(new Error(code ? 'The sync stopped early.' : 'The sync stopped.')); });
  });
}
// A page and the files it published with, read from where they were: the first place each one is found. Left out
// when they'd make it too big to send.
export async function readPage(
  one: { source?: string | null; files?: SupportingFileEntry[] | null },
  { read = readFile, info = stat, allowedExt = MAIN_EXT }: { read?: ReadFileFn; info?: StatFn; allowedExt?: readonly string[] } = {},
): Promise<ReadPageResult | null> {
  const ext = extname(one.source || '').toLowerCase();
  if (!allowedExt.includes(ext)) return null;
  const main = await read(one.source!);
  const limit = MAIN_EXT.includes(ext) ? MAX_PAGE : MAX_FILE;
  if (main.length > limit) return null;
  let size = main.length;
  const files: Array<{ path: string; data: string }> = [];
  for (const [published, candidates] of (one.files || []).slice(0, MAX_PAGE_FILES)) {
    for (const candidate of candidates || []) {
      const found = await info(candidate).catch(() => null);
      if (!found?.isFile() || found.size > MAX_FILE) continue;
      if ((size + found.size) * 4 / 3 > PAGE_BODY) break;
      const data = await read(candidate).catch(() => null);
      if (!data) continue;
      size += data.length;
      files.push({ path: published, data: data.toString('base64') });
      break;
    }
  }
  return { main: { ext, data: main.toString('base64') }, files };
}

export class ClaudeSyncSender {
  post: (path: string, body: unknown, timeoutMs?: number) => Promise<any>;
  cacheFile: string;
  stageDir: string;
  readJSON: <T = unknown>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<unknown>;
  name: string;
  claudeDir: string | undefined;
  desktopDir: string | undefined;
  dropDir: string;
  brainDir: string;
  codexDir: string;
  docsDir: string;
  worker: (data: ClaudeSyncWorkerData) => Promise<ScanWorkerResult | ConvertSessionsResult>;
  read: ReadFileFn;
  info: StatFn;
  now: () => number;
  log: (message: string) => void;
  onState: (state: ClaudeSyncSenderState) => void;
  running: Promise<ClaudeSyncCounts> | null;
  last: ClaudeSyncSenderState['last'];
  error: string;
  progress: string;
  failures: Map<string, number>;
  unavailable?: string;

  // post(path, body, timeoutMs): the face client's call to the mini. cacheFile: where the last scan's offsets are kept.
  constructor({ post, cacheFile, stageDir, readJSON, writeJSON, name = 'Mac', claudeDir, desktopDir, dropDir = '', brainDir = '', codexDir = join(homedir(), '.codex'), docsDir = join(homedir(), 'Documents/Codex'), worker = runWorker, read = readFile, info = stat, now = Date.now, log = () => {}, onState = () => {} }: ClaudeSyncSenderOptions) {
    this.post = post;
    this.cacheFile = cacheFile;
    this.stageDir = stageDir;
    this.readJSON = readJSON;
    this.writeJSON = writeJSON;
    this.name = name;
    this.claudeDir = claudeDir;
    this.desktopDir = desktopDir;
    this.dropDir = dropDir;
    this.brainDir = brainDir;
    this.codexDir = codexDir;
    this.docsDir = docsDir;
    this.worker = worker;
    this.read = read;
    this.info = info;
    this.now = now;
    this.log = log;
    this.onState = onState;
    this.running = null; this.last = null; this.error = ''; this.progress = ''; this.failures = new Map();
  }
  // Sends one thing, unless it has failed SEND_TRIES times already: its answer, or null when it was skipped or failed.
  async attempt<T>(key: string, send: () => Promise<T>): Promise<T | null> {
    if ((this.failures.get(key) || 0) >= SEND_TRIES) return null;
    try { const answer = await send(); this.failures.delete(key); return answer; }
    catch (error: unknown) { this.failures.set(key, (this.failures.get(key) || 0) + 1); this.log(`Claude sync: ${key} didn’t go (${errMsg(error)})`); return null; }
  }
  state(): ClaudeSyncSenderState { return { role: 'sender', running: Boolean(this.running), progress: this.progress, last: this.last, error: this.error }; }
  step(words: string): void { this.progress = words; this.onState(this.state()); }
  // One run at a time; a second ask while one runs gets that run.
  run({ manual = false }: { manual?: boolean } = {}): Promise<ClaudeSyncCounts> {
    this.running ??= this.go({ manual }).then(counts => { this.last = { at: new Date(this.now()).toISOString(), counts, manual }; this.error = ''; return counts; },
      (error: unknown) => { this.error = String(errMsg(error)).slice(0, 300); throw error; })
      .finally(() => { this.running = null; this.progress = ''; this.onState(this.state()); });
    this.onState(this.state());
    return this.running;
  }
  // The Docs on the desktop app's daily list (<dropDir>/_typed.json: { items: { url: { kind, title, version } } }), whose
  // version is the day claude.ai last changed them.
  async listedDocs(): Promise<CleanTypedMeta[]> {
    let list: { items?: unknown } | null = null;
    try { list = JSON.parse(await this.read(join(this.dropDir, '_typed.json'), 'utf8')) as { items?: unknown }; } catch { return []; }
    return Object.entries(list?.items && typeof list.items === 'object' ? (list.items as Record<string, unknown>) : {})
      .filter((entry): entry is [string, { kind: 'doc'; title?: unknown; version?: unknown }] => (entry[1] as { kind?: unknown } | null | undefined)?.kind === 'doc')
      .map(([url, item]) => cleanTypedMeta({ url, kind: 'doc', title: item.title, version: String(item.version ?? ''), tabs: [] }))
      .filter((doc): doc is CleanTypedMeta => Boolean(doc));
  }
  // Designs the desktop app saved in the drop folder, each new version with its files and then its uploads; and the
  // Docs on its list whose version is new, which the other Mac exports itself (doc-export.mjs runs no model here).
  async sendTyped(counts: { pagesFailed: number; typedCopied: number; files: number; docsExported?: number }): Promise<void> {
    if (!this.dropDir) return;
    const typed = await scanTyped(this.dropDir), docs = (await this.listedDocs()).filter(doc => !typed.some(entry => entry.url === doc.url));
    const all: Array<CleanTypedMeta & { folder: string | null }> = [...typed, ...docs.map(doc => ({ ...doc, folder: null }))];
    if (!all.length) return;
    const { send = [] } = (await this.post('/v1/face/claude/plan-typed', { pages: all.map(({ folder, ...page }) => page) }, 120_000)) as { send?: string[] };
    let sent = 0, exported = 0, noDocs = false;
    for (const url of send) {
      const page = all.find(entry => entry.url === url);
      if (!page) continue;
      this.step(`Bringing Docs and Designs: ${++sent} of ${send.length}`);
      if (!page.folder) {
        if (noDocs || exported >= DOCS_PER_RUN) continue;
        exported++;
        const { folder, ...meta } = page;
        const answer = await this.attempt(`doc ${url} ${page.version}`, () => this.post('/v1/face/claude/doc', { page: meta }, FETCH_WAIT_MS)) as { result?: string } | null;
        if (answer?.result === 'copied') { counts.docsExported = (counts.docsExported ?? 0) + 1; counts.typedCopied++; }
        else if (answer?.result === 'unavailable') noDocs = true;
        else counts.pagesFailed++;
        continue;
      }
      const files: Array<{ path: string; data: string }> = [], blobs: Array<{ id: string; path: string }> = [];
      let size = 0;
      const folderPath = page.folder;
      await walk(folderPath, 6, async path => {
        const published = plainPath(path.slice(folderPath.length + 1));
        if (!published) return;
        const blob = /^_blob\/([0-9a-f]{32})$/.exec(published);
        if (blob) { blobs.push({ id: blob[1]!, path }); return; }
        const info = await this.info(path).catch(() => null);
        if (!info?.isFile() || info.size > MAX_FILE || (size + info.size) * 4 / 3 > PAGE_BODY) return;
        size += info.size;
        files.push({ path: published, data: (await this.read(path)).toString('base64') });
      });
      const { folder, ...meta } = page;
      const answer = await this.attempt(`typed ${url} ${page.version}`, () => this.post('/v1/face/claude/typed', { page: meta, files }, 180_000)) as { result?: string } | null;
      if (answer?.result !== 'copied') { counts.pagesFailed++; continue; }
      counts.typedCopied++;
      for (const blob of blobs) {
        const info = await this.info(blob.path).catch(() => null);
        if (!info?.isFile() || info.size > MAX_ASSET) continue;
        const sent = await this.attempt(`file ${blob.id}`, async () => {
          const data = await this.read(blob.path);
          return this.post('/v1/face/claude/asset', { url, asset: { id: blob.id, type: page.types[blob.id] || sniffType(data) }, data: data.toString('base64') }, 300_000) as Promise<{ result?: string }>;
        });
        if (sent?.result === 'copied') counts.files++;
      }
    }
  }
  // User-facing Antigravity artifacts on this Mac (~/.gemini/antigravity/brain): pushed to the mini under origin: 'antigravity'.
  async syncAntigravity({ brainDir = this.brainDir, manual = false }: { brainDir?: string; manual?: boolean } = {}): Promise<{ found: number; copied: number; updated: number; skipped: number; failed: number }> {
    const counts = { found: 0, copied: 0, updated: 0, skipped: 0, failed: 0 };
    if (!brainDir) return counts;
    const list = await discoverAntigravityArtifacts({ brainDir });
    counts.found = list.length;
    if (!list.length) return counts;
    const byId = new Map(list.map(one => [one.id, one]));
    const { send = [] } = (await this.post('/v1/face/claude/plan-antigravity', { pages: list.map(antigravityMeta), manual }, 120_000)) as { send?: string[] };
    counts.skipped = Math.max(0, list.length - send.length);
    let sent = 0;
    for (const id of send) {
      const one = byId.get(id);
      if (!one) continue;
      this.step(`Importing Antigravity pages: ${++sent} of ${send.length}`);
      const key = `agy ${id} ${one.hash.slice(0, 12)}`;
      const sendOne = async (): Promise<{ result?: string }> => {
        const read = await readPage(one, { read: this.read, info: this.info });
        if (!read) throw new Error('Its file couldn’t be read.');
        return this.post('/v1/face/claude/antigravity', { page: antigravityMeta(one), manual, ...read }, 180_000);
      };
      const answer = manual ? await sendOne().catch((error: unknown) => { this.log(`Antigravity import: ${key} didn’t go (${errMsg(error)})`); return null; }) : await this.attempt(key, sendOne);
      if (answer?.result === 'copied') counts.copied++;
      else if (answer?.result === 'updated') counts.updated++;
      else if (answer?.result === 'skipped') counts.skipped++;
      else counts.failed++;
    }
    return counts;
  }
  // ChatGPT (Codex) artifacts on this Mac (~/Documents/Codex/**/outputs, ~/.codex/visualizations, ~/.codex/generated_images, project PDFs): pushed to the mini under origin: 'codex'.
  async syncCodex({ codexDir = this.codexDir, docsDir = this.docsDir, extraRoots = null, manual = false }: { codexDir?: string; docsDir?: string; extraRoots?: readonly string[] | null; manual?: boolean } = {}): Promise<{ found: number; copied: number; updated: number; skipped: number; failed: number }> {
    const counts = { found: 0, copied: 0, updated: 0, skipped: 0, failed: 0 };
    if (!codexDir && !docsDir) return counts;
    const list = await discoverCodexArtifacts({ codexDir, docsDir, extraRoots });
    counts.found = list.length;
    if (!list.length) return counts;
    const byId = new Map(list.map(one => [one.id, one]));
    const { send = [] } = (await this.post('/v1/face/claude/plan-codex', { pages: list.map(codexMeta), manual }, 120_000)) as { send?: string[] };
    counts.skipped = Math.max(0, list.length - send.length);
    let sent = 0;
    for (const id of send) {
      const one = byId.get(id);
      if (!one) continue;
      this.step(`Importing ChatGPT pages: ${++sent} of ${send.length}`);
      const key = `cdx ${id} ${one.hash.slice(0, 12)}`;
      const sendOne = async (): Promise<{ result?: string }> => {
        const read = await readPage(one, { read: this.read, info: this.info, allowedExt: CODEX_EXT });
        if (!read) throw new Error('Its file couldn’t be read.');
        return this.post('/v1/face/claude/codex', { page: codexMeta(one), manual, ...read }, 180_000);
      };
      const answer = manual ? await sendOne().catch((error: unknown) => { this.log(`Codex import: ${key} didn’t go (${errMsg(error)})`); return null; }) : await this.attempt(key, sendOne);
      if (answer?.result === 'copied') counts.copied++;
      else if (answer?.result === 'updated') counts.updated++;
      else if (answer?.result === 'skipped') counts.skipped++;
      else counts.failed++;
    }
    return counts;
  }
  async go({ manual }: { manual: boolean }): Promise<ClaudeSyncCounts> {
    const counts: ClaudeSyncCounts = { chatsAdded: 0, chatsUpdated: 0, chatsKept: 0, pagesCopied: 0, pagesFetched: 0, pagesFailed: 0, pagesOnline: 0, typedCopied: 0, docsExported: 0, files: 0 };
    this.step('Reading Claude Code’s history…');
    const cache = await this.readJSON<ScanCache | null>(this.cacheFile, null);
    const scan = await this.worker({ task: 'scan', claudeDir: this.claudeDir, desktopDir: this.desktopDir, dropDir: this.dropDir, cache }) as ScanWorkerResult;

    // Chats: only settled ones, unless you asked.
    const quiet = this.now() - (manual ? 0 : SETTLED_MS);
    const settled = scan.groups.filter(group => group.files.every(file => file.mtimeMs <= quiet));
    const { todo = [], kept = 0 } = (await this.post('/v1/face/claude/plan-chats', { groups: settled.map(group => ({ id: group.id, signature: importSignature(group) })) }, 120_000)) as { todo?: string[]; kept?: number };
    counts.chatsKept = kept;
    const wanted = new Set(todo), building = settled.filter(group => wanted.has(group.id));
    if (building.length) {
      this.step(`Building ${building.length} ${building.length === 1 ? 'chat' : 'chats'}…`);
      await mkdir(this.stageDir, { recursive: true, mode: 0o700 });
      const { chats } = await this.worker({ task: 'convert', todo: building, paths: scan.paths, sessionsDir: this.stageDir, dataDir: '' }) as ConvertSessionsResult;
      const skipped = chats.filter(chat => !chat.turns).map(({ id, signature }) => ({ id, signature }));
      for (let i = 0; i < skipped.length; i += 1000) await this.post('/v1/face/claude/skipped', { chats: skipped.slice(i, i + 1000) }, 60_000);
      let sent = 0;
      for (const chat of chats.filter(one => one.turns)) {
        const file = join(this.stageDir, `${chat.id}.json`);
        this.step(`Sending chats: ${++sent} of ${chats.length - skipped.length}`);
        const answer = await this.attempt(`chat ${chat.id} ${chat.signature}`, async () => this.post('/v1/face/claude/chat',
          { id: chat.id, signature: chat.signature, title: chat.title, cwd: chat.cwd, imported: chat.imported, history: JSON.parse(await this.read(file, 'utf8')) }, 120_000)) as { result?: string } | null;
        await rm(file, { force: true }).catch(() => {});
        if (answer?.result === 'added') counts.chatsAdded++; else if (answer?.result === 'updated') counts.chatsUpdated++; else if (answer?.result === 'kept') counts.chatsKept++;
      }
    }

    // Pages.
    const byURL = new Map(scan.found.map(one => [one.url, one]));
    const plan = (await this.post('/v1/face/claude/plan-pages', { pages: scan.found.map(pageMeta) }, 120_000)) as { send?: string[]; fetch?: string[]; assets?: Array<{ url: string; ids?: string[] }> };
    let sent = 0;
    for (const url of plan.send || []) {
      const one = byURL.get(url);
      if (!one) continue;
      this.step(`Sending pages: ${++sent} of ${plan.send!.length}`);
      const answer = await this.attempt(`page ${url} ${one.seq || 1}`, async () => {
        const read = await readPage(one, { read: this.read, info: this.info });
        if (!read) throw new Error('Its file couldn’t be read.');
        return { ...(await this.post('/v1/face/claude/page', { page: pageMeta(one), ...read }, 180_000)), files: read.files.length + 1 } as { result?: string; files: number };
      });
      if (answer?.result === 'copied') { counts.pagesCopied++; counts.files += answer.files; } else if (!answer) counts.pagesFailed++;
    }
    const fetches = (plan.fetch || []).slice(0, FETCHES_PER_RUN);
    let fetched = 0;
    for (const url of fetches) {
      const one = byURL.get(url);
      if (!one) continue;
      this.step(`Downloading from claude.ai: ${++fetched} of ${fetches.length}`);
      const answer = await this.attempt(`download ${url} ${one.seq || 1}`, () => this.post('/v1/face/claude/fetch', { page: pageMeta(one) }, FETCH_WAIT_MS)) as { result?: string; why?: string } | null;
      // The other Mac can't download pages at all just now: the rest stay online only for this run.
      if (answer?.result === 'unavailable') { counts.pagesOnline = (plan.fetch || []).length - fetched + 1; this.unavailable = answer.why || ''; break; }
      if (answer?.result === 'copied') counts.pagesFetched++; else if (!answer || answer.result === 'failed') counts.pagesFailed++;
    }
    for (const { url, ids } of plan.assets || []) {
      const one = byURL.get(url);
      for (const asset of (one?.assets || []).filter(entry => ids?.includes(entry.id))) {
        const found = await this.info(asset.path).catch(() => null);
        if (!found?.isFile() || found.size > MAX_ASSET) continue;
        const answer = await this.attempt(`file ${asset.id}`, async () => {
          const data = await this.read(asset.path);
          if (asset.sha256 && createHash('sha256').update(data).digest('hex') !== asset.sha256.toLowerCase()) return { result: 'changed' };
          return this.post('/v1/face/claude/asset', { url, asset: { id: asset.id, type: asset.type, sha256: asset.sha256 }, data: data.toString('base64') }, 300_000) as Promise<{ result?: string }>;
        });
        if (answer?.result === 'copied') counts.files++;
      }
    }
    await this.sendTyped(counts);
    if (this.brainDir) {
      const agy = await this.syncAntigravity({ brainDir: this.brainDir, manual: false }).catch((error: unknown) => { this.log(`Antigravity sync: ${errMsg(error)}`); return null; });
      if (agy) { counts.antigravityCopied = agy.copied + agy.updated; counts.pagesFailed += agy.failed; }
    }
    if (this.codexDir || this.docsDir) {
      const cdx = await this.syncCodex({ codexDir: this.codexDir, docsDir: this.docsDir, manual: false }).catch((error: unknown) => { this.log(`Codex sync: ${errMsg(error)}`); return null; });
      if (cdx) { counts.codexCopied = cdx.copied + cdx.updated; counts.pagesFailed += cdx.failed; }
    }
    await this.writeJSON(this.cacheFile, scan.cache);
    await this.post('/v1/face/claude/done', { counts, from: this.name }, 30_000).catch(() => {});
    return counts;
  }
}
