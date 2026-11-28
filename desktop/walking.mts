// Movement is driven by renderer frames: no background polling or focus changes.
export interface WalkBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WalkDisplay {
  id: number;
  workArea: WalkBounds;
}

export interface WalkWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  getBounds(): WalkBounds;
  setPosition(x: number, y: number, animate?: boolean): void;
}

export interface WalkScreen {
  getDisplayMatching(rect: WalkBounds): WalkDisplay;
}

export interface DesktopWalkOptions {
  window: WalkWindow;
  screen: WalkScreen;
  allowed: () => boolean;
  now?: () => number;
  random?: () => number;
}

export interface WalkStartResult {
  token: number;
  direction: 1 | -1;
}

export interface WalkStepResult {
  token: number;
  direction: 1 | -1;
  travel: number;
  done: boolean;
}

interface WalkState {
  token: number;
  direction: 1 | -1;
  distance: number;
  travel: number;
  x: number;
  y: number;
  width: number;
  height: number;
  display: number;
  left: number;
  right: number;
  last: number;
  expectedX: number;
}

export class DesktopWalk {
  window: WalkWindow;
  screen: WalkScreen;
  allowed: () => boolean;
  now: () => number;
  random: () => number;
  serial: number;
  walk: WalkState | null;

  constructor({ window, screen, allowed, now = () => performance.now(), random = Math.random }: DesktopWalkOptions) {
    this.window = window;
    this.screen = screen;
    this.allowed = allowed;
    this.now = now;
    this.random = random;
    this.serial = 0;
    this.walk = null;
  }

  start(): WalkStartResult | null {
    this.stop();
    if (!this.allowed() || this.window.isDestroyed() || !this.window.isVisible()) return null;
    const b = this.window.getBounds(), display = this.screen.getDisplayMatching(b), a = display.workArea;
    const left = a.x + 12, right = a.x + a.width - b.width - 12;
    if (right - left < 80 || b.x < left - 1 || b.x > right + 1) return null;
    const roomLeft = b.x - left, roomRight = right - b.x;
    const direction: 1 | -1 = roomLeft < 80 ? 1 : roomRight < 80 ? -1 : this.random() < .5 ? -1 : 1;
    const distance = Math.min(180 + this.random() * 160, direction < 0 ? roomLeft : roomRight);
    this.walk = { token: ++this.serial, direction, distance, travel: 0, x: b.x, y: b.y, width: b.width, height: b.height, display: display.id, left, right, last: this.now(), expectedX: b.x };
    return { token: this.walk.token, direction };
  }

  step(token: number): WalkStepResult | null {
    const w = this.walk;
    if (!w || w.token !== token) return null;
    const b = this.window.getBounds(), display = this.screen.getDisplayMatching(b), a = display.workArea;
    if (!this.allowed() || !this.window.isVisible() || b.x !== w.expectedX || b.y !== w.y || b.width !== w.width || b.height !== w.height || display.id !== w.display || a.x + 12 !== w.left || a.x + a.width - b.width - 12 !== w.right) { this.stop(token); return null; }
    const now = this.now(), elapsed = now - w.last; w.last = now;
    // A stalled/hidden renderer must not catch up with a jump on return.
    if (elapsed > 1000 || elapsed < 0) { this.stop(token); return null; }
    w.travel = Math.min(w.distance, w.travel + Math.min(elapsed, 100) / 1000 * 40);
    const x = Math.round(Math.max(w.left, Math.min(w.right, w.x + w.direction * w.travel)));
    if (x !== w.expectedX) this.window.setPosition(x, w.y, false);
    w.expectedX = x;
    const result: WalkStepResult = { token: w.token, direction: w.direction, travel: w.travel, done: w.travel >= w.distance };
    if (result.done) this.stop(token);
    return result;
  }

  stop(token?: number): void { if (token === undefined || this.walk?.token === token) this.walk = null; }
}
