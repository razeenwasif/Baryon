import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

const NAME = /^[a-z0-9][a-z0-9_-]{0,29}$/, CALL_LIMIT = 120000, RESULT_LIMIT = 64 * 1024, MAX_STDIO_BUFFER = 16 * 1024 * 1024, MAX_TOOLS = 60, MAX_IMAGES = 4, IMAGE_LIMIT = 8 * 1024 * 1024;
const protocolVersion = '2025-06-18';

export interface ConnectorConfig {
  id: string;
  name: string;
  kind: 'command' | 'url';
  target: string;
}

export interface McpToolDefinition {
  name: string;
  remote: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpImageContent {
  type: 'image';
  mimeType: string;
  data: string;
}

export interface McpCallResult {
  failed: boolean;
  text: string;
  images?: Array<{ mimeType: string; data: string }>;
}

export interface McpClientOptions {
  connector: ConnectorConfig;
  spawnProcess?: typeof spawn;
  fetchImpl?: typeof fetch;
}

export interface ConnectorStoreOptions {
  read: () => Promise<{ version?: number; items?: unknown[] } | null | undefined>;
  write: (data: { version: number; items: ConnectorConfig[] }) => Promise<unknown>;
  id?: () => string;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: { message?: unknown };
}

interface RawMcpTool {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
}

interface RawContentItem {
  type?: unknown;
  text?: unknown;
  mimeType?: unknown;
  data?: unknown;
}

// What the provider bridges can carry. Anything else stays a named placeholder.
const usableImage = (item: RawContentItem | null | undefined): item is McpImageContent =>
  item?.type === 'image'
  && typeof item.mimeType === 'string'
  && /^image\/(?:png|jpeg|gif|webp)$/.test(item.mimeType)
  && typeof item.data === 'string'
  && item.data.length <= IMAGE_LIMIT
  && /^[A-Za-z0-9+/]+={0,2}$/.test(item.data);

export const connectorToolName = (connector: string, tool: string): string => `c_${connector}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

// A personal MCP server, for the length of a work turn. Its tools run outside the sandbox, so calling one always asks unless allowed.
export class McpClient {
  connector: ConnectorConfig;
  spawnProcess: typeof spawn;
  fetchImpl: typeof fetch;
  pending: Map<number, PendingRequest>;
  id: number;
  tools: McpToolDefinition[];
  child: ChildProcessByStdio<Writable, Readable, null> | null;
  sessionId?: string;

  constructor({ connector, spawnProcess = spawn, fetchImpl = fetch }: McpClientOptions) {
    this.connector = connector;
    this.spawnProcess = spawnProcess;
    this.fetchImpl = fetchImpl;
    this.pending = new Map();
    this.id = 0;
    this.tools = [];
    this.child = null;
  }

  rpcOverStdio(message: JsonRpcRequest & { id: number }): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new Error(`${this.connector.name} took too long to answer.`)); }, CALL_LIMIT);
      this.pending.set(message.id, { resolve, reject, timer });
      this.child!.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }

  startProcess(): void {
    const child = this.spawnProcess('/bin/zsh', ['-lc', this.connector.target], { stdio: ['pipe', 'pipe', 'ignore'], detached: true }) as ChildProcessByStdio<Writable, Readable, null>;
    this.child = child;
    let buffer = '';
    const fail = (error: Error): void => { for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); };
    child.stdin.on('error', () => {});
    child.on('error', (error: Error) => fail(new Error(`${this.connector.name} couldn’t start: ${error.message}`)));
    child.on('close', () => fail(new Error(`${this.connector.name} stopped.`)));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_STDIO_BUFFER) {
        buffer = '';
        fail(new Error(`${this.connector.name} exceeded output buffer limit.`));
        this.close();
        return;
      }
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let reply: JsonRpcResponse; try { reply = JSON.parse(line) as JsonRpcResponse; } catch { continue; }
        if (reply.id === undefined) continue;
        const entry = this.pending.get(reply.id);
        if (!entry) continue;
        this.pending.delete(reply.id); clearTimeout(entry.timer);
        reply.error ? entry.reject(new Error(String(reply.error.message || 'The server refused.').slice(0, 300))) : entry.resolve(reply.result);
      }
    });
  }

  async rpcOverHttp(message: JsonRpcRequest, signal?: AbortSignal): Promise<unknown> {
    const response = await this.fetchImpl(this.connector.target, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}) }, body: JSON.stringify(message), signal: signal || AbortSignal.timeout(CALL_LIMIT) });
    this.sessionId = response.headers.get('mcp-session-id') || this.sessionId;
    if (!response.ok) throw new Error(`${this.connector.name} answered ${response.status}.`);
    if (message.id === undefined) return null;
    const body = await response.text();
    let json: JsonRpcResponse | null = null;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      for (const match of body.matchAll(/^data:\s*(.+)$/gm)) {
        try {
          const entry = JSON.parse(match[1]) as JsonRpcResponse;
          if (entry && entry.id === message.id) { json = entry; break; }
        } catch {}
      }
    } else {
      json = JSON.parse(body) as JsonRpcResponse;
    }
    if (json?.error) throw new Error(String(json.error.message || 'The server refused.').slice(0, 300));
    return json?.result;
  }

  request(method: string, params?: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const message: JsonRpcRequest & { id: number } = { jsonrpc: '2.0', id: ++this.id, method, params };
    return this.connector.kind === 'url' ? this.rpcOverHttp(message, signal) : this.rpcOverStdio(message);
  }

  async connect(): Promise<McpToolDefinition[]> {
    if (this.connector.kind !== 'url') this.startProcess();
    await this.request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'fairy', version: '1.0.0' } });
    const notice: JsonRpcRequest = { jsonrpc: '2.0', method: 'notifications/initialized' };
    if (this.connector.kind === 'url') await this.rpcOverHttp(notice).catch(() => {}); else this.child!.stdin.write(`${JSON.stringify(notice)}\n`);
    const { tools = [] } = (await this.request('tools/list', {})) as { tools?: RawMcpTool[] };
    this.tools = tools.slice(0, MAX_TOOLS).filter((tool): tool is RawMcpTool & { name: string } => typeof tool?.name === 'string').map(tool => ({ name: connectorToolName(this.connector.name, tool.name), remote: tool.name, description: `From ${this.connector.name}: ${String(tool.description || '').slice(0, 800)}`, inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? (tool.inputSchema as Record<string, unknown>) : { type: 'object', properties: {} } }));
    return this.tools;
  }

  async call(remote: string, args?: Record<string, unknown>, signal?: AbortSignal): Promise<McpCallResult> {
    const result = (await this.request('tools/call', { name: remote, arguments: args ?? {} }, signal)) as { content?: RawContentItem[]; structuredContent?: unknown; isError?: boolean } | null | undefined;
    const text = (result?.content || []).map(item => item?.type === 'text' ? String(item.text ?? '') : `[${String(item?.type || 'content')}]`).join('\n') || JSON.stringify(result?.structuredContent ?? '');
    const images = (Array.isArray(result?.content) ? result.content : []).filter(usableImage).slice(0, MAX_IMAGES).map(({ mimeType, data }) => ({ mimeType, data }));
    return { failed: result?.isError === true, text: text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n… the rest isn’t shown` : text, ...(images.length ? { images } : {}) };
  }

  close(): void {
    if (this.child) {
      try { if (this.child.pid !== undefined) process.kill(-this.child.pid, 'SIGTERM'); else this.child.kill(); }
      catch { try { this.child.kill(); } catch {} }
      this.child = null;
    }
  }
}

export class ConnectorStore {
  read: () => Promise<{ version?: number; items?: unknown[] } | null | undefined>;
  write: (data: { version: number; items: ConnectorConfig[] }) => Promise<unknown>;
  id: () => string;
  items: ConnectorConfig[];

  constructor({ read, write, id = randomUUID }: ConnectorStoreOptions) {
    this.read = read;
    this.write = write;
    this.id = id;
    this.items = [];
  }

  async load(): Promise<void> {
    const saved = await this.read();
    this.items = (Array.isArray(saved?.items) ? saved.items : []).filter((item): item is ConnectorConfig => {
      const candidate = item as Partial<ConnectorConfig> | null | undefined;
      return Boolean(candidate && NAME.test(candidate.name || '') && (candidate.kind === 'command' || candidate.kind === 'url') && typeof candidate.target === 'string');
    });
  }

  save(): Promise<unknown> { return this.write({ version: 1, items: this.items }); }

  state(): ConnectorConfig[] { return this.items; }

  async add({ name, kind, target }: { name: string; kind: string; target: string }): Promise<ConnectorConfig[]> {
    const clean = String(name ?? '').trim().toLowerCase();
    if (!NAME.test(clean)) throw new Error('Name a connector with lowercase letters, numbers, dashes and underscores.');
    if (this.items.some(item => item.name === clean)) throw new Error('A connector already has that name.');
    if ((kind !== 'command' && kind !== 'url') || typeof target !== 'string' || !target.trim() || target.length > 2000) throw new Error('A connector needs a command or an address.');
    if (kind === 'url') {
      let url: URL; try { url = new URL(target); } catch { throw new Error('That address isn’t valid.'); }
      if (url.username || url.password) throw new Error('Connector addresses cannot include credentials.');
      const host = url.hostname.toLowerCase();
      if (/^169\.254\./.test(host) || /^\[?fe80:/i.test(host) || host === 'metadata.google.internal' || host === 'metadata.goog') {
        throw new Error('That connector address is not allowed.');
      }
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(host))) throw new Error('Use an https address, or http on this Mac.');
    }
    this.items.push({ id: this.id(), name: clean, kind, target: target.trim() });
    await this.save(); return this.state();
  }

  async remove(id: string): Promise<ConnectorConfig[]> { this.items = this.items.filter(item => item.id !== id); await this.save(); return this.state(); }
}
