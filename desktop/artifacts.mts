import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';

export interface ArtifactConcept {
  name: string;
  file: string;
}

export interface ArtifactConceptView extends ArtifactConcept {
  src: string;
}

export interface ArtifactVersion {
  seq: number;
  file: string | null;
  at: string;
  concepts?: ArtifactConcept[];
}

export interface ArtifactVersionView extends Omit<ArtifactVersion, 'concepts'> {
  src: string;
  concepts?: ArtifactConceptView[];
}

export interface ArtifactComment {
  id: string;
  concept: string;
  text: string;
  at: string;
}

export type ArtifactKind = 'page' | 'doc' | 'slides' | 'dashboard' | 'canvas' | 'whiteboard' | 'sheet' | 'a2ui';
export type ArtifactOrigin = 'fairy' | 'claude' | 'antigravity' | 'codex';
export type ArtifactSourceName = 'calendar' | 'email';

export interface ArtifactItem {
  id: string;
  kind: ArtifactKind;
  sources: ArtifactSourceName[];
  granted: ArtifactSourceName[];
  comments: ArtifactComment[];
  title: string;
  description: string;
  url: string;
  origin: ArtifactOrigin;
  sourceHash?: string;
  assets?: Record<string, string>;
  session: string;
  sessionTitle?: string;
  folder?: string;
  updatedAt: string;
  versions: ArtifactVersion[];
}

export interface ArtifactItemView extends Omit<ArtifactItem, 'versions'> {
  versions: ArtifactVersionView[];
}

export interface ArtifactStoreState {
  imported: boolean;
  items: ArtifactItemView[];
}

interface ArtifactIndex {
  version?: number;
  imported?: boolean;
  grouped?: boolean;
  foldered?: boolean;
  removed?: unknown[];
  items?: unknown[];
}

export interface ArtifactStoreOptions {
  dir: string;
  readJSON: <T = unknown>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<void>;
  trash: (path: string) => Promise<unknown>;
  now?: () => string;
  onChange?: (state: ArtifactStoreState) => void;
  id?: () => string;
}

export interface PreparePageOptions {
  dashboard?: boolean;
  blobs?: { base: string; ids: string[] } | null;
}

export interface ByteRange {
  start: number;
  end: number;
}

export interface PublishArtifactOptions {
  id?: string | null;
  kind?: string;
  title?: string;
  description?: string;
  html?: string;
  files?: Record<string, unknown>;
  entry?: string;
  concepts?: Array<{ name?: unknown; file?: unknown }>;
  sources?: unknown;
  session?: string;
  folder?: string;
}

export interface ServeArtifactResult {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer | ReadStream;
}

export interface FoundClaudeArtifact {
  id?: string | null;
  url: string;
  seq?: number;
  at?: number | string;
  chat?: string;
  chatTitle?: string;
  project?: string;
  title?: string;
  description?: string;
  source?: string | null;
  files?: Array<[string, string[]]> | null;
  assets?: Array<{ id?: string; path?: unknown; type?: unknown; sha256?: unknown }>;
}

export interface FoundExternalArtifact {
  id?: unknown;
  source?: unknown;
  title?: unknown;
  description?: unknown;
  at?: number | string;
  session?: unknown;
  files?: Array<[string, string[]]> | null;
}

export const ARTIFACT_SCHEME = 'fairy-artifact';
const ORIGIN = `${ARTIFACT_SCHEME}://page`;
export const MAX_PAGE = 16 * 1024 * 1024, MAX_FILE = 64 * 1024 * 1024, MAX_FILES = 255, MAX_NAME = 120, MAX_REMOVED = 2000;
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogv': 'video/ogg', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.vtt': 'text/vtt; charset=utf-8', '.pdf': 'application/pdf', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
// A file uploaded to a claude.ai artifact's asset store, which its pages name as /_blob/<id>. Fairy keeps the ones she
// copied in the artifact's own _blob folder, beside its versions, as one upload serves every version.
export const BLOB_ID = /^[0-9a-f]{32}$/;
const BLOB_FILE = /^_blob\/([0-9a-f]{32})$/;
const BLOB_TYPES = new Map<string, string>(Object.values(TYPES).map(type => [type.split(';')[0], type]));
// What an upload is served as: its own type when it's one pages use, else from its file name.
export const blobType = (type: unknown, name = ''): string => BLOB_TYPES.get(String(type || '').split(';')[0].trim().toLowerCase()) || TYPES[extname(String(name)).toLowerCase()] || 'application/octet-stream';
const cleanAssets = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {})
  .filter((entry): entry is [string, string] => BLOB_ID.test(entry[0]) && (BLOB_TYPES.has(String(entry[1]).split(';')[0]) || entry[1] === 'application/octet-stream')).slice(0, MAX_FILES));
// A video is sent a piece at a time, so it starts and seeks without its whole file being read, or carried to the other
// Mac's window first. The player asks for the next piece itself.
export const RANGE_CHUNK = 2 * 1024 * 1024;
const PAGE_FILE = /\.(?:html?|md)$/i;

const text = (value: unknown, limit = MAX_NAME): string => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
// One path inside a version's folder: never a parent, a root or a hidden file.
export function plainPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 512 || value.includes('\0') || value.includes('\\')) return null;
  const parts = value.split('/').filter(part => part && part !== '.');
  if (!parts.length || value.startsWith('/') || parts.some(part => part === '..' || part.startsWith('.'))) return null;
  return parts.join('/');
}
export const artifactURL = (id: string, seq: number | string, file = 'index.html'): string => `${ORIGIN}/${id}/${seq}/${file.split('/').map(encodeURIComponent).join('/')}`;
// Pages can draw and run, and reach only their own version's files. Nothing here names the app.
// The CDNs are the ones claude.ai allows, so a page that works there works here.
// A page may frame its own files, and nothing else: a claude.ai Design's canvas shows each artboard in a frame of its own
// (typed-pages.mjs). A dashboard frames nothing.
export function pagePolicy(id: string, seq: number | string, { strict = false, offline = false }: { strict?: boolean; offline?: boolean } = {}): string {
  const own = `${ORIGIN}/${id}/${seq}/`;
  // A phone's copy can run all it likes, but it can't reach anything beyond its own files.
  if (offline && !strict) return [`default-src ${own} data: blob:`, `script-src ${own} 'unsafe-inline' 'unsafe-eval' blob:`, `style-src ${own} 'unsafe-inline'`, `font-src ${own} data:`, `img-src ${own} data: blob:`, `media-src ${own} data: blob:`, `connect-src ${own}`, `frame-src ${own}`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`].join('; ');
  // Dashboards can hold your data, so they get no way to send anything out: nothing remote at all.
  if (strict) return [`default-src ${own} data:`, `script-src ${own} 'unsafe-inline'`, `style-src ${own} 'unsafe-inline'`, `font-src ${own} data:`, `img-src ${own} data:`, `media-src 'none'`, `connect-src 'none'`, `frame-src 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`].join('; ');
  const cdns = 'https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com';
  return [`default-src ${own} data: blob:`, `script-src ${own} 'unsafe-inline' 'unsafe-eval' blob: ${cdns} https://cdn.tailwindcss.com https://code.jquery.com`,
    `style-src ${own} 'unsafe-inline' https://fonts.googleapis.com ${cdns}`, `font-src ${own} data: https://fonts.gstatic.com ${cdns}`,
    `img-src ${own} https: data: blob:`, `media-src ${own} https: data: blob:`, `connect-src ${own} ${cdns}`, `frame-src ${own}`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`].join('; ');
}
// Claude's runtime answers null when a page asks for something a viewer can't run, and pages are written for that.
// A page's frame is sandboxed with no origin of its own, so a <track>'s captions load only when its video asks in CORS
// mode (the page's own files allow it). On claude.ai the page has an origin, so pages don't say crossorigin; it's set
// here on a video or audio given a track, unless what it plays is somewhere else, which might not allow CORS.
const TRACKS = 'new MutationObserver(function(r){function f(t){var m=t.parentElement,s;if(!m||!/^(VIDEO|AUDIO)$/.test(m.tagName)||m.hasAttribute("crossorigin"))return;s=m.getAttribute("src")||(m.querySelector("source")||{}).src||"";if(!/^https?:/i.test(s))m.crossOrigin="anonymous";}r.forEach(function(x){x.addedNodes.forEach(function(n){if(n.nodeType!==1)return;if(n.tagName==="TRACK")f(n);else n.querySelectorAll("track").forEach(f);});});}).observe(document,{childList:true,subtree:true});';
// Asked by the window (Pin to a notebook), a page says what of it is selected: its words and where they sit in the frame.
const SELECTION = 'addEventListener("message",function(e){if(e.source!==parent||!e.data||e.data.type!=="fairy-selection-request")return;var s=getSelection(),t=s?String(s):"",r=null;if(s&&s.rangeCount&&t.trim()){var b=s.getRangeAt(0).getBoundingClientRect();if(0>b.top||b.bottom>innerHeight){var g=s.getRangeAt(0),c=g.startContainer,el=c.nodeType===1?(c.childNodes[g.startOffset]||c):c.parentElement;if(el&&el.nodeType!==1)el=el.parentElement;if(el&&el.scrollIntoView)el.scrollIntoView({block:innerHeight>b.height?"center":"start",behavior:"instant"});b=g.getBoundingClientRect();}r={x:b.left,y:b.top,w:b.width,h:b.height};}parent.postMessage({type:"fairy-selection",id:e.data.id,text:t.slice(0,4000),rect:r,title:document.title||""},"*");});addEventListener("message",function(e){if(e.source===parent&&e.data&&e.data.type==="fairy-selection-clear"){var s=getSelection();if(s)s.removeAllRanges();}});';
const RUNTIME = `<script>window.claude=window.claude||{use:async()=>null};${TRACKS}${SELECTION}</script>`;
// A dashboard asks Fairy for data by message, and gets only what you allowed.
const DASHBOARD_RUNTIME = '<script>window.fairy={data:function(){return new Promise(function(resolve,reject){var id=Math.random();function on(e){if(e.source!==parent||!e.data||e.data.type!=="fairy-data"||e.data.id!==id)return;removeEventListener("message",on);clearTimeout(t);resolve(e.data.data);}var t=setTimeout(function(){removeEventListener("message",on);reject(new Error("No answer"));},30000);addEventListener("message",on);parent.postMessage({type:"fairy-data-request",id:id},"*");});}};</script>';
const RESET = '<style>*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>';
const SKELETON = (head: string, body: string): string => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${RUNTIME}${RESET}${head}</head><body>${body}</body></html>`;
const escapeHTML = (value: string): string => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// A claude.ai page names its uploads as /_blob/<id> on its own site. Here they're under the page's version, so each
// address of an upload Fairy has is pointed there (and nothing else, so prose that mentions /_blob/ is left alone).
export function pointBlobs(content: string, base: string, ids?: readonly string[] | null): string {
  if (!ids?.length || !content.includes('/_blob/')) return content;
  const have = new Set(ids);
  return content.replace(/(^|[^\w./-])\/_blob\/([0-9a-f]{32})(?![0-9a-f])/g, (match: string, before: string, id: string) => (have.has(id) ? `${before}${base}_blob/${id}` : match));
}
export function preparePage(content: string, file = 'index.html', { dashboard = false, blobs = null }: PreparePageOptions = {}): string {
  const runtime = dashboard ? RUNTIME + DASHBOARD_RUNTIME : RUNTIME;
  if (blobs && !/\.md$/i.test(file)) content = pointBlobs(content, blobs.base, blobs.ids);
  if (/\.md$/i.test(file)) return SKELETON('<style>body{padding:20px;background:#fff;color:#1a1a1a}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.6 ui-sans-serif,system-ui,sans-serif}@media (prefers-color-scheme:dark){body{background:#17181b;color:#e8e9ee}}</style>', `<pre>${escapeHTML(content)}</pre>`);
  if (!/^\s*(?:<!--[\s\S]*?-->\s*)*<!doctype/i.test(content)) return SKELETON(dashboard ? DASHBOARD_RUNTIME : '', content);
  const head = content.match(/<head(?:\s[^>]*)?>/i);
  if (head) return `${content.slice(0, head.index! + head[0].length)}${runtime}${content.slice(head.index! + head[0].length)}`;
  return content.replace(/<!doctype[^>]*>/i, (match: string) => `${match}${runtime}`);
}
export function byteRange(header: unknown, size: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2])), end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}
function cleanVersion(value: unknown): ArtifactVersion | null {
  const v = value as { seq?: unknown; file?: unknown; at?: unknown; concepts?: unknown } | null | undefined;
  const seq = Number(v?.seq);
  if (!Number.isInteger(seq) || seq < 1) return null;
  const concepts = (Array.isArray(v?.concepts) ? v.concepts : [])
    .map(concept => {
      const c = concept as { name?: unknown; file?: unknown } | null | undefined;
      return { name: text(c?.name, 60), file: plainPath(c?.file) };
    })
    .filter((concept): concept is ArtifactConcept => Boolean(concept.file))
    .slice(0, 8);
  return { seq, file: v?.file === null ? null : plainPath(v?.file), at: String(v?.at || ''), ...(concepts.length ? { concepts } : {}) };
}
export const KINDS: readonly ArtifactKind[] = ['page', 'doc', 'slides', 'dashboard', 'canvas', 'whiteboard', 'sheet', 'a2ui'], cleanNames = (value: unknown): ArtifactSourceName[] => (Array.isArray(value) ? value : []).filter((name): name is ArtifactSourceName => name === 'calendar' || name === 'email');
export const ORIGINS: readonly ArtifactOrigin[] = Object.freeze(['fairy', 'claude', 'antigravity', 'codex']);
const ANTIGRAVITY_ID = /^agy-[0-9a-f]{24}$/;
const CODEX_ID = /^cdx-[0-9a-f]{24}$/;
const CODEX_FILE = /\.(?:html?|md|pdf|png|jpe?g|webp)$/i;
const IMAGE_FILE = /\.(?:png|jpe?g|webp)$/i;
// The project folder a page was made or published in, for matching it to chats about the same project.
const cleanFolder = (value: unknown): string => typeof value === 'string' && value.startsWith('/') && value.length <= 400 && !value.includes('\0') ? value.replace(/\/+$/, '') : '';
function cleanArtifact(value: unknown): ArtifactItem | null {
  const v = value as Record<string, unknown> | null | undefined;
  if (!v || typeof v.id !== 'string' || !SAFE_ID.test(v.id)) return null;
  const versions = (Array.isArray(v.versions) ? v.versions : []).map(cleanVersion).filter((ver): ver is ArtifactVersion => Boolean(ver));
  if (!versions.length) return null;
  const sourceHash = typeof v.sourceHash === 'string' && /^[0-9a-f]{16,64}$/.test(v.sourceHash) ? v.sourceHash : '';
  const assets = cleanAssets(v.assets);
  const sessionTitle = text(v.sessionTitle, 120);
  const folder = cleanFolder(v.folder);
  const kind: ArtifactKind = KINDS.includes(v.kind as ArtifactKind) ? (v.kind as ArtifactKind) : 'page';
  const origin: ArtifactOrigin = ORIGINS.includes(v.origin as ArtifactOrigin) ? (v.origin as ArtifactOrigin) : 'fairy';
  const comments: ArtifactComment[] = (Array.isArray(v.comments) ? v.comments : [])
    .map(comment => {
      const c = comment as { id?: unknown; concept?: unknown; text?: unknown; at?: unknown } | null | undefined;
      return { id: String(c?.id || '').slice(0, 64), concept: text(c?.concept, 60), text: text(c?.text, 1000), at: String(c?.at || '') };
    })
    .filter(comment => Boolean(comment.id && comment.text))
    .slice(-200);
  return { id: v.id, kind, sources: cleanNames(v.sources), granted: cleanNames(v.granted), comments,
    title: text(v.title) || 'Page', description: text(v.description, 300), url: /^https:\/\/claude\.ai\//.test(typeof v.url === 'string' ? v.url : '') ? String(v.url).slice(0, 300) : '',
    origin, ...(sourceHash ? { sourceHash } : {}), ...(Object.keys(assets).length ? { assets } : {}), session: typeof v.session === 'string' ? v.session.slice(0, 80) : '', ...(sessionTitle ? { sessionTitle } : {}), ...(folder ? { folder } : {}), updatedAt: String(v.updatedAt || ''), versions };
}

// The file a kind's later changes start from: what the model wrote, or the data Fairy's own page shows.
export const SOURCE_FILES: Record<string, string> = { doc: 'doc.md', slides: 'slides.html', whiteboard: 'scene.json', sheet: 'sheet.json', a2ui: 'surface.json' };
// Kinds whose page is Fairy's own and whose data can be yours, so they get no network at all.
const STRICT_KINDS = ['dashboard', 'whiteboard', 'sheet', 'a2ui'];

// A copy of each published version. It's what the side panel shows, offline and with no sign-in.
export class ArtifactStore {
  dir: string;
  readJSON: <T = unknown>(path: string, fallback: T) => Promise<T>;
  writeJSON: (path: string, value: unknown) => Promise<void>;
  trash: (path: string) => Promise<unknown>;
  now: () => string;
  onChange: (state: ArtifactStoreState) => void;
  id: () => string;
  items: ArtifactItem[] = [];
  imported = false;
  grouped = false;
  foldered = false;
  // The addresses of pages from Claude you removed, so syncing from the other Mac doesn't bring them back.
  removed: string[] = [];

  constructor({ dir, readJSON, writeJSON, trash, now = () => new Date().toISOString(), onChange = () => {}, id = randomUUID }: ArtifactStoreOptions) {
    this.dir = dir;
    this.readJSON = readJSON;
    this.writeJSON = writeJSON;
    this.trash = trash;
    this.now = now;
    this.onChange = onChange;
    this.id = id;
  }
  async load(): Promise<void> {
    let index: ArtifactIndex | null = null;
    try { index = await this.readJSON<ArtifactIndex | null>(join(this.dir, 'index.json'), null); }
    catch (error: unknown) { console.warn('Starting a new artifact list:', error instanceof Error ? error.message : String(error)); }
    this.items = (Array.isArray(index?.items) ? index.items : []).map(cleanArtifact).filter((item): item is ArtifactItem => Boolean(item));
    this.imported = index?.imported === true; this.grouped = index?.grouped === true; this.foldered = index?.foldered === true;
    this.removed = (Array.isArray(index?.removed) ? index.removed : []).filter((entry): entry is string => typeof entry === 'string' && entry.length <= 200).slice(-MAX_REMOVED);
  }
  save(): Promise<void> { return this.writeJSON(join(this.dir, 'index.json'), { version: 1, imported: this.imported, grouped: this.grouped, foldered: this.foldered, removed: this.removed, items: this.items }); }
  // Whether a page from Claude was here once and you removed it.
  wasRemoved({ id, url }: { id?: string; url?: string } = {}): boolean { return this.removed.some(entry => entry === id || (Boolean(url) && entry.toLowerCase() === String(url).replace(/\/+$/, '').toLowerCase())); }
  async changed(): Promise<ArtifactStoreState> { await this.save(); this.onChange(this.state()); return this.state(); }
  state(): ArtifactStoreState { return { imported: this.imported, items: [...this.items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(item => ({ ...item, versions: item.versions.map(version => ({ ...version, src: version.file ? artifactURL(item.id, version.seq, version.file) : '', concepts: version.concepts?.map(concept => ({ ...concept, src: artifactURL(item.id, version.seq, concept.file) })) })) })) }; }
  find(id: string): ArtifactItem {
    const item = this.items.find(entry => entry.id === id);
    if (!item) throw new Error('That page is no longer here.');
    return item;
  }
  versionDir(id: string, seq: number | string): string { return join(this.dir, id, String(seq)); }
  // Fairy's own pages: a new artifact, or the next version of one.
  async publish({ id, kind = 'page', title, description = '', html, files = html === undefined ? {} : { 'index.html': html }, entry = 'index.html', concepts, sources, session = '', folder = '' }: PublishArtifactOptions): Promise<{ id: string; seq: number; title: string }> {
    const names = Object.keys(files);
    if (!names.length || names.some(name => {
      const value = files[name];
      return !plainPath(name) || typeof value !== 'string' || !value.trim() || Buffer.byteLength(value) > MAX_PAGE;
    }) || !names.includes(entry)) throw new Error('A page must be some HTML under 16 MB.');
    const existing = id ? this.find(id) : null, itemId = existing?.id || this.id(), seq = (existing?.versions.at(-1)?.seq || 0) + 1, at = this.now();
    await mkdir(this.versionDir(itemId, seq), { recursive: true, mode: 0o700 });
    for (const name of names) await writeFile(join(this.versionDir(itemId, seq), plainPath(name)!), files[name] as string, { mode: 0o600 });
    const version = cleanVersion({ seq, file: entry, at, concepts })!;
    if (existing) {
      existing.versions.push(version); existing.updatedAt = at; existing.title = text(title) || existing.title; existing.description = text(description, 300) || existing.description;
      // A dashboard that starts asking for something new has to ask you again.
      if (sources) { existing.sources = cleanNames(sources); existing.granted = existing.granted.filter(name => existing.sources.includes(name)); }
      existing.comments = [];
    } else {
      const created = cleanArtifact({ id: itemId, kind, title, description, sources, origin: 'fairy', session, folder, updatedAt: at, versions: [version] });
      if (created) this.items.push(created);
    }
    await this.changed();
    return { id: itemId, seq, title: text(title) || existing?.title || 'Page' };
  }
  // The latest source of a page Fairy made, for changing it or editing it by hand.
  async source(id: string, seq?: number): Promise<{ id: string; kind: ArtifactKind; title: string; comments: ArtifactComment[]; concepts?: Array<{ name: string; html: string }>; text?: string }> {
    const item = this.find(id), version = seq ? item.versions.find(entry => entry.seq === seq) : item.versions.at(-1);
    if (!version?.file) throw new Error('This page’s file is no longer on this Mac.');
    const read = (name: string): Promise<string> => readFile(join(this.versionDir(id, version.seq), name), 'utf8');
    const base = { id, kind: item.kind, title: item.title, comments: item.comments };
    if (version.concepts) return { ...base, concepts: await Promise.all(version.concepts.map(async concept => ({ name: concept.name, html: await read(concept.file) }))) };
    return { ...base, text: await read(SOURCE_FILES[item.kind] || version.file) };
  }
  async grant(id: string, sources: unknown): Promise<ArtifactStoreState> {
    const item = this.find(id);
    item.granted = cleanNames(sources).filter(name => item.sources.includes(name));
    return this.changed();
  }
  async addComment(id: string, { concept = '', text: words }: { concept?: unknown; text?: unknown }): Promise<ArtifactStoreState> {
    const item = this.find(id), clean = text(words, 1000);
    if (!clean) throw new Error('Write a comment first.');
    if (item.comments.length >= 200) throw new Error('Remove a comment first.');
    item.comments.push({ id: this.id(), concept: text(concept, 60), text: clean, at: this.now() });
    return this.changed();
  }
  async removeComment(id: string, commentId: string): Promise<ArtifactStoreState> {
    const item = this.find(id);
    item.comments = item.comments.filter(comment => comment.id !== commentId);
    return this.changed();
  }
  // A new chat has no id until its first turn is saved, which is after its first page.
  async linkSession(id: string, session: string): Promise<void> {
    const item = this.find(id);
    if (!item.session && session) { item.session = String(session).slice(0, 80); await this.changed(); }
  }
  async remove(id: string): Promise<ArtifactStoreState> {
    const item = this.find(id);
    if (item.origin === 'claude' || item.origin === 'antigravity' || item.origin === 'codex') this.removed = [...this.removed.filter(entry => entry !== item.id), item.id, ...(item.url ? [item.url.replace(/\/+$/, '').toLowerCase()] : [])].slice(-MAX_REMOVED);
    await this.trash(join(this.dir, id));
    this.items = this.items.filter(item => item.id !== id);
    return this.changed();
  }
  // Answers the page's own requests, from these copies and nothing else.
  // stream: a page's media (anything not a page) comes as a stream of the whole range it asked for, read as it's sent.
  // A window's video needs that: Chromium takes a shorter answer to its open-ended "bytes=0-" as the end of the
  // video and never asks for the rest, so a clip froze where the first 2 MB ran out (a quarter or half way in). A
  // seek cancels the stream and asks again from there, so nothing is read ahead of what plays. Without it (the
  // phone, whose player asks for exact ranges), ranges come 2 MB at a time, read whole.
  async serve(pathname: string, rangeHeader?: string | null, { offline = false, stream = false }: { offline?: boolean; stream?: boolean } = {}): Promise<ServeArtifactResult> {
    const refuse = (status = 404): ServeArtifactResult => ({ status, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: 'Not found' });
    let path: string;
    try { path = decodeURIComponent(pathname); } catch { return refuse(); }
    const [, id, seq, ...rest] = path.split('/'), file = plainPath(rest.join('/') || 'index.html'), item = this.items.find(entry => entry.id === id);
    if (!item || !file || !item.versions.some(version => String(version.seq) === seq)) return refuse();
    const blob = BLOB_FILE.exec(file)?.[1];
    if (blob && !item.assets?.[blob]) return refuse();
    const root = this.versionDir(id, seq), full = blob ? join(this.dir, id, '_blob', blob) : join(root, normalize(file));
    if (!blob && !full.startsWith(root + sep)) return refuse();
    let info: Awaited<ReturnType<typeof lstat>>;
    try { info = await lstat(full); } catch { return refuse(); }
    if (!info.isFile()) return refuse();
    const type = blob ? item.assets![blob] : TYPES[extname(file).toLowerCase()] || 'application/octet-stream';
    const dashboard = item.kind === 'dashboard';
    const headers: Record<string, string> = { 'content-security-policy': pagePolicy(id, seq, { strict: STRICT_KINDS.includes(item.kind), offline }), 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cache-control': 'no-store' };
    const blobs = item.assets ? { base: `/${id}/${seq}/`, ids: Object.keys(item.assets) } : null;
    if (!blob && PAGE_FILE.test(file)) return { status: 200, headers: { ...headers, 'content-type': TYPES['.html'] }, body: preparePage(await readFile(full, 'utf8'), file, { dashboard, blobs }) };
    headers['content-type'] = type; headers['accept-ranges'] = 'bytes';
    const range = byteRange(rangeHeader, info.size);
    if (!range) {
      if (rangeHeader) return { status: 416, headers: { ...headers, 'content-range': `bytes */${info.size}` }, body: '' };
      return { status: 200, headers: { ...headers, 'content-length': String(info.size) }, body: stream ? createReadStream(full) : await readFile(full) };
    }
    if (stream) return { status: 206, headers: { ...headers, 'content-length': String(range.end - range.start + 1), 'content-range': `bytes ${range.start}-${range.end}/${info.size}` }, body: createReadStream(full, { start: range.start, end: range.end }) };
    range.end = Math.min(range.end, range.start + RANGE_CHUNK - 1);
    const handle = await open(full, 'r');
    try {
      const body = Buffer.alloc(range.end - range.start + 1);
      await handle.read(body, 0, body.length, range.start);
      return { status: 206, headers: { ...headers, 'content-length': String(body.length), 'content-range': `bytes ${range.start}-${range.end}/${info.size}` }, body };
    } finally { await handle.close(); }
  }
  // Copies what a past publish names, as it is on disk now. A page whose file has gone is kept as its address.
  async importFound(found: FoundClaudeArtifact): Promise<'copied' | 'address' | 'skipped' | 'grouped'> {
    const id = SAFE_ID.test(found.id || '') ? found.id! : found.url.split('/').pop();
    if (!id || !SAFE_ID.test(id)) return 'skipped';
    const existing = this.items.find(item => item.id === id || (Boolean(found.url) && item.url === found.url));
    const seq = Math.max(1, Number(found.seq) || 1), at = found.at ? new Date(found.at).toISOString() : this.now();
    // The Claude Code session it came from, kept even when there's nothing new to copy, so older imports get grouped.
    const chat = { ...(found.chat ? { session: `claude-code:${String(found.chat).slice(0, 60)}`, ...(found.chatTitle ? { sessionTitle: text(found.chatTitle, 120) } : {}) } : {}), ...(cleanFolder(found.project) ? { folder: cleanFolder(found.project) } : {}) };
    if (existing?.origin === 'claude' && (chat.session || chat.folder)) Object.assign(existing, chat);
    if (existing?.versions.some(version => version.seq >= seq && version.file)) {
      // Uploads belong to the artifact, not a version, so ones made since its last copy still come along.
      if (existing.origin === 'claude' && await this.copyAssets(existing, found.assets)) return 'copied';
      return chat.session && existing.origin === 'claude' ? 'grouped' : 'skipped';
    }
    const itemId = existing?.id || id;
    const file = await this.copyPage(itemId, seq, found);
    const version: ArtifactVersion = { seq, file, at };
    if (existing) {
      existing.versions = [...existing.versions.filter(entry => entry.seq !== seq), version].sort((a, b) => a.seq - b.seq);
      existing.title = text(found.title) || existing.title; existing.url ||= found.url; existing.updatedAt = at;
    } else {
      const created = cleanArtifact({ id: itemId, title: found.title, description: found.description, url: found.url, origin: 'claude', ...chat, updatedAt: at, versions: [version] });
      if (created) this.items.push(created);
    }
    const target = existing || this.items.at(-1);
    if (target) await this.copyAssets(target, found.assets);
    return file ? 'copied' : 'address';
  }
  // Copies a user-facing Antigravity artifact (.html/.htm/.md) under its own agy-* id and origin: 'antigravity'.
  // Strictly isolated from Claude and Fairy pages so duplicate titles never overwrite or merge across origins.
  async importAntigravity(found: FoundExternalArtifact | null | undefined, { respectRemoved = false }: { respectRemoved?: boolean } = {}): Promise<'copied' | 'updated' | 'skipped'> {
    const id = typeof found?.id === 'string' ? found.id : '';
    if (!ANTIGRAVITY_ID.test(id) || typeof found?.source !== 'string' || !PAGE_FILE.test(found.source)) return 'skipped';
    const existing = this.items.find(item => item.id === id);
    if (existing && existing.origin !== 'antigravity') return 'skipped';
    if (!existing && respectRemoved && this.wasRemoved({ id })) return 'skipped';
    let info: Awaited<ReturnType<typeof lstat>>;
    try { info = await lstat(found.source); } catch { return 'skipped'; }
    if (info.isSymbolicLink() || !info.isFile() || info.size === 0 || info.size > MAX_PAGE) return 'skipped';
    const bytes = await readFile(found.source);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (existing && existing.sourceHash === hash && existing.versions.some(version => version.file)) return 'skipped';

    const ext = extname(found.source).toLowerCase();
    const isDoc = ext === '.md';
    const title = text(found.title) || existing?.title || 'Antigravity Artifact';
    const description = text(found.description, 300);
    const seq = (existing?.versions.at(-1)?.seq || 0) + 1;
    const at = found.at ? new Date(found.at).toISOString() : this.now();
    const dir = this.versionDir(id, seq);

    let file: string | null;
    if (isDoc) {
      const { docPage } = await import('./page-types.mjs');
      const mdText = bytes.toString('utf8');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, 'index.html'), docPage(mdText, title), { mode: 0o600 });
      await writeFile(join(dir, 'doc.md'), mdText, { mode: 0o600 });
      file = 'index.html';
    } else {
      file = await this.copyPage(id, seq, { source: found.source, files: found.files });
      if (!file) return 'skipped';
    }

    const version: ArtifactVersion = { seq, file, at };
    const session = typeof found.session === 'string' && found.session.startsWith('antigravity:') ? found.session.slice(0, 80) : '';
    if (existing) {
      existing.versions = [...existing.versions.filter(entry => entry.seq !== seq), version].sort((a, b) => a.seq - b.seq);
      existing.kind = isDoc ? 'doc' : 'page';
      existing.title = title;
      if (description) existing.description = description;
      if (session) existing.session = session;
      existing.sourceHash = hash;
      existing.updatedAt = at;
      return 'updated';
    }
    const created = cleanArtifact({
      id,
      kind: isDoc ? 'doc' : 'page',
      title,
      description,
      origin: 'antigravity',
      sourceHash: hash,
      session,
      updatedAt: at,
      versions: [version],
    });
    if (created) this.items.push(created);
    // Manual re-import clears a prior removal entry so future edits stay in sync.
    this.removed = this.removed.filter(entry => entry !== id);
    return 'copied';
  }
  // Copies a ChatGPT (Codex) artifact (.html/.htm/.md/.pdf/.png/.jpg/.jpeg/.webp) under its own cdx-* id and origin: 'codex'.
  async importCodex(found: FoundExternalArtifact | null | undefined, { respectRemoved = false }: { respectRemoved?: boolean } = {}): Promise<'copied' | 'updated' | 'skipped'> {
    const id = typeof found?.id === 'string' ? found.id : '';
    if (!CODEX_ID.test(id) || typeof found?.source !== 'string' || !CODEX_FILE.test(found.source)) return 'skipped';
    const existing = this.items.find(item => item.id === id);
    if (existing && existing.origin !== 'codex') return 'skipped';
    if (!existing && respectRemoved && this.wasRemoved({ id })) return 'skipped';
    let info: Awaited<ReturnType<typeof lstat>>;
    try { info = await lstat(found.source); } catch { return 'skipped'; }
    const ext = extname(found.source).toLowerCase();
    const isHtmlOrMd = ext === '.html' || ext === '.htm' || ext === '.md';
    const limit = isHtmlOrMd ? MAX_PAGE : MAX_FILE;
    if (info.isSymbolicLink() || !info.isFile() || info.size === 0 || info.size > limit) return 'skipped';
    const bytes = await readFile(found.source);
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (existing && existing.sourceHash === hash && existing.versions.some(version => version.file)) return 'skipped';

    const isDoc = ext === '.md';
    const isPdf = ext === '.pdf';
    const isImage = IMAGE_FILE.test(ext);
    const title = text(found.title) || existing?.title || 'ChatGPT Artifact';
    const description = text(found.description, 300);
    const seq = (existing?.versions.at(-1)?.seq || 0) + 1;
    const at = found.at ? new Date(found.at).toISOString() : this.now();
    const dir = this.versionDir(id, seq);

    let file: string | null;
    if (isDoc) {
      const { docPage } = await import('./page-types.mjs');
      const mdText = bytes.toString('utf8');
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(join(dir, 'index.html'), docPage(mdText, title), { mode: 0o600 });
      await writeFile(join(dir, 'doc.md'), mdText, { mode: 0o600 });
      file = 'index.html';
    } else if (isPdf) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await copyFile(found.source, join(dir, 'document.pdf'));
      file = 'document.pdf';
    } else if (isImage) {
      const imgFile = `image${ext}`;
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await copyFile(found.source, join(dir, imgFile));
      const safeTitle = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>html,body{margin:0;height:100%;background:#111216;display:grid;place-items:center}img{max-width:100%;max-height:100vh;object-fit:contain;display:block}</style></head><body><img src="./${imgFile}" alt="${safeTitle}"></body></html>`;
      await writeFile(join(dir, 'index.html'), html, { mode: 0o600 });
      file = 'index.html';
    } else {
      file = await this.copyPage(id, seq, { source: found.source, files: found.files });
      if (!file) return 'skipped';
    }

    const version: ArtifactVersion = { seq, file, at };
    const session = typeof found.session === 'string' && found.session.startsWith('codex:') ? found.session.slice(0, 80) : 'codex:all';
    if (existing) {
      existing.versions = [...existing.versions.filter(entry => entry.seq !== seq), version].sort((a, b) => a.seq - b.seq);
      existing.kind = isDoc ? 'doc' : 'page';
      existing.title = title;
      if (description) existing.description = description;
      if (session) existing.session = session;
      existing.sourceHash = hash;
      existing.updatedAt = at;
      return 'updated';
    }
    const created = cleanArtifact({
      id,
      kind: isDoc ? 'doc' : 'page',
      title,
      description,
      origin: 'codex',
      sourceHash: hash,
      session,
      updatedAt: at,
      versions: [version],
    });
    if (created) this.items.push(created);
    this.removed = this.removed.filter(entry => entry !== id);
    return 'copied';
  }
  // Only names the session of a page already imported from claude.ai; never adds one, so a page you removed stays gone.
  groupFound(found: { id?: string | null; url?: string; project?: string; chat?: string; chatTitle?: string }): 'grouped' | 'skipped' {
    const item = this.items.find(entry => entry.origin === 'claude' && ((Boolean(found.id) && entry.id === found.id) || (Boolean(found.url) && entry.url === found.url)));
    if (!item) return 'skipped';
    if (cleanFolder(found.project)) item.folder = cleanFolder(found.project);
    if (!found.chat) return 'skipped';
    item.session = `claude-code:${String(found.chat).slice(0, 60)}`;
    if (found.chatTitle) item.sessionTitle = text(found.chatTitle, 120); else delete item.sessionTitle;
    return 'grouped';
  }
  // The files a past publish uploaded to its artifact (found.assets: id, path, type, sha256), each as it was uploaded:
  // one changed since (its sha256 differs), gone, too big or not a plain file is left out.
  async copyAssets(item: ArtifactItem, assets?: Array<{ id?: string; path?: unknown; type?: unknown; sha256?: unknown }>): Promise<number> {
    let copied = 0;
    for (const asset of Array.isArray(assets) ? assets.slice(0, MAX_FILES) : []) {
      if (!asset?.id || !BLOB_ID.test(asset.id) || item.assets?.[asset.id] || typeof asset.path !== 'string') continue;
      try {
        const info = await lstat(asset.path);
        if (!info.isFile() || info.size > MAX_FILE) continue;
        const bytes = await readFile(asset.path);
        if (asset.sha256 && createHash('sha256').update(bytes).digest('hex') !== String(asset.sha256).toLowerCase()) continue;
        const dir = join(this.dir, item.id, '_blob');
        await mkdir(dir, { recursive: true, mode: 0o700 });
        await writeFile(join(dir, asset.id), bytes, { mode: 0o600 });
        item.assets = { ...item.assets, [asset.id]: blobType(asset.type, asset.path) };
        copied++;
      } catch { /* Not on this Mac any more. */ }
    }
    return copied;
  }
  async copyPage(id: string, seq: number, found: { source?: string | null; files?: Array<[string, string[]]> | null }): Promise<string | null> {
    if (!found.source || !PAGE_FILE.test(found.source)) return null;
    let info: Awaited<ReturnType<typeof lstat>>;
    try { info = await lstat(found.source); } catch { return null; }
    if (!info.isFile() || info.size > MAX_PAGE) return null;
    const dir = this.versionDir(id, seq), file = `index${extname(found.source).toLowerCase()}`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await copyFile(found.source, join(dir, file));
    let count = 0;
    for (const [published, candidates] of found.files || []) {
      if (count >= MAX_FILES) break;
      const clean = plainPath(published);
      if (!clean || !TYPES[extname(clean).toLowerCase()] || clean === file) continue;
      for (const candidate of candidates) {
        try {
          const details = await lstat(candidate);
          if (!details.isFile() || details.size > MAX_FILE || !TYPES[extname(candidate).toLowerCase()]) continue;
          await mkdir(dirname(join(dir, clean)), { recursive: true, mode: 0o700 });
          await copyFile(candidate, join(dir, clean));
          count++;
          break;
        } catch { /* Not at this location; try the next one. */ }
      }
    }
    return file;
  }
}
