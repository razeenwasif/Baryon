// Dynamic Chromium memory & frame-throttling manager for Fairy's main frameless window.
// When the window is covered, minimized, on another Space, or hidden via CompanionVisibility,
// background throttling is enabled immediately and GPU/compositor layers (plus hidden views)
// are reclaimed after reclaimMs. Returning to view restores rendering and invalidates immediately.
interface WindowMemoryWebContents {
  send?: (channel: string, ...args: unknown[]) => void;
  setBackgroundThrottling?: (allowed: boolean) => void;
  invalidate?: () => void;
}

interface WindowMemoryTarget {
  isDestroyed(): boolean;
  webContents?: WindowMemoryWebContents;
}

interface WindowMemoryTimer {
  unref?: () => unknown;
}

type WindowMemoryTimerHandle = ReturnType<typeof setTimeout> | WindowMemoryTimer | number;

interface WindowMemoryOptions {
  window: WindowMemoryTarget | null;
  reclaimMs?: number;
  schedule?: (fn: () => void, ms: number) => WindowMemoryTimerHandle;
  clear?: (timer: any) => void;
  onReclaim?: () => void;
  onRestore?: () => void;
}

class WindowMemory {
  window: WindowMemoryTarget | null;
  reclaimMs: number;
  schedule: (fn: () => void, ms: number) => WindowMemoryTimerHandle;
  clear: (timer: any) => void;
  onReclaim: () => void;
  onRestore: () => void;
  visible = true;
  reclaimed = false;
  timer: WindowMemoryTimerHandle | null = null;
  disposed = false;

  constructor({ window, reclaimMs = 15_000, schedule = setTimeout, clear = clearTimeout, onReclaim = () => {}, onRestore = () => {} }: WindowMemoryOptions) {
    this.window = window;
    this.reclaimMs = reclaimMs;
    this.schedule = schedule;
    this.clear = clear;
    this.onReclaim = onReclaim;
    this.onRestore = onRestore;
  }

  alive(): boolean {
    return !this.disposed && Boolean(this.window) && !this.window!.isDestroyed();
  }

  cancel(): void {
    if (this.timer !== null) {
      this.clear(this.timer);
      this.timer = null;
    }
  }

  sendIdle(idle: boolean): void {
    if (!this.alive()) return;
    this.window!.webContents?.send?.('fairy:memory-idle', idle);
  }

  setVisible(visible: unknown): void {
    if (this.disposed) return;
    const next = Boolean(visible);
    if (next === this.visible) return;
    this.visible = next;
    if (!this.alive()) {
      this.cancel();
      return;
    }
    if (!next) {
      this.window!.webContents?.setBackgroundThrottling?.(true);
      this.cancel();
      this.timer = this.schedule(() => {
        this.timer = null;
        if (this.visible || !this.alive()) return;
        this.reclaimed = true;
        this.sendIdle(true);
        this.onReclaim();
      }, this.reclaimMs);
      if (typeof this.timer === 'object' && this.timer !== null) {
        this.timer.unref?.();
      }
      return;
    }
    this.cancel();
    this.window!.webContents?.setBackgroundThrottling?.(false);
    if (this.reclaimed) {
      this.reclaimed = false;
      this.sendIdle(false);
      this.onRestore();
    }
    this.window!.webContents?.invalidate?.();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
  }
}

module.exports = { WindowMemory };
