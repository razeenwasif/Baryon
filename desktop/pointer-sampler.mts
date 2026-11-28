// Two Macs, step 5: whether this Mac is the one in use, from its pointer and its idle time, sampled every 200 ms.
// Under Universal Control the Mac being driven from the other one moves its pointer, but its idle time only falls back
// to about half a second, never to 0 (measured in step 1), so a fall in idle time counts as input too.
export const SAMPLE_MS = 200, FRESH_IDLE_SECONDS = 0.15, RUN_GAP_MS = 400, NEVER_MS = 3_600_000;

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface PointerSampleResult {
  active: boolean;
  activeAgoMs: number;
  entry: ScreenPoint | null;
  exit: ScreenPoint | null;
}

export class PointerSampler {
  now: () => number;
  last: { point: ScreenPoint; idle: number | null; at: number } | null = null;
  activeAt: number | null = null;
  exit: ScreenPoint | null = null;
  entry: ScreenPoint | null = null;

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    this.now = now;
  }

  // point: the pointer, in screen coordinates; idle: seconds since the last input, or null if unknown.
  // Returns whether this sample was input, how long ago the last input was, where the pointer was at the start of the
  // latest run of input (where she should come in) and at its last input (where she should leave).
  sample({ point, idle, at = this.now() }: { point: ScreenPoint; idle: number | null; at?: number }): PointerSampleResult {
    const last = this.last, known = typeof idle === 'number' && Number.isFinite(idle);
    const moved = Boolean(last) && (point.x !== last!.point.x || point.y !== last!.point.y);
    const fell = Boolean(last) && known && typeof last!.idle === 'number' && Number.isFinite(last!.idle) && idle < last!.idle - 0.02;
    const active = moved || fell || (known && idle < FRESH_IDLE_SECONDS);
    if (active) {
      if (this.activeAt === null || at - this.activeAt > RUN_GAP_MS) this.entry = { ...point };
      this.activeAt = at; this.exit = { ...point };
    }
    this.last = { point: { ...point }, idle, at };
    return { active, activeAgoMs: this.activeAt === null ? NEVER_MS : Math.min(NEVER_MS, at - this.activeAt), entry: this.entry, exit: this.exit };
  }
}
