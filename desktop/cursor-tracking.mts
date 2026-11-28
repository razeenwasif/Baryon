// Read-only DIP coordinates. No screenshot, input injection, or persistent history.
export interface CursorPoint {
  x: number;
  y: number;
}

export interface CursorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopCursorWindow {
  isDestroyed(): boolean;
  isVisible(): boolean;
  isMinimized(): boolean;
  getContentBounds(): CursorRect;
}

export interface DesktopCursorScreen {
  getCursorScreenPoint(): CursorPoint;
  getDisplayNearestPoint(point: CursorPoint): { id: number };
  getDisplayMatching(rect: CursorRect): { id: number };
}

export class DesktopCursor {
  window: DesktopCursorWindow;
  screen: DesktopCursorScreen;
  allowed: () => boolean;
  now: () => number;
  last = -Infinity;
  cached: CursorPoint | null = null;

  constructor({ window, screen, allowed, now = () => performance.now() }: {
    window: DesktopCursorWindow;
    screen: DesktopCursorScreen;
    allowed: () => boolean;
    now?: () => number;
  }) {
    this.window = window;
    this.screen = screen;
    this.allowed = allowed;
    this.now = now;
  }

  sample(): CursorPoint | null {
    if (!this.allowed() || this.window.isDestroyed() || !this.window.isVisible() || this.window.isMinimized()) { this.cached = null; return null; }
    const now = this.now(); if (now - this.last < 80) return this.cached; this.last = now;
    const point = this.screen.getCursorScreenPoint(), bounds = this.window.getContentBounds();
    if (this.screen.getDisplayNearestPoint(point).id !== this.screen.getDisplayMatching(bounds).id) { this.cached = null; return null; }
    this.cached = { x: point.x - bounds.x, y: point.y - bounds.y }; return this.cached;
  }
}
