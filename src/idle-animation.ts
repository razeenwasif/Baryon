// Idle-only clock: background time and busy activities never queue up animations.
export type IdlePhase = 'idle' | 'enter' | 'seated' | 'exit';

export interface IdleOutput {
  from: string;
  to: string;
  mix: number;
  active: boolean;
}

export interface IdleTickOptions {
  eligible?: boolean;
  visible?: boolean;
  ready?: boolean;
}

export const SITTING = {
  interval: [180, 300] as readonly [number, number],
  hold: [600, 900] as readonly [number, number],
  enterFrame: 0.28,
  blend: 0.16,
  expressions: [[0, 3.6], [1, 0.15], [2, 4.5], [5, 1.2], [6, 4], [1, 0.15], [0, 5]] as readonly (readonly [number, number])[],
};

const ENTER: string[] = ['idle', ...Array.from({ length: 8 }, (_, i) => `sit-enter-${i}`), 'sit-loop-0'];
const EXIT: string[] = ['sit-loop-0', ...Array.from({ length: 8 }, (_, i) => `sit-enter-${7 - i}`), 'idle'];
const EXPRESSION_TOTAL: number = SITTING.expressions.reduce((n, [, duration]) => n + duration, 0);
const smooth = (x: number): number => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};

export class IdleAnimation {
  random: () => number;
  output: IdleOutput;
  phase: IdlePhase;
  time: number;
  remaining: number;
  hold: number;
  exitFrom?: string;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.output = { from: 'idle', to: 'idle', mix: 0, active: false };
    this.phase = 'idle';
    this.time = 0;
    this.remaining = 0;
    this.hold = 0;
    this.reset();
  }

  range([a, b]: readonly [number, number]): number {
    return a + (b - a) * this.random();
  }

  reset(): void {
    this.phase = 'idle';
    this.time = 0;
    this.remaining = this.range(SITTING.interval);
    this.hold = this.range(SITTING.hold);
  }

  start(): boolean {
    if (this.phase !== 'idle') return false;
    this.phase = 'enter';
    this.time = 0;
    return true;
  }

  stop(): void {
    if (this.phase === 'seated') {
      this.exitFrom = this.sample().to;
      this.phase = 'exit';
      this.time = 0;
    }
  }

  tick(dt: number, { eligible = true, visible = true, ready = true }: IdleTickOptions = {}): IdleOutput {
    if (!visible) return this.sample();
    // Brief conversations pause a seated session; explicit Stop, hide and sleep reset it.
    if (!eligible || !ready) return this.sample();
    dt = Math.max(0, Math.min(dt, 0.1));
    if (this.phase === 'idle') {
      this.remaining -= dt;
      if (this.remaining <= 0) this.start();
    } else {
      this.time += dt;
      if (this.phase === 'enter' && this.time >= 9 * SITTING.enterFrame) {
        this.phase = 'seated';
        this.time = 0;
      } else if (this.phase === 'seated' && this.time >= this.hold) {
        this.stop();
      } else if (this.phase === 'exit' && this.time >= 9 * SITTING.enterFrame) {
        this.reset();
      }
    }
    return this.sample();
  }

  sample(): IdleOutput {
    const pair = (from: string, to: string, mix: number): IdleOutput =>
      Object.assign(this.output, { from, to, mix: smooth(mix), active: this.phase !== 'idle' });
    if (this.phase === 'idle') return pair('idle', 'idle', 0);
    if (this.phase === 'enter' || this.phase === 'exit') {
      const frames = this.phase === 'enter' ? ENTER : EXIT;
      const i = Math.min(8, Math.floor(this.time / SITTING.enterFrame));
      return pair(
        this.phase === 'exit' && i === 0 ? (this.exitFrom || frames[0]) : frames[i],
        frames[i + 1],
        (this.time - i * SITTING.enterFrame) / SITTING.blend,
      );
    }
    const total = EXPRESSION_TOTAL;
    let t = this.time % total;
    let previous = 0;
    for (const [frame, duration] of SITTING.expressions) {
      if (t < duration) return pair(`sit-loop-${previous}`, `sit-loop-${frame}`, t / Math.min(0.12, duration * 0.5));
      t -= duration;
      previous = frame;
    }
    return pair('sit-loop-0', 'sit-loop-0', 0);
  }
}
