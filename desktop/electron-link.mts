// Electron, the user's notes app, asks Fairy to work in its vault: "find notes that should link
// here and add the links". Each request is a work session like one started in Fairy's window, in
// the vault's folder, with her tools, sandbox and approvals. The chat shows in her sidebar, and her
// window, companion and paired iPhone answer its questions. Electron shows the steps as they happen.
//
// A private socket in Fairy's data folder (`electron.sock`). One line of JSON per message, each way:
//   → {type:'hello'}                                    ← {type:'hello', name, provider}
//   → {type:'work', id, folder, prompt, context?, chat?, mode}   ← {type:'started', id, chat}, then any of
//        {type:'step', id, row}  {type:'tasks', id, tasks}  {type:'text', id, text}
//        {type:'approval', id, approval, title, detail}  {type:'approval-closed', id, approval}
//      and last {type:'done', id, text, failed}, or {type:'error', id, message} if it couldn't start.
//   → {type:'stop', id}                                 (the work stops and ends with 'done')
// `context` is what Electron tells the work about the vault (its conventions, the open note); it
// goes in front of the prompt for the model but isn't saved in the chat, which keeps your words.
// `mode` is 'edit' (Run on its own: changes in the vault go ahead, anything past the sandbox asks)
// or 'read' (plan mode: nothing changes until the plan is agreed in Fairy).
//
// Electron can't answer approvals. They stay Fairy's to show and answer, so no program on this Mac
// can wave a step through by talking to the socket.
import net from 'node:net';
import { isAbsolute } from 'node:path';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';

export const MAX_PROMPT = 12000;
export const MAX_CONTEXT = 16000;
const LINE_LIMIT = 1 << 20;
const SAFE_CHAT = /^[a-z0-9-]{1,64}$/;

export interface WorkRequestInput {
  prompt?: unknown;
  folder?: unknown;
  context?: unknown;
  chat?: unknown;
  mode?: unknown;
}

export interface WorkRequest {
  prompt: string;
  context: string;
  folder: string;
  chat: string | null;
  permission: 'plan' | 'auto';
}

export interface WorkEventInput {
  type?: string;
  row?: {
    id?: unknown;
    tool?: unknown;
    summary?: unknown;
    status?: unknown;
  };
  tasks?: unknown[];
  thought?: {
    status?: string;
  };
  text?: unknown;
  id?: unknown;
  title?: unknown;
  command?: unknown;
  detail?: unknown;
  failed?: unknown;
}

export type ElectronEvent =
  | { type: 'step'; row: { id: unknown; tool: unknown; summary: string; status: unknown } }
  | { type: 'tasks'; tasks: unknown[] }
  | { type: 'thinking' }
  | { type: 'text'; text: string }
  | { type: 'approval'; approval: unknown; title: string; detail: string }
  | { type: 'approval-closed'; approval: unknown }
  | { type: 'done'; text: string; failed: boolean };

export interface StartElectronLinkOptions {
  path: string;
  start: (
    request: WorkRequest,
    emit: (event: WorkEventInput | null | undefined) => void,
  ) => Promise<{ chat: string }> | { chat: string };
  stop: (chat: string) => void;
  name?: () => string;
  provider?: () => string;
  status?: (() => Record<string, unknown> | null | undefined) | null;
  log?: (message: string) => void;
}

const failure = (message: string): Error => new Error(message);
const clip = (value: unknown, limit: number): string => String(value ?? '').slice(0, limit);

/** Checks and tidies a work request from Electron. Throws for anything it can't use. */
export function workRequest(input: WorkRequestInput | null | undefined): WorkRequest {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  const folder = typeof input?.folder === 'string' ? input.folder : '';
  if (!prompt) throw failure('Electron sends what to do.');
  if (prompt.length > MAX_PROMPT) throw failure(`The request is too long (at most ${MAX_PROMPT} characters).`);
  if (!folder || !isAbsolute(folder)) throw failure('Electron sends its vault’s folder.');
  const context = typeof input?.context === 'string' ? input.context.trim() : '';
  if (context.length > MAX_CONTEXT) throw failure(`The context is too long (at most ${MAX_CONTEXT} characters).`);
  if (input?.chat !== undefined && input.chat !== null && !SAFE_CHAT.test(String(input.chat))) throw failure('That isn’t one of Fairy’s chats.');
  if (input?.mode !== undefined && input.mode !== 'edit' && input.mode !== 'read') throw failure('The mode is edit or read.');
  return { prompt, context, folder, chat: (input?.chat as string | undefined) || null, permission: input?.mode === 'read' ? 'plan' : 'auto' };
}

/** A work event as Electron reads it, or null for ones it doesn't show. */
export function forElectron(event: WorkEventInput | null | undefined): ElectronEvent | null {
  switch (event?.type) {
    case 'tool': return { type: 'step', row: { id: event.row?.id, tool: event.row?.tool, summary: clip(event.row?.summary, 300), status: event.row?.status } };
    case 'tasks': return { type: 'tasks', tasks: (Array.isArray(event.tasks) ? event.tasks : []).slice(0, 50) };
    case 'thought': return event.thought?.status === 'running' ? { type: 'thinking' } : null;
    case 'thinking': return { type: 'thinking' };
    case 'text': return { type: 'text', text: clip(event.text, 20000) };
    case 'approval': return { type: 'approval', approval: event.id, title: clip(event.title || 'Fairy needs your OK', 300), detail: clip(event.command || event.detail, 600) };
    case 'approval-closed': return { type: 'approval-closed', approval: event.id };
    case 'done': return { type: 'done', text: clip(event.text, 20000), failed: event.failed === true };
    default: return null;
  }
}

/** Listen at `path` for Electron. `start(request, emit)` begins a work turn and resolves to
 * {chat}; it calls `emit` with work events until one of type 'done'. `stop(chat)` stops one.
 * Returns {close}. */
export function startElectronLink({ path, start, stop, name = () => 'Fairy', provider = () => '', status = null, log = () => {} }: StartElectronLinkOptions): { close: () => void } {
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }
  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buffer = '';
    // Each request's chat once it has started, and those asked to stop before then.
    const chats = new Map<string, string>(), stopSoon = new Set<string>();
    const send = (message: Record<string, unknown>): void => { if (!conn.destroyed) conn.write(`${JSON.stringify(message)}\n`); };
    const handle = async (line: string): Promise<void> => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(line) as Record<string, unknown>; } catch { return send({ type: 'error', message: 'That was not JSON.' }); }
      const id = typeof message?.id === 'string' ? message.id.slice(0, 80) : '';
      switch (message?.type) {
        case 'hello': {
          const extra = typeof status === 'function' ? status() : null;
          return send({ type: 'hello', name: name() || 'Fairy', provider: provider() || '', ...(extra && typeof extra === 'object' ? extra : {}) });
        }
        case 'work': {
          try {
            const request = workRequest(message as WorkRequestInput);
            const { chat } = await start(request, event => {
              const out = forElectron(event);
              if (out) send({ ...out, id });
              if (event?.type === 'done') chats.delete(id);
            });
            chats.set(id, chat);
            send({ type: 'started', id, chat });
            if (stopSoon.delete(id)) stop(chat);
          } catch (error: unknown) {
            stopSoon.delete(id);
            send({ type: 'error', id, message: error instanceof Error ? error.message : String(error) });
          }
          return;
        }
        case 'stop': {
          const chat = chats.get(id);
          if (chat) stop(chat);
          else if (id) stopSoon.add(id);
          return;
        }
        default: return send({ type: 'error', id, message: 'Unknown request.' });
      }
    };
    conn.on('data', chunk => {
      buffer += String(chunk);
      if (buffer.length > LINE_LIMIT) return void conn.destroy();
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) handle(line).catch((error: unknown) => log(`electron link: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    // The work carries on in Fairy when Electron goes; it's in her sidebar.
    conn.on('error', () => {});
  });
  server.on('error', (error: Error) => log(`electron link: ${error.message}`));
  // Only this user: the data folder is private, and the socket is too.
  server.listen(path, () => { try { chmodSync(path, 0o600); } catch {} });
  return {
    close(): void {
      server.close();
      try { unlinkSync(path); } catch {}
    },
  };
}
