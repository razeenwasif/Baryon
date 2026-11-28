// After Away (the plan “Fairy away from the mini”): the full Fairy's side of the user's other apps on a face's Mac.
// The face opens their sockets there (face-sockets.mjs) and sends each question here, where it goes into the same chat
// a question from that app on this Mac would (Tachyon's is the chat called Terminal). The face sends only the app's
// words and context; the prompt is built here, by the app link's own rules, so a face can't ask for more than the app can.
//
//   POST /v1/face/app/ask {app, text, context, tools?, speak?}
//                                               → newline-delimited JSON: {type:'text', text} as she writes (the reply
//                                                   so far), then {type:'done', text} or {type:'error', message}.
//                                                   Closing the request stops the answer.
//        tools: the app's own tools on the face's Mac (Flux's browser): each step she takes is sent as
//                                                   {type:'tool', call, tool, args}, and the face answers it with
//                                                   POST /v1/face/app/tool {call, result} or {call, error}.
//        speak: after 'done', her voice for the answer as {type:'voice', bytes (base64), pauseBeforeMs} clips, then
//                                                   {type:'spoken'}. Closing it stops her voice too.
//   POST /v1/face/app/new {app}                 → {ok:true}: that app's next question starts a new conversation.
//   POST /v1/face/app/work {app, folder, prompt, context, chat, mode}
//                                               → newline-delimited JSON: {type:'started', chat}, then Electron's own
//                                                   events (electron-link.mjs) until {type:'done'}, or {type:'error'}.
//                                                   Closing it doesn't stop the work: it's in the sidebar here.
//   POST /v1/face/app/stop {app, chat}          → {ok:true}: stops that app's work in that chat.
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY = 64 * 1024, MAX_TEXT = 12000, MAX_RESULT = 4 * 1024 * 1024, TOOL_WAIT_MS = 10 * 60 * 1000;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

type HttpError = Error & { status: number };
const failure = (status: number, message: string): HttpError => Object.assign(new Error(message), { status });

export type CleanContext = Record<string, string | number>;

export interface FaceToolBridge {
  call: (tool: string, args: unknown, signal?: AbortSignal) => Promise<unknown>;
}

export interface VoiceClip {
  bytes?: Uint8Array | Buffer;
  pauseBeforeMs?: number;
}

export interface FaceAppEntry {
  ask: (options: {
    text: string;
    context: CleanContext;
    tools?: FaceToolBridge;
    onText: (value: unknown) => void;
  }) => Promise<{ text?: unknown } | null | undefined>;
  stop: (chat?: string) => void | Promise<void>;
  reset: () => void | Promise<void>;
  rpc?: (method: string, args: Record<string, unknown>) => unknown | Promise<unknown>;
  say?: (text: string, options: { signal: AbortSignal; part: (clip: VoiceClip | null | undefined) => void }) => Promise<unknown>;
  work?: (request: Record<string, unknown>, emit: (event: Record<string, unknown>) => void) => Promise<{ chat: unknown }>;
}

export interface FaceLink {
  body: (request: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
  send: (response: ServerResponse, status: number, payload: unknown) => void;
}

export interface FaceTimers {
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
}

export interface FaceAppsOptions {
  apps?: Record<string, FaceAppEntry>;
  uuid?: () => string;
  timers?: FaceTimers;
  pingMs?: number;
}

interface CallWaiter {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

// Only the context fields the apps send, as strings or a whole number, so nothing else reaches the prompt.
export function cleanContext(value: unknown): CleanContext {
  const context: CleanContext = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return context;
  const obj = value as Record<string, unknown>;
  for (const key of ['cwd', 'command', 'output', 'screen', 'selection', 'url', 'title', 'text', 'host', 'connection', 'section', 'selected_container', 'summary', 'logs_tail']) {
    if (typeof obj[key] === 'string') context[key] = obj[key].slice(0, 20000);
  }
  if (typeof obj.exit === 'number' && Number.isInteger(obj.exit)) context.exit = obj.exit;
  return context;
}

export class FaceApps {
  apps: Record<string, FaceAppEntry>;
  uuid: () => string;
  timers: FaceTimers;
  pingMs: number;
  calls: Map<string, CallWaiter>;

  // apps: { [name]: { ask({ text, context, onText }) → { text }, stop(), reset() } }, one per app this Fairy answers for;
  // an app that starts work instead has work(request, emit) → { chat }, emit getting its events until 'done', and stop(chat).
  // ask also gets tools, an object with call(tool, args, signal) that runs on the face's Mac, when the app sent its own;
  // say(text, { signal, part }) makes her voice for an answer, part getting each clip, and resolves when it's all made.
  constructor({ apps = {}, uuid = randomUUID, timers = globalThis, pingMs = 15_000 }: FaceAppsOptions = {}) {
    this.apps = apps;
    this.uuid = uuid;
    this.timers = timers;
    this.pingMs = pingMs;
    this.calls = new Map();
  }

  entry(name: unknown): FaceAppEntry {
    const app = typeof name === 'string' && Object.hasOwn(this.apps, name) ? this.apps[name] : null;
    if (!app) throw failure(404, 'That app isn’t answered here.');
    return app;
  }

  async handle(request: IncomingMessage, response: ServerResponse, { pathname, link }: { pathname: string; link: FaceLink }): Promise<void> {
    if (request.method === 'POST' && pathname === '/v1/face/app/new') {
      const { app } = await link.body(request);
      await this.entry(app).reset();
      return link.send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && pathname === '/v1/face/app/rpc') {
      const { app, method, params } = await link.body(request, MAX_BODY);
      const entry = this.entry(app);
      if (typeof entry.rpc !== 'function') throw failure(404, 'That app doesn’t answer RPC here.');
      if (typeof method !== 'string' || !method.trim()) throw failure(400, 'Say which CLI method to run.');
      const args = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
      const data = await entry.rpc(method.trim(), args);
      return link.send(response, 200, { ok: true, data: data ?? null });
    }
    // The face's answer to one of her steps in the app's own tools.
    if (request.method === 'POST' && pathname === '/v1/face/app/tool') {
      const { call, result, error } = await link.body(request, MAX_RESULT);
      const waiter = this.calls.get(String(call ?? ''));
      if (!waiter) throw failure(409, 'That step isn’t waiting.');
      if (typeof error === 'string') waiter.reject(new Error(error.slice(0, 2000)));
      else waiter.resolve(result ?? null);
      return link.send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && pathname === '/v1/face/app/ask') {
      const { app, text, context, tools, speak } = await link.body(request, MAX_BODY);
      const entry = this.entry(app);
      if (typeof text !== 'string' || text.length > MAX_TEXT) throw failure(400, 'Enter a message of up to 12,000 characters.');
      request.socket.setTimeout(0);
      response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      const write = (message: unknown): void => { if (!response.writableEnded && !response.destroyed) response.write(`${JSON.stringify(message)}\n`); };
      const controller = new AbortController(), mine = new Set<string>();
      let answering = true;
      // The face closed it: the app was stopped there, or the link dropped. The answer, any step waiting on the face, and
      // her voice all stop.
      response.on('close', () => {
        if (answering) entry.stop();
        controller.abort(new Error('Stopped.'));
        for (const id of mine) this.calls.get(id)?.reject(new Error('Lost the link to the app.'));
      });
      const browser: FaceToolBridge | null = tools === true ? { call: (tool, args, signal) => this.step({ tool, args, signal, write, mine, stopped: controller.signal }) } : null;
      let reply: string | null = null;
      try {
        reply = String((await entry.ask({ text, context: cleanContext(context), ...(browser ? { tools: browser } : {}), onText: value => { if (typeof value === 'string') write({ type: 'text', text: value }); } }))?.text ?? '');
        answering = false;
        write({ type: 'done', text: reply });
      } catch (error) {
        answering = false;
        const errObj = error as { name?: string; message?: string } | null;
        write({ type: 'error', message: errObj?.name === 'AbortError' ? 'Stopped.' : String(errObj?.message || 'Fairy couldn’t answer.') });
      }
      if (reply && speak === true && typeof entry.say === 'function' && !controller.signal.aborted) {
        await entry.say(reply, { signal: controller.signal, part: clip => { if (clip?.bytes?.length) write({ type: 'voice', bytes: Buffer.from(clip.bytes).toString('base64'), pauseBeforeMs: Math.max(0, Math.round(Number(clip.pauseBeforeMs) || 0)) }); } })
          .catch(() => {});
        write({ type: 'spoken' });
      }
      if (!response.writableEnded) response.end();
      return;
    }
    if (request.method === 'POST' && pathname === '/v1/face/app/stop') {
      const { app, chat } = await link.body(request);
      const entry = this.entry(app);
      if (typeof entry.work !== 'function' || typeof chat !== 'string' || !chat) throw failure(400, 'Say which work to stop.');
      await entry.stop(chat);
      return link.send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && pathname === '/v1/face/app/work') {
      const { app, ...asked } = await link.body(request, MAX_BODY);
      const entry = this.entry(app);
      if (typeof entry.work !== 'function') throw failure(404, 'That app isn’t answered here.');
      request.socket?.setTimeout?.(0);
      // Events that come before the work has said it started wait, so 'started' is always first.
      const early: Record<string, unknown>[] = [];
      let open = false, ended = false, stopPing = () => {};
      const out = (event: Record<string, unknown>): void => {
        if (ended || response.destroyed || response.writableEnded) return;
        if (!open) { early.push(event); return; }
        response.write(`${JSON.stringify(event)}\n`);
        if (event.type === 'done') { ended = true; stopPing(); response.end(); }
      };
      let chat: unknown;
      // A refusal (a folder that isn't here, a chat already working) is an ordinary error answer.
      try { ({ chat } = await entry.work(asked, event => { if (event && typeof event === 'object') out(event); })); }
      catch (error) {
        const errObj = error as { status?: number; message?: string } | null;
        throw failure(errObj?.status ?? 400, String(errObj?.message || 'Fairy couldn’t start that.'));
      }
      response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/x-ndjson; charset=utf-8' });
      open = true;
      const ping = this.pingMs > 0 ? this.timers.setInterval(() => {
        if (!ended && !response.destroyed && !response.writableEnded) response.write('{"type":"ping"}\n');
      }, this.pingMs) : null;
      (ping as { unref?: () => unknown } | null)?.unref?.();
      stopPing = () => { if (ping) this.timers.clearInterval(ping); };
      response.on('close', stopPing);
      response.on('error', stopPing);
      out({ type: 'started', chat: String(chat) });
      for (const event of early.splice(0)) out(event);
      return;
    }
    return link.send(response, 404, { error: 'Not found.' });
  }

  // One step in the app's tools on the face's Mac: sent down the answer's stream, answered by /v1/face/app/tool. A commit
  // waits for the user's answer in the app, so the wait is long, as for the app on this Mac.
  step({ tool, args, signal, write, mine, stopped }: {
    tool: string;
    args: unknown;
    signal?: AbortSignal;
    write: (message: unknown) => void;
    mine: Set<string>;
    stopped: AbortSignal;
  }): Promise<unknown> {
    const id = this.uuid();
    return new Promise((resolve, reject) => {
      const end = (): void => { this.timers.clearTimeout(timer); this.calls.delete(id); mine.delete(id); signal?.removeEventListener?.('abort', abort); };
      const abort = (): void => { end(); reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' })); };
      const timer = this.timers.setTimeout(() => { end(); reject(new Error('The app took too long to answer.')); }, TOOL_WAIT_MS);
      if (signal?.aborted || stopped.aborted) return abort();
      signal?.addEventListener?.('abort', abort, { once: true });
      this.calls.set(id, { resolve: value => { end(); resolve(value); }, reject: error => { end(); reject(error); } });
      mine.add(id);
      write({ type: 'tool', call: id, tool: String(tool), args: args && typeof args === 'object' ? args : {} });
    });
  }
}
