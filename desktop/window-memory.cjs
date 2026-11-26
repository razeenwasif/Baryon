// Dynamic Chromium memory & frame-throttling manager for Fairy's main frameless window.
// When the window is covered, minimized, on another Space, or hidden via CompanionVisibility,
// background throttling is enabled immediately and GPU/compositor layers (plus hidden views)
// are reclaimed after reclaimMs. Returning to view restores rendering and invalidates immediately.
class WindowMemory {
  constructor({ window, reclaimMs = 15_000, schedule = setTimeout, clear = clearTimeout, onReclaim = () => {}, onRestore = () => {} }) {
    Object.assign(this, { window, reclaimMs, schedule, clear, onReclaim, onRestore });
    this.visible = true;
    this.reclaimed = false;
    this.timer = null;
    this.disposed = false;
  }

  alive() {
    return !this.disposed && Boolean(this.window) && !this.window.isDestroyed();
  }

  cancel() {
    if (this.timer !== null) {
      this.clear(this.timer);
      this.timer = null;
    }
  }

  sendIdle(idle) {
    if (!this.alive()) return;
    this.window.webContents?.send?.('fairy:memory-idle', idle);
  }

  setVisible(visible) {
    if (this.disposed) return;
    const next = Boolean(visible);
    if (next === this.visible) return;
    this.visible = next;
    if (!this.alive()) {
      this.cancel();
      return;
    }
    if (!next) {
      this.window.webContents?.setBackgroundThrottling?.(true);
      this.cancel();
      this.timer = this.schedule(() => {
        this.timer = null;
        if (this.visible || !this.alive()) return;
        this.reclaimed = true;
        this.sendIdle(true);
        this.onReclaim();
      }, this.reclaimMs);
      this.timer?.unref?.();
      return;
    }
    this.cancel();
    this.window.webContents?.setBackgroundThrottling?.(false);
    if (this.reclaimed) {
      this.reclaimed = false;
      this.sendIdle(false);
      this.onRestore();
    }
    this.window.webContents?.invalidate?.();
  }

  dispose() {
    this.disposed = true;
    this.cancel();
  }
}

module.exports = { WindowMemory };
