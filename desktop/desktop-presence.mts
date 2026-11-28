// A visible overlay must never intercept a worker's clicks or keyboard focus.
export interface DesktopPresenceApp {
  hide(): void;
  show(): void;
}

export interface DesktopPresenceWindow {
  isFocusable(): boolean;
  isDestroyed(): boolean;
  isFocused(): boolean;
  setFocusable(focusable: boolean): void;
  setIgnoreMouseEvents(ignore: boolean, options?: { forward?: boolean }): void;
  showInactive(): void;
  show(): void;
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

export class DesktopPresence {
  app: DesktopPresenceApp;
  window: DesktopPresenceWindow;
  active = false;
  focusable = false;

  constructor({ app, window }: { app: DesktopPresenceApp; window: DesktopPresenceWindow }) {
    this.app = app;
    this.window = window;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    this.focusable = this.window.isFocusable();
    this.window.webContents.send('fairy:desktop-active', true);
    this.passive();
  }

  passive(): void {
    if (!this.active || this.window.isDestroyed()) return;
    // Hide/unhide only to relinquish app activation, never during screenshot capture.
    if (this.window.isFocused()) this.app.hide();
    this.window.setFocusable(false);
    this.window.setIgnoreMouseEvents(true, { forward: true });
    this.app.show();
    this.window.showInactive();
  }

  review(): void {
    if (!this.active || this.window.isDestroyed()) return;
    this.window.setFocusable(true);
    this.window.setIgnoreMouseEvents(false);
    this.app.show(); this.window.show();
  }

  leave(): void {
    if (!this.active) return;
    this.active = false;
    if (this.window.isDestroyed()) return;
    this.window.webContents.send('fairy:desktop-active', false);
    this.window.setFocusable(this.focusable);
    this.window.setIgnoreMouseEvents(false);
  }
}
