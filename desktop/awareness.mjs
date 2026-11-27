// One replaceable screenshot in memory. Late captures cannot revive a paused cache.
export class ScreenAwareness {
  constructor({ capture, allowed, now = Date.now, changed = () => {} }) {
    Object.assign(this, { capture, allowed, now, changed });
    this.epoch = 0; this.displayId = null; this.image = null; this.pending = null;
  }
  clear() { this.epoch++; this.image = null; this.changed(); }
  select(displayId) { if (this.displayId !== displayId) { this.displayId = displayId; this.clear(); } }
  async fresh(signal, maxAge = 5000) {
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
    try { await this.pending; signal?.throwIfAborted(); return this.image.value; }
    finally { this.pending = null; }
  }
}
