// Two Macs, step 5: whether this Mac is the one in use, from its pointer and its idle time, sampled every 200 ms.
// Under Universal Control the Mac being driven from the other one moves its pointer, but its idle time only falls back
// to about half a second, never to 0 (measured in step 1), so a fall in idle time counts as input too.
export const SAMPLE_MS = 200, FRESH_IDLE_SECONDS = 0.15, RUN_GAP_MS = 400, NEVER_MS = 3_600_000;

export class PointerSampler {
  constructor({ now = Date.now } = {}) { this.now = now; this.last = null; this.activeAt = null; this.exit = null; this.entry = null; }
  // point: the pointer, in screen coordinates; idle: seconds since the last input, or null if unknown.
  // Returns whether this sample was input, how long ago the last input was, where the pointer was at the start of the
  // latest run of input (where she should come in) and at its last input (where she should leave).
  sample({ point, idle, at = this.now() }) {
    const last = this.last, known = Number.isFinite(idle);
    const moved = Boolean(last) && (point.x !== last.point.x || point.y !== last.point.y);
    const fell = Boolean(last) && known && Number.isFinite(last.idle) && idle < last.idle - 0.02;
    const active = moved || fell || (known && idle < FRESH_IDLE_SECONDS);
    if (active) {
      if (this.activeAt === null || at - this.activeAt > RUN_GAP_MS) this.entry = { ...point };
      this.activeAt = at; this.exit = { ...point };
    }
    this.last = { point: { ...point }, idle, at };
    return { active, activeAgoMs: this.activeAt === null ? NEVER_MS : Math.min(NEVER_MS, at - this.activeAt), entry: this.entry, exit: this.exit };
  }
}
