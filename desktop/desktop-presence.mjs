// A visible overlay must never intercept a worker's clicks or keyboard focus.
export class DesktopPresence {
  constructor({app, window}) { this.app = app; this.window = window; this.active = false; }
  enter() {
    if (this.active) return;
    this.active = true;
    this.focusable = this.window.isFocusable();
    this.window.webContents.send('fairy:desktop-active', true);
    this.passive();
  }
  passive() {
    if (!this.active || this.window.isDestroyed()) return;
    // Hide/unhide only to relinquish app activation, never during screenshot capture.
    if (this.window.isFocused()) this.app.hide();
    this.window.setFocusable(false);
    this.window.setIgnoreMouseEvents(true, {forward: true});
    this.app.show();
    this.window.showInactive();
  }
  review() {
    if (!this.active || this.window.isDestroyed()) return;
    this.window.setFocusable(true);
    this.window.setIgnoreMouseEvents(false);
    this.app.show(); this.window.show();
  }
  leave() {
    if (!this.active) return;
    this.active = false;
    if (this.window.isDestroyed()) return;
    this.window.webContents.send('fairy:desktop-active', false);
    this.window.setFocusable(this.focusable);
    this.window.setIgnoreMouseEvents(false);
  }
}
