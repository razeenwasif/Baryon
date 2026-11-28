interface CompanionVisibilityWindow {
  isDestroyed: () => boolean;
  isFocusable: () => boolean;
  getOpacity: () => number;
  setIgnoreMouseEvents: (ignore: boolean, options?: { forward?: boolean }) => void;
  setFocusable: (focusable: boolean) => void;
  setOpacity: (opacity: number) => void;
}

// Keep the native window alive: ordering out the last window can trigger an
// external/native quit request on macOS. Hidden content must never intercept input.
class CompanionVisibility {
  window: CompanionVisibilityWindow;
  changed: (hidden: boolean) => void;
  hidden: boolean;
  focusable = true;
  opacity = 1;

  constructor(window: CompanionVisibilityWindow, changed: (hidden: boolean) => void = () => {}) {
    this.window = window;
    this.changed = changed;
    this.hidden = false;
  }
  // opacity: what restore brings it back to, when the window was faded out first (two Macs, glide.cjs).
  hide({ opacity }: { opacity?: number } = {}): void {
    const w = this.window;
    if (this.hidden || w.isDestroyed()) return;
    this.focusable = w.isFocusable();
    this.opacity = opacity ?? w.getOpacity();
    this.hidden = true;
    w.setIgnoreMouseEvents(true, { forward: true });
    w.setFocusable(false);
    w.setOpacity(0);
    this.changed(true);
  }
  // opacity: set instead of the saved one, when the window will fade itself in (glide.cjs).
  restore({ opacity }: { opacity?: number } = {}): void {
    const w = this.window;
    if (!this.hidden || w.isDestroyed()) return;
    this.hidden = false;
    w.setOpacity(opacity ?? this.opacity);
    w.setFocusable(this.focusable);
    w.setIgnoreMouseEvents(false);
    this.changed(false);
  }
}
module.exports = { CompanionVisibility };
