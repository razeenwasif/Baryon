export interface PlaybackIndicatorApi {
  spotifyStatus: () => Promise<{ connected?: boolean }>;
  spotifyNow: () => Promise<{ playing?: boolean; track?: unknown } | null>;
}

export interface PlaybackIndicatorOptions {
  api?: PlaybackIndicatorApi | null;
  allowed: () => boolean;
  onChange: (playing: boolean) => void;
  now?: () => number;
  interval?: () => number;
}

// Poll only playback state through the existing connection; nothing goes to the AI.
export class PlaybackIndicator {
  api: PlaybackIndicatorApi | null | undefined;
  allowed: () => boolean;
  onChange: (playing: boolean) => void;
  now: () => number;
  interval: () => number;
  next: number;
  pending: boolean;
  epoch: number;

  constructor({ api, allowed, onChange, now = Date.now, interval = () => 15000 }: PlaybackIndicatorOptions) {
    this.api = api;
    this.allowed = allowed;
    this.onChange = onChange;
    this.now = now;
    this.interval = interval;
    this.next = 0;
    this.pending = false;
    this.epoch = 0;
  }

  reset(): void {
    this.epoch++;
    this.next = 0;
    this.onChange(false);
  }

  async tick(): Promise<void> {
    if (!this.api || !this.allowed()) { this.reset(); return; }
    if (this.pending || this.now() < this.next) return;
    this.pending = true;
    const token = this.epoch;
    this.next = this.now() + this.interval();
    try {
      const status = await this.api.spotifyStatus();
      if (!status.connected) this.next = this.now() + 60000;
      const current = status.connected ? await this.api.spotifyNow() : null;
      if (token === this.epoch && this.allowed()) this.onChange(Boolean(current?.playing && current?.track));
    } catch {
      if (token === this.epoch) { this.onChange(false); this.next = this.now() + 60000; }
    } finally {
      this.pending = false;
      if (token === this.epoch) this.next = Math.max(this.next, this.now() + this.interval());
    }
  }
}
