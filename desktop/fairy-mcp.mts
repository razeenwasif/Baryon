// Doc 7, #11: Read-only Fairy MCP stdio server — exposes Fairy's memory, project memory,
// per-project lab journal, session recall, and local notes safely to external MCP clients
// (Claude Code, Antigravity, scripts). Strictly read-only: zero writes, zero keys/tokens.
import { createHash } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultDataDir } from './fairy-cli.mjs';
import { JOURNAL_DIR, LabJournal, redactSecrets } from './lab-journal.mjs';
import { LocalFiles, excludedPath } from './local-files.mjs';
import { MEMORY_KINDS, type MemoryKind } from './long-term-memory.mjs';
import { NoteKeywords, noteChunks, noteTokens, type NoteChunkDraft } from './notes.mjs';
import { MEMORY_DIR, ProjectMemory } from './project-memory.mjs';
import { SessionRecall, formatRecallForTool, loadSessionsFromDir } from './session-recall.mjs';
import { checkArguments, type JsonSchemaLike } from './tool-arguments.mjs';

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const MAX_LINE_BYTES = 2 * 1024 * 1024;
const MAX_NOTE_FILES = 5000;
const MAX_NOTE_SIZE = 256 * 1024;
const MAX_READ_FILE_BYTES = 512 * 1024;

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaLike;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  mimeType: string;
}

interface SafeSettings {
  notesRoot: string;
  rememberedFacts: string;
}

interface ProjectMemorySummary {
  folder: string;
  count: number;
  lastAt: string;
}

interface CollectedNoteChunk extends NoteChunkDraft {
  id: string;
  path: string;
}

interface LongTermMemoryEntry {
  id: unknown;
  kind: MemoryKind;
  label: string;
  text: string;
  source: unknown;
  at: unknown;
}

interface LongTermDataResult {
  kind: string;
  items: LongTermMemoryEntry[];
  rememberedFacts: string[];
}

interface ProjectSummaryEntry {
  folder: string;
  memoryFindings: number;
  journalEntries: number;
  lastAt: string;
}

export type JsonRpcId = string | number;

export interface JsonRpcError {
  code: number;
  message: string;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface FairyMcpHandlerOptions {
  dataDir?: string;
}

export interface FairyMcpHandler {
  handleMessage: (message: unknown) => Promise<JsonRpcResponse | null>;
  callTool: (name: string, args?: Record<string, unknown>) => Promise<unknown>;
}

export interface McpInputStream {
  setEncoding?: (encoding: BufferEncoding) => unknown;
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
  on(event: 'end' | 'close', listener: () => void): unknown;
  off?: ((event: 'data', listener: (chunk: Buffer | string) => void) => unknown) &
    ((event: 'end' | 'close', listener: () => void) => unknown);
  resume?: () => unknown;
}

export interface McpOutputStream {
  destroyed?: boolean;
  writableEnded?: boolean;
  write(chunk: string): unknown;
}

export interface StartFairyMcpServerOptions {
  dataDir?: string;
  input?: McpInputStream;
  output?: McpOutputStream;
  log?: (msg: string) => void;
}

export interface FairyMcpServer {
  closed: Promise<void>;
  close: () => void;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'fairy_memory_read',
    description: 'Read Fairy’s long-term structured memory (about you, projects, commitments, development rules) and remembered facts.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['all', 'you', 'projects', 'self', 'work'] },
        query: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fairy_project_memory',
    description: 'Read kept project-memory findings for a work folder, or list all folders that have kept findings.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fairy_lab_journal',
    description: 'Read dated lab journal entries (what was tried, outcome, decisions) for a project folder, or list projects with journals.',
    inputSchema: {
      type: 'object',
      properties: {
        folder: { type: 'string' },
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fairy_recall_sessions',
    description: 'Search across Fairy’s work sessions and plain chats and return cited excerpts with chat title, date, turn number, and session id.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        folder: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fairy_notes_search',
    description: 'Search your configured personal Markdown notes folder locally with keywords and return matching excerpts and line numbers.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 12 },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'fairy_notes_read',
    description: 'Read a line range from a note inside your configured personal notes folder.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        start_line: { type: 'integer', minimum: 1 },
        max_lines: { type: 'integer', minimum: 1, maximum: 300 },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
];

const MCP_RESOURCES: McpResourceDefinition[] = [
  { uri: 'fairy://memory/long-term', name: 'Long-term memory & facts', mimeType: 'application/json' },
  { uri: 'fairy://projects', name: 'Known projects (memory & lab journals)', mimeType: 'application/json' },
];

function errorText(err: unknown, fallback?: string): string {
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (msg) return String(msg);
  }
  return fallback !== undefined ? fallback : String(err);
}

async function readJsonSafe<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function readSafeSettings(dataDir: string): Promise<SafeSettings> {
  const raw = await readJsonSafe<Record<string, unknown>>(join(dataDir, 'settings.json'), {});
  return {
    notesRoot: typeof raw?.notesRoot === 'string' ? raw.notesRoot : '',
    rememberedFacts: typeof raw?.rememberedFacts === 'string' ? redactSecrets(raw.rememberedFacts) : '',
  };
}

function noteChunkId(relPath: string, line: number, answer: string): string {
  return createHash('sha256').update(`${relPath}\0${line}\0${answer}`).digest('hex').slice(0, 24);
}

async function listProjectMemories(dir: string): Promise<ProjectMemorySummary[]> {
  let names: string[] = [];
  try { names = await readdir(dir); } catch { return []; }
  const out: ProjectMemorySummary[] = [];
  for (const name of names.filter(n => n.endsWith('.json'))) {
    const parsed = await readJsonSafe<{ folder?: unknown; findings?: Array<{ at?: unknown }> } | null>(join(dir, name), null);
    if (typeof parsed?.folder !== 'string' || !Array.isArray(parsed.findings)) continue;
    const last = parsed.findings.at(-1);
    out.push({
      folder: parsed.folder,
      count: parsed.findings.length,
      lastAt: typeof last?.at === 'string' ? last.at : String(last?.at || ''),
    });
  }
  return out.sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
}

async function collectNoteChunks(localFiles: LocalFiles, rootId: string): Promise<CollectedNoteChunk[]> {
  const queue: string[] = [''];
  const chunks: CollectedNoteChunk[] = [];
  let seen = 0;
  while (queue.length && seen < MAX_NOTE_FILES && chunks.length < 12000) {
    const relDir = queue.shift() ?? '';
    let dir;
    try { dir = await localFiles.checked(rootId, relDir); } catch { continue; }
    let entries: Dirent[] = [];
    try { entries = await readdir(dir.full, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (++seen > MAX_NOTE_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (excludedPath(rel)) continue;
      if (entry.isDirectory()) {
        queue.push(rel);
      } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        try {
          const checked = await localFiles.checked(rootId, rel);
          const info = await stat(checked.full);
          if (!info.isFile() || info.size > MAX_NOTE_SIZE) continue;
          const text = await readFile(checked.full, 'utf8');
          if (text.includes('\0')) continue;
          for (const c of noteChunks(text, rel)) {
            chunks.push({
              ...c,
              id: noteChunkId(rel, c.line, c.answer),
              path: rel,
            });
          }
        } catch {}
      }
    }
  }
  return chunks;
}

export function createFairyMcpHandler({ dataDir = defaultDataDir() }: FairyMcpHandlerOptions = {}): FairyMcpHandler {
  const projectMemory = new ProjectMemory({ dir: join(dataDir, MEMORY_DIR) });
  const labJournal = new LabJournal({ dir: join(dataDir, JOURNAL_DIR) });
  let initialized = false;

  async function resolveNotesContext(): Promise<{ localFiles: LocalFiles; notesRoot: string }> {
    const safeSettings = await readSafeSettings(dataDir);
    const localFiles = new LocalFiles({
      read: () => readJsonSafe(join(dataDir, 'local-folders.json'), []),
      write: async () => {},
    });
    const roots = await localFiles.load();
    const notesRoot = safeSettings.notesRoot && roots.some(r => r.id === safeSettings.notesRoot)
      ? safeSettings.notesRoot
      : '';
    if (!notesRoot) throw new Error('No personal notes folder is configured in Fairy.');
    return { localFiles, notesRoot };
  }

  async function readLongTermData({ kind = 'all', query = '' }: { kind?: string; query?: string } = {}): Promise<LongTermDataResult> {
    const saved = await readJsonSafe<{ items?: unknown }>(join(dataDir, 'long-term-memory.json'), {});
    const safeSettings = await readSafeSettings(dataDir);
    const rawItems: unknown[] = Array.isArray(saved?.items) ? saved.items : [];
    let items: LongTermMemoryEntry[] = rawItems
      .filter((i): i is Record<string, unknown> & { text: string; kind: MemoryKind } =>
        Boolean(i) &&
        typeof i === 'object' &&
        typeof (i as Record<string, unknown>).text === 'string' &&
        typeof (i as Record<string, unknown>).kind === 'string' &&
        Object.hasOwn(MEMORY_KINDS, (i as Record<string, unknown>).kind as string))
      .map(i => ({
        id: i.id,
        kind: i.kind,
        label: MEMORY_KINDS[i.kind],
        text: redactSecrets(i.text),
        source: i.source,
        at: i.at || '',
      }));
    if (kind && kind !== 'all') items = items.filter(i => i.kind === kind);
    const q = String(query || '').trim().toLowerCase();
    if (q) items = items.filter(i => i.text.toLowerCase().includes(q));
    const facts = safeSettings.rememberedFacts
      ? safeSettings.rememberedFacts.split(/\r?\n/).map(s => s.trim()).filter(Boolean).filter(s => !q || s.toLowerCase().includes(q))
      : [];
    return { kind, items, rememberedFacts: facts };
  }

  async function readProjectsSummary(): Promise<ProjectSummaryEntry[]> {
    const [memProjects, journalProjects] = await Promise.all([
      listProjectMemories(join(dataDir, MEMORY_DIR)),
      labJournal.listProjects(),
    ]);
    const byFolder = new Map<string, ProjectSummaryEntry>();
    for (const m of memProjects) {
      byFolder.set(m.folder, { folder: m.folder, memoryFindings: m.count, journalEntries: 0, lastAt: m.lastAt || '' });
    }
    for (const j of journalProjects) {
      const cur = byFolder.get(j.folder) || { folder: j.folder, memoryFindings: 0, journalEntries: 0, lastAt: '' };
      cur.journalEntries = j.count;
      if (String(j.lastAt) > String(cur.lastAt)) cur.lastAt = j.lastAt;
      byFolder.set(j.folder, cur);
    }
    return [...byFolder.values()].sort((a, b) => String(b.lastAt).localeCompare(String(a.lastAt)));
  }

  async function callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const def = MCP_TOOLS.find(t => t.name === name);
    if (!def) throw new Error(`Unknown tool: ${name}`);
    const invalid = checkArguments(def.inputSchema, args ?? {});
    if (invalid) throw new Error(invalid);

    if (name === 'fairy_memory_read') {
      return readLongTermData(args as { kind?: string; query?: string });
    }

    if (name === 'fairy_project_memory') {
      const folder = typeof args.folder === 'string' ? args.folder : '';
      if (folder) {
        const findings = await projectMemory.list(folder);
        return { folder, findings: findings.map(f => ({ ...f, text: redactSecrets(f.text) })) };
      }
      return { projects: await listProjectMemories(join(dataDir, MEMORY_DIR)) };
    }

    if (name === 'fairy_lab_journal') {
      const folder = typeof args.folder === 'string' ? args.folder : '';
      if (!folder) {
        return { projects: await labJournal.listProjects() };
      }
      let entries = await labJournal.list(folder);
      const q = String(args.query || '').trim().toLowerCase();
      if (q) {
        entries = entries.filter(e => `${e.date} ${e.title} ${e.tried} ${e.outcome} ${e.decision}`.toLowerCase().includes(q));
      }
      const limit = typeof args.limit === 'number' ? args.limit : 20;
      return { folder, total: entries.length, entries: entries.slice(0, limit) };
    }

    if (name === 'fairy_recall_sessions') {
      const query = String(args.query || '');
      const folder = typeof args.folder === 'string' ? args.folder : '';
      const limit = typeof args.limit === 'number' ? args.limit : 6;
      const store = await loadSessionsFromDir(join(dataDir, 'sessions'));
      const recall = new SessionRecall({ sessions: store });
      const res = await recall.search(query, {
        limit,
        onlyFolder: folder,
      });
      return {
        summary: formatRecallForTool(res),
        query: res.query,
        hits: res.hits.map(h => ({
          citation: h.citation,
          sessionId: h.sessionId,
          title: h.title,
          folder: h.folder,
          date: h.date,
          turnIndex: h.turnIndex,
          score: h.score,
          excerpt: h.excerpt,
        })),
      };
    }

    if (name === 'fairy_notes_search') {
      const query = String(args.query || '');
      const limit = typeof args.limit === 'number' ? args.limit : 6;
      const { localFiles, notesRoot } = await resolveNotesContext();
      const chunks = await collectNoteChunks(localFiles, notesRoot);
      const keywords = new NoteKeywords(chunks);
      let rawHits: Array<{ id: string; score: number; hits?: number }> = keywords.search(query);
      if (!rawHits.length && chunks.length) {
        // Fallback for small note sets where BM25 IDF log(N) stays below 1.0
        const qTokens = noteTokens(query);
        const phrase = query.trim().toLowerCase();
        const terms = qTokens.length ? qTokens : [phrase];
        rawHits = chunks
          .map(c => {
            const hay = `${c.question}\n${c.answer}`.toLowerCase();
            const hits = terms.filter(t => hay.includes(t)).length;
            return { id: c.id, score: hits / Math.max(1, terms.length), hits };
          })
          .filter(h => h.hits > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      }
      const byId = new Map(chunks.map(c => [c.id, c]));
      const results = rawHits.slice(0, limit).map(h => {
        const chunk = byId.get(h.id);
        return chunk ? {
          path: chunk.path,
          heading: chunk.question,
          line: chunk.line,
          score: Number((h.score || 0).toFixed(3)),
          excerpt: redactSecrets(chunk.answer.slice(0, 800)),
        } : null;
      }).filter((r): r is NonNullable<typeof r> => r !== null);
      return { query, hits: results };
    }

    if (name === 'fairy_notes_read') {
      const { localFiles, notesRoot } = await resolveNotesContext();
      const checked = await localFiles.checked(notesRoot, String(args.path || ''));
      const info = await stat(checked.full);
      if (!info.isFile()) throw new Error('That path is not a file.');
      if (info.size > MAX_READ_FILE_BYTES) throw new Error('Note is too large to read in one call.');
      const text = await readFile(checked.full, 'utf8');
      if (text.includes('\0')) throw new Error('Cannot read binary file.');
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, typeof args.start_line === 'number' ? args.start_line : 1);
      const count = Math.min(300, Math.max(1, typeof args.max_lines === 'number' ? args.max_lines : 120));
      const slice = lines.slice(start - 1, start - 1 + count);
      return {
        path: checked.path,
        startLine: start,
        endLine: start + Math.max(0, slice.length - 1),
        totalLines: lines.length,
        hasMore: start - 1 + slice.length < lines.length,
        text: slice.map((line, i) => `${start + i}: ${redactSecrets(line)}`).join('\n'),
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  }

  async function handleMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (!message || typeof message !== 'object' || (message as Record<string, unknown>).jsonrpc !== '2.0') {
      const rawId = typeof message === 'object' && message !== null && 'id' in message
        ? (message as { id?: unknown }).id
        : undefined;
      const errId = typeof rawId === 'string' || typeof rawId === 'number' ? rawId : null;
      return { jsonrpc: '2.0', id: errId, error: { code: -32600, message: 'Invalid Request' } };
    }
    const req = message as { id?: unknown; method?: unknown; params?: Record<string, unknown> };
    const { id, method, params } = req;
    // Notifications (no id) never get a response per JSON-RPC 2.0 / MCP
    if (id === undefined || id === null) {
      if (method === 'notifications/initialized') initialized = true;
      return null;
    }
    const rpcId = id as JsonRpcId;

    try {
      if (method === 'initialize') {
        return {
          jsonrpc: '2.0',
          id: rpcId,
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: {
              tools: { listChanged: false },
              resources: { listChanged: false },
            },
            serverInfo: { name: 'fairy-mcp', version: '1.0.0' },
          },
        };
      }
      if (method === 'ping') {
        return { jsonrpc: '2.0', id: rpcId, result: { initialized } };
      }
      if (method === 'tools/list') {
        return { jsonrpc: '2.0', id: rpcId, result: { tools: MCP_TOOLS } };
      }
      if (method === 'tools/call') {
        const toolName = typeof params?.name === 'string' ? params.name : '';
        const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const data = await callTool(toolName, toolArgs);
          return {
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
              structuredContent: data,
              isError: false,
            },
          };
        } catch (err: unknown) {
          return {
            jsonrpc: '2.0',
            id: rpcId,
            result: {
              content: [{ type: 'text', text: errorText(err) }],
              isError: true,
            },
          };
        }
      }
      if (method === 'resources/list') {
        return { jsonrpc: '2.0', id: rpcId, result: { resources: MCP_RESOURCES } };
      }
      if (method === 'resources/read') {
        const uri = params?.uri;
        if (uri === 'fairy://memory/long-term') {
          const data = await readLongTermData({});
          return {
            jsonrpc: '2.0',
            id: rpcId,
            result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] },
          };
        }
        if (uri === 'fairy://projects') {
          const data = { projects: await readProjectsSummary() };
          return {
            jsonrpc: '2.0',
            id: rpcId,
            result: { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(data, null, 2) }] },
          };
        }
        return { jsonrpc: '2.0', id: rpcId, error: { code: -32002, message: `Resource not found: ${String(uri || '')}` } };
      }
      return { jsonrpc: '2.0', id: rpcId, error: { code: -32601, message: `Method not found: ${String(method)}` } };
    } catch (err: unknown) {
      return { jsonrpc: '2.0', id: rpcId, error: { code: -32603, message: errorText(err, 'Internal error') } };
    }
  }

  return { handleMessage, callTool };
}

export function startFairyMcpServer({
  dataDir = defaultDataDir(),
  input = process.stdin,
  output = process.stdout,
  log = (msg: string) => { process.stderr.write(`${msg}\n`); },
}: StartFairyMcpServerOptions = {}): FairyMcpServer {
  const { handleMessage } = createFairyMcpHandler({ dataDir });
  let buffer = '';
  let inFlight = Promise.resolve();
  let stopped = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });

  const writeResponse = (msg: JsonRpcResponse | null): void => {
    if (!msg || stopped || output.destroyed || output.writableEnded) return;
    output.write(`${JSON.stringify(msg)}\n`);
  };

  const processLine = (line: string): void => {
    inFlight = inFlight.then(async () => {
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        return;
      }
      const reply = await handleMessage(msg);
      if (reply) writeResponse(reply);
    }).catch((err: unknown) => log(`fairy-mcp: ${errorText(err)}`));
  };

  const onData = (chunk: Buffer | string): void => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (Buffer.byteLength(buffer, 'utf8') > MAX_LINE_BYTES) {
      buffer = '';
      writeResponse({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } });
      return;
    }
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, at);
      buffer = buffer.slice(at + 1);
      if (line.trim()) processLine(line);
    }
  };

  const onEnd = (): void => finish();

  const finish = (): void => {
    if (stopped) return;
    stopped = true;
    input.off?.('data', onData);
    input.off?.('end', onEnd);
    input.off?.('close', onEnd);
    inFlight.finally(() => resolveClosed());
  };

  input.setEncoding?.('utf8');
  input.on('data', onData);
  input.on('end', onEnd);
  input.on('close', onEnd);
  input.resume?.();

  return {
    closed,
    close: finish,
  };
}
