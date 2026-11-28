// One cancellable deadline + display-synchronized callback per active renderer.

export type FrameDrawCallback = (time: number, dt: number) => void;

export interface FrameLoopOptions<TRaf = number, TTimer = ReturnType<typeof setTimeout>> {
  fps?: number;
  now?: () => number;
  request?: (cb: FrameRequestCallback) => TRaf;
  cancel?: (id: TRaf) => void;
  schedule?: (cb: () => void, ms: number) => TTimer;
  clear?: (id: TTimer) => void;
}

export class FrameLoop<TRaf = number, TTimer = ReturnType<typeof setTimeout>> {
  draw: FrameDrawCallback;
  fps: number;
  now: () => number;
  request: (cb: FrameRequestCallback) => TRaf;
  cancel: (id: TRaf) => void;
  schedule: (cb: () => void, ms: number) => TTimer;
  clear: (id: TTimer) => void;
  running: boolean;
  raf: TRaf | null;
  timer: TTimer | null;
  last: number;
  tick: FrameRequestCallback;

  constructor(
    draw: FrameDrawCallback,
    {
      fps = 30,
      now = () => performance.now(),
      request = cb => requestAnimationFrame(cb) as unknown as TRaf,
      cancel = id => cancelAnimationFrame(id as unknown as number),
      schedule = (cb, ms) => setTimeout(cb, ms) as unknown as TTimer,
      clear = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    }: FrameLoopOptions<TRaf, TTimer> = {},
  ) {
    this.draw = draw;
    this.fps = fps;
    this.now = now;
    this.request = request;
    this.cancel = cancel;
    this.schedule = schedule;
    this.clear = clear;
    this.running = false;
    this.raf = null;
    this.timer = null;
    this.last = 0;
    this.tick = (time: number) => {
      this.raf = null;
      if (!this.running) return;
      const dt = Math.min(.1, Math.max(0, (time - this.last) / 1000));
      this.last = time;
      this.draw(time, dt);
      if (this.running) {
        this.timer = this.schedule(
          () => {
            this.timer = null;
            if (this.running) this.raf = this.request(this.tick);
          },
          Math.max(0, 1000 / this.fps - (this.now() - time) - 2),
        );
      }
    };
  }

  setRunning(value: boolean): void {
    if (this.running === value) return;
    this.running = value;
    if (value) {
      this.last = this.now();
      this.raf = this.request(this.tick);
    } else {
      if (this.raf !== null) this.cancel(this.raf);
      if (this.timer !== null) this.clear(this.timer);
      this.raf = this.timer = null;
    }
  }

  setFPS(value: number): void {
    if (Number.isFinite(value) && value > 0) this.fps = Math.max(1, Math.min(60, value));
  }

  dispose(): void {
    this.setRunning(false);
    this.draw = () => {};
  }
}
