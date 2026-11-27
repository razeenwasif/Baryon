// Two Macs, step 5 (docs/fairy-on-two-macs-plan.md, Presence and hand-over): which Mac shows her. The full Fairy keeps
// one of these, fed by its own pointer sampler and by the face's reports. The step 1 test on the real MacBook and mini
// named every crossing within 0.2 s with these numbers; 0.5 s was the shortest dwell that didn't flap.
export const FRESH_MS = 400, DWELL_MS = 1000, HEARTBEAT_MS = 5000, STALE_MS = 15000;
const clampAgo = value => Math.max(0, Math.min(3_600_000, Number.isFinite(Number(value)) ? Number(value) : 3_600_000));

export class FacePresence {
  constructor({ now = Date.now } = {}) {
    // decided: where decide() last said she was, so a claim made between two decisions still counts as a change.
    this.now = now; this.shownOn = 'home'; this.decided = 'home'; this.faceUp = false; this.face = null; this.homeActiveAt = -Infinity; this.homeLocked = false; this.follow = 'pointer';
  }
  // The face's event stream opened or closed.
  connected(on) { this.faceUp = Boolean(on); if (!this.faceUp) this.face = null; }
  homeSample({ activeAgoMs, locked = false }) { this.homeActiveAt = this.now() - clampAgo(activeAgoMs); this.homeLocked = Boolean(locked); }
  // { activeAgoMs, locked, claim, follow } from the face, as it sent them.
  faceReport({ activeAgoMs, locked = false, claim = false, follow } = {}) {
    const at = this.now();
    this.face = { activeAt: at - clampAgo(activeAgoMs), locked: Boolean(locked), heardAt: at };
    if (follow === 'pointer' || follow === 'manual') this.follow = follow;
    if (claim === true) this.shownOn = 'face';
  }
  // "Bring Fairy here" on this Mac or the face's.
  claim(by) { if (by === 'home' || (by === 'face' && this.faceUp && this.face)) this.shownOn = by; }
  decide() {
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
