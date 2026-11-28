// One replaceable screenshot in memory. Late captures cannot revive a paused cache.
export type ScreenDisplayId = string | number | null;

export interface ScreenAwarenessOptions<T = unknown> {
  capture: (displayId: ScreenDisplayId) => Promise<T>;
  allowed: () => boolean;
  now?: () => number;
  changed?: () => void;
}

interface CachedImage<T> {
  value: T;
  at: number;
}

export class ScreenAwareness<T = unknown> {
  capture: (displayId: ScreenDisplayId) => Promise<T>;
  allowed: () => boolean;
  now: () => number;
  changed: () => void;
  epoch: number;
  displayId: ScreenDisplayId;
  image: CachedImage<T> | null;
  pending: Promise<void> | null;

  constructor({ capture, allowed, now = Date.now, changed = () => {} }: ScreenAwarenessOptions<T>) {
    this.capture = capture;
    this.allowed = allowed;
    this.now = now;
    this.changed = changed;
    this.epoch = 0; this.displayId = null; this.image = null; this.pending = null;
  }
  clear(): void { this.epoch++; this.image = null; this.changed(); }
  select(displayId: ScreenDisplayId): void { if (this.displayId !== displayId) { this.displayId = displayId; this.clear(); } }
  async fresh(signal?: AbortSignal | null, maxAge = 5000): Promise<T> {
    signal?.throwIfAborted();
    if (!this.allowed()) { this.clear(); throw new Error('Screen awareness is paused.'); }
    if (this.image && this.now() - this.image.at < maxAge) return this.image.value;
    if (this.pending) { await this.pending; signal?.throwIfAborted(); return this.fresh(signal, maxAge); }
    const token = this.epoch;
    this.pending = (async () => {
      const value = await this.capture(this.displayId);
      if (token !== this.epoch || !this.allowed()) throw new Error('Screen awareness changed during capture.');
      this.image = { value, at: this.now() }; this.changed();
    })();
    try { await this.pending; signal?.throwIfAborted(); return this.image!.value; }
    finally { this.pending = null; }
  }
}
