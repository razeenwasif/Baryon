// Shares the avatar's existing frame clock; at most one movement request in flight.
export interface WalkStepValue {
  token: unknown;
  done?: boolean;
  travel?: number;
  [key: string]: unknown;
}

export interface WalkingApi {
  walkStart: () => Promise<WalkStepValue | null | undefined>;
  walkStep: (token: unknown) => Promise<WalkStepValue | null | undefined>;
  walkStop: (token: unknown) => Promise<unknown>;
}

export interface WalkingAnimationOptions {
  api: WalkingApi;
  eligible: (manual: boolean) => boolean;
  display: (value: WalkStepValue | null) => void;
  random?: () => number;
}

export class WalkingAnimation {
  api: WalkingApi;
  eligible: (manual: boolean) => boolean;
  display: (value: WalkStepValue | null) => void;
  random: () => number;
  epoch: number;
  pending: boolean;
  active: WalkStepValue | null;
  elapsed: number;
  remaining!: number;
  preview = false;

  constructor({ api, eligible, display, random = Math.random }: WalkingAnimationOptions) {
    this.api = api;
    this.eligible = eligible;
    this.display = display;
    this.random = random;
    this.epoch = 0;
    this.pending = false;
    this.active = null;
    this.elapsed = 0;
    this.resetDeadline();
  }

  resetDeadline(): void {
    this.remaining = 240 + this.random() * 180;
  }

  request(): void {
    this.preview = true;
    this.remaining = 0.8;
  }

  cancel(): void {
    this.preview = false;
    this.epoch++;
    const token = this.active?.token;
    this.active = null;
    this.elapsed = 0;
    this.display(null);
    if (token !== undefined) void this.api.walkStop(token).catch(() => {});
    this.resetDeadline();
  }

  async start(manual = false): Promise<boolean> {
    if (this.pending || this.active || !this.eligible(manual)) return false;
    this.pending = true;
    const epoch = ++this.epoch;
    try {
      const value = await this.api.walkStart();
      if (epoch !== this.epoch || !this.eligible(manual)) {
        if (value) await this.api.walkStop(value.token);
        return false;
      }
      if (value) {
        this.active = value;
        this.display({ ...value, travel: 0 });
        return true;
      }
      return false;
    } catch {
      return false;
    } finally {
      this.pending = false;
      this.preview = false;
      this.resetDeadline();
    }
  }

  tick(dt: number): void {
    if (!this.eligible(Boolean(this.active || this.preview))) {
      if (this.active || this.pending) this.cancel();
      return;
    }
    if (!this.active) {
      this.remaining -= dt;
      if (this.remaining <= 0) void this.start(Boolean(this.preview));
      return;
    }
    this.elapsed += dt;
    if (this.pending || this.elapsed < 0.05) return;
    this.elapsed = 0;
    this.pending = true;
    const epoch = this.epoch, token = this.active.token;
    this.api
      .walkStep(token)
      .then(value => {
        if (epoch !== this.epoch) return;
        if (!value || value.done) {
          this.cancel();
          return;
        }
        this.display(value);
      })
      .catch(() => {
        if (epoch === this.epoch) this.cancel();
      })
      .finally(() => {
        this.pending = false;
      });
  }
}
