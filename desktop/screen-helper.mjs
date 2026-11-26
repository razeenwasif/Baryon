import { spawn } from 'node:child_process';

// Efficiency audit, fix 7: one fairy-screen process takes every picture of the screen, instead of a new process each
// time. It answers each request with a line of JSON and then, if the screen changed, the PNG's bytes, so a picture
// never travels as text; if nothing changed it says so, and the last picture is used again (the same pixels make the
// same PNG). It stops after a minute with nothing to take, and starts again for the next picture.
export const SCREEN_TIMEOUT_MS = 6000, SCREEN_IDLE_MS = 60000;

// Efficiency audit, fix 8B: keep the raw PNG bytes of the latest capture beside its URL so quiz OCR
// can hand the PNG straight to the helper without base64-encoding or decoding on every frame.
let latestPicture = null;
export const picturePng = snapshot => Buffer.isBuffer(snapshot?.png) ? snapshot.png
  : (snapshot?.url && latestPicture?.url === snapshot.url ? latestPicture.png : null);

// Lines and byte runs from a stream of chunks, joining chunks only once a whole answer has arrived.
class Frames {
  constructor() { this.chunks = []; this.length = 0; }
  push(chunk) { this.chunks.push(chunk); this.length += chunk.length; }
  take(count) {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks, this.length);
    const taken = all.subarray(0, count), rest = all.subarray(count);
    this.chunks = rest.length ? [rest] : []; this.length = rest.length;
    return taken;
  }
  line() {
    for (let i = 0, seen = 0; i < this.chunks.length; seen += this.chunks[i].length, i += 1) {
      const end = this.chunks[i].indexOf(10);
      if (end >= 0) { const line = this.take(seen + end + 1); return line.subarray(0, line.length - 1).toString('utf8'); }
    }
    return null;
  }
}

export class ScreenHelper {
  constructor({ path, spawnProcess = spawn, timeoutMs = SCREEN_TIMEOUT_MS, idleMs = SCREEN_IDLE_MS, schedule = setTimeout, clear = clearTimeout }) {
    Object.assign(this, { path, spawnProcess, timeoutMs, idleMs, schedule, clear });
    this.child = null; this.waiting = new Map(); this.sequence = 0; this.last = null; this.idleTimer = null;
  }
  get running() { return Boolean(this.child); }
  start() {
    if (this.child) return this.child;
    const child = this.spawnProcess(this.path, ['--serve'], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child; this.last = null;
    const frames = new Frames();
    let header = null;
    child.stdout.on('data', chunk => {
      frames.push(chunk);
      for (;;) {
        if (!header) {
          const line = frames.line();
          if (line === null) return;
          try { header = JSON.parse(line); } catch { continue; }
        }
        const bytes = Number.isInteger(header.bytes) && header.bytes > 0 ? header.bytes : 0;
        if (frames.length < bytes) return;
        const body = bytes ? frames.take(bytes) : null, answer = header;
        header = null;
        if (this.child === child) this.answer(answer, body);
      }
    });
    // Its messages may name windows on screen, so they aren't kept.
    child.stderr?.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', error => this.stopped(child, new Error(error.code === 'ENOENT' ? 'Build the macOS helper first: npm run build:screen' : error.message)));
    child.on('close', () => this.stopped(child, new Error('The screen helper stopped before answering.')));
    return child;
  }
  stopped(child, error) {
    if (this.child !== child) return;
    if (latestPicture && this.last?.picture?.url === latestPicture.url) latestPicture = null;
    this.child = null; this.last = null; this.cancelIdle();
    for (const waiter of this.waiting.values()) waiter.reject(error);
    this.waiting.clear();
  }
  answer(header, body) {
    // A picture is kept even when nobody waits for it any more, so an "unchanged" that follows still has it.
    if (body) {
      const picture = { url: `data:image/png;base64,${body.toString('base64')}`, width: header.width, height: header.height };
      this.last = { id: header.id, picture };
      latestPicture = { url: picture.url, png: body };
    }
    const waiter = this.waiting.get(header.id);
    if (!waiter) return;
    this.waiting.delete(header.id);
    if (header.error) waiter.reject(new Error(String(header.error).slice(0, 300)));
    else if (body) waiter.resolve(this.last.picture);
    else if (header.unchanged && this.last?.id === header.sameAs) waiter.resolve(this.last.picture);
    else waiter.resolve(null);
  }
  // A picture of the screen: { url, width, height }.
  async capture(payload, signal) {
    signal?.throwIfAborted();
    try {
      // null: the helper says nothing changed, but the picture it means isn't the one kept here, so ask for a new one.
      return await this.request(payload, signal) ?? await this.request({ ...payload, force: 1 }, signal);
    } finally { this.idle(); }
  }
  request(payload, signal) {
    return new Promise((resolve, reject) => {
      const child = this.start(), id = ++this.sequence;
      this.cancelIdle();
      const done = () => { this.clear(timer); signal?.removeEventListener('abort', abort); };
      // Taking a picture is normally about a second, and now and then macOS never answers: a new helper takes the next.
      const timer = this.schedule(() => { this.waiting.delete(id); signal?.removeEventListener('abort', abort); reject(new Error('Taking a picture of the screen timed out.')); this.restart(child); }, this.timeoutMs);
      const abort = () => { this.waiting.delete(id); done(); reject(signal.reason ?? new Error('Stopped.')); };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.set(id, { resolve: value => { done(); resolve(value); }, reject: error => { done(); reject(error); } });
      child.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    });
  }
  restart(child) { if (this.child === child) { this.stopped(child, new Error('Taking a picture of the screen timed out.')); child.kill(); } }
  idle() {
    this.cancelIdle();
    if (!this.child || this.waiting.size) return;
    this.idleTimer = this.schedule(() => { this.idleTimer = null; if (!this.waiting.size) this.stop(); }, this.idleMs);
    this.idleTimer?.unref?.();
  }
  cancelIdle() { if (this.idleTimer !== null) this.clear(this.idleTimer); this.idleTimer = null; }
  // Closing its input ends the helper once it has answered what it was asked.
  stop() { const child = this.child; if (!child) return; this.stopped(child, new Error('The screen helper was stopped.')); child.stdin.end(); }
  dispose() { const child = this.child; this.stop(); child?.kill(); }
}
