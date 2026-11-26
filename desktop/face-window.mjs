// Fairy away from the mini, Away 3: Fairy's own window on the face's Mac, answered by the Mac she lives on through the
// bridge (face-link.mjs, Away 2). This is its logic, with no Electron in it: face-main.cjs gives it the window.
//
// - session(): a window session, opened with Touch ID (confirm) and the approve key, kept until it ends (12 hours, the
//   window closing, this Mac locking or sleeping) and opened again, with Touch ID, the next time it's needed.
// - call(channel, args): a Remote channel to the other Mac, answered by her own handler; a step allowed from here asks
//   for Touch ID again; her error comes back as the same text. A Local channel is this Mac's; anything else is refused.
// - events(batch): her window's events, in order; a gap means some were missed, so the state is fetched afresh.
// - linkChanged(state) (Away 5): the link dropped (calls in flight end, new ones are refused at once, the page dims) or
//   came back (the page catches up on what finished meanwhile). Nothing the page holds, such as a draft, is reloaded.
// - file(request): a page's file or an animation for fairy-artifact:, fetched from her.
import { powerPolicy } from './power-awareness.mjs';
import { decode, encode } from './remote-codec.mjs';
import { basename } from 'node:path';
import { BYTE_CHANNELS, isLong, kindOf, NEEDS_APPROVAL } from './remote-channels.mjs';

// ipcRenderer.send rather than invoke: these get no answer, so nothing is registered for them here.
export const SENDS = Object.freeze(['ink-voice', 'quick-heard', 'startup-usable', 'window-position']);
export const MINI_ONLY_MESSAGE = 'Do this on your other Mac.';
// A turn can run for a long time with nothing on the wire, so a window call waits long; stopping it is the page's Stop.
const CALL_MS = 30 * 60_000, OPEN_MS = 30_000, EARLY_MS = 60_000;
// What a page's file keeps from her answer: its type, range and policy, and what lets a page whose frame has no origin
// of its own (the sandbox) read it in CORS mode, as a caption track or a crossorigin video does.
const KEPT_HEADERS = ['content-type', 'content-range', 'accept-ranges', 'cache-control', 'content-security-policy', 'access-control-allow-origin', 'x-content-type-options'];
// Away 5: an ordinary call gives up after 20 seconds, one carrying a file or a recording after 120; after 2 seconds the
// page says it's waiting. A long call (isLong) waits for its turn, and ends only when the link drops.
export const PLAIN_MS = 20_000, BYTES_MS = 120_000, WAIT_MS = 2_000;
// What Touch ID asks about, for each call that needs it; a terminal opened within RECENT_MS of opening the window is
// covered by that same Touch ID.
// The calls that start a turn or work which may then use this Mac's browser or screen. A chat's call lasts as long as its
// turn; work carries on after its call returns, so steps for it are taken for this long after one was sent from here.
const TURN_STARTS = new Set(['chat', 'work-send', 'session-message', 'session-new-work', 'session-to-work', 'side-proposal-start']), WORK_STARTS = new Set(['work-send', 'session-message', 'session-new-work', 'session-to-work', 'side-proposal-start']);
export const WORK_MS = 2 * 60 * 60_000;
const APPROVAL_REASONS = { 'terminal-start': 'open a terminal on your other Mac', 'work-permission': 'let this work session run without asking',
  'memory-clear': 'delete everything Fairy remembers', 'clear-memory': 'clear this chat’s memory', 'session-remove': 'delete a chat', 'sessions-remove': 'delete chats', 'sweep-mini': 'sweep caches on your other Mac',
  'git-commit': 'commit changes on your other Mac', 'git-push': 'push this branch from your other Mac',
  'git-open-pr': 'open a pull request from your other Mac', 'git-merge': 'merge this chat’s branch on your other Mac',
  'git-act': 'run a Git branch or stash action on your other Mac' }, RECENT_MS = 15_000;
export const LINK_DOWN_MESSAGE = 'Can’t reach your other Mac. Trying again…', SLOW_MESSAGE = 'Your other Mac took too long to answer.';
// How a connection that dropped on the way ends: said as the link being down, not as the socket's error.
const DROPPED = new Set(['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN', 'ECONNABORTED']);
// Away 4: a file attached from this Mac is at most 20 MB, as from the phone, and at most ten at once; it's refused here,
// before anything is sent.
export const ATTACH_MAX_BYTES = 20 * 1024 * 1024, ATTACH_AT_ONCE = 10;

// Her awareness comes from the other Mac, and with it that Mac's power policy: whether *its* window is seen, its battery
// and heat, and whether you're away from *it*, none of which says anything about this window. Opening her window here,
// she follows you, the other Mac's window goes unseen, and ten minutes on you count as away there (Low Power to the
// page): this window's backgrounds and animations stood still. So what the window draws by is this Mac's own policy:
// whether this window is seen, this Mac's battery and heat (local), and you here, using it.
const DRAWING = ['visible', 'fps', 'level', 'powerLevel', 'away', 'optional', 'onBattery', 'thermal', 'speedLimit', 'lowPower', 'label'];
export function seenHere(awareness, seen, local = {}) {
  if (!awareness || typeof awareness !== 'object' || !awareness.power || typeof awareness.power !== 'object') return awareness;
  const policy = powerPolicy({ onBattery: Boolean(local.onBattery), thermal: local.thermal ?? 'unknown', speedLimit: local.speedLimit ?? 100, visible: seen !== false, idleSeconds: 0 });
  return { ...awareness, power: { ...awareness.power, ...Object.fromEntries(DRAWING.map(key => [key, policy[key]])) } };
}

export class FaceWindow {
  // client: FaceClient; confirm(reason) resolves after Touch ID or throws; approveKey(): the sealed key, unsealed;
  // local: { channel: (...args) => value } for this Mac's own channels; deliver(channel, value) passes an event to the
  // page; reload() loads the page again.
  // status({ down, waiting }) tells the page how the link is (Away 5); choose: { channel: args => args or null } fills in
  // a Remote call's arguments on this Mac first (a work session's folder, picked here), null meaning it was cancelled;
  // timers can be replaced in tests.
  // seen() says whether this Mac's window can be seen, power() this Mac's battery and heat (seenHere).
  constructor({ client, confirm, approveKey, local = {}, deliver = () => {}, status = () => {}, choose = {}, now = Date.now, timers = globalThis,
    limits = { plain: PLAIN_MS, bytes: BYTES_MS, wait: WAIT_MS }, seen = () => true, power = () => ({}) }) {
    Object.assign(this, { client, confirm, approveKey, local, deliver, status, choose, now, timers, limits, seen, power });
    this.awareness = null;
    this.open = null; this.opening = null; this.seq = 0;
    this.down = false; this.calls = new Set(); this.waitingShown = false;
    // Terminals opened from here, and what's been typed in each that's still to go.
    // openedAt: when Touch ID last opened a window session (the only Touch ID that also covers a terminal).
    this.openedAt = -Infinity; this.terminals = new Set(); this.writing = new Map();
    // Whether a session has been opened before: a later one (after a lock, a sleep or 12 hours) fetches the state afresh.
    this.opened = false;
    // Turns asked from here that are still running, and until when work started from here may still be.
    this.turns = 0; this.workUntil = 0;
  }
  // The other Mac stops the terminals a window session opened when it ends, so the page is told each has ended: the next
  // key starts a new one.
  endTerminals() {
    for (const id of this.terminals) this.deliver('terminal-exit', { id, code: null });
    this.terminals.clear(); this.writing.clear();
  }
  // What's typed in a terminal goes in order, one request at a time; keys typed meanwhile go together in the next.
  writeTerminal(id, data) {
    if (typeof id !== 'string' || typeof data !== 'string' || !data) return Promise.resolve(null);
    let line = this.writing.get(id);
    if (!line) { line = { text: '', running: null }; this.writing.set(id, line); }
    line.text += data;
    line.running ??= (async () => {
      try { while (line.text) { const text = line.text; line.text = ''; await this.call('terminal-write', [id, text], { inOrder: true }); } }
      catch (error) { line.text = ''; throw error; }
      finally { line.running = null; if (this.writing.get(id) === line && !line.text) this.writing.delete(id); }
    })();
    return line.running;
  }
  // Away 5: the link's state from the face's client. Down: every call in flight ends (her work carries on there) and the
  // page dims. Back: the page catches up.
  linkChanged(state) {
    const down = state !== 'connected';
    if (down === this.down) return;
    this.down = down;
    if (down) for (const call of this.calls) call.controller.abort();
    this.tell();
    if (!down) void this.refresh();
  }
  tell() {
    const waiting = !this.down && [...this.calls].some(call => call.slow);
    this.waitingShown = waiting;
    this.status({ down: this.down, waiting });
  }
  // What finished while the link was down or a batch went missing: the chat list and the open chat, fetched afresh.
  async refresh() {
    if (!this.open || this.down) return;
    try {
      const state = await this.call('state');
      if (state?.sessions) this.deliver('sessions', state.sessions);
      if (state?.sessions?.active) this.deliver('session-show', state.sessions.active);
    } catch {}
  }
  live() { return Boolean(this.open) && this.now() < this.open.expires - EARLY_MS; }
  // Whether a turn or work started from this window may be running now. Only then does this Mac run a step the other
  // Mac sends for its browser or its screen: the other Mac's word alone isn't enough. It needs a session, so after a
  // lock or a sleep nothing runs until Touch ID has opened the next one.
  acting() { return Boolean(this.open) && (this.turns > 0 || this.now() < this.workUntil); }
  async session() {
    if (this.live()) return this.open;
    this.opening ??= (async () => {
      try {
        await this.confirm('open Fairy’s window on this Mac');
        this.openedAt = this.now();
        // A new session: the last one's terminals were stopped on the other Mac.
        this.endTerminals();
        const answer = await this.client.call('POST', '/v1/face/window', { body: { approveKey: this.approveKey() }, timeoutMs: OPEN_MS });
        if (typeof answer?.token !== 'string') throw new Error('Your other Mac’s answer wasn’t understood.');
        this.open = { token: answer.token, expires: Date.parse(answer.expires) || this.now() + 3_600_000 };
        this.seq = 0;
        // While no session was open (this Mac was locked or asleep) her events weren't passed on, and the new session
        // counts from zero, so nothing would show as missed: what's on screen is fetched afresh.
        if (this.opened) void this.refresh();
        this.opened = true;
        return this.open;
      } finally { this.opening = null; }
    })();
    return this.opening;
  }
  // Ends the session here and there (the window closed, or this Mac locked or slept). Touch ID opens the next one.
  async end() {
    const open = this.open; this.open = null; this.seq = 0;
    this.endTerminals();
    if (open) await this.client.call('POST', '/v1/face/window/close', { body: {}, headers: { 'X-Fairy-Window': open.token } }).catch(() => {});
  }
  async call(channel, args = [], { inOrder = false } = {}) {
    if (channel === 'terminal-write' && !inOrder) return this.writeTerminal(args[0], args[1]);
    if (channel === 'terminal-stop') { this.terminals.delete(args[0]); this.writing.delete(args[0]); }
    const kind = kindOf(channel);
    if (kind === 'local') { const run = this.local[channel]; return run ? run(...args) : null; }
    if (kind !== 'remote') throw new Error(MINI_ONLY_MESSAGE);
    if (this.down) throw Object.assign(new Error(LINK_DOWN_MESSAGE), { linkDown: true });
    if (this.choose[channel]) { args = await this.choose[channel](args); if (args == null) return null; }
    let approveKey;
    if (NEEDS_APPROVAL[channel]?.(args)) {
      if (!(channel === 'terminal-start' && this.now() - this.openedAt < RECENT_MS)) await this.confirm(APPROVAL_REASONS[channel] ?? 'allow a step Fairy asked about');
      approveKey = this.approveKey();
    }
    const bytes = BYTE_CHANNELS.includes(channel), long = isLong(channel), starts = TURN_STARTS.has(channel);
    if (starts) this.turns += 1;
    if (WORK_STARTS.has(channel)) this.workUntil = this.now() + WORK_MS;
    try { return this.here(channel, await this.send(channel, args, { approveKey, bytes, long })); }
    finally { if (starts) this.turns -= 1; }
  }
  // Her awareness in an answer (the state), with this window's own seen (seenHere).
  here(channel, result) {
    if (result && typeof result === 'object' && result.awareness?.power) { this.awareness = result.awareness; return { ...result, awareness: seenHere(result.awareness, this.seen(), this.power()) }; }
    return result;
  }
  // This window shown, hidden, minimized or covered, or this Mac's power changed: the page is told, with her latest awareness.
  seenChanged() { if (this.awareness) this.deliver('awareness', seenHere(this.awareness, this.seen(), this.power())); }
  async send(channel, args, { approveKey, bytes, long }) {
    for (let attempt = 0; ; attempt++) {
      const open = await this.session();
      const call = { controller: new AbortController(), slow: false, timer: null, limit: null, timedOut: false };
      const limit = long ? CALL_MS : bytes ? this.limits.bytes : this.limits.plain;
      if (!long) {
        call.timer = this.timers.setTimeout(() => { call.slow = true; this.tell(); }, this.limits.wait);
        // The whole call, connecting included, is held to its limit.
        call.limit = this.timers.setTimeout(() => { call.timedOut = true; call.controller.abort(); }, limit);
      }
      this.calls.add(call);
      const stopped = new Promise((resolve, reject) => call.controller.signal.addEventListener('abort', () => reject(new Error('Stopped.')), { once: true }));
      try {
        const asked = this.client.call('POST', '/v1/face/call', { body: { channel, args: encode(args), ...(approveKey ? { approveKey } : {}) },
          headers: { 'X-Fairy-Window': open.token, 'X-Fairy-Channel': channel, 'Accept-Encoding': 'gzip', ...(bytes ? { 'X-Fairy-Bytes': '1' } : {}) },
          timeoutMs: limit, signal: call.controller.signal });
        asked.catch(() => {}); stopped.catch(() => {});
        const answer = await Promise.race([asked, stopped]);
        if (typeof answer?.error === 'string') throw Object.assign(new Error(answer.error), { fromHer: true });
        const result = decode(answer?.result ?? null);
        if (channel === 'terminal-start' && typeof result?.id === 'string') this.terminals.add(result.id);
        return result;
      } catch (error) {
        if (call.timedOut) throw Object.assign(new Error(SLOW_MESSAGE), { timedOut: true });
        // The link dropped while it was on its way: say so, rather than how the request ended.
        if (call.controller.signal.aborted || DROPPED.has(error?.code)) throw Object.assign(new Error(LINK_DOWN_MESSAGE), { linkDown: true });
        // Her Fairy restarted, or 12 hours passed: open the window session again (with Touch ID) and try once more.
        if (error?.status === 401 && attempt === 0) { this.open = null; continue; }
        throw error;
      } finally {
        this.timers.clearTimeout(call.timer); this.timers.clearTimeout(call.limit);
        call.controller.abort();
        this.calls.delete(call);
        if (call.slow || this.waitingShown) this.tell();
      }
    }
  }
  events({ seq, events } = {}) {
    if (!this.open || !Number.isInteger(seq) || !Array.isArray(events)) return;
    // A missed batch: rather than guess, the state is fetched afresh (the page keeps what you were typing).
    const missed = this.seq && seq !== this.seq + 1;
    this.seq = seq;
    if (missed) { void this.refresh(); return; }
    for (const item of events) {
      if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
      const value = decode(item[1]);
      if (item[0] === 'terminal-exit') { this.terminals.delete(value?.id); this.writing.delete(value?.id); }
      // Her own browser opening on the other Mac: this window's pane is this Mac's, opened by its own steps.
      if (item[0] === 'work' && value?.type === 'browser-open') continue;
      if (item[0] === 'awareness' && value?.power) { this.awareness = value; this.deliver('awareness', seenHere(value, this.seen(), this.power())); continue; }
      this.deliver(item[0], value);
    }
  }
  // A browser step's answer (remote-browser.mjs), for this window session.
  async answerBrowser(answer) {
    if (!this.open) return;
    await this.client.call('POST', '/v1/face/window/browser', { body: answer, headers: { 'X-Fairy-Window': this.open.token }, timeoutMs: OPEN_MS }).catch(() => {});
  }
  // A Desktop task step's answer (remote-screen.mjs): a picture of this screen can be a few MB, so it gets longer.
  async answerDesktop(answer) {
    if (!this.open) return;
    await this.client.call('POST', '/v1/face/window/desktop', { body: answer, headers: { 'X-Fairy-Window': this.open.token }, timeoutMs: OPEN_MS * 4 }).catch(() => {});
  }
  // Away 4: files chosen on this Mac, each read here and added on the other Mac as if attached there; one too big is
  // refused before it's read. Resolves as her own attach-choose does: { added, failed: [{ name, message }] }.
  async attachFiles(paths, { stat, readFile }) {
    const added = [], failed = [];
    for (const path of paths.slice(0, ATTACH_AT_ONCE)) {
      const name = basename(path);
      try {
        const info = await stat(path);
        if (!info.isFile()) throw new Error(`${name} isn’t a file.`);
        if (info.size > ATTACH_MAX_BYTES) throw new Error(`${name} is over 20 MB, which is as big as a file attached from this Mac can be.`);
        added.push(await this.call('attach-bytes', [name, await readFile(path)]));
      } catch (error) { failed.push({ name, message: String(error?.message || 'It couldn’t be attached.') }); }
    }
    return { added, failed };
  }
  // A fairy-artifact: request from the window: its page's files (host page) and animations (host anim), from her.
  async file({ host, path, range = null }) {
    const open = await this.session();
    const query = new URLSearchParams({ host, path });
    // A ranged ask is a video or sound: its whole range comes as a stream on a connection of its own, so it plays as it
    // arrives and a seek (the window cancelling it) closes it. Chromium takes a shorter answer as the end of the file.
    if (range) {
      const giveUp = new AbortController(), timer = setTimeout(() => giveUp.abort(new Error('Your other Mac took too long to answer.')), OPEN_MS * 4);
      try {
        const response = await this.client.call('GET', `/v1/face/page-file?${query}`, { stream: true, signal: giveUp.signal, headers: { 'X-Fairy-Window': open.token, Range: range } });
        clearTimeout(timer);
        const kept = Object.fromEntries(Object.entries(response.headers).filter(([name]) => [...KEPT_HEADERS, 'content-length'].includes(name)));
        return { status: response.statusCode, headers: kept, stream: response };
      } catch (error) { clearTimeout(timer); return { status: error?.status ?? 502, headers: { 'content-type': 'text/plain; charset=utf-8' }, bytes: Buffer.from('Not found') }; }
    }
    try {
      const { bytes, headers, status } = await this.client.call('GET', `/v1/face/page-file?${query}`, { raw: true, headers: { 'X-Fairy-Window': open.token, ...(range ? { Range: range } : {}) }, timeoutMs: OPEN_MS * 4 });
      const kept = Object.fromEntries(Object.entries(headers).filter(([name]) => KEPT_HEADERS.includes(name)));
      // A video can't seek without its piece's length, which a Response made from bytes doesn't give by itself.
      return { status, headers: { ...kept, 'content-length': String(bytes.length) }, bytes };
    } catch (error) { return { status: error?.status ?? 502, headers: { 'content-type': 'text/plain; charset=utf-8' }, bytes: Buffer.from('Not found') }; }
  }
}
