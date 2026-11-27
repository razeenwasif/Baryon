// Two Macs (docs/fairy-on-two-macs-plan.md): the full Fairy's side of a face on another Mac. PhoneLink hands it every
// /v1/face/ request from a device paired as a Mac, so the port, Tailscale-only check, pinned certificate and keys are
// the phone link's own. A face asks in Quick chat and hears the answer in her voice; it can stop a turn and see the
// questions it can answer. It never reads files, the screen or settings here, whatever it sends. Explain from a face is
// drawn on the face's own screen, from a picture the face sends (steps 6 and 7).
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { homedir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { decode, encode } from './remote-codec.mjs';
import { BYTE_CHANNELS, kindOf, NEEDS_APPROVAL, WINDOW_EVENTS } from './remote-channels.mjs';

// The face takes the picture, reads its text with Vision (up to 9 seconds) and sends it over Tailscale, so the wait is
// longer than that. A refusal says why, so the message says what to do.
const MAX_PICTURE_BODY = 20 * 1024 * 1024, PICTURE_WAIT_MS = 30000, NOT_SHARING = 'Your MacBook isn’t sharing its screen. Turn on Let Fairy see this screen in its menu bar, and allow Screen Recording for Fairy there.';
const TOO_SLOW = 'Your MacBook took too long to send a picture of its screen. Try again.';
const REFUSALS = {
  off: 'Your MacBook isn’t sharing its screen. Turn on Let Fairy see this screen in Fairy’s menu bar there.',
  permission: 'Fairy on your MacBook isn’t allowed to see its screen. Allow her there in System Settings, Privacy & Security, Screen & System Audio Recording.',
  locked: 'Your MacBook is locked, so Fairy can’t see its screen.',
  busy: 'Your MacBook was asked for a picture a moment ago. Try again.',
  failed: 'Fairy couldn’t take a picture of your MacBook’s screen. Try again.',
};
// Away: frames held back while this much of the event stream is still unsent.
const FRAME_BACKLOG = 256 * 1024;
// A browser step on the face's Mac (remote-browser.mjs): a page can take 20 seconds to load there, and a screenshot is
// a few hundred KB.
const BROWSER_WAIT_MS = 90_000, MAX_BROWSER_BODY = 8 * 1024 * 1024;
// A Desktop task's step on the face's Mac (remote-screen.mjs): a picture is a few MB, and a question waits for the user.
const DESKTOP_WAIT_MS = 10 * 60_000, MAX_DESKTOP_BODY = 24 * 1024 * 1024;
export const DESKTOP_GONE = 'Fairy’s window on your MacBook isn’t open, so the task can’t use its screen. Open her window there and ask again.';
export const BROWSER_GONE = 'Fairy’s window on your MacBook isn’t open, so its browser can’t be used. Open her window there and ask again.';
const MAX_TEXT = 12000, MAX_BODY = 64 * 1024, MAX_PARTS = 60, MAX_VOICE_BYTES = 30 * 1024 * 1024, TEXT_EVERY_MS = 100, PING_EVERY_MS = 15000, LISTED_WAIT_MS = 50;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
// The ids of the parts a face says it still shows, as InkScene names them.
const shownParts = value => (Array.isArray(value) ? value.filter(id => typeof id === 'string' && /^p\d{1,6}$/.test(id)).slice(0, 200) : []);
// An area selected on the face with ⌃⌥A, in its display's points, as screen-ink.mjs's focus: plain numbers only.
function selected(value) {
  const finite = (object, keys) => object && keys.every(key => Number.isFinite(object[key]));
  if (!finite(value?.rect, ['x', 'y', 'w', 'h']) || !finite(value?.size, ['width', 'height']) || value.size.width <= 0 || value.size.height <= 0) return null;
  const { x, y, w, h } = value.rect;
  return { rect: { x, y, w, h }, how: value.how === 'circled' ? 'circled' : 'selected', size: { width: value.size.width, height: value.size.height } };
}
// Fairy away from the mini, Away 2: a window on the face's Mac. Opened with the approve key (Touch ID there), for 12 hours
// at most; a call's body is at most 1 MB, an answer over 1 KB is sent gzipped, and events go out at most every 30 ms.
const WINDOW_HOURS = 12, MAX_CALL_BODY = 1024 * 1024, MAX_BYTES_BODY = 60 * 1024 * 1024, GZIP_OVER = 1024, EVENTS_EVERY_MS = 30;
const sameToken = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const failure = (status, message) => Object.assign(new Error(message), { status });
// One Mac at a time shows her and has her window. Another paired Mac takes over only once the one that has her hasn't
// been heard from for this long (it reports every 5 seconds while it's connected), so two Macs don't knock each other
// off in turn. Both using her at once is the link security plan's Link 7.
export const HOLD_MS = 20_000, ELSEWHERE = 'Fairy is on another of your Macs just now. Quit her there, or wait a moment, to use her here.';
// What a failed window call says to the face's window. Her own messages go as they are, with this Mac's home folder
// shortened to ~; an error from the system (a missing file, a refused connection) names paths and addresses of this
// Mac, so it goes as a plain line.
export function shownError(error, home = homedir()) {
  if (typeof error?.syscall === 'string' || (typeof error?.code === 'string' && /^E[A-Z0-9_]+$/.test(error.code) && typeof error?.errno === 'number')) return 'Fairy couldn’t do that on your other Mac.';
  const text = String(error?.message || 'Fairy couldn’t do that.');
  return (home && home.length > 1 ? text.split(home).join('~') : text).slice(0, 2000);
}
const shownApproval = item => ({ id: String(item.id), title: String(item.title || 'Fairy needs your OK'), detail: String(item.command || item.detail || '').slice(0, 600),
  ...(item.macOnly ? { macOnly: true } : {}), ...(item.tooBig ? { tooBig: true } : {}), ...(typeof item.allowLabel === 'string' ? { allowLabel: item.allowLabel.slice(0, 40) } : {}), ...(typeof item.denyLabel === 'string' ? { denyLabel: item.denyLabel.slice(0, 40) } : {}) });

export class FaceLink {
  // ask(text, { signal, onText, onProgress, explain, drawn, focus }) resolves to { text }; explain asks for a drawn answer,
  // drawn is the ids of the parts still showing on the face, so a card closed there isn't drawn again, and focus is an
  // area selected there with ⌃⌥A; stop() stops it; history() is Quick chat's last messages;
  // makeVoice({ signal, emit }) is the phone's ReplyVoice; waiting() is the questions the phone link can answer.
  // onPresence({ activeAgoMs, locked, claim, follow }) gets each of the face's presence reports (step 5).
  // call(channel, args) runs this Mac's own window handler for a window on the face's Mac (Away 2), and serve({ host,
  // path, range }) answers its fairy-artifact: requests, a page's files or an animation, as this Mac's window gets them (Away 3).
  // quiz(observation, signal) is this Mac's own quiz solve, for a question the face recognised (step 8). apps is the
  // user's other apps on the face's Mac (After Away). health() is "Check before you leave" (home-health.mjs) and
  // restart() starts Fairy again here (Fairy away from the mini, Away 1).
  constructor({ ask, stop = () => {}, history = async () => [], makeVoice = null, waiting = () => [], name = () => 'Fairy', onChange = () => {}, onPresence = () => {}, quiz = null, apps = null, claudeSync = null, health = null, restart = null, call = null, serve = null, pickApp = null, windowClosed = () => {}, now = Date.now, uuid = randomUUID, timers = globalThis }) {
    Object.assign(this, { ask, stopAsk: stop, history, makeVoice, waiting, name, onChange, onPresence, quiz, apps, claudeSync, health, restart, call, serve, pickApp, windowClosed, now, uuid, timers });
    // The face's window session (Away 2): { token, device, expires, seq, queue, timer }, or null.
    this.window = null;
    this.quizRun = null;
    this.stream = null; this.turn = null; this.forwarded = new Set();
    // Pictures asked of the face, by id, waiting for its answer (step 6).
    this.pictures = new Map();
    // Browser steps sent to the face's window, by id, waiting for its answer.
    this.browserSteps = new Map();
    // And a Desktop task's steps on the face's screen.
    this.desktopSteps = new Map();
    // Whether the face's Mac shows her now (face-presence.mjs decides, on this Mac).
    this.shownHere = false;
  }
  connected() { return Boolean(this.stream); }

  // Whether this device is the Mac that has her now (or no Mac has).
  holds(device) { return !this.stream || this.stream.device === device?.id; }
  async handle(request, response, { device, pathname, searchParams, link }) {
    if (this.stream && this.stream.device === device?.id) this.stream.heardAt = this.now();
    if (request.method === 'GET' && pathname === '/v1/face/events') return this.open(request, response, device);
    // The user's other apps on the face's Mac (face-apps.mjs): their questions, in their own chats here.
    if (pathname.startsWith('/v1/face/app/') && this.apps) return this.apps.handle(request, response, { pathname, link });
    // Claude sync (claude-sync.mjs): Claude Code's chats and pages, sent from the Mac they're made on.
    if (pathname.startsWith('/v1/face/claude/') && this.claudeSync) return this.claudeSync.handle(request, response, { pathname, link, device });
    if (request.method === 'POST' && pathname === '/v1/face/ask') {
      const { text, explain, drawn, focus, task } = await link.body(request, MAX_BODY);
      if (!this.holds(device)) throw failure(409, ELSEWHERE);
      // task: the companion's Task mode there, a Desktop task on the face's own screen.
      return link.send(response, 200, this.start(text, explain === true ? { explain: true, drawn: shownParts(drawn), focus: selected(focus) } : task === true ? { task: true } : {}, device));
    }
    // How long ago the face's Mac last had input, whether it's locked, and "Bring Fairy here" (step 5).
    if (request.method === 'POST' && pathname === '/v1/face/presence') {
      const { activeAgoMs, locked, claim, follow, ride } = await link.body(request);
      if (!Number.isFinite(activeAgoMs) || activeAgoMs < 0) throw failure(400, 'Say how long ago this Mac was used.');
      if (!this.holds(device)) return link.send(response, 200, { ok: true });
      // ride: the face's Ride along switch and whether she's riding there, so she rides on here when she crosses back.
      const carried = ride && typeof ride.enabled === 'boolean' ? { enabled: ride.enabled, riding: ride.riding === true } : null;
      this.onPresence({ activeAgoMs: Math.min(activeAgoMs, 3_600_000), locked: locked === true, claim: claim === true, ...(follow === 'pointer' || follow === 'manual' ? { follow } : {}), ...(carried ? { ride: carried } : {}) });
      return link.send(response, 200, { ok: true });
    }
    // A picture of the face's screen, or its refusal, answering want-picture.
    if (request.method === 'POST' && pathname === '/v1/face/picture') {
      const body = await link.body(request, MAX_PICTURE_BODY);
      const waiter = this.holds(device) ? this.pictures.get(String(body?.id ?? '')) : null;
      if (!waiter) throw failure(409, 'No picture was asked for.');
      this.pictures.delete(waiter.id);
      if (body.refused === true) waiter.reject(new Error(REFUSALS[body.reason] ?? NOT_SHARING));
      else {
        const { png, width, height, bounds } = body;
        const sized = value => Number.isInteger(value) && value > 0 && value <= 8192;
        const box = bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]));
        if (typeof png !== 'string' || !/^[A-Za-z0-9+/]+=*$/.test(png) || !sized(width) || !sized(height) || !box) { waiter.reject(new Error('The face sent a picture that wasn’t understood.')); throw failure(400, 'That picture wasn’t understood.'); }
        waiter.resolve({ url: `data:image/png;base64,${png}`, width, height, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }, ...(body.read && Array.isArray(body.read.lines) ? { read: body.read } : {}) });
      }
      return link.send(response, 200, { ok: true });
    }
    // A quiz question the face recognised on its own screen (step 8): this Mac's quiz solve answers it, the model's reply
    // goes back, and the face reads the hint from it. One at a time: a newer question replaces the one before.
    if (request.method === 'POST' && pathname === '/v1/face/quiz') {
      if (!this.quiz) throw failure(404, 'Not found.');
      const { observation } = await link.body(request, MAX_PICTURE_BODY);
      if (!observation || typeof observation !== 'object' || Array.isArray(observation) || typeof observation.text !== 'string') throw failure(400, 'That question wasn’t understood.');
      const controller = new AbortController();
      this.quizRun?.abort(new Error('Stopped.'));
      this.quizRun = controller;
      // The face gave up on it (the question changed, or the link dropped): the model call stops too.
      response.on('close', () => { if (!response.writableEnded) controller.abort(new Error('Stopped.')); });
      try {
        const reply = await this.quiz(observation, controller.signal);
        return link.send(response, 200, { reply: typeof reply === 'string' ? reply : typeof reply?.text === 'string' ? reply.text : '' });
      } finally { if (this.quizRun === controller) this.quizRun = null; }
    }
    // "Open my notes app" on the face's companion: which of the face's apps it means (apps.mjs), picked here, where the
    // model and what the user asked Fairy to remember are. Only the apps' cards come; the names picked go back.
    if (request.method === 'POST' && pathname === '/v1/face/app-pick') {
      if (!this.pickApp) throw failure(404, 'Not found.');
      const { asked, apps } = await link.body(request, MAX_PICTURE_BODY);
      const { cleanCard } = await import('./apps.mjs');
      const cards = (Array.isArray(apps) ? apps : []).slice(0, 600).map(cleanCard).filter(Boolean);
      if (typeof asked !== 'string' || !asked.trim() || asked.length > 200 || !cards.length) throw failure(400, 'Say which app and send the apps.');
      const answer = await this.pickApp(asked.trim(), cards);
      return link.send(response, 200, answer?.app ? { app: answer.app.name } : answer?.choices ? { choices: answer.choices.map(card => card.name) } : {});
    }
    // Away 1: whether this Mac will look after itself while you're away, asked for by "Check before you leave".
    if (request.method === 'GET' && pathname === '/v1/face/health') {
      if (!this.health) throw failure(404, 'Not found.');
      return link.send(response, 200, { checks: await this.health() });
    }
    // "Restart Fairy on the other Mac": only with the approve key, which the face sends after Touch ID.
    if (request.method === 'POST' && pathname === '/v1/face/restart') {
      if (!this.restart) throw failure(404, 'Not found.');
      const { approveKey } = await link.body(request);
      if (!link.approves(device, approveKey)) throw failure(403, 'Confirm with Touch ID to restart Fairy there.');
      link.send(response, 200, { ok: true });
      // After the answer has gone, so the face hears it.
      this.timers.setTimeout(() => this.restart(), 300);
      return;
    }
    // Away 2: a window on the face's Mac. Opening it needs the approve key; every call then carries its token.
    if (request.method === 'POST' && pathname === '/v1/face/window') {
      if (!this.call) throw failure(404, 'Not found.');
      const { approveKey } = await link.body(request);
      if (!link.approves(device, approveKey)) throw failure(403, 'Confirm with Touch ID to open Fairy’s window here.');
      if (!this.holds(device)) throw failure(409, ELSEWHERE);
      this.closeWindow();
      const expires = this.now() + WINDOW_HOURS * 3_600_000;
      this.window = { token: randomBytes(32).toString('base64url'), device: device.id, expires, seq: 0, queue: [], timer: null };
      return link.send(response, 200, { token: this.window.token, expires: new Date(expires).toISOString() });
    }
    if (request.method === 'POST' && pathname === '/v1/face/window/close') {
      await link.body(request);
      if (this.windowFor(request, device)) this.closeWindow();
      return link.send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && pathname === '/v1/face/call') return this.windowCall(request, response, device, link);
    // The answer to a desktop step of a task the face's companion started (no window there): only while that task runs.
    if (request.method === 'POST' && pathname === '/v1/face/desktop') {
      if (!this.taskRunning() || !this.asked(device)) throw failure(409, 'No task from this Mac is running.');
      const { id, result, error } = await link.body(request, MAX_DESKTOP_BODY);
      const waiter = this.desktopSteps.get(String(id ?? ''));
      if (!waiter) throw failure(409, 'That step isn’t waiting.');
      if (typeof error === 'string') waiter.reject(new Error(error.slice(0, 2000)));
      else waiter.resolve(result ?? null);
      return link.send(response, 200, { ok: true });
    }
    // The answer to a browser step, from the face's window: { id, result } or { id, error }.
    if (request.method === 'POST' && (pathname === '/v1/face/window/browser' || pathname === '/v1/face/window/desktop')) {
      if (!this.windowFor(request, device)) throw failure(401, 'Open Fairy’s window again to carry on.');
      const desktop = pathname.endsWith('/desktop');
      const { id, result, error } = await link.body(request, desktop ? MAX_DESKTOP_BODY : MAX_BROWSER_BODY);
      const waiter = (desktop ? this.desktopSteps : this.browserSteps).get(String(id ?? ''));
      if (!waiter) throw failure(409, 'That step isn’t waiting.');
      if (typeof error === 'string') waiter.reject(new Error(error.slice(0, 2000)));
      else waiter.resolve(result ?? null);
      return link.send(response, 200, { ok: true });
    }
    // Away 3: a file the face's window asks for at fairy-artifact://page/… or …//anim/…, only while its window is open.
    if (request.method === 'GET' && pathname === '/v1/face/page-file') {
      if (!this.serve) throw failure(404, 'Not found.');
      if (!this.windowFor(request, device)) throw failure(401, 'Open Fairy’s window again to carry on.');
      const host = searchParams.get('host'), path = searchParams.get('path');
      if (!['page', 'anim'].includes(host) || typeof path !== 'string' || !path.startsWith('/') || path.length > 2000) throw failure(400, 'That file wasn’t understood.');
      const { status, headers, body } = await this.serve({ host, path, range: request.headers.range });
      // A video's range, streamed from the file as it goes (artifacts.serve); the face's window stops it by closing.
      if (typeof body?.pipe === 'function') {
        const own = Object.fromEntries(Object.entries(headers || {}).filter(([name]) => !/^(transfer-encoding|connection)$/i.test(name)));
        response.writeHead(status, { ...HEADERS, ...own });
        response.on('close', () => body.destroy());
        body.on('error', () => response.destroy());
        body.pipe(response);
        return;
      }
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ''));
      // The file's own length header is dropped for this one: Node's client refuses an answer with two, which kept every
      // video, picture and poster a page asked for from reaching the face's window.
      const own = Object.fromEntries(Object.entries(headers || {}).filter(([name]) => !/^(content-length|transfer-encoding|connection)$/i.test(name)));
      response.writeHead(status, { ...HEADERS, ...own, 'Content-Length': bytes.length });
      response.end(bytes);
      return;
    }
    // Stopping a turn, and her voice for it, are for the Mac that asked it.
    if (request.method === 'POST' && pathname === '/v1/face/stop') { await link.body(request); if (this.asked(device)) this.stopTurn(); return link.send(response, 200, { ok: true }); }
    if (request.method === 'GET' && pathname === '/v1/face/history') return link.send(response, 200, { name: String(this.name() || 'Fairy'), history: await this.history() });
    if (request.method === 'GET' && pathname === '/v1/face/voice') {
      const turn = this.asked(device) ? this.turn : null, index = Number(searchParams.get('part'));
      const part = turn && turn.id === searchParams.get('turn') && Number.isInteger(index) ? turn.parts[index] : null;
      if (!part) return link.send(response, 404, { error: 'That clip isn’t ready.' });
      response.writeHead(200, { ...HEADERS, 'Content-Type': 'audio/mpeg', 'Content-Length': part.bytes.length, 'X-Fairy-Pause-Before': String(part.pauseBeforeMs) });
      response.end(part.bytes);
      return;
    }
    return link.send(response, 404, { error: 'Not found.' });
  }

  // Whether the turn (running or last) is this device's.
  asked(device) { return !this.turn || this.turn.device == null || this.turn.device === device?.id; }
  // One stream: the same Mac's new one replaces its old one. Another Mac's is refused while the Mac that has her is
  // still being heard from; once it isn't, the other takes over, and the first's window session ends.
  open(request, response, device) {
    if (this.stream && this.stream.device !== device.id) {
      if (this.now() - this.stream.heardAt < HOLD_MS) throw failure(409, ELSEWHERE);
      if (this.window && this.window.device !== device.id) this.closeWindow();
    }
    this.closeStream();
    request.socket.setTimeout(0);
    response.writeHead(200, { ...HEADERS, 'Content-Type': 'text/event-stream; charset=utf-8' });
    const stream = { response, device: device.id, heardAt: this.now(), ping: this.timers.setInterval(() => response.write(': still here\n\n'), PING_EVERY_MS) };
    stream.ping.unref?.();
    this.stream = stream;
    response.on('close', () => { if (this.stream === stream) { this.timers.clearInterval(stream.ping); this.stream = null; this.shownHere = false; for (const waiter of [...this.pictures.values()]) waiter.reject(new Error(NOT_SHARING)); this.endBrowserSteps(); this.endDesktopSteps(); this.onChange(); } });
    const turn = this.turn?.running ? { id: this.turn.id, text: this.turn.text } : null;
    const approvals = this.listed().map(shownApproval);
    for (const item of approvals) this.forwarded.add(item.id);
    this.emit('hello', { name: String(this.name() || 'Fairy'), turn, approvals, show: this.shownHere });
    this.onChange();
  }
  closeStream() {
    const stream = this.stream;
    if (!stream) return;
    this.stream = null; this.timers.clearInterval(stream.ping); stream.response.destroy();
  }
  // The device was removed on this Mac.
  forget(device) { if (this.stream?.device === device) { this.closeStream(); this.onChange(); } }
  close() { this.closeStream(); this.turn?.controller.abort(); }
  emit(type, data) { this.stream?.response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
  listed() { try { return this.waiting() ?? []; } catch { return []; } }

  start(text, { explain = false, drawn = [], focus = null, task = false } = {}, device = null) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) throw failure(400, 'Enter a message of 1–12,000 characters.');
    if (this.turn?.running) throw failure(409, 'Fairy is still answering. Stop her or wait a moment.');
    // A new turn drops the last one's voice.
    this.turn?.controller.abort();
    const turn = { id: this.uuid(), device: device?.id ?? null, controller: new AbortController(), running: true, task: task === true, text: '', parts: [], size: 0, voiceDone: false, voiceFailed: '', sentAt: 0, timer: null };
    this.turn = turn;
    void this.run(turn, text.trim(), { explain, drawn, focus, task: turn.task });
    return { turn: turn.id };
  }
  async run(turn, text, { explain = false, drawn = [], focus = null, task = false } = {}) {
    const { signal } = turn.controller;
    const voice = this.makeVoice ? this.makeVoice({ signal, emit: part => this.addPart(turn, part) }) : null;
    try {
      // becomeTask(): a question that turned into a Desktop task on the face's screen (core.mjs DESKTOP_MARKER), whose
      // steps may then go to the face with no window open, as a task from its Task mode's do.
      const reply = await this.ask(text, { signal, becomeTask: () => { turn.task = true; }, ...(explain ? { explain: true, drawn, focus } : task ? { task: true } : {}),
        onText: value => { if (typeof value !== 'string' || signal.aborted) return; turn.text = value; voice?.update(value); this.textSoon(turn); },
        onProgress: value => { if (!signal.aborted) this.emit('progress', { turn: turn.id, text: String(value ?? '').slice(0, 200) }); } });
      if (signal.aborted) throw new Error('Stopped.');
      turn.text = String(reply?.text ?? '');
      this.flushText(turn);
      turn.running = false;
      if (turn.task) this.endDesktopSteps();
      this.emit('done', { turn: turn.id, text: turn.text });
      if (voice) { turn.voiceFailed = (await voice.finish(turn.text)) || ''; turn.voiceDone = true; this.voiceNews(turn); }
    } catch (error) {
      turn.running = false; voice?.cancel(); this.timers.clearTimeout(turn.timer);
      if (turn.task) this.endDesktopSteps();
      this.emit('failed', { turn: turn.id, message: signal.aborted ? 'Stopped.' : String(error?.message || 'Fairy couldn’t answer.') });
    }
  }
  stopTurn() {
    const turn = this.turn;
    if (!turn) return;
    if (turn.running) this.stopAsk();
    turn.controller.abort();
  }
  // The whole reply so far, at most ten times a second, and always the last.
  textSoon(turn) {
    if (turn.timer) return;
    const wait = Math.max(0, turn.sentAt + TEXT_EVERY_MS - this.now());
    turn.timer = this.timers.setTimeout(() => { turn.timer = null; this.flushText(turn); }, wait);
  }
  flushText(turn) {
    if (turn.timer) { this.timers.clearTimeout(turn.timer); turn.timer = null; }
    turn.sentAt = this.now();
    if (this.turn === turn) this.emit('text', { turn: turn.id, text: turn.text });
  }
  addPart(turn, part) {
    if (this.turn !== turn || !part?.bytes?.length) return;
    if (turn.parts.length >= MAX_PARTS || turn.size + part.bytes.length > MAX_VOICE_BYTES) { turn.controller.abort(); return; }
    turn.size += part.bytes.length;
    turn.parts.push({ bytes: Buffer.from(part.bytes), pauseBeforeMs: Math.max(0, Math.round(Number(part.pauseBeforeMs) || 0)) });
    this.voiceNews(turn);
  }
  voiceNews(turn) {
    if (this.turn === turn) this.emit('voice', { turn: turn.id, parts: turn.parts.length, done: turn.voiceDone, ...(turn.voiceFailed ? { failed: turn.voiceFailed } : {}) });
  }

  // A question that needs an OK, as the companion is shown it. Only the ones the phone link can answer (a work
  // session's) reach a face, with the phone link's own word on whether a Mac or phone may allow them.
  approval(value) {
    if (!value?.id) return;
    const id = String(value.id);
    if (value.closed) { if (this.forwarded.delete(id)) this.emit('approval-closed', { id }); return; }
    // The question is listed a moment after it's shown.
    this.timers.setTimeout(() => {
      const item = this.listed().find(entry => String(entry.id) === id);
      if (!item || this.forwarded.has(id)) return;
      this.forwarded.add(id);
      this.emit('approval', shownApproval({ ...item, title: value.title || item.title, detail: value.detail || item.command || item.detail }));
    }, LISTED_WAIT_MS);
  }
  // One picture of the face's screen, asked for during a turn the face started (step 6), and only then: a request made on
  // this Mac or on the phone never reaches the face's screen. The face may refuse, saying why, and after 30 seconds this gives up.
  // Resolves { url, width, height, bounds, read? }; the picture is kept in memory only.
  picture(purpose = 'look', { signal } = {}) {
    if (!this.stream || !this.turn?.running) return Promise.reject(new Error(NOT_SHARING));
    const id = this.uuid();
    return new Promise((resolve, reject) => {
      const end = () => { this.timers.clearTimeout(timer); signal?.removeEventListener('abort', stopped); this.pictures.delete(id); };
      const waiter = { id, resolve: value => { end(); resolve(value); }, reject: error => { end(); reject(error); } };
      const timer = this.timers.setTimeout(() => waiter.reject(new Error(TOO_SLOW)), PICTURE_WAIT_MS);
      const stopped = () => waiter.reject(new Error('Stopped.'));
      signal?.addEventListener('abort', stopped, { once: true });
      this.pictures.set(id, waiter);
      this.emit('want-picture', { id, purpose: String(purpose).slice(0, 40) });
    });
  }
  // Show her on the face's Mac, or not; ride is this Mac's Ride along switch and whether she was riding, so she rides on there.
  show(on, { ride = null } = {}) { on = Boolean(on); if (this.shownHere === on) return; this.shownHere = on; this.emit('show', { on, ...(on && ride ? { ride } : {}) }); }
  // Away 2: the face's window session this request belongs to, if its token is live and it's this device's.
  windowFor(request, device) {
    const open = this.window, token = request.headers['x-fairy-window'];
    if (!open || open.device !== device.id || this.now() >= open.expires || !sameToken(token, open.token)) return null;
    return open;
  }
  // A window session ends (closed, or replaced by a new one): what it opened on this Mac, its terminals, ends with it.
  // A task the companion there started carries on without the window.
  closeWindow() { const open = this.window; if (!open) return; this.timers.clearTimeout(open.timer); this.window = null; this.endBrowserSteps(); if (!this.taskRunning()) this.endDesktopSteps(); this.windowClosed(); }
  // A Desktop task the face's companion started, running now.
  taskRunning() { return Boolean(this.stream && this.turn?.running && this.turn.task); }
  // One step in the browser of the face's window, for a turn started there: sent down the stream as browser-step and
  // answered at /v1/face/window/browser. Stopping the turn tells the face to stop the step.
  browserStep(tool, args = {}, { signal } = {}) {
    return this.windowStep({ event: 'browser-step', waiters: this.browserSteps, gone: BROWSER_GONE, slow: 'Your MacBook’s browser took too long to answer.', wait: BROWSER_WAIT_MS }, tool, args, signal);
  }
  endBrowserSteps() { for (const waiter of [...this.browserSteps.values()]) waiter.reject(new Error(BROWSER_GONE)); }
  // One step of a Desktop task on the face's own screen (remote-screen.mjs), for a turn started in its window or a task
  // its companion started: sent as desktop-step and answered at /v1/face/window/desktop, or /v1/face/desktop for the
  // companion's. A question there waits for the user, so the wait is long.
  desktopStep(tool, args = {}, { signal } = {}) {
    return this.windowStep({ event: 'desktop-step', waiters: this.desktopSteps, gone: DESKTOP_GONE, slow: 'Your MacBook took too long to answer.', wait: DESKTOP_WAIT_MS, task: true }, tool, args, signal);
  }
  endDesktopSteps() { for (const waiter of [...this.desktopSteps.values()]) waiter.reject(new Error(DESKTOP_GONE)); }
  windowStep({ event, waiters, gone, slow, wait, task = false }, tool, args, signal) {
    const windowOpen = this.window && this.stream && this.now() < this.window.expires;
    if (!windowOpen && !(task && this.taskRunning())) return Promise.reject(new Error(gone));
    const id = this.uuid();
    return new Promise((resolve, reject) => {
      const end = () => { this.timers.clearTimeout(timer); signal?.removeEventListener?.('abort', stopped); waiters.delete(id); };
      const waiter = { resolve: value => { end(); resolve(value); }, reject: error => { end(); reject(error); } };
      const timer = this.timers.setTimeout(() => waiter.reject(new Error(slow)), wait);
      const stopped = () => { this.emit(`${event}-stop`, { id }); waiter.reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' })); };
      if (signal?.aborted) { end(); return reject(Object.assign(new Error('Stopped.'), { name: 'AbortError' })); }
      signal?.addEventListener?.('abort', stopped, { once: true });
      waiters.set(id, waiter);
      // via: 'turn' for a step of the face's own task (answered at /v1/face/desktop), 'window' for its window's.
      this.emit(event, { id, tool: String(tool), args: args && typeof args === 'object' ? args : {}, via: task && this.taskRunning() ? 'turn' : 'window' });
    });
  }
  // One call from the face's window: only a Remote channel, run by this Mac's own handler with the same arguments.
  async windowCall(request, response, device, link) {
    if (!this.call) throw failure(404, 'Not found.');
    if (!this.windowFor(request, device)) throw failure(401, 'Open Fairy’s window again to carry on.');
    // A recording or a file (Away 4) says so, and may be bigger; it must then be one of the channels that carry one.
    // The header also names the channel, so a big body for a channel that carries none is refused before it's read.
    const carriesBytes = request.headers['x-fairy-bytes'] === '1', named = String(request.headers['x-fairy-channel'] ?? '');
    if (carriesBytes && !BYTE_CHANNELS.includes(named)) throw failure(413, 'That’s too big to send.');
    const body = await link.body(request, carriesBytes ? MAX_BYTES_BODY : MAX_CALL_BODY);
    const channel = String(body?.channel ?? '');
    if (kindOf(channel) !== 'remote') throw failure(403, 'Do this on your other Mac.');
    if (carriesBytes && channel !== named) throw failure(413, 'That’s too big to send.');
    let args;
    try { args = Array.isArray(body?.args) ? decode(body.args) : []; } catch { throw failure(400, 'That call wasn’t understood.'); }
    if (NEEDS_APPROVAL[channel]?.(args) && !link.approves(device, body.approveKey)) throw failure(403, 'Confirm with Touch ID to allow this.');
    let answer;
    try { answer = { result: encode(await this.call(channel, args)) }; }
    catch (error) { answer = { error: shownError(error) }; }
    const json = Buffer.from(JSON.stringify(answer));
    // Bigger answers (a long chat's state) go gzipped when the face says it can take them.
    if (json.length > GZIP_OVER && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) {
      const packed = gzipSync(json);
      response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', 'Content-Length': packed.length });
      response.end(packed);
      return;
    }
    response.writeHead(200, { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': json.length });
    response.end(json);
  }
  // What this Mac's window is sent, passed on to the face's window while it's open: the window's own events only, in order,
  // gathered into one numbered batch every 30 ms, so the face can tell when one was missed.
  windowEvent(channel, value) {
    const open = this.window;
    if (!open || this.now() >= open.expires || !WINDOW_EVENTS.includes(channel)) return;
    // Away 5: with the link down the event is lost, so the numbering skips one: the face sees the gap when it's back
    // and fetches the state afresh.
    if (!this.stream) { if (!open.missed) { open.missed = true; open.seq += 1; } return; }
    open.missed = false;
    // A terminal's output in pieces goes as one, so a busy shell sends one string per batch.
    const last = open.queue.at(-1);
    // The Simulator's frames: only the newest in a batch goes, and none while the link is still sending earlier ones.
    if (channel === 'simulator-frame') {
      if ((this.stream.response?.writableLength ?? 0) > FRAME_BACKLOG) return;
      const queued = open.queue.findIndex(([name]) => name === 'simulator-frame');
      if (queued >= 0) open.queue.splice(queued, 1);
    }
    if (channel === 'terminal-data' && last?.[0] === 'terminal-data' && last[1]?.id === value?.id && typeof value?.data === 'string') { last[1] = { ...last[1], data: last[1].data + value.data }; return; }
    let carried;
    try { carried = encode(value); } catch { return; }
    open.queue.push([channel, carried]);
    if (open.timer) return;
    open.timer = this.timers.setTimeout(() => {
      open.timer = null;
      if (this.window !== open || !open.queue.length) return;
      const events = open.queue.splice(0);
      this.emit('window', { seq: ++open.seq, events });
    }, EVENTS_EVERY_MS);
  }
  // Away 4: a notification this Mac shows ("Fairy needs your OK", a finished task), shown on the face's Mac too while
  // its window is open.
  notice({ title, body } = {}) {
    if (!this.window || !this.stream || this.now() >= this.window.expires || !title) return;
    this.emit('notice', { title: String(title).slice(0, 200), body: String(body ?? '').slice(0, 500) });
  }
  // A drawing for the face's screen, or { clear: true } to wipe it (step 7). Only while the face's own turn is running,
  // or to clear: nothing asked here or on the phone draws on the face.
  ink(value) {
    if (value?.clear === true) return this.emit('ink', { clear: true });
    if (this.turn?.running && value?.state) this.emit('ink', { id: this.turn.id, state: value.state });
  }
  // Something she says unasked, only while she's shown on the face's Mac.
  say(text) { if (this.shownHere && typeof text === 'string' && text.trim()) this.emit('say', { text: text.slice(0, 4000) }); }
}
