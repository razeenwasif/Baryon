// Private Unix socket protocol for the Fairy CLI (`cli.sock`).
// Mirrors `electron-link.mjs` security hardening: mode 0600 socket, strict RPC method allowlist,
// never exports secrets/keys, and never auto-approves or bypasses interactive approvals.
import { chmodSync, existsSync, unlinkSync } from 'node:fs';
import net from 'node:net';
import { isAbsolute } from 'node:path';

export const MAX_CLI_PROMPT = 24000;
export const MAX_CLI_CONTEXT = 16000;
const LINE_LIMIT = 1 << 20;
const SAFE_CHAT = /^[a-z0-9-]{1,64}$/;
const SAFE_ID = /^[a-zA-Z0-9._-]{1,80}$/;

const clip = (value, limit) => String(value ?? '').slice(0, limit);
const cleanOptional = (value, limit = 120) => (typeof value === 'string' && value.trim() && !/[\r\n\0]/.test(value) ? value.trim().slice(0, limit) : '');

export const CLI_RPC_METHODS = Object.freeze([
  'status',
  'models.list',
  'models.set',
  'usage',
  'sessions.list',
  'sessions.show',
  'sessions.search',
  'sessions.rename',
  'sessions.fork',
  'sessions.compact',
  'recall',
  'memory.list',
  'memory.add',
  'memory.search',
  'journal.list',
  'journal.add',
  'notes.search',
  'notes.read',
  'today',
  'goals.list',
  'goals.add',
  'goals.continue',
  'promises.list',
  'promises.done',
  'auth.status',
  'auth.agyRefresh',
  'plugins.status',
  'plugins.connect',
]);

export const CLI_RPC_METHOD_SET = new Set(CLI_RPC_METHODS);

/** Validates and normalizes a `work` request received over `cli.sock`. */
export function cliWorkRequest(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  const folder = typeof input?.folder === 'string' ? input.folder : '';
  if (!prompt) throw new Error('Provide a prompt for Fairy.');
  if (prompt.length > MAX_CLI_PROMPT) throw new Error(`The prompt is too long (at most ${MAX_CLI_PROMPT} characters).`);
  if (!folder || !isAbsolute(folder)) throw new Error('Provide an absolute project folder path.');
  const context = typeof input?.context === 'string' ? input.context.trim() : '';
  if (context.length > MAX_CLI_CONTEXT) throw new Error(`The context is too long (at most ${MAX_CLI_CONTEXT} characters).`);
  if (input.chat !== undefined && input.chat !== null && input.chat !== '' && !SAFE_CHAT.test(String(input.chat))) {
    throw new Error('That isn’t one of Fairy’s chats.');
  }
  if (input.mode !== undefined && input.mode !== 'edit' && input.mode !== 'read') {
    throw new Error('The mode must be edit or read.');
  }
  const model = cleanOptional(input.model, 100);
  const provider = cleanOptional(input.provider, 40);
  return {
    prompt,
    context,
    folder,
    chat: input.chat ? String(input.chat) : null,
    permission: input.mode === 'read' ? 'plan' : 'auto',
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
  };
}

/** Validates and normalizes a plain chat `ask` request received over `cli.sock`. */
export function cliAskRequest(input) {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (!prompt) throw new Error('Provide a prompt for Fairy.');
  if (prompt.length > MAX_CLI_PROMPT) throw new Error(`The prompt is too long (at most ${MAX_CLI_PROMPT} characters).`);
  const context = typeof input?.context === 'string' ? input.context.trim() : '';
  if (context.length > MAX_CLI_CONTEXT) throw new Error(`The context is too long (at most ${MAX_CLI_CONTEXT} characters).`);
  if (input.chat !== undefined && input.chat !== null && input.chat !== '' && !SAFE_CHAT.test(String(input.chat))) {
    throw new Error('That isn’t one of Fairy’s chats.');
  }
  const model = cleanOptional(input.model, 100);
  const provider = cleanOptional(input.provider, 40);
  return {
    prompt,
    context,
    chat: input.chat ? String(input.chat) : null,
    ...(model ? { model } : {}),
    ...(provider ? { provider } : {}),
  };
}

/** Projects internal work events onto compact NDJSON messages for CLI clients. */
export function forCli(event) {
  switch (event?.type) {
    case 'tool':
      return {
        type: 'step',
        row: {
          id: event.row?.id,
          tool: event.row?.tool,
          summary: clip(event.row?.summary, 300),
          status: event.row?.status,
        },
      };
    case 'tasks':
      return { type: 'tasks', tasks: (Array.isArray(event.tasks) ? event.tasks : []).slice(0, 50) };
    case 'thought':
      return event.thought?.status === 'running' ? { type: 'thinking', text: clip(event.thought?.text, 300) } : null;
    case 'thinking':
      return { type: 'thinking' };
    case 'handoff':
      return { type: 'handoff', handoff: event.handoff || null };
    case 'text':
      return { type: 'text', text: clip(event.text, 40000) };
    case 'approval':
      return {
        type: 'approval',
        approval: event.id,
        title: clip(event.title || 'Fairy needs your OK', 300),
        detail: clip(event.command || event.detail, 600),
      };
    case 'approval-closed':
      return { type: 'approval-closed', approval: event.id };
    case 'done':
      return { type: 'done', text: clip(event.text, 40000), failed: event.failed === true };
    case 'error':
      return { type: 'error', message: clip(event.message || 'Turn failed.', 1000) };
    default:
      return null;
  }
}

/**
 * Starts the `cli.sock` Unix domain socket server.
 * Supports `hello`, `rpc`, `work`, `ask`, and `stop` over NDJSON lines.
 */
export function startCliLink({
  path,
  name = () => 'Fairy',
  provider = () => '',
  model = () => '',
  status = null,
  rpc = async () => { throw new Error('CLI RPC is unavailable.'); },
  startWork = async () => { throw new Error('Work sessions are unavailable.'); },
  stopWork = () => {},
  askChat = async () => { throw new Error('Plain chat is unavailable.'); },
  stopChat = () => {},
  log = () => {},
}) {
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }

  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buffer = '';
    const activeWork = new Map();
    const activeAsks = new Set();
    const stopSoon = new Set();

    const send = message => {
      if (!conn.destroyed && !conn.writableEnded) {
        conn.write(`${JSON.stringify(message)}\n`);
      }
    };

    const handle = async line => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return send({ type: 'error', message: 'That was not JSON.' });
      }
      const id = typeof message?.id === 'string' && SAFE_ID.test(message.id) ? message.id : String(message?.id ?? '').slice(0, 80);

      switch (message?.type) {
        case 'hello': {
          const extra = typeof status === 'function' ? status() : null;
          return send({
            type: 'hello',
            name: name() || 'Fairy',
            provider: provider() || '',
            model: model() || '',
            mode: extra?.mode || 'body',
            ...(extra && typeof extra === 'object' ? extra : {}),
          });
        }

        case 'rpc': {
          const method = typeof message?.method === 'string' ? message.method.trim() : '';
          if (!CLI_RPC_METHOD_SET.has(method)) {
            return send({ type: 'error', id, message: `Unknown CLI method: ${method || '(empty)'}.` });
          }
          const params = message?.params && typeof message.params === 'object' && !Array.isArray(message.params)
            ? message.params
            : {};
          try {
            const data = await rpc(method, params);
            return send({ type: 'result', id, data: data ?? null });
          } catch (error) {
            return send({ type: 'error', id, message: String(error?.message || error || 'CLI RPC failed.') });
          }
        }

        case 'work': {
          try {
            const request = cliWorkRequest(message);
            const { chat } = await startWork(request, event => {
              const out = forCli(event);
              if (out) send({ ...out, id });
              if (event?.type === 'done') activeWork.delete(id);
            });
            activeWork.set(id, chat);
            send({ type: 'started', id, chat });
            if (stopSoon.delete(id)) stopWork(chat);
          } catch (error) {
            stopSoon.delete(id);
            send({ type: 'error', id, message: String(error?.message || error || 'Could not start work session.') });
          }
          return;
        }

        case 'ask': {
          let request;
          try {
            request = cliAskRequest(message);
          } catch (error) {
            return send({ type: 'error', id, message: String(error?.message || error) });
          }
          activeAsks.add(id);
          let sentDone = false;
          try {
            const result = await askChat(request, event => {
              if (!event || typeof event !== 'object') return;
              if (event.type === 'started') send({ type: 'started', id, chat: event.chat || '' });
              else if (event.type === 'text') send({ type: 'text', id, text: clip(event.text, 40000) });
              else if (event.type === 'done') {
                sentDone = true;
                send({ type: 'done', id, text: clip(event.text, 40000), failed: event.failed === true });
              }
            });
            if (!sentDone) {
              if (result?.chat) send({ type: 'started', id, chat: result.chat });
              send({ type: 'done', id, text: clip(result?.text ?? '', 40000), failed: false });
            }
          } catch (error) {
            send({ type: 'error', id, message: String(error?.message || error || 'Fairy could not answer.') });
          } finally {
            activeAsks.delete(id);
            stopSoon.delete(id);
          }
          return;
        }

        case 'stop': {
          const chat = activeWork.get(id);
          if (chat) stopWork(chat);
          else if (activeAsks.has(id)) stopChat(id);
          else if (id) stopSoon.add(id);
          return;
        }

        default:
          return send({ type: 'error', id, message: 'Unknown request.' });
      }
    };

    conn.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > LINE_LIMIT) return conn.destroy();
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) {
          handle(line).catch(error => log(`cli link: ${error?.message || error}`));
        }
      }
    });

    conn.on('close', () => {
      for (const id of activeAsks) stopChat(id);
      activeAsks.clear();
      stopSoon.clear();
    });
    conn.on('error', () => {});
  });

  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  server.on('error', error => { log(`cli link: ${error.message}`); resolveReady(); });
  server.listen(path, () => {
    try { chmodSync(path, 0o600); } catch {}
    resolveReady();
  });

  return {
    ready,
    close() {
      server.close();
      try { unlinkSync(path); } catch {}
    },
  };
}
