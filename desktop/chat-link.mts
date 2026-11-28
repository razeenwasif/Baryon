// A private socket another of your apps asks Fairy through: Tachyon (tachyon-link.mjs) and Flux
// (flux-link.mjs). One line of JSON per message, each way:
//   → {type:'hello'}                ← {type:'hello', name}
//   → {type:'ask', text, context, speak?}  ← {type:'text', text} as she writes (the reply so far),
//                                      then {type:'done', text} or {type:'error', message}
//   → {type:'stop'}                 stops the answer being written, or being said
//                                   ← {type:'spoken'} after `done`, once an answer done() says has been said
//   → {type:'new'}                  ← {type:'ok'}: the next question starts a new conversation
// The socket is in Fairy's data folder and only this user can open it. It carries conversation
// only: no tools, files or desktop control.
import net from 'node:net';
import { chmodSync, existsSync, unlinkSync } from 'node:fs';

const LINE_LIMIT = 1 << 20;

export interface ChatLinkMessage {
  type?: string;
  text?: string;
  context?: Record<string, unknown>;
  speak?: boolean;
  model?: string;
  effort?: string;
  [key: string]: unknown;
}

export interface ChatLinkChat {
  stop: () => void;
  send: (
    prompt: unknown,
    options?: {
      onText?: (value: string) => void;
      record?: unknown;
      run?: unknown;
      settingsOverride?: { model?: string; effort?: string };
    },
  ) => Promise<{ text: string }>;
}

export interface StartChatLinkOptions {
  path: string;
  chat: ChatLinkChat;
  reset: () => Promise<unknown> | unknown;
  prompt: (text: string | undefined, context: Record<string, unknown>) => unknown;
  record: (text: string | undefined, context: Record<string, unknown>) => unknown;
  done?: (text: string, message: ChatLinkMessage) => unknown;
  runner?: (message: ChatLinkMessage) => unknown;
  onStop?: () => unknown;
  name?: () => string;
  label?: string;
  log?: (message: string) => void;
}

/** Listen at `path`. `chat` is a CompanionChat for its questions, `reset` starts it on a new
 * conversation, `prompt(text, context)` builds what Fairy is asked, `record(text, context)` what
 * the chat keeps of it, `name` is what Fairy is called, `done(text, message)` runs with each
 * finished answer, `runner(message)` may give an ask its own way of answering (CompanionChat's
 * `run`), `onStop()` runs on a stop as well (to stop her saying an answer), and `label` names the app in
 * the log. Returns {close}. */
export function startChatLink({
  path,
  chat,
  reset,
  prompt,
  record,
  done = () => {},
  runner = () => null,
  onStop = () => {},
  name = () => 'Fairy',
  label = 'link',
  log = () => {},
}: StartChatLinkOptions): { close: () => void } {
  if (existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }
  const server = net.createServer(conn => {
    conn.setEncoding('utf8');
    let buffer = '';
    const send = (message: Record<string, unknown>): void => { if (!conn.destroyed) conn.write(`${JSON.stringify(message)}\n`); };
    const handle = async (line: string): Promise<void> => {
      let message: ChatLinkMessage;
      try { message = JSON.parse(line) as ChatLinkMessage; } catch { return send({ type: 'error', message: 'That was not JSON.' }); }
      switch (message?.type) {
        case 'hello': return send({ type: 'hello', name: name() || 'Fairy' });
        case 'stop': chat.stop(); onStop(); return;
        case 'new': await reset(); return send({ type: 'ok' });
        case 'ask': {
          try {
            const context = message.context ?? {};
            const settingsOverride = message.model || message.effort ? { model: message.model, effort: message.effort } : undefined;
            const { text } = await chat.send(prompt(message.text, context), { onText: value => send({ type: 'text', text: value }), record: record(message.text, context), run: runner(message) ?? undefined, settingsOverride });
            send({ type: 'done', text });
            // done() may say it aloud; when it returns a promise, tell the app once that's finished.
            const said = done(text, message);
            if (said && typeof (said as PromiseLike<unknown>).then === 'function') {
              const ok = await Promise.resolve(said as PromiseLike<unknown>).catch(() => false);
              send({ type: 'spoken', spoken: ok !== false });
            }
          } catch (error: unknown) {
            const err = error as { name?: string; message?: string };
            send({ type: 'error', message: err?.name === 'AbortError' ? 'Stopped.' : err?.message || String(error) });
          }
          return;
        }
        default: return send({ type: 'error', message: 'Unknown request.' });
      }
    };
    conn.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > LINE_LIMIT) { conn.destroy(); return; }
      let at: number;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        if (line.trim()) handle(line).catch((error: unknown) => log(`${label} link: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
    conn.on('error', () => {});
  });
  server.on('error', (error: unknown) => log(`${label} link: ${error instanceof Error ? error.message : String(error)}`));
  // Only this user: the data folder is private, and the socket is too.
  server.listen(path, () => { try { chmodSync(path, 0o600); } catch {} });
  return {
    close() {
      server.close();
      try { unlinkSync(path); } catch {}
    },
  };
}
