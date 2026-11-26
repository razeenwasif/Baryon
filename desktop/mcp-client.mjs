import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const NAME = /^[a-z0-9][a-z0-9_-]{0,29}$/, CALL_LIMIT = 120000, RESULT_LIMIT = 64 * 1024, MAX_STDIO_BUFFER = 16 * 1024 * 1024, MAX_TOOLS = 60, MAX_IMAGES = 4, IMAGE_LIMIT = 8 * 1024 * 1024;
const protocolVersion = '2025-06-18';
// What the provider bridges can carry. Anything else stays a named placeholder.
const usableImage = item => item?.type === 'image' && /^image\/(?:png|jpeg|gif|webp)$/.test(item.mimeType) && typeof item.data === 'string' && item.data.length <= IMAGE_LIMIT && /^[A-Za-z0-9+/]+={0,2}$/.test(item.data);
export const connectorToolName = (connector, tool) => `c_${connector}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
// A personal MCP server, for the length of a work turn. Its tools run outside the sandbox, so calling one always asks unless allowed.
export class McpClient {
  constructor({ connector, spawnProcess = spawn, fetchImpl = fetch }) { Object.assign(this, { connector, spawnProcess, fetchImpl }); this.pending = new Map(); this.id = 0; this.tools = []; }
  rpcOverStdio(message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(message.id); reject(new Error(`${this.connector.name} took too long to answer.`)); }, CALL_LIMIT);
      this.pending.set(message.id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  }
  startProcess() {
    this.child = this.spawnProcess('/bin/zsh', ['-lc', this.connector.target], { stdio: ['pipe', 'pipe', 'ignore'], detached: true });
    let buffer = '';
    const fail = error => { for (const [, entry] of this.pending) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); };
    this.child.stdin.on('error', () => {});
    this.child.on('error', error => fail(new Error(`${this.connector.name} couldn’t start: ${error.message}`)));
    this.child.on('close', () => fail(new Error(`${this.connector.name} stopped.`)));
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > MAX_STDIO_BUFFER) {
        buffer = '';
        fail(new Error(`${this.connector.name} exceeded output buffer limit.`));
        this.close();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let reply; try { reply = JSON.parse(line); } catch { continue; }
        const entry = this.pending.get(reply.id);
        if (!entry) continue;
        this.pending.delete(reply.id); clearTimeout(entry.timer);
        reply.error ? entry.reject(new Error(String(reply.error.message || 'The server refused.').slice(0, 300))) : entry.resolve(reply.result);
      }
    });
  }
  async rpcOverHttp(message, signal) {
    const response = await this.fetchImpl(this.connector.target, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(this.sessionId ? { 'mcp-session-id': this.sessionId } : {}) }, body: JSON.stringify(message), signal: signal || AbortSignal.timeout(CALL_LIMIT) });
    this.sessionId = response.headers.get('mcp-session-id') || this.sessionId;
    if (!response.ok) throw new Error(`${this.connector.name} answered ${response.status}.`);
    if (message.id === undefined) return null;
    const body = await response.text();
    let json = null;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      for (const match of body.matchAll(/^data:\s*(.+)$/gm)) {
        try {
          const entry = JSON.parse(match[1]);
          if (entry && entry.id === message.id) { json = entry; break; }
        } catch {}
      }
    } else {
      json = JSON.parse(body);
    }
    if (json?.error) throw new Error(String(json.error.message || 'The server refused.').slice(0, 300));
    return json?.result;
  }
  request(method, params, signal) {
    const message = { jsonrpc: '2.0', id: ++this.id, method, params };
    return this.connector.kind === 'url' ? this.rpcOverHttp(message, signal) : this.rpcOverStdio(message);
  }
  async connect() {
    if (this.connector.kind !== 'url') this.startProcess();
    await this.request('initialize', { protocolVersion, capabilities: {}, clientInfo: { name: 'fairy', version: '1.0.0' } });
    const notice = { jsonrpc: '2.0', method: 'notifications/initialized' };
    if (this.connector.kind === 'url') await this.rpcOverHttp(notice).catch(() => {}); else this.child.stdin.write(`${JSON.stringify(notice)}\n`);
    const { tools = [] } = await this.request('tools/list', {});
    this.tools = tools.slice(0, MAX_TOOLS).filter(tool => typeof tool?.name === 'string').map(tool => ({ name: connectorToolName(this.connector.name, tool.name), remote: tool.name, description: `From ${this.connector.name}: ${String(tool.description || '').slice(0, 800)}`, inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} } }));
    return this.tools;
  }
  async call(remote, args, signal) {
    const result = await this.request('tools/call', { name: remote, arguments: args ?? {} }, signal);
    const text = (result?.content || []).map(item => item?.type === 'text' ? item.text : `[${item?.type || 'content'}]`).join('\n') || JSON.stringify(result?.structuredContent ?? '');
    const images = (Array.isArray(result?.content) ? result.content : []).filter(usableImage).slice(0, MAX_IMAGES).map(({ mimeType, data }) => ({ mimeType, data }));
    return { failed: result?.isError === true, text: text.length > RESULT_LIMIT ? `${text.slice(0, RESULT_LIMIT)}\n… the rest isn’t shown` : text, ...(images.length ? { images } : {}) };
  }
  close() { if (this.child) { try { process.kill(-this.child.pid, 'SIGTERM'); } catch { try { this.child.kill(); } catch {} } this.child = null; } }
}
export class ConnectorStore {
  constructor({ read, write, id = randomUUID }) { Object.assign(this, { read, write, id }); this.items = []; }
  async load() { const saved = await this.read(); this.items = (Array.isArray(saved?.items) ? saved.items : []).filter(item => NAME.test(item?.name || '') && ['command', 'url'].includes(item.kind) && typeof item.target === 'string'); }
  save() { return this.write({ version: 1, items: this.items }); }
  state() { return this.items; }
  async add({ name, kind, target }) {
    const clean = String(name ?? '').trim().toLowerCase();
    if (!NAME.test(clean)) throw new Error('Name a connector with lowercase letters, numbers, dashes and underscores.');
    if (this.items.some(item => item.name === clean)) throw new Error('A connector already has that name.');
    if (!['command', 'url'].includes(kind) || typeof target !== 'string' || !target.trim() || target.length > 2000) throw new Error('A connector needs a command or an address.');
    if (kind === 'url') {
      let url; try { url = new URL(target); } catch { throw new Error('That address isn’t valid.'); }
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
  async remove(id) { this.items = this.items.filter(item => item.id !== id); await this.save(); return this.state(); }
}
