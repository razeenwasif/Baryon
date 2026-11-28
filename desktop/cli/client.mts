// Unified Fairy CLI transport client:
// 1. Connects to `cli.sock` (live Fairy Body or MacBook Face proxy).
// 2. Falls back to legacy `electron.sock` when only an older daemon socket is open.
// 3. Automatically runs in Standalone Headless mode if neither socket is open (unless `--attached`).
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { resolve } from 'node:path';
import { createHeadlessBackend, type HeadlessBackend, type HeadlessBackendOptions } from './headless.mjs';
import { defaultCliSocketPath, defaultDataDir, defaultSocketPath, type EnvMap } from './paths.mjs';
import type {
  ReplBackend,
  ReplHelloInfo,
  ReplTurnEvent,
  ReplTurnResult,
} from './repl.mjs';

export interface SocketHelloData extends ReplHelloInfo {
  type?: string;
  remote?: boolean;
  dataDir?: string;
  message?: string;
}

export type SocketTurnEvent = ReplTurnEvent & {
  message?: string;
  failed?: boolean;
};

export type SocketTurnResult = ReplTurnResult & {
  chat: string;
  text: string;
  failed: boolean;
  events: SocketTurnEvent[];
};

export interface SocketStreamTurnOptions {
  socketPath: string;
  type?: string;
  payload?: Record<string, unknown>;
  id?: string;
  signal?: AbortSignal | null;
  onEvent?: (event: SocketTurnEvent) => void;
}

export interface CliRunWorkRequest {
  folder?: string;
  prompt?: string;
  context?: string;
  chat?: string | null;
  mode?: 'edit' | 'read' | string;
  model?: string;
  provider?: string;
  signal?: AbortSignal | null;
}

export interface CliAskChatRequest {
  prompt?: string;
  context?: string;
  chat?: string | null;
  model?: string;
  provider?: string;
  signal?: AbortSignal | null;
}

export interface CliBackend extends Omit<ReplBackend, 'runWork' | 'askChat'> {
  mode: string;
  socketPath?: string;
  socketKind?: string;
  dataDir: string;
  runWork(req?: CliRunWorkRequest, onEvent?: (ev: SocketTurnEvent) => void): Promise<ReplTurnResult>;
  askChat(req?: CliAskChatRequest, onEvent?: (ev: SocketTurnEvent) => void): Promise<ReplTurnResult>;
  stop?: (id?: string) => void;
  close(): Promise<void>;
}

export interface ResolveCliBackendOptions {
  socket?: string;
  dataDir?: string;
  env?: EnvMap;
  stdin?: HeadlessBackendOptions['stdin'];
  stderr?: HeadlessBackendOptions['stderr'];
  headless?: boolean;
  attached?: boolean;
  provider?: string;
  model?: string;
  autoApprove?: boolean;
  providers?: HeadlessBackendOptions['providers'];
  promptApproval?: HeadlessBackendOptions['promptApproval'];
}

function friendlySocketError(error: unknown, socketPath: string): Error {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (typeof code === 'string' && ['ENOENT', 'ECONNREFUSED', 'EACCES'].includes(code)) {
    return new Error(`Fairy isn’t running or its local socket isn’t open at ${socketPath}.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function pingSocket(socketPath: string, timeoutMs = 5000): Promise<SocketHelloData> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let settled = false;
    const conn = net.createConnection(socketPath, () => {
      conn.write('{"type":"hello"}\n');
    });
    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for Fairy at ${socketPath}.`));
    }, timeoutMs);
    timer.unref?.();

    const finish = (err: Error | null, value?: SocketHelloData): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value as SocketHelloData);
    };

    conn.setEncoding('utf8');
    conn.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let msg: SocketHelloData;
        try { msg = JSON.parse(line) as SocketHelloData; } catch { continue; }
        if (msg.type === 'hello') return finish(null, msg);
        if (msg.type === 'error') return finish(new Error(msg.message || 'Fairy returned an error.'));
      }
    });
    conn.on('error', err => finish(friendlySocketError(err, socketPath)));
    conn.on('close', () => finish(new Error(`Socket closed before Fairy answered at ${socketPath}.`)));
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function socketRpc<T = any>(
  socketPath: string,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 30000,
): Promise<T> {
  const id = randomUUID();
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let settled = false;
    const conn = net.createConnection(socketPath, () => {
      conn.write(`${JSON.stringify({ type: 'rpc', id, method, params })}\n`);
    });
    const timer = setTimeout(() => {
      finish(new Error(`Timed out waiting for "${method}" on ${socketPath}.`));
    }, timeoutMs);
    timer.unref?.();

    const finish = (err: Error | null, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value as T);
    };

    conn.setEncoding('utf8');
    conn.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let msg: { id?: string; type?: string; data?: T; message?: string };
        try { msg = JSON.parse(line) as { id?: string; type?: string; data?: T; message?: string }; } catch { continue; }
        if (msg.id && msg.id !== id) continue;
        if (msg.type === 'result') return finish(null, msg.data);
        if (msg.type === 'error') return finish(new Error(msg.message || `CLI RPC "${method}" failed.`));
      }
    });
    conn.on('error', err => finish(friendlySocketError(err, socketPath)));
    conn.on('close', () => finish(new Error(`Connection closed before "${method}" finished.`)));
  });
}

export function socketStreamTurn({
  socketPath,
  type = 'work',
  payload = {},
  id = randomUUID(),
  signal = null,
  onEvent = () => {},
}: SocketStreamTurnOptions): Promise<SocketTurnResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let settled = false;
    let chatId = typeof payload.chat === 'string' ? payload.chat : '';
    let finalText = '';
    let abortTimer: ReturnType<typeof setTimeout> | null = null;
    const events: SocketTurnEvent[] = [];

    const conn = net.createConnection(socketPath, () => {
      conn.write(`${JSON.stringify({ type, id, ...payload })}\n`);
    });

    const cleanup = (): void => {
      if (abortTimer !== null) clearTimeout(abortTimer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const finish = (err: Error | null, value?: SocketTurnResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      conn.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value as SocketTurnResult);
    };

    const onAbort = (): void => {
      if (settled) return;
      if (!conn.destroyed) {
        try { conn.write(`${JSON.stringify({ type: 'stop', id })}\n`); } catch {}
      }
      abortTimer = setTimeout(() => {
        finish(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
      }, 2000);
      abortTimer.unref?.();
    };

    if (signal?.aborted) {
      conn.destroy();
      return rejectPromise(Object.assign(new Error('Stopped.'), { name: 'AbortError' }));
    }
    signal?.addEventListener?.('abort', onAbort, { once: true });

    conn.setEncoding('utf8');
    conn.on('data', (chunk: Buffer | string) => {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let msg: SocketTurnEvent;
        try { msg = JSON.parse(line) as SocketTurnEvent; } catch { continue; }
        if (msg.id && msg.id !== id) continue;
        events.push(msg);
        try { onEvent(msg); } catch {}
        if (msg.type === 'started' && msg.chat) chatId = msg.chat;
        else if (msg.type === 'text' && typeof msg.text === 'string') finalText = msg.text;
        else if (msg.type === 'error') return finish(new Error(msg.message || 'Fairy could not complete that turn.'));
        else if (msg.type === 'done') {
          if (typeof msg.text === 'string') finalText = msg.text;
          return finish(null, { chat: chatId, text: finalText, failed: msg.failed === true, events });
        }
      }
    });
    conn.on('error', err => finish(friendlySocketError(err, socketPath)));
    conn.on('close', () => finish(new Error('Connection to Fairy closed before finishing.')));
  });
}

function createSocketBackend({
  socketPath,
  kind = 'cli',
  helloData,
}: {
  socketPath: string;
  kind?: string;
  helloData: SocketHelloData;
}): CliBackend {
  return {
    mode: helloData?.mode || (helloData?.remote ? 'face' : 'body'),
    socketPath,
    socketKind: kind,
    dataDir: helloData?.dataDir || '',
    async hello() {
      return helloData;
    },
    async rpc(method, params = {}) {
      if (kind !== 'cli') {
        if (method === 'status') return { ...helloData, socket: socketPath, mode: 'legacy' };
        throw new Error('This command requires cli.sock (restart Fairy) or --headless mode.');
      }
      return socketRpc(socketPath, method, params, method.includes('models') || method.includes('usage') ? 60000 : 30000);
    },
    runWork({ folder = process.cwd(), prompt, context = '', chat = null, mode = 'edit', model = '', provider = '', signal = null }: CliRunWorkRequest = {}, onEvent: (ev: SocketTurnEvent) => void = () => {}) {
      const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
      if (!cleanPrompt) return Promise.reject(new Error('Provide a prompt for Fairy.'));
      if (mode !== 'edit' && mode !== 'read') return Promise.reject(new Error('Mode must be "edit" or "read".'));
      return socketStreamTurn({
        socketPath,
        type: 'work',
        payload: {
          folder: resolve(String(folder || process.cwd())),
          prompt: cleanPrompt,
          ...(context ? { context } : {}),
          ...(chat ? { chat } : {}),
          mode,
          ...(kind === 'cli' && model ? { model } : {}),
          ...(kind === 'cli' && provider ? { provider } : {}),
        },
        signal,
        onEvent,
      });
    },
    askChat({ prompt, context = '', chat = null, model = '', provider = '', signal = null }: CliAskChatRequest = {}, onEvent: (ev: SocketTurnEvent) => void = () => {}) {
      if (kind !== 'cli') {
        return Promise.reject(new Error('Plain chat requires cli.sock (restart Fairy) or --headless mode.'));
      }
      const cleanPrompt = typeof prompt === 'string' ? prompt.trim() : '';
      if (!cleanPrompt) return Promise.reject(new Error('Provide a prompt for Fairy.'));
      return socketStreamTurn({
        socketPath,
        type: 'ask',
        payload: {
          prompt: cleanPrompt,
          ...(context ? { context } : {}),
          ...(chat ? { chat } : {}),
          ...(model ? { model } : {}),
          ...(provider ? { provider } : {}),
        },
        signal,
        onEvent,
      });
    },
    async close() {},
  };
}

/**
 * Resolves the active backend for a CLI invocation:
 * - explicit `--headless`: standalone headless backend
 * - explicit `--socket PATH`: probe that socket (`cli.sock` or `electron.sock`)
 * - default: probe `cli.sock`, then `electron.sock`, else fall back to headless (unless `attached: true`).
 */
export async function resolveCliBackend({
  socket = '',
  dataDir = '',
  env = process.env,
  stdin = process.stdin,
  stderr = process.stderr,
  headless = false,
  attached = false,
  provider = '',
  model = '',
  autoApprove = false,
  providers = null,
  promptApproval = null,
}: ResolveCliBackendOptions = {}): Promise<CliBackend | HeadlessBackend> {
  const resolvedDataDir = dataDir || defaultDataDir(env);
  if (headless) {
    return createHeadlessBackend({
      dataDir: resolvedDataDir,
      env,
      stdin,
      stderr,
      providerOverride: provider,
      modelOverride: model,
      autoApprove,
      providers,
      promptApproval,
    });
  }

  const cliPath = socket || defaultCliSocketPath(env);
  try {
    const helloData = await pingSocket(cliPath, 1500);
    return createSocketBackend({ socketPath: cliPath, kind: 'cli', helloData });
  } catch (err) {
    if (socket) {
      // Explicit --socket could still be an older `electron.sock`.
      if (/electron\.sock$/.test(socket)) {
        const helloData = await pingSocket(socket, 2000);
        return createSocketBackend({ socketPath: socket, kind: 'electron', helloData });
      }
      if (attached) throw err;
    }
  }

  const legacyPath = defaultSocketPath(env);
  if (!socket && legacyPath !== cliPath) {
    try {
      const helloData = await pingSocket(legacyPath, 1500);
      return createSocketBackend({ socketPath: legacyPath, kind: 'electron', helloData });
    } catch {}
  }

  if (attached) {
    throw new Error(`Fairy isn’t running or its local socket isn’t open at ${cliPath}.`);
  }

  return createHeadlessBackend({
    dataDir: resolvedDataDir,
    env,
    stdin,
    stderr,
    providerOverride: provider,
    modelOverride: model,
    autoApprove,
    providers,
    promptApproval,
  });
}
