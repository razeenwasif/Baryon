import { joinDelay } from './speech-audio.js';
import type { SpeechJoinCurrent, SpeechJoinPrevious } from './speech-audio.js';

export interface ReplyAudioPart extends SpeechJoinCurrent {
  sequence: number;
  bytes?: ArrayBufferView | ArrayBuffer | { byteLength?: number; length?: number } | null;
  trailingMs?: number;
}

export interface ReplyAudioQueueEntry<TPart extends ReplyAudioPart = ReplyAudioPart, TPrepared extends ReplyAudioPart = TPart> {
  part: TPart | null;
  bytes: number;
  prepared: Promise<TPrepared | null> | null;
}

export interface ReplyAudioOptions<TPart extends ReplyAudioPart = ReplyAudioPart, TPrepared extends ReplyAudioPart = TPart> {
  play: (part: TPrepared) => Promise<unknown> | unknown;
  allowed: () => boolean;
  prepare?: (part: TPart) => Promise<TPrepared> | TPrepared;
  now?: () => number;
  maxBytes?: number;
  maxParts?: number;
}

// Keep at most the playing clip and one decoded clip ahead. The remaining
// compressed audio has explicit limits; a runaway stream fails visibly.
export class ReplyAudio<TPart extends ReplyAudioPart = ReplyAudioPart, TPrepared extends ReplyAudioPart = TPart> {
  play: (part: TPrepared) => Promise<unknown> | unknown;
  allowed: () => boolean;
  prepare: (part: TPart) => Promise<TPrepared> | TPrepared;
  now: () => number;
  maxBytes: number;
  maxParts: number;
  queue: Array<ReplyAudioQueueEntry<TPart, TPrepared>>;
  bytes: number;
  last: number;
  cancelled: boolean;
  error: unknown;
  preparedCount: number;
  chain: Promise<void>;
  running: boolean;
  waiters: Set<(value: null) => void>;
  previous: SpeechJoinPrevious | null | undefined;
  timer: ReturnType<typeof setTimeout> | null | undefined;

  constructor({
    play,
    allowed,
    prepare = async part => part as unknown as TPrepared,
    now = () => performance.now(),
    maxBytes = 32 * 1024 * 1024,
    maxParts = 128,
  }: ReplyAudioOptions<TPart, TPrepared>) {
    this.play = play;
    this.allowed = allowed;
    this.prepare = prepare;
    this.now = now;
    this.maxBytes = maxBytes;
    this.maxParts = maxParts;
    this.queue = [];
    this.bytes = 0;
    this.last = -1;
    this.cancelled = false;
    this.error = null;
    this.preparedCount = 0;
    this.chain = Promise.resolve();
    this.running = false;
    this.waiters = new Set();
    this.previous = null;
    this.timer = null;
  }
  push(part: TPart): void {
    if (this.cancelled || this.error || part.sequence <= this.last) return;
    if (!this.allowed()) { this.cancel(); return; }
    const rawBytes = part.bytes as { byteLength?: number; length?: number } | null | undefined;
    const bytes = rawBytes?.byteLength ?? rawBytes?.length ?? 0;
    if (this.queue.length >= this.maxParts || this.bytes + bytes > this.maxBytes) {
      this.error = new Error('Voice queue reached its memory limit. The full reply is still available as text.');
      this.cancel(); return;
    }
    this.last = part.sequence; this.bytes += bytes;
    this.queue.push({ part, bytes, prepared: null });
    this.prefetch();
    this.startPump();
  }
  startPump(): void {
    if (this.running || this.cancelled) return;
    this.running = true;
    this.chain = this.pump().catch(error => { this.error = error; this.cancel(); }).finally(() => {
      this.running = false; if (this.queue.length && !this.cancelled) this.startPump();
    });
  }
  prefetch(): void {
    for (const entry of this.queue) {
      if (this.preparedCount >= 2 || this.cancelled) return;
      if (entry.prepared) continue;
      this.preparedCount++;
      entry.prepared = Promise.resolve().then(async () => {
        if (this.cancelled || !this.allowed()) return null;
        const part = entry.part!; entry.part = null;
        const ready = await this.prepare(part);
        return this.cancelled || !this.allowed() ? null : ready;
      }).catch(error => { this.error = error; this.cancel(); return null; });
    }
  }
  async waitFor<T>(promise: Promise<T>): Promise<T | null> {
    if (this.cancelled) return null;
    let wake!: (value: null) => void;
    const stopped = new Promise<null>(resolve => { wake = resolve; this.waiters.add(wake); });
    try { return await Promise.race([promise, stopped]); }
    finally { this.waiters.delete(wake); }
  }
  async pump(): Promise<void> {
    while (this.queue.length && !this.cancelled) {
      if (!this.allowed()) { this.cancel(); break; }
      const entry = this.queue[0];
      let ready = entry.prepared ? await this.waitFor(entry.prepared) : null;
      if (!ready || this.cancelled || !this.allowed()) { this.cancel(); break; }
      const delay = joinDelay(ready, this.previous, this.now());
      if (delay) await this.waitFor(new Promise<void>(resolve => { this.timer = setTimeout(resolve, delay); }));
      if (this.timer != null) clearTimeout(this.timer);
      this.timer = null;
      if (this.cancelled || !this.allowed()) { ready = null; this.cancel(); break; }
      await this.waitFor(Promise.resolve(this.play(ready)));
      if (this.cancelled) break;
      this.previous = { endedAt: this.now(), trailingMs: ready.trailingMs || 0 };
      ready = null; entry.prepared = null; this.queue.shift(); this.bytes -= entry.bytes; this.preparedCount--;
      this.prefetch();
    }
  }
  async finish(): Promise<void> { while (this.running) await this.chain; if (this.error) throw this.error; }
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    if (this.timer != null) clearTimeout(this.timer);
    this.timer = null;
    for (const wake of this.waiters) wake(null);
    this.waiters.clear();
    for (const entry of this.queue) { entry.part = null; entry.prepared = null; }
    this.queue.length = 0; this.bytes = 0; this.preparedCount = 0; this.previous = null;
  }
}
