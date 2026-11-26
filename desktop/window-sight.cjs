// Efficiency audit, fix 4: whether anyone can see Fairy's window, so nothing is drawn while nobody can.
// macOS tells Electron when a window is covered or sits on another Space, and Electron passes that on as the window's
// 'hide' and 'show' events, though isVisible() stays true throughout. A covering window fading in flaps those events
// for about half a second, so going unseen waits for a hide to stand; coming back into view counts at once.
const SETTLE_MS = 1000;
class WindowSight {
  constructor({ window, changed = () => {}, hidden = () => false, settleMs = SETTLE_MS, schedule = setTimeout, clear = clearTimeout }) {
    Object.assign(this, { window, changed, hidden, settleMs, schedule, clear });
    this.covered = false; this.timer = null; this.listeners = [];
    this.visible = this.read();
    const on = (name, fn) => { window.on(name, fn); this.listeners.push([name, fn]); };
    on('hide', () => {
      this.covered = true; this.cancel();
      // Hidden for real (hide()) needs no settling; covered waits to see whether it stays covered.
      if (!this.alive() || !window.isVisible()) { this.sync(); return; }
      this.timer = this.schedule(() => { this.timer = null; this.sync(); }, this.settleMs);
      this.timer?.unref?.();
    });
    on('show', () => { this.covered = false; this.cancel(); this.sync(); });
    on('minimize', () => this.sync());
    on('restore', () => this.sync());
  }
  alive() { return Boolean(this.window) && !this.window.isDestroyed(); }
  read() { return this.alive() && this.window.isVisible() && !this.window.isMinimized() && !this.covered && !this.hidden(); }
  // Also called when something else changes what can be seen, such as Fairy being closed (made see-through).
  sync() { const visible = this.read(); if (visible !== this.visible) { this.visible = visible; this.changed(visible); } return visible; }
  cancel() { if (this.timer !== null) this.clear(this.timer); this.timer = null; }
  dispose() { this.cancel(); for (const [name, fn] of this.listeners) this.window.removeListener(name, fn); this.listeners = []; }
}
module.exports = { WindowSight, SETTLE_MS };
