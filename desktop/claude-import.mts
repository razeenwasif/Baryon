import { existsSync, createReadStream, type Dirent } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, relative, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';
import { atomicJSON } from './json-store.mjs';
import { inNotebook, titleFor, type HistoryEntry, type WorkConfig } from './sessions.mjs';
import { checkWorkFolder } from './work-sandbox.mjs';

export const IMPORTED_MODE = 'claude-code';
const MAX_ENTRIES = 1000, MAX_ROWS = 200, MAX_USER = 20000, MAX_REPLY = 60000, MAX_OUTPUT = 1500, MAX_ERROR = 800;
const SAFE_NAME = /^[a-z0-9-]{1,60}$/;
// Notices the app adds to the conversation, which you didn't write.
const NOTICES = /<(system-reminder|task-notification|artifact-view-context|local-command-caveat|local-command-stdout|local-command-stderr|bash-stdout|bash-stderr|side-sessions-event|ci-monitor-event|ide_[a-z_]+)\b[^>]*>[\s\S]*?<\/\1>/g;
const HIDDEN_TOOLS = /^(?:TodoWrite|ToolSearch|TaskCreate|TaskUpdate|TaskList|TaskGet|mcp__ccd_turn__|mcp__ccd_session__mark_chapter)/;
const clip = (text: unknown, limit: number): string => { const value = String(text ?? ''); return value.length <= limit ? value : `${value.slice(0, limit)}\n… ${value.length - limit} more characters`; };

export interface TranscriptRow {
  id: string;
  status: string;
  tool: string;
  summary: string;
  reason?: string;
  output?: string;
}

export interface TranscriptTurn {
  texts: string[];
  rows: TranscriptRow[];
  at: string;
}

export interface TranscriptHistoryEntry extends HistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  at: string;
  mode: string;
  activity?: TranscriptRow[];
}

export interface TranscriptEvent {
  type?: string;
  sessionId?: string;
  uuid?: string;
  customTitle?: string;
  aiTitle?: string;
  isSidechain?: boolean;
  cwd?: string;
  timestamp?: string;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  isVisibleInTranscriptOnly?: boolean;
  turnOrigin?: string;
  isApiErrorMessage?: boolean;
  message?: {
    model?: string;
    content?: string | Array<Record<string, any>>;
  };
}

export interface SessionFileInfo {
  id: string;
  path: string;
  size: number;
  mtimeMs: number;
  helper: boolean;
}

export interface SessionGroup {
  id: string;
  files: SessionFileInfo[];
  title: string;
  cwd: string;
  recorded?: boolean;
  signature?: string;
}

export interface ImportManifestEntry {
  signature?: string;
  turns: number;
}

export interface ImportedChatRecord {
  id: string;
  signature: string;
  turns: number;
  cwd?: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  imported?: {
    from: string;
    project: string;
    turns: number;
    notebook?: true;
  };
  work?: {
    folder: string;
    permission: WorkConfig['permission'];
  };
}

export interface ImportProgress {
  done: number;
  total: number;
}

export interface ConvertSessionsOptions {
  todo: readonly SessionGroup[];
  paths: Record<string, string>;
  sessionsDir: string;
  dataDir?: string;
  home?: string;
  tempRoots?: readonly string[];
  onProgress?: (progress: ImportProgress) => void;
}

export interface ConvertSessionsResult {
  chats: ImportedChatRecord[];
  failed: Array<{ id: string; message: string }>;
}

export function cleanUserText(text: unknown): string {
  let value = String(text ?? '').replace(NOTICES, '');
  value = value.replace(/<\/?pasted_content\b[^>]*>/g, '');
  value = value.replace(/<bash-input>([\s\S]*?)<\/bash-input>/g, (_all, command: string) => `! ${command.trim()}`);
  if (/<command-name>/.test(value)) {
    const name = /<command-name>([\s\S]*?)<\/command-name>/.exec(value)?.[1]?.trim() || '', args = /<command-args>([\s\S]*?)<\/command-args>/.exec(value)?.[1]?.trim() || '';
    value = value.replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g, '').trim() || `${name}${args ? ` ${args}` : ''}`;
  }
  value = value.replace(/^\s*\[Request interrupted[^\]]*\]\s*$/gm, '').replace(/^\s*Caveat: The messages below were generated[^\n]*$/gm, '');
  return value.trim();
}
const shortTool = (name: unknown): string => String(name ?? '').replace(/^mcp__[^_]+(?:_[^_]+)*__/, '') || 'tool';
const firstString = (input: Record<string, unknown> | undefined): string | undefined => Object.values(input ?? {}).find((value): value is string => typeof value === 'string' && Boolean(value.trim()));
const insideFolder = (path: unknown, cwd: string): unknown => { if (!cwd || typeof path !== 'string') return path; const rel = relative(cwd, path); return rel && !rel.startsWith('..') && !rel.startsWith(sep) ? rel : path; };
// One step, in the same shape as Fairy's own, so it reads and summarises the same way.
function toRow(block: { name?: string; input?: Record<string, unknown>; id?: unknown }, cwd: string): TranscriptRow {
  const { name, input = {}, id } = block, base = { id: String(id), status: 'failed' };
  if (name === 'Bash') return { ...base, tool: 'run', summary: clip(input.command, 300), ...(input.description ? { reason: clip(input.description, 200) } : {}) };
  if (name === 'Read') return { ...base, tool: 'read', summary: clip(insideFolder(input.file_path, cwd), 300) };
  if (name === 'Write') return { ...base, tool: 'write', summary: clip(insideFolder(input.file_path, cwd), 300) };
  if (name === 'Edit' || name === 'MultiEdit' || name === 'NotebookEdit') return { ...base, tool: 'edit', summary: clip(insideFolder(input.file_path || input.notebook_path, cwd), 300) };
  if (name === 'Grep' || name === 'Glob') return { ...base, tool: 'search', summary: clip(input.pattern, 300) };
  if (name === 'Agent' || name === 'Task') return { ...base, tool: 'helper', summary: clip(input.description || input.prompt, 300) };
  return { ...base, tool: shortTool(name), summary: clip(firstString(input) || '', 200) };
}
const resultText = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.filter((item): item is { type: string; text?: string } => item?.type === 'text').map(item => item.text).join('\n') : '';
// Turns a transcript's lines into a chat. Copied history is dropped when the session it came from has it too.
export class TranscriptBuilder {
  own: Set<string>;
  alreadyElsewhere: (sessionId: string | undefined, uuid: string | undefined) => boolean;
  history: TranscriptHistoryEntry[];
  turn: TranscriptTurn | null;
  seen: Set<string>;
  rows: Map<string, TranscriptRow>;
  cwd: string;
  customTitle: string;
  aiTitle: string;
  typed: boolean;

  constructor({ ownIds = [], alreadyElsewhere = () => false }: { ownIds?: readonly string[]; alreadyElsewhere?: (sessionId: string | undefined, uuid: string | undefined) => boolean } = {}) {
    this.own = new Set(ownIds); this.alreadyElsewhere = alreadyElsewhere;
    this.history = []; this.turn = null; this.seen = new Set(); this.rows = new Map(); this.cwd = ''; this.customTitle = ''; this.aiTitle = ''; this.typed = false;
  }
  mine(event: TranscriptEvent): boolean { return !event.sessionId || !this.own.size || this.own.has(event.sessionId); }
  add(event: TranscriptEvent): void {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'custom-title' && event.customTitle && this.mine(event)) this.customTitle = event.customTitle;
    if (event.type === 'ai-title' && event.aiTitle && this.mine(event)) this.aiTitle = event.aiTitle;
    if ((event.type !== 'user' && event.type !== 'assistant') || event.isSidechain) return;
    if (event.uuid) { if (this.seen.has(event.uuid)) return; this.seen.add(event.uuid); }
    if (!this.mine(event) && this.alreadyElsewhere(event.sessionId, event.uuid)) return;
    this.cwd ||= typeof event.cwd === 'string' ? event.cwd : '';
    if (event.type === 'user') this.user(event); else this.assistant(event);
  }
  flush(): void {
    const turn = this.turn;
    this.turn = null;
    if (!turn || (!turn.texts.length && !turn.rows.length)) return;
    this.history.push({ role: 'assistant', content: clip(turn.texts.join('\n\n'), MAX_REPLY) || '(No written reply.)', at: turn.at, mode: IMPORTED_MODE, ...(turn.rows.length ? { activity: turn.rows.slice(-MAX_ROWS) } : {}) });
  }
  user(event: TranscriptEvent): void {
    const content = event.message?.content, blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const block of blocks) {
      if (block?.type !== 'tool_result') continue;
      const row = this.rows.get(block.tool_use_id);
      if (!row) continue;
      row.status = block.is_error ? 'failed' : 'done';
      const text = resultText(block.content);
      if (block.is_error) row.output = clip(text, MAX_ERROR);
      else if (row.tool === 'run' && text.trim()) row.output = clip(text, MAX_OUTPUT);
      if (this.turn) this.turn.at = event.timestamp || this.turn.at;
    }
    if (event.isMeta || event.isCompactSummary || event.isVisibleInTranscriptOnly) return;
    const text = cleanUserText(blocks.filter(block => block?.type === 'text').map(block => block.text).join('\n')), images = blocks.filter(block => block?.type === 'image').length;
    if (!text && !images) return;
    // Claude Code marks what a program sent rather than a person. Older transcripts don't say, so they count as typed.
    if (!event.turnOrigin || event.turnOrigin === 'human') this.typed = true;
    this.flush();
    this.history.push({ role: 'user', content: clip(`${text}${images ? `${text ? '\n\n' : ''}[${images === 1 ? 'An image' : `${images} images`}]` : ''}`, MAX_USER), at: event.timestamp || '', mode: IMPORTED_MODE });
    this.turn = { texts: [], rows: [], at: event.timestamp || '' };
  }
  assistant(event: TranscriptEvent): void {
    if (event.isApiErrorMessage || event.message?.model === '<synthetic>') return;
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    this.turn ||= { texts: [], rows: [], at: event.timestamp || '' };
    if (event.timestamp) this.turn.at = event.timestamp;
    for (const block of blocks) {
      if (block?.type === 'text' && block.text?.trim()) this.turn.texts.push(block.text.trim());
      else if (block?.type === 'tool_use' && !HIDDEN_TOOLS.test(block.name || '')) {
        const row = toRow(block, this.cwd);
        this.rows.set(block.id, row); this.turn.rows.push(row);
      }
    }
  }
  finish(): TranscriptHistoryEntry[] { this.flush(); return this.history.slice(-MAX_ENTRIES); }
}
async function eachEvent(path: string, use: (event: TranscriptEvent) => void): Promise<void> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    let event: TranscriptEvent;
    try { event = JSON.parse(line) as TranscriptEvent; } catch { continue; }
    use(event);
  }
}
const TEMP_ROOTS = [tmpdir(), '/tmp', '/private/tmp', '/private/var/folders', '/var/folders'];
const inTemp = (path: string, roots: readonly string[]): boolean => roots.some(root => path === root || path.startsWith(`${root}/`));
const originalProject = (cwd: unknown): string => String(cwd ?? '').replace(/\/\.claude\/worktrees\/.*$/, '');
// Claude Code names each project's folder after its path. Fairy's own helper folders, and temporary ones such as a test
// copy's, hold sessions a program ran rather than chats of yours, unless the desktop app kept them as its sessions.
export const helperFolder = (name: string): boolean => /-(?:claude|codex|antigravity)-workspace$/.test(name) || /^-(?:private-)?(?:tmp|var-folders)-/.test(name);
export function projectName(cwd: unknown, home = homedir(), tempRoots: readonly string[] = TEMP_ROOTS): string {
  // A session inside a project's hidden folder belongs to that project.
  const path = String(cwd ?? '').replace(/\/\.[^/]+(?:\/.*)?$/, '');
  if (!path) return 'Unknown folder';
  if (inTemp(path, tempRoots)) return 'Temporary folders';
  return path === home ? 'Home folder' : basename(path);
}
// A chat can carry on in its folder if that's still there. Otherwise it's for reading, and for ordinary chat.
export function workFolderFor(
  cwd: unknown,
  { dataDir = '', home = homedir(), exists = existsSync, tempRoots = TEMP_ROOTS }: { dataDir?: string; home?: string; exists?: (path: string) => boolean; tempRoots?: readonly string[] } = {},
): string | null {
  for (const path of [cwd, originalProject(cwd)]) {
    if (!path || typeof path !== 'string' || inTemp(path, tempRoots) || !exists(path)) continue;
    try { return checkWorkFolder(path, { dataDir, home }); } catch {}
  }
  return null;
}
// Finds every session, joining the transcripts the desktop app treats as one chat. Nothing here changes Claude Code's files.
export async function findSessions({ claudeDir = join(homedir(), '.claude'), desktopDir = join(homedir(), 'Library/Application Support/Claude/claude-code-sessions') }: { claudeDir?: string; desktopDir?: string } = {}): Promise<{ groups: SessionGroup[]; paths: Record<string, string> }> {
  const files = new Map<string, SessionFileInfo>(), records: Array<Record<string, any>> = [];
  let projects: Dirent[] = [];
  try { projects = await readdir(join(claudeDir, 'projects'), { withFileTypes: true }); } catch (error: unknown) { if ((error as { code?: string })?.code !== 'ENOENT') throw error; }
  for (const project of projects.filter(entry => entry.isDirectory())) {
    const folder = join(claudeDir, 'projects', project.name);
    for (const name of await readdir(folder).catch(() => [] as string[])) {
      const id = name.replace(/\.jsonl$/, '');
      if (!name.endsWith('.jsonl') || id.startsWith('agent-') || !SAFE_NAME.test(id)) continue;
      const info = await stat(join(folder, name)).catch(() => null);
      if (info?.isFile()) files.set(id, { id, path: join(folder, name), size: info.size, mtimeMs: Math.round(info.mtimeMs), helper: helperFolder(project.name) });
    }
  }
  const walk = async (folder: string, depth: number): Promise<void> => {
    for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [] as Dirent[])) {
      const path = join(folder, entry.name);
      if (entry.isDirectory() && depth) await walk(path, depth - 1);
      else if (/^local_.*\.json$/.test(entry.name)) { try { records.push(JSON.parse(await readFile(path, 'utf8'))); } catch {} }
    }
  };
  await walk(desktopDir, 3);
  const groups: SessionGroup[] = [], used = new Set<string>();
  for (const record of records) {
    const ids = [...(Array.isArray(record.priorCliSessionIds) ? record.priorCliSessionIds : []), record.cliSessionId].filter((id): id is string => typeof id === 'string' && files.has(id) && !used.has(id));
    if (!ids.length) continue;
    ids.forEach(id => used.add(id));
    groups.push({ id: `cc-${ids[0]}`, files: ids.map(id => files.get(id)!), title: typeof record.title === 'string' ? record.title : '', cwd: record.originCwd || record.cwd || '', recorded: true });
  }
  for (const file of files.values()) if (!used.has(file.id) && !file.helper) groups.push({ id: `cc-${file.id}`, files: [file], title: '', cwd: '' });
  return { groups, paths: Object.fromEntries([...files.values()].map(file => [file.id, file.path])) };
}
export const importSignature = (group: Pick<SessionGroup, 'files'>): string => group.files.map(file => `${file.id}:${file.size}:${file.mtimeMs}`).join('|');
// What to do with each one. A chat you deleted stays deleted, and one you've carried on with here stays as you left it.
// A group from the other Mac (claude-sync.mjs) comes with its signature already worked out.
export function planImport(
  groups: readonly SessionGroup[],
  manifest: Record<string, ImportManifestEntry | undefined>,
  { sessionById, busy = () => false }: { sessionById: (id: string) => { turns: number } | null | undefined; busy?: (id: string) => boolean },
): { todo: SessionGroup[]; kept: string[] } {
  const todo: SessionGroup[] = [], kept: string[] = [];
  for (const group of groups) {
    const known = manifest[group.id];
    if (known?.signature === (group.signature ?? importSignature(group))) continue;
    if (known && known.turns > 0) {
      const session = sessionById(group.id);
      if (!session || session.turns !== known.turns || busy(group.id)) { kept.push(group.id); continue; }
    }
    todo.push(group);
  }
  return { todo, kept };
}
// The transcripts are large, so this runs on a worker thread and the window stays responsive.
export async function convertSessions({ todo, paths, sessionsDir, dataDir, home = homedir(), tempRoots = TEMP_ROOTS, onProgress = () => {} }: ConvertSessionsOptions): Promise<ConvertSessionsResult> {
  const parents = new Map<string, Set<string>>(), chats: ImportedChatRecord[] = [], failed: Array<{ id: string; message: string }> = [];
  const uuidsOf = async (id: string): Promise<Set<string>> => {
    if (!parents.has(id)) {
      const found = new Set<string>();
      if (paths[id]) await eachEvent(paths[id], event => { if (event.uuid && event.sessionId === id) found.add(event.uuid); }).catch(() => {});
      parents.set(id, found);
    }
    return parents.get(id)!;
  };
  let done = 0;
  for (const group of todo) {
    try {
      const ownIds = group.files.map(file => file.id), foreign = new Set<string>();
      for (const file of group.files) await eachEvent(file.path, event => { if (event.sessionId && !ownIds.includes(event.sessionId) && (event.type === 'user' || event.type === 'assistant')) foreign.add(event.sessionId); });
      const elsewhere = new Map<string, Set<string>>();
      for (const id of foreign) elsewhere.set(id, await uuidsOf(id));
      const builder = new TranscriptBuilder({ ownIds, alreadyElsewhere: (id, uuid) => Boolean(id && uuid && elsewhere.get(id)?.has(uuid)) });
      for (const file of group.files) await eachEvent(file.path, event => builder.add(event));
      const history = builder.finish(), signature = importSignature(group);
      // A session you never typed in, outside the desktop app, was a program's: a test run or a background call.
      if (!history.some(entry => entry.role === 'user') || (!group.recorded && !builder.typed)) { chats.push({ id: group.id, signature, turns: 0 }); continue; }
      const cwd = group.cwd || builder.cwd, folder = workFolderFor(cwd, { dataDir, home, tempRoots });
      await atomicJSON(join(sessionsDir, `${group.id}.json`), JSON.stringify(history));
      chats.push({ id: group.id, signature, turns: history.length, cwd, title: group.title || builder.customTitle || builder.aiTitle || titleFor(history), createdAt: history[0]!.at, updatedAt: history.at(-1)!.at,
        imported: { from: IMPORTED_MODE, project: projectName(cwd, home, tempRoots), turns: history.length, ...(inNotebook(cwd) ? { notebook: true } : {}) }, ...(folder ? { work: { folder, permission: 'ask' } } : {}) });
    } catch (error: unknown) { failed.push({ id: group.id, message: String(error instanceof Error ? error.message : error).slice(0, 200) }); }
    onProgress({ done: ++done, total: todo.length });
  }
  return { chats, failed };
}
export function startImportWorker(
  workerData: Omit<ConvertSessionsOptions, 'onProgress'>,
  onProgress: (progress: ImportProgress) => void = () => {},
): { done: Promise<ConvertSessionsResult>; stop: () => Promise<number> } {
  const worker = new Worker(new URL('./claude-import-worker.mjs', import.meta.url), { workerData });
  const done = new Promise<ConvertSessionsResult>((resolve, reject) => {
    worker.on('message', (message: { progress?: ImportProgress; result?: ConvertSessionsResult }) => { if (message.progress) onProgress(message.progress); if (message.result) resolve(message.result); });
    worker.on('error', reject);
    worker.on('exit', code => reject(new Error(code ? 'The import stopped early.' : 'The import stopped.')));
  });
  return { done, stop: () => worker.terminate() };
}
