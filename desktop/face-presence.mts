// Two Macs, step 5 (docs/fairy-on-two-macs-plan.md, Presence and hand-over): which Mac shows her. The full Fairy keeps
// one of these, fed by its own pointer sampler and by the face's reports. The step 1 test on the real MacBook and mini
// named every crossing within 0.2 s with these numbers; 0.5 s was the shortest dwell that didn't flap.
export const FRESH_MS = 400, DWELL_MS = 1000, HEARTBEAT_MS = 5000, STALE_MS = 15000;

export type PresenceSide = 'home' | 'face';
export type PresenceFollowMode = 'pointer' | 'manual';

export interface FacePresenceState {
  activeAt: number;
  locked: boolean;
  heardAt: number;
}

const clampAgo = (value: unknown): number => Math.max(0, Math.min(3_600_000, Number.isFinite(Number(value)) ? Number(value) : 3_600_000));

export class FacePresence {
  now: () => number;
  shownOn: PresenceSide = 'home';
  decided: PresenceSide = 'home';
  faceUp = false;
  face: FacePresenceState | null = null;
  homeActiveAt = -Infinity;
  homeLocked = false;
  follow: PresenceFollowMode = 'pointer';

  constructor({ now = Date.now }: { now?: () => number } = {}) {
    // decided: where decide() last said she was, so a claim made between two decisions still counts as a change.
    this.now = now;
  }

  // The face's event stream opened or closed.
  connected(on: unknown): void { this.faceUp = Boolean(on); if (!this.faceUp) this.face = null; }

  homeSample({ activeAgoMs, locked = false }: { activeAgoMs: unknown; locked?: boolean }): void {
    this.homeActiveAt = this.now() - clampAgo(activeAgoMs);
    this.homeLocked = Boolean(locked);
  }

  // { activeAgoMs, locked, claim, follow } from the face, as it sent them.
  faceReport({ activeAgoMs, locked = false, claim = false, follow }: { activeAgoMs?: unknown; locked?: boolean; claim?: boolean; follow?: string } = {}): void {
    const at = this.now();
    this.face = { activeAt: at - clampAgo(activeAgoMs), locked: Boolean(locked), heardAt: at };
    if (follow === 'pointer' || follow === 'manual') this.follow = follow;
    if (claim === true) this.shownOn = 'face';
  }

  // "Bring Fairy here" on this Mac or the face's.
  claim(by: PresenceSide | string): void {
    if (by === 'home' || (by === 'face' && this.faceUp && this.face)) this.shownOn = by;
  }

  decide(): { shownOn: PresenceSide; changed: boolean } {
    const now = this.now(), face = this.face;
    if (!this.faceUp || !face || now - face.heardAt > STALE_MS || face.locked) this.shownOn = 'home';
    else if (this.homeLocked) this.shownOn = 'face';
    else if (this.follow === 'pointer') {
      const homeAgo = now - this.homeActiveAt, faceAgo = now - face.activeAt;
      if (this.shownOn === 'home' && faceAgo <= FRESH_MS && homeAgo >= DWELL_MS) this.shownOn = 'face';
      else if (this.shownOn === 'face' && homeAgo <= FRESH_MS && faceAgo >= DWELL_MS) this.shownOn = 'home';
    }
    const changed = this.shownOn !== this.decided;
    this.decided = this.shownOn;
    return { shownOn: this.shownOn, changed };
  }
}
