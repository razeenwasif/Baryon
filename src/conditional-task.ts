export type ConditionalTimerHandle = ReturnType<typeof setTimeout> & { unref?: () => void };

export interface ConditionalTaskOptions {
  enabled: () => boolean;
  delay: number | (() => number);
  run: () => Promise<unknown> | unknown;
  onError?: (error: unknown) => void;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ConditionalTimerHandle;
  clear?: (id: ConditionalTimerHandle) => void;
}

// A disabled task owns no timer. Async work is serial and the next deadline is
// scheduled after completion, so a slow request never builds a polling backlog.
export class ConditionalTask {
  enabled: () => boolean;
  delay: number | (() => number);
  run: () => Promise<unknown> | unknown;
  onError: (error: unknown) => void;
  now: () => number;
  schedule: (fn: () => void, ms: number) => ConditionalTimerHandle;
  clear: (id: ConditionalTimerHandle) => void;
  timer: ConditionalTimerHandle | null;
  at: number | null;
  running: boolean;
  disposed: boolean;

  constructor({
    enabled,
    delay,
    run,
    onError = () => {},
    now = Date.now,
    schedule = (fn, ms) => setTimeout(fn, ms),
    clear = id => clearTimeout(id),
  }: ConditionalTaskOptions) {
    this.enabled = enabled;
    this.delay = delay;
    this.run = run;
    this.onError = onError;
    this.now = now;
    this.schedule = schedule;
    this.clear = clear;
    this.timer = null;
    this.at = null;
    this.running = false;
    this.disposed = false;
  }

  sync(restart = false): void {
    if (this.disposed) return;
    if (!this.enabled()) { this.cancelTimer(); return; }
    if (this.running) return;
    if (this.timer !== null && !restart) return;
    const delay = typeof this.delay === 'function' ? this.delay() : this.delay;
    if (!Number.isFinite(delay)) { this.cancelTimer(); return; }
    const at = this.now() + Math.max(0, delay);
    if (this.timer !== null && this.at !== null && Math.abs(this.at - at) < 2) return;
    this.cancelTimer();
    this.at = at;
    this.timer = this.schedule(() => { this.timer = null; this.at = null; void this.fire(); }, Math.max(0, delay));
    this.timer?.unref?.();
  }

  async fire(): Promise<void> {
    if (this.disposed || this.running || !this.enabled()) return;
    this.running = true;
    try {
      await this.run();
    } catch (error: unknown) {
      this.onError(error);
    } finally {
      this.running = false;
      this.sync();
    }
  }

  cancelTimer(): void {
    if (this.timer !== null) this.clear(this.timer);
    this.timer = null;
    this.at = null;
  }

  dispose(): void {
    this.disposed = true;
    this.cancelTimer();
  }
}
