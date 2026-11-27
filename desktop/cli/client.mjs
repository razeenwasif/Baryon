// Unified Fairy CLI transport client:
// 1. Connects to `cli.sock` (live Fairy Body or MacBook Face proxy).
// 2. Falls back to legacy `electron.sock` when only an older daemon socket is open.
// 3. Automatically runs in Standalone Headless mode if neither socket is open (unless `--attached`).
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { resolve } from 'node:path';
import { createHeadlessBackend } from './headless.mjs';
import { defaultCliSocketPath, defaultDataDir, defaultSocketPath } from './paths.mjs';

function friendlySocketError(error, socketPath) {
  if (error && ['ENOENT', 'ECONNREFUSED', 'EACCES'].includes(error.code)) {
    return new Error(`Fairy isn’t running or its local socket isn’t open at ${socketPath}.`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

export function pingSocket(socketPath, timeoutMs = 5000) {
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

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value);
    };

    conn.setEncoding('utf8');
    conn.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.type === 'hello') return finish(null, msg);
        if (msg.type === 'error') return finish(new Error(msg.message || 'Fairy returned an error.'));
      }
    });
    conn.on('error', err => finish(friendlySocketError(err, socketPath)));
    conn.on('close', () => finish(new Error(`Socket closed before Fairy answered at ${socketPath}.`)));
  });
}

export function socketRpc(socketPath, method, params = {}, timeoutMs = 30000) {
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

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      conn.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value);
    };

    conn.setEncoding('utf8');
    conn.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
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
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let buffer = '';
    let settled = false;
    let chatId = payload.chat || '';
    let finalText = '';
    let abortTimer = null;
    const events = [];

    const conn = net.createConnection(socketPath, () => {
      conn.write(`${JSON.stringify({ type, id, ...payload })}\n`);
    });

    const cleanup = () => {
      clearTimeout(abortTimer);
      signal?.removeEventListener?.('abort', onAbort);
    };
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      conn.destroy();
      if (err) rejectPromise(err);
      else resolvePromise(value);
    };

    const onAbort = () => {
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
    conn.on('data', chunk => {
      buffer += chunk;
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (!line.trim()) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
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

function createSocketBackend({ socketPath, kind = 'cli', helloData }) {
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
    runWork({ folder = process.cwd(), prompt, context = '', chat = null, mode = 'edit', model = '', provider = '', signal = null } = {}, onEvent = () => {}) {
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
    askChat({ prompt, context = '', chat = null, model = '', provider = '', signal = null } = {}, onEvent = () => {}) {
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
} = {}) {
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
