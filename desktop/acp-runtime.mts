const SAFE_ACP_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SHELL_META = /[;&|`$<>()\r\n\0]/;

export type AcpFrameFormat = 'content-length' | 'ndjson';

export interface AcpAgentConfig {
  command?: string;
  args?: readonly unknown[];
  description?: string;
}

export interface AcpAgentEntry {
  id: string;
  command: string;
  args: string[];
  description: string;
}

export interface AcpError {
  code?: number;
  message?: string;
  data?: unknown;
}

export interface AcpMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: AcpError;
  [key: string]: unknown;
}

export interface EncodeAcpFrameOptions {
  format?: AcpFrameFormat;
}

export interface CreateAcpFrameDecoderOptions {
  maxFrameBytes?: number;
  onMessage?: (message: AcpMessage) => void;
}

export interface AcpFrameDecoder {
  push(chunk: string | Buffer): void;
  reset(): void;
}

export interface CreateAcpClientOptions {
  write?: (frame: string) => void;
  format?: AcpFrameFormat;
  requestTimeoutMs?: number;
  maxFrameBytes?: number;
}

export interface AcpRequestOptions {
  signal?: AbortSignal | null;
}

export interface AcpClient {
  request(method: string, params?: unknown, options?: AcpRequestOptions): Promise<unknown>;
  notify(method: string, params?: unknown): void;
  receive(chunk: string | Buffer): void;
  pendingCount(): number;
  close(): void;
}

interface InflightRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  cleanup: (() => void) | null;
}

export class AcpRegistry {
  #agents = new Map<string, AcpAgentEntry>();

  register(id: unknown, { command, args = [], description = '' }: AcpAgentConfig = {}): AcpAgentEntry {
    const cleanId = String(id ?? '').trim();
    if (!SAFE_ACP_ID.test(cleanId)) throw new Error('Invalid ACP agent identifier.');
    const cmd = String(command ?? '').trim();
    if (!cmd || SHELL_META.test(cmd)) throw new Error('Unsafe ACP executable path.');
    const cleanArgs = (Array.isArray(args) ? args : []).map(a => {
      const s = String(a ?? '');
      if (/\0/.test(s)) throw new Error('Invalid ACP argument.');
      return s;
    });
    const entry: AcpAgentEntry = { id: cleanId, command: cmd, args: cleanArgs, description: String(description || '').slice(0, 300) };
    this.#agents.set(cleanId, entry);
    return { ...entry, args: [...entry.args] };
  }

  get(id: unknown): AcpAgentEntry | null {
    const e = this.#agents.get(String(id ?? ''));
    return e ? { ...e, args: [...e.args] } : null;
  }

  list(): AcpAgentEntry[] {
    return [...this.#agents.values()].map(e => ({ ...e, args: [...e.args] }));
  }

  remove(id: unknown): boolean {
    return this.#agents.delete(String(id ?? ''));
  }
}

export function encodeAcpFrame(message: unknown, { format = 'content-length' }: EncodeAcpFrameOptions = {}): string {
  const json = JSON.stringify(message);
  if (format === 'ndjson') return `${json}\n`;
  const len = Buffer.byteLength(json, 'utf8');
  return `Content-Length: ${len}\r\n\r\n${json}`;
}

export function createAcpFrameDecoder({ maxFrameBytes = 4 * 1024 * 1024, onMessage = () => {} }: CreateAcpFrameDecoderOptions = {}): AcpFrameDecoder {
  let buffer: Buffer = Buffer.alloc(0);

  return {
    push(chunk: string | Buffer) {
      const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk ?? ''), 'utf8');
      buffer = Buffer.concat([buffer, incoming]);
      if (buffer.length > maxFrameBytes * 2) {
        buffer = Buffer.alloc(0);
        throw new Error('ACP frame buffer exceeded limit.');
      }

      while (buffer.length > 0) {
        const asText = buffer.toString('utf8');
        if (/^Content-Length:/i.test(asText)) {
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd < 0) break;
          const headers = buffer.subarray(0, headerEnd).toString('utf8');
          const m = /Content-Length:\s*(\d+)/i.exec(headers);
          if (!m) {
            buffer = buffer.subarray(headerEnd + 4);
            continue;
          }
          const len = Number(m[1]);
          if (!Number.isSafeInteger(len) || len < 0 || len > maxFrameBytes) {
            buffer = Buffer.alloc(0);
            throw new Error(`Invalid ACP Content-Length: ${len}`);
          }
          const bodyStart = headerEnd + 4;
          if (buffer.length < bodyStart + len) break;
          const payload = buffer.subarray(bodyStart, bodyStart + len).toString('utf8');
          buffer = buffer.subarray(bodyStart + len);
          try {
            const parsed: unknown = JSON.parse(payload);
            if (parsed && typeof parsed === 'object') onMessage(parsed as AcpMessage);
          } catch {}
        } else {
          const nl = buffer.indexOf('\n');
          if (nl < 0) break;
          if (nl > maxFrameBytes) {
            buffer = Buffer.alloc(0);
            throw new Error('ACP NDJSON frame exceeded limit.');
          }
          const line = buffer.subarray(0, nl).toString('utf8').trim();
          buffer = buffer.subarray(nl + 1);
          if (!line) continue;
          try {
            const parsed: unknown = JSON.parse(line);
            if (parsed && typeof parsed === 'object') onMessage(parsed as AcpMessage);
          } catch {}
        }
      }
    },
    reset() {
      buffer = Buffer.alloc(0);
    },
  };
}

/**
 * Hardened JSON-RPC 2.0 ACP client with bounded frame decoding and cancellation propagation.
 */
export function createAcpClient({ write, format = 'content-length', requestTimeoutMs = 30_000, maxFrameBytes = 4 * 1024 * 1024 }: CreateAcpClientOptions = {}): AcpClient {
  let nextId = 1;
  let closed = false;
  const inflight = new Map<string | number, InflightRequest>();

  const decoder = createAcpFrameDecoder({
    maxFrameBytes,
    onMessage(msg) {
      if ((typeof msg.id === 'number' || typeof msg.id === 'string') && inflight.has(msg.id)) {
        const pending = inflight.get(msg.id)!;
        inflight.delete(msg.id);
        clearTimeout(pending.timer);
        pending.cleanup?.();
        if (msg.error) pending.reject(new Error(String(msg.error?.message || 'ACP request error')));
        else pending.resolve(msg.result ?? null);
      }
    },
  });

  function notify(method: string, params: unknown = {}): void {
    if (closed || typeof write !== 'function') return;
    write(encodeAcpFrame({ jsonrpc: '2.0', method: String(method), params }, { format }));
  }

  function request(method: string, params: unknown = {}, { signal = null }: AcpRequestOptions = {}): Promise<unknown> {
    if (closed) return Promise.reject(new Error('ACP client is closed.'));
    if (typeof write !== 'function') return Promise.reject(new Error('ACP transport unavailable.'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const cleanupAbort = signal
        ? () => signal.removeEventListener('abort', onAbort)
        : null;
      const onAbort = (): void => {
        if (!inflight.has(id)) return;
        inflight.delete(id);
        clearTimeout(timer);
        notify('$/cancelRequest', { id });
        reject(new Error('ACP request aborted'));
      };
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        if (!inflight.has(id)) return;
        inflight.delete(id);
        cleanupAbort?.();
        notify('$/cancelRequest', { id });
        reject(new Error(`ACP request timed out: ${method}`));
      }, requestTimeoutMs);
      timer.unref?.();

      if (signal?.aborted) {
        clearTimeout(timer);
        reject(new Error('ACP request aborted'));
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      inflight.set(id, { resolve, reject, timer, cleanup: cleanupAbort });
      write(encodeAcpFrame({ jsonrpc: '2.0', id, method: String(method), params }, { format }));
    });
  }

  function close(): void {
    closed = true;
    for (const [, p] of inflight.entries()) {
      clearTimeout(p.timer);
      p.cleanup?.();
      p.reject(new Error('ACP client closed'));
    }
    inflight.clear();
    decoder.reset();
  }

  return {
    request,
    notify,
    receive: chunk => decoder.push(chunk),
    pendingCount: () => inflight.size,
    close,
  };
}
