// The ink window: a transparent, click-through window over one whole display, just under floating Fairy,
// where she draws beside what you're reading. Clicks pass through to your apps except over a card.
const { BrowserWindow, ipcMain, screen } = require('electron');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');

class InkOverlay {
  constructor({ scene, onChange = () => {} }) {
    this.scene = scene; this.onChange = onChange; this.window = null; this.displayId = null; this.look = null; this.riding = false;
    this.page = pathToFileURL(join(__dirname, '../dist/ink.html')).href;
    const from = (channel, fn) => ipcMain.on(`fairy:ink-${channel}`, (event, ...args) => {
      if (!this.window || this.window.isDestroyed() || event.sender !== this.window.webContents || event.senderFrame?.url !== this.page) return;
      fn(...args);
    });
    // Over a card the window takes the pointer, so its buttons and dragging work; elsewhere clicks go through.
    from('interactive', value => this.window.setIgnoreMouseEvents(!value, { forward: true }));
    from('close', id => { if (typeof id === 'string' && this.scene.remove(id)) this.send(); });
    from('clear', () => this.clear());
    // Quicker ways to ask: the area you dragged over (or nothing, if you pressed Esc).
    from('area', rect => { const resolve = this.areaWaiter; this.areaWaiter = null; this.endArea(); resolve?.(rect && [rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) ? rect : null); });
    // Show me how: a step's [next] or [stop] (see nextAction).
    from('guide', action => { const resolve = this.guideWaiter; this.guideWaiter = null; resolve?.(action === 'stop' ? 'stop' : 'next'); });
    // A card asking Fairy something new (a quiz's "more like this"); main sends it to the floating eye or the companion.
    from('ask', text => { if (typeof text === 'string' && text.trim()) this.onAsk?.(text.trim().slice(0, 2000), this.owner); });
    // The pen leaving Fairy and coming back, so she can turn into it and back (onPen in main.cjs).
    from('pen', phase => this.onPen?.(phase === 'out' ? 'out' : 'in', this.owner));
  }
  get showing() { return this.scene.showing; }
  async ensure(bounds, displayId) {
    if (this.window && !this.window.isDestroyed()) {
      if (this.displayId !== displayId) { this.window.setBounds(bounds); this.displayId = displayId; }
      return this.window;
    }
    this.displayId = displayId;
    const window = this.window = new BrowserWindow({ ...bounds, frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: false,
      minimizable: false, maximizable: false, fullscreenable: false, acceptFirstMouse: true, skipTaskbar: true, show: false, enableLargerThanScreen: true, title: 'Baryon ink',
      webPreferences: { preload: join(__dirname, 'ink-preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
    // Just under floating Fairy (screen-saver level), over full-screen apps and on every Space.
    window.setAlwaysOnTop(true, 'screen-saver', -1);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.on('closed', () => { if (this.window === window) this.window = null; });
    await window.loadFile(join(__dirname, '../dist/ink.html'));
    return window;
  }
  // state: InkScene.state(look); bounds: the display's bounds in screen points.
  async show(state, bounds, displayId) {
    const window = await this.ensure(bounds, displayId);
    this.last = state;
    window.webContents.send('fairy:ink-scene', state);
    if (state.parts.length || this.riding) window.showInactive(); else window.hide();
    this.onChange(this.showing);
  }
  send() {
    if (!this.window || this.window.isDestroyed()) return;
    const state = { ...(this.last || {}), version: this.scene.version, parts: this.scene.state().parts };
    this.last = state;
    this.window.webContents.send('fairy:ink-scene', state);
    if (!state.parts.length && !this.riding) this.window.hide();
    this.onChange(this.showing);
  }
  clear() {
    if (!this.scene.showing) return;
    this.scene.clear(); this.send();
  }
  // Show me how: draws a step (or the end) of a guide; the window stays click-through except on the step's caption.
  async guide(state, bounds, displayId) {
    const window = await this.ensure(bounds, displayId);
    window.webContents.send('fairy:ink-guide', state);
    window.showInactive();
    if (state.done) setTimeout(() => { if (!this.scene.showing && this.window && !this.window.isDestroyed() && !this.guideWaiter && !this.riding) this.window.hide(); }, 2600);
  }
  // Fairy's voice level, passed on only while there's a drawing to show it on.
  voice(level) { if (this.scene.showing && this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.webContents.send('fairy:ink-voice', Math.max(0, Math.min(1, Number(level) || 0))); }
  // Ride along: Fairy, cursor-sized, beside your pointer on the display it's on (display: { bounds, id }).
  async ride(on, display = null) {
    this.riding = Boolean(on);
    if (this.riding && display) {
      const window = await this.ensure(display.bounds, display.id);
      window.webContents.send('fairy:ink-ride', { on: true });
      window.showInactive();
    } else if (!this.riding && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send('fairy:ink-ride', { on: false });
      this.hideSoon(500);
    }
  }
  // Where the pointer is now, in the display's points, for the rider to follow.
  rideAt(point) { if (this.riding && this.window && !this.window.isDestroyed()) this.window.webContents.send('fairy:ink-ride-at', point); }
  // Quicker ways to ask: the listening badge and pointer trail while ⌃⌥ is held, and the ring round what was circled.
  async quick(state, bounds, displayId) {
    const window = await this.ensure(bounds, displayId);
    window.webContents.send('fairy:ink-quick', state);
    window.showInactive();
    if (!state.listening) this.hideSoon(state.circle ? 3600 : 400);
  }
  // ⌃⌥A: the window takes the pointer and keys for a moment so you can drag over an area; resolves it, or null.
  async selectArea(bounds, displayId) {
    const window = await this.ensure(bounds, displayId);
    this.areaWaiter?.(null);
    window.setIgnoreMouseEvents(false);
    window.webContents.send('fairy:ink-area-start');
    window.show(); window.focus();
    return new Promise(resolve => { this.areaWaiter = resolve; });
  }
  endArea() { if (this.window && !this.window.isDestroyed()) { this.window.setIgnoreMouseEvents(true, { forward: true }); this.hideSoon(); } }
  hideSoon(ms = 400) {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => { if (!this.scene.showing && !this.guideWaiter && !this.areaWaiter && !this.riding && this.window && !this.window.isDestroyed()) this.window.hide(); }, ms);
  }
  // Resolves 'next' or 'stop' when the current step's buttons are pressed; a newer step's wait replaces an older one.
  nextAction() { return new Promise(resolve => { this.guideWaiter = resolve; }); }
  close() { this.scene.clear(); if (this.window && !this.window.isDestroyed()) this.window.destroy(); this.window = null; }
  // Which display to draw on: the one Fairy floats on, else the one with the pointer.
  static display(near) { return near ? screen.getDisplayMatching(near) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()); }
}
module.exports = { InkOverlay };
