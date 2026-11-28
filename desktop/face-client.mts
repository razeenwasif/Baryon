// Two Macs (docs/fairy-on-two-macs-plan.md): a face's one way to the Fairy on its other Mac. Every connection starts
// here and goes to that Mac's phone link over Tailscale. The link's certificate is self-made, so it is trusted by its
// pin alone: the TLS socket is opened and its fingerprint checked before a byte of any request is written, and a
// certificate that doesn't match is never trusted by itself (the face says to pair again).
import type { ClientRequest, IncomingHttpHeaders, IncomingMessage } from 'node:http';
import { Agent, request as httpsRequest, type RequestOptions } from 'node:https';
import type { Duplex } from 'node:stream';
import { connect as tlsConnect, type ConnectionOptions, type TLSSocket } from 'node:tls';
import { gunzipSync } from 'node:zlib';

export interface PinnedTarget {
  host: string;
  port: number;
  pin: string;
}

export interface PairTarget extends PinnedTarget {
  code: string;
}

export interface StoredPairing extends PinnedTarget {
  device: string;
}

export interface FaceStreamEvent {
  type: string;
  data: Record<string, unknown>;
}

export type FaceLinkState = 'unpaired' | 'connecting' | 'connected' | 'unreachable' | 'changed' | 'forgotten';

export type FaceClientError = Error & {
  code?: string;
  status?: number;
};

export interface FaceTimerHandle {
  unref?: () => void;
}

export interface FaceTimers {
  setTimeout: (fn: () => void, ms: number) => FaceTimerHandle;
  clearTimeout: (handle: FaceTimerHandle | null | undefined) => void;
  setInterval: (fn: () => void, ms: number) => FaceTimerHandle;
  clearInterval: (handle: FaceTimerHandle | null | undefined) => void;
}

export interface FaceStoreLike {
  pairing: () => StoredPairing | null;
  readKey: () => string;
  savePairing: (pairing: StoredPairing & { readKey: string; approveKey: string }) => Promise<unknown>;
  forget: () => Promise<unknown>;
}

export interface FaceClientOptions {
  store: FaceStoreLike;
  name?: string;
  connect?: (options: ConnectionOptions) => TLSSocket;
  request?: (options: RequestOptions, callback?: (res: IncomingMessage) => void) => ClientRequest;
  resolve?: (host: string) => string;
  timers?: FaceTimers;
  now?: () => number;
  workSilentMs?: number;
  onEvent?: (event: FaceStreamEvent) => void;
  onState?: (state: FaceLinkState) => void;
}

export interface FaceCallOptions {
  body?: unknown;
  key?: string;
  stream?: boolean;
  raw?: boolean;
  target?: PinnedTarget | null;
  timeoutMs?: number;
  signal?: AbortSignal | null;
  headers?: Record<string, string>;
  again?: boolean;
}

export interface FaceRawResponse {
  bytes: Buffer;
  headers: IncomingHttpHeaders;
  status: number;
}

export interface AppAskPrompt {
  text: string;
  context?: unknown;
  tools?: boolean;
  speak?: boolean;
}

export interface AppVoiceClip {
  bytes: Buffer;
  pauseBeforeMs: number;
}

export interface AppAskOptions {
  onText?: (text: string) => void;
  signal?: AbortSignal | null;
  onTool?: ((tool: string, args: Record<string, unknown>, signal: AbortSignal | null) => Promise<unknown> | unknown) | null;
  onVoice?: (clip: AppVoiceClip) => void;
  onSpoken?: () => void;
}

export interface AppWorkEvent {
  type: string;
  [key: string]: unknown;
}

type IdleSocket = Duplex & { fairyIdle?: FaceTimerHandle };

// After a lost or failed connection: tries again after 1, 2, 5 and 10 seconds, then every 30.
export const RETRY_MS = [1000, 2000, 5000, 10000, 30000];
const CONNECT_TIMEOUT_MS = 8000, REQUEST_TIMEOUT_MS = 15000, SILENT_MS = 45000;
// A checked connection is kept for the next call for this long after its last answer (the other Mac closes an idle one
// after 5 seconds, so a kept one is never one it's about to close), and at most this many are kept.
export const IDLE_MS = 3000, KEPT = 3;
const NETWORK = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNRESET', 'EPIPE']);

// fairy://pair?host=…&port=…&code=…&pin=…&kind=mac, as "Pair a Mac" makes it on the other Mac.
export function parsePairLink(link: unknown): PairTarget {
  let url: URL;
  try { url = new URL(String(link ?? '').trim()); } catch { throw new Error('That isn’t a pairing link. Copy it again from Pair a Mac on your other Mac.'); }
  if (url.protocol !== 'fairy:' || url.host !== 'pair') throw new Error('That isn’t a pairing link. Copy it again from Pair a Mac on your other Mac.');
  const query = url.searchParams, host = query.get('host') ?? '', port = Number(query.get('port')), code = query.get('code') ?? '', pin = query.get('pin') ?? '';
  if (query.get('kind') !== 'mac') throw new Error('That link is for pairing an iPhone. On your other Mac, use Pair a Mac.');
  if (!/^[a-z0-9.-]{1,253}$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535 || !/^[A-Za-z0-9_-]{8,100}$/.test(code) || !/^[0-9a-f]{64}$/.test(pin)) {
    throw new Error('That pairing link is incomplete. Copy it again from Pair a Mac on your other Mac.');
  }
  return { host, port, code, pin };
}

// Server-sent events from a stream of text chunks, joined across chunk boundaries: [{ type, data }].
export function eventParser(): { feed: (chunk: string | Buffer) => FaceStreamEvent[] } {
  let buffer = '';
  return {
    feed(chunk: string | Buffer): FaceStreamEvent[] {
      buffer += String(chunk).replace(/\r\n/g, '\n');
      const events: FaceStreamEvent[] = [];
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        let type = 'message'; const data: string[] = [];
        for (const line of block.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          const at = line.indexOf(':'), field = at < 0 ? line : line.slice(0, at), value = at < 0 ? '' : line.slice(at + 1).replace(/^ /, '');
          if (field === 'event') type = value; else if (field === 'data') data.push(value);
        }
        if (!data.length) continue;
        try { events.push({ type, data: JSON.parse(data.join('\n')) as Record<string, unknown> }); } catch { /* Not ours. */ }
      }
      return events;
    },
  };
}

const failure = (message: string, extra: Record<string, unknown> = {}): FaceClientError => Object.assign(new Error(message), extra);

// Connections to the other Mac, kept open between calls so each call doesn't pay a new TLS greeting. Every one is made
// by open(), so its certificate was checked against the pin before it carried anything, and it only ever talks to that
// Mac. One left idle for IDLE_MS is closed.
class PinnedAgent extends Agent {
  open: () => Promise<TLSSocket>;
  timers: FaceTimers;
  constructor(open: () => Promise<TLSSocket>, timers: FaceTimers) {
    super({ keepAlive: true, maxFreeSockets: KEPT });
    this.open = open; this.timers = timers;
  }
  override createConnection(_options: RequestOptions, done?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    this.open().then(socket => done?.(null, socket), err => done?.(err instanceof Error ? err : new Error(String(err)), undefined as unknown as Duplex));
    return undefined;
  }
  override keepSocketAlive(socket: IdleSocket): boolean {
    if (!(super.keepSocketAlive(socket) as unknown as boolean)) return false;
    socket.fairyIdle = this.timers.setTimeout(() => socket.destroy(), IDLE_MS);
    socket.fairyIdle.unref?.();
    return true;
  }
  override reuseSocket(socket: IdleSocket, request: ClientRequest): void { this.timers.clearTimeout(socket.fairyIdle); super.reuseSocket(socket, request); }
}

export class FaceClient {
  store: FaceStoreLike;
  name: string;
  connect: (options: ConnectionOptions) => TLSSocket;
  request: (options: RequestOptions, callback?: (res: IncomingMessage) => void) => ClientRequest;
  resolve: (host: string) => string;
  timers: FaceTimers;
  now: () => number;
  workSilentMs: number;
  onEvent: (event: FaceStreamEvent) => void;
  onState: (state: FaceLinkState) => void;
  link: FaceLinkState;
  key: string;
  tries: number;
  retryTimer: FaceTimerHandle | null;
  response: IncomingMessage | null;
  stopped: boolean;
  heardAt: number;
  watch: FaceTimerHandle | null;
  connecting: boolean;
  run: number;
  agents: Map<string, PinnedAgent>;

  // store: FaceStore. resolve maps the other Mac's name to where to connect (tests use 127.0.0.1); onEvent gets each event,
  // onState each change of state(): 'unpaired', 'connecting', 'connected', 'unreachable', 'changed' or 'forgotten'.
  constructor({ store, name = 'Mac', connect = tlsConnect, request = httpsRequest, resolve = host => host, timers = globalThis as unknown as FaceTimers, now = Date.now, workSilentMs = 60_000, onEvent = () => {}, onState = () => {} }: FaceClientOptions) {
    this.store = store;
    this.name = name;
    this.connect = connect;
    this.request = request;
    this.resolve = resolve;
    this.timers = timers;
    this.now = now;
    this.workSilentMs = workSilentMs;
    this.onEvent = onEvent;
    this.onState = onState;
    this.link = store.pairing() ? 'connecting' : 'unpaired';
    this.key = ''; this.tries = 0; this.retryTimer = null; this.response = null; this.stopped = true; this.heardAt = 0; this.watch = null;
    // connecting: the one attempt at the stream in flight; run: which start() it belongs to, so one from before a stop()
    // changes nothing; agents: the kept connections, by where and which pin.
    this.connecting = false; this.run = 0; this.agents = new Map();
  }
  state(): FaceLinkState { return this.link; }
  setLink(link: FaceLinkState): void { if (this.link !== link) { this.link = link; this.onState(link); } }

  // A TLS socket to the other Mac whose certificate matches the pin, or an error with code 'PIN'.
  open({ host, port, pin }: PinnedTarget): Promise<TLSSocket> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.connect({ host: this.resolve(host), port, servername: host, rejectUnauthorized: false, minVersion: 'TLSv1.3' });
      const fail = (error: Error): void => { if (settled) return; settled = true; socket.destroy(); reject(error); };
      socket.setTimeout(CONNECT_TIMEOUT_MS, () => fail(failure('Your other Mac didn’t answer.', { code: 'ETIMEDOUT' })));
      socket.once('error', fail);
      socket.once('secureConnect', () => {
        const fingerprint = String(socket.getPeerCertificate()?.fingerprint256 ?? '').replaceAll(':', '').toLowerCase();
        if (fingerprint !== pin) return fail(failure('Your other Mac’s certificate changed. Pair again.', { code: 'PIN' }));
        if (settled) return;
        settled = true; socket.setTimeout(0); socket.removeListener('error', fail); resolve(socket);
      });
    });
  }
  agentFor(target: PinnedTarget): PinnedAgent {
    const name = `${target.host}:${target.port}:${target.pin}`;
    if (!this.agents.has(name)) this.agents.set(name, new PinnedAgent(() => this.open(target), this.timers));
    return this.agents.get(name)!;
  }
  closeKept(): void { for (const agent of this.agents.values()) agent.destroy(); this.agents.clear(); }
  // One request on a pinned socket. stream: resolves with the response itself; raw: the body's bytes and headers.
  // timeoutMs: how long to wait for the answer (a quiz's model call takes longer); signal stops the request.
  // headers: more request headers (a window call's X-Fairy-Window token, Away 2).
  call(method: string, path: string, options: FaceCallOptions & { stream: true }): Promise<IncomingMessage>;
  call(method: string, path: string, options: FaceCallOptions & { raw: true }): Promise<FaceRawResponse>;
  call(method: string, path: string, options?: FaceCallOptions): Promise<Record<string, any>>;
  async call(method: string, path: string, { body, key = this.key, stream = false, raw = false, target = this.store.pairing(), timeoutMs = REQUEST_TIMEOUT_MS, signal = null, headers = {}, again = false }: FaceCallOptions = {}): Promise<IncomingMessage | FaceRawResponse | Record<string, any>> {
    signal?.throwIfAborted();
    if (!target) throw failure('Not paired with your other Mac yet.', { status: 401 });
    // A stream keeps its connection for as long as it lasts, so it gets one of its own; a call takes a kept one, or a
    // new one that's kept after. Either way Node sends only on a socket open() checked.
    let socket: TLSSocket | null = null;
    if (stream) {
      socket = await this.open(target);
      // Stopped while connecting (Away 5: the window gave up on it, or the link dropped).
      if (signal?.aborted) { socket.destroy(); throw signal.reason ?? new Error('Stopped.'); }
    }
    const pinned = socket;
    return new Promise((resolve, reject) => {
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const request = this.request({ host: target.host, port: target.port, method, path, ...(pinned ? { createConnection: () => pinned } : { agent: this.agentFor(target) }),
        headers: { ...headers, ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, response => {
        if (stream) return resolve(response);
        const parts: Buffer[] = [];
        response.on('data', (part: Buffer) => parts.push(part));
        response.on('error', reject);
        response.on('end', () => {
          // A window call's bigger answers come gzipped (Away 2).
          let all: Buffer = Buffer.concat(parts);
          if (response.headers['content-encoding'] === 'gzip') { try { all = gunzipSync(all); } catch { return reject(failure('Your other Mac’s answer was cut short.', { code: 'ETRUNC' })); } }
          const statusCode = response.statusCode ?? 0;
          if (raw && statusCode < 400) return resolve({ bytes: all, headers: response.headers, status: statusCode });
          let data: Record<string, any> = {};
          try { data = all.length ? JSON.parse(all.toString('utf8')) : {}; } catch { data = {}; }
          if (statusCode >= 400) return reject(failure(data.error || `Your other Mac answered ${statusCode}.`, { status: statusCode }));
          resolve(data);
        });
      });
      if (!stream) request.setTimeout(timeoutMs, () => request.destroy(failure('Your other Mac took too long to answer.', { code: 'ETIMEDOUT' })));
      signal?.addEventListener('abort', () => request.destroy((signal.reason as Error | undefined) ?? new Error('Stopped.')), { once: true });
      // A kept connection the other Mac closed just as this was sent: a read is asked once more on a new one. Anything
      // that changes something isn't, as it can't be known whether it arrived.
      request.on('error', (error: FaceClientError) => {
        if (request.reusedSocket && method === 'GET' && !again && !signal?.aborted && (['ECONNRESET', 'EPIPE'] as readonly (string | undefined)[]).includes(error?.code)) return resolve(this.call(method, path, { body, key, stream, raw, target, timeoutMs, signal, headers, again: true }) as Promise<IncomingMessage | FaceRawResponse | Record<string, any>>);
        reject(error);
      });
      request.end(payload ?? undefined);
    });
  }
  friendly(error: unknown): unknown {
    const err = error as FaceClientError | null | undefined;
    if (err?.code === 'PIN') return error;
    if (err?.code && NETWORK.has(err.code)) return failure('Couldn’t reach your other Mac. Check that Tailscale is on on both Macs and that Fairy is open there.', { code: err.code });
    return error;
  }

  async pair(link: unknown, name = this.name): Promise<void> {
    const target = parsePairLink(link);
    let reply: Record<string, any>;
    try { reply = await this.call('POST', '/v1/pair', { body: { code: target.code, name: String(name || 'Mac').slice(0, 40), kind: 'mac' }, key: '', target }); }
    catch (error) { throw this.friendly(error); }
    if (typeof reply?.readKey !== 'string' || typeof reply?.approveKey !== 'string' || typeof reply?.device !== 'string') throw new Error('Your other Mac’s answer wasn’t understood.');
    this.stop();
    await this.store.savePairing({ host: target.host, port: target.port, pin: target.pin, device: reply.device, readKey: reply.readKey, approveKey: reply.approveKey });
    this.start();
  }

  start(): void {
    this.stopped = false;
    if (!this.store.pairing()) return this.setLink('unpaired');
    try { this.key = this.store.readKey(); } catch { this.key = ''; }
    if (!this.key) return this.setLink('unpaired');
    this.watch ??= this.timers.setInterval(() => { if (this.response && this.now() - this.heardAt > SILENT_MS) this.response.destroy(); }, SILENT_MS / 3);
    this.watch.unref?.();
    void this.connectStream();
  }
  stop(): void {
    this.stopped = true; this.run += 1; this.connecting = false;
    this.closeKept();
    this.timers.clearTimeout(this.retryTimer); this.retryTimer = null;
    this.timers.clearInterval(this.watch); this.watch = null;
    const response = this.response; this.response = null; response?.destroy();
  }
  // Now, not at the next try: the Mac woke, the screen unlocked, or you clicked her eye.
  retryNow(): void {
    if (this.stopped || this.response || this.connecting || !['unreachable', 'connecting'].includes(this.link)) return;
    this.timers.clearTimeout(this.retryTimer); this.retryTimer = null; this.tries = 0;
    void this.connectStream();
  }
  // Probe a quiet stream on wake/network recovery before waiting out a dead TCP timeout.
  async probeNow(): Promise<boolean> {
    if (this.stopped || !this.store.pairing()) return false;
    if (!this.response) { this.retryNow(); return false; }
    try {
      await this.call('GET', '/v1/face/history', { timeoutMs: 4000 });
      this.heardAt = this.now();
      return true;
    } catch {
      const stale = this.response;
      this.response = null;
      stale?.destroy();
      this.later();
      return false;
    }
  }
  // One attempt at a time: a second one (the Mac woke and the screen unlocked together) would otherwise race the
  // first, and whichever failed last would mark a link that's connected as unreachable.
  async connectStream(): Promise<void> {
    if (this.stopped || this.response || this.connecting) return;
    const run = this.run;
    this.connecting = true;
    if (this.link !== 'unreachable') this.setLink('connecting');
    let response: IncomingMessage;
    try { response = await this.call('GET', '/v1/face/events', { stream: true }); }
    catch (error) {
      if (run !== this.run) return;
      this.connecting = false;
      if ((error as FaceClientError | undefined)?.code === 'PIN') { this.stop(); return this.setLink('changed'); }
      return this.later();
    }
    // Stopped, or stopped and started again, while it was connecting: this one isn't wanted.
    if (run !== this.run) { response.destroy(); return; }
    this.connecting = false;
    if (response.statusCode === 401) { response.resume(); return this.dropped(); }
    if (response.statusCode !== 200) { response.resume(); return this.later(); }
    this.response = response; this.tries = 0; this.heardAt = this.now();
    this.setLink('connected');
    const parser = eventParser();
    response.setEncoding('utf8');
    response.on('data', (chunk: string) => { this.heardAt = this.now(); for (const event of parser.feed(chunk)) this.onEvent(event); });
    response.on('error', () => {});
    response.on('close', () => {
      if (this.response !== response) return;
      this.response = null;
      this.onEvent({ type: 'lost', data: {} });
      if (!this.stopped) this.later();
    });
  }
  later(): void {
    // A failed attempt never marks a live link.
    if (this.stopped || this.response) return;
    this.setLink('unreachable');
    const delay = RETRY_MS[Math.min(this.tries, RETRY_MS.length - 1)];
    this.tries += 1;
    this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => { this.retryTimer = null; void this.connectStream(); }, delay);
    this.retryTimer.unref?.();
  }
  // The other Mac no longer knows this one (removed there): keys are deleted, and it takes a new pairing.
  async dropped(): Promise<void> { this.stop(); this.key = ''; await this.store.forget(); this.setLink('forgotten'); }
  // Forget from this Mac: tells the other Mac too if it can.
  async forget(): Promise<void> {
    if (this.store.pairing()) await this.call('POST', '/v1/leave', { body: {} }).catch(() => {});
    this.stop(); this.key = ''; await this.store.forget(); this.setLink('unpaired');
  }

  // explain: a drawn answer, with drawn the ids of the parts still showing here.
  // task: the companion's Task mode, a Desktop task on this Mac's screen run by the other Mac.
  async ask(text: string, { explain = false, drawn = [], focus = null, task = false }: { explain?: boolean; drawn?: string[]; focus?: unknown; task?: boolean } = {}): Promise<Record<string, any>> {
    try { return await this.call('POST', '/v1/face/ask', { body: explain ? { text, explain: true, drawn, ...(focus ? { focus } : {}) } : task ? { text, task: true } : { text } }); } catch (error) { throw this.friendly(error); }
  }
  // The answer to one step of that task (remote-screen.mjs); a picture is a few MB.
  desktopAnswer(answer: Record<string, unknown>): Promise<Record<string, any> | undefined> { return this.call('POST', '/v1/face/desktop', { body: answer, timeoutMs: 120000 }).catch(() => undefined); }
  stopTurn(): Promise<Record<string, any>> { return this.call('POST', '/v1/face/stop', { body: {} }); }
  history(): Promise<Record<string, any>> { return this.call('GET', '/v1/face/history'); }
  async voicePart(turn: string, part: number | string): Promise<{ bytes: Buffer; pauseBeforeMs: number }> {
    const { bytes, headers } = await this.call('GET', `/v1/face/voice?${new URLSearchParams({ turn, part: String(part) })}`, { raw: true });
    return { bytes, pauseBeforeMs: Math.max(0, Number(headers['x-fairy-pause-before']) || 0) };
  }
  // The chats window's requests: the phone link's own, used as a phone uses them.
  async get(path: string): Promise<Record<string, any>> { try { return await this.call('GET', path); } catch (error) { throw this.friendly(error); } }
  async post(path: string, body: unknown = {}): Promise<Record<string, any>> { try { return await this.call('POST', path, { body }); } catch (error) { throw this.friendly(error); } }
  // The phone link's live stream for the chats window: { overview, chat } each time either changes.
  chatsStream(chat?: string): Promise<IncomingMessage> { return this.call('GET', `/v1/events${chat ? `?${new URLSearchParams({ chat })}` : ''}`, { stream: true }); }
  // A picture of this Mac's screen, or { id, refused: true }, for the other Mac's want-picture (step 6).
  picture(answer: Record<string, unknown>): Promise<Record<string, any>> { return this.call('POST', '/v1/face/picture', { body: answer }); }
  // Away 1: "Check before you leave" ([{ id, ok, label, fix }]), and starting Fairy again on the other Mac (approve key).
  async health(): Promise<unknown[]> { return (await this.call('GET', '/v1/face/health', { timeoutMs: 30000 })).checks ?? []; }
  restart(approveKey: string): Promise<Record<string, any>> { return this.call('POST', '/v1/face/restart', { body: { approveKey } }); }
  // A quiz question recognised here, answered by the other Mac's quiz (step 8): resolves the model's reply.
  async quiz(observation: unknown, { signal }: { signal?: AbortSignal | null } = {}): Promise<string> { return (await this.call('POST', '/v1/face/quiz', { body: { observation }, timeoutMs: 60000, signal })).reply ?? ''; }
  // Which of this Mac's apps "my notes app" means, picked by the other Mac's model: { app: name }, { choices: [names] } or {}.
  pickApp(asked: string, apps: unknown[]): Promise<Record<string, any>> { return this.call('POST', '/v1/face/app-pick', { body: { asked, apps }, timeoutMs: 45000 }); }
  // { activeAgoMs, locked, claim, follow }: whether this Mac is the one in use (step 5).
  // A request from AudioPulse on this Mac (face-sockets.mjs), run once on the other Mac's provider as for a paired iPhone.
  // The other Mac gives the model up to 90 seconds, so this waits a little longer.
  async assist({ instructions, prompt }: { instructions: string; prompt: string }): Promise<string> {
    try { return String((await this.call('POST', '/v1/assist', { body: { instructions, prompt }, timeoutMs: 95000 })).text ?? ''); }
    catch (error) { throw this.friendly(error); }
  }
  // A question from one of the user's other apps on this Mac (face-sockets.mjs): onText gets the reply so far, and the
  // reply resolves; signal stops it, which the other Mac hears as the request closing. With tools, onTool(tool, args,
  // signal) runs each step the other Mac takes in the app's own tools here. With speak, onVoice gets each clip of her
  // voice for the answer after it resolves, and onSpoken runs once they've all come (or the link went).
  async appAsk(app: string, { text, context, tools = false, speak = false }: AppAskPrompt, { onText = () => {}, signal = null, onTool = null, onVoice = () => {}, onSpoken = () => {} }: AppAskOptions = {}): Promise<string> {
    let response: IncomingMessage;
    try { response = await this.call('POST', '/v1/face/app/ask', { body: { app, text, context, ...(tools ? { tools: true } : {}), ...(speak ? { speak: true } : {}) }, stream: true, signal }); }
    catch (error) { throw this.friendly(error); }
    return new Promise((resolve, reject) => {
      let buffer = '', settled = false, spoken = false;
      const finishVoice = (): void => { if (!spoken) { spoken = true; onSpoken(); } response.destroy(); };
      // Done: the reply resolves; with speak, the stream stays open for her voice.
      const end = (error: Error | null, text = ''): void => {
        if (settled) return;
        settled = true;
        if (error || !speak) { response.destroy(); if (speak) finishVoice(); }
        error ? reject(error) : resolve(text);
      };
      const answerStep = async ({ call, tool, args }: { call: string; tool?: unknown; args?: Record<string, unknown> }): Promise<void> => {
        let answer: Record<string, unknown>;
        try { answer = { call, result: onTool ? await onTool(String(tool), args ?? {}, signal) : null, ...(onTool ? {} : { error: 'This app sent no tools.' }) }; }
        catch (error) { answer = { call, error: String((error as Error | undefined)?.message || error) }; }
        await this.call('POST', '/v1/face/app/tool', { body: answer }).catch(() => {});
      };
      if ((response.statusCode ?? 0) >= 400) {
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { buffer += chunk; });
        response.on('end', () => { let message = ''; try { message = JSON.parse(buffer).error; } catch {} end(failure(message || `Your other Mac answered ${response.statusCode}.`, { status: response.statusCode })); });
        return;
      }
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
          let message: Record<string, any> | null = null;
          try { message = JSON.parse(buffer.slice(0, at)); } catch {}
          buffer = buffer.slice(at + 1);
          if (message?.type === 'text') onText(String(message.text ?? ''));
          else if (message?.type === 'tool' && typeof message.call === 'string') void answerStep(message as { call: string; tool?: unknown; args?: Record<string, unknown> });
          else if (message?.type === 'done') end(null, String(message.text ?? ''));
          else if (message?.type === 'error') end(new Error(String(message.message || 'Fairy couldn’t answer.')));
          else if (message?.type === 'voice' && typeof message.bytes === 'string') onVoice({ bytes: Buffer.from(message.bytes, 'base64'), pauseBeforeMs: Number(message.pauseBeforeMs) || 0 });
          else if (message?.type === 'spoken') finishVoice();
        }
      });
      const gone = (): void => { end(signal?.aborted ? new Error('Stopped.') : failure('Lost the link to your other Mac.')); if (speak) finishVoice(); };
      response.on('error', gone);
      response.on('close', gone);
    });
  }
  // Work one of the user's apps on this Mac starts on the other Mac (Electron: in its vault). Resolves { chat } once it has
  // started; emit then gets the app's events until 'done'. If the link drops first, the work carries on there and emit
  // gets a last 'done' saying so.
  async appWork(app: string, request: Record<string, unknown>, emit: (event: AppWorkEvent) => void = () => {}): Promise<{ chat: string }> {
    let response: IncomingMessage;
    try { response = await this.call('POST', '/v1/face/app/work', { body: { ...request, app }, stream: true }); }
    catch (error) { throw this.friendly(error); }
    return new Promise((resolve, reject) => {
      let buffer = '', chat: string | null = null, finished = false, settled = false, heardAt = this.now();
      // Events go to emit a turn later, in order, so whoever awaited { chat } has said it started before the first one.
      const queued: AppWorkEvent[] = [];
      const deliver = (message: AppWorkEvent): void => { queued.push(message); if (queued.length === 1) setImmediate(() => { for (const item of queued.splice(0)) emit(item); }); };
      response.setEncoding('utf8');
      if ((response.statusCode ?? 0) >= 400) {
        response.on('data', (chunk: string) => { buffer += chunk; });
        response.on('end', () => { let message = ''; try { message = JSON.parse(buffer).error; } catch {} reject(failure(message || `Your other Mac answered ${response.statusCode}.`, { status: response.statusCode })); });
        return;
      }
      const watchEvery = Math.max(10, Math.min(10000, Math.floor(this.workSilentMs / 3)));
      const watch = this.workSilentMs > 0 ? this.timers.setInterval(() => { if (this.now() - heardAt > this.workSilentMs) response.destroy(); }, watchEvery) : null;
      watch?.unref?.();
      const stopWatch = (): void => { if (watch) this.timers.clearInterval(watch); };
      response.on('data', (chunk: string) => {
        heardAt = this.now();
        buffer += chunk;
        let at: number;
        while ((at = buffer.indexOf('\n')) >= 0) {
          let message: Record<string, any> | null = null;
          try { message = JSON.parse(buffer.slice(0, at)); } catch {}
          buffer = buffer.slice(at + 1);
          if (!message || typeof message !== 'object' || message.type === 'ping') continue;
          if (message.type === 'started' && !chat) { chat = String(message.chat); settled = true; resolve({ chat }); }
          else if (chat && !finished) { if (message.type === 'done') { finished = true; stopWatch(); } deliver(message as AppWorkEvent); }
        }
      });
      const gone = (): void => {
        stopWatch();
        if (!chat) { if (!settled) { settled = true; reject(failure('Lost the link to your other Mac.')); } return; }
        if (!finished) { finished = true; deliver({ type: 'done', text: 'Lost the link to your other Mac. The work carries on there, in Fairy’s sidebar.', failed: true }); }
      };
      response.on('end', gone);
      response.on('close', gone);
      response.on('error', gone);
    });
  }
  async appStop(app: string, chat: string): Promise<void> { try { await this.call('POST', '/v1/face/app/stop', { body: { app, chat } }); } catch (error) { throw this.friendly(error); } }
  async appNew(app: string): Promise<void> { try { await this.call('POST', '/v1/face/app/new', { body: { app } }); } catch (error) { throw this.friendly(error); } }
  async appRpc(app: string, method: string, params: Record<string, unknown> = {}, { timeoutMs = 30000, signal = null }: { timeoutMs?: number; signal?: AbortSignal | null } = {}): Promise<unknown> {
    try {
      const res = await this.call('POST', '/v1/face/app/rpc', { body: { app, method, params }, timeoutMs, signal });
      return res?.data ?? null;
    } catch (error) {
      throw this.friendly(error);
    }
  }
  presence(report: Record<string, unknown>): Promise<Record<string, any>> { return this.call('POST', '/v1/face/presence', { body: report }); }
  answer(id: string, decision: string, approveKey?: string): Promise<Record<string, any>> { return this.call('POST', '/v1/answer', { body: { id, decision, ...(approveKey ? { approveKey } : {}) } }); }
}
