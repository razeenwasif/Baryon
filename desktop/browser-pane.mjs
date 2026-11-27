import { searchURL, webURL } from './browser.mjs';

// What was typed into the address bar: an address, or else a search.
export function browserAddress(input) {
  const text = String(input ?? '').trim();
  if (!text || text.length > 2048) throw new Error('Type an address or a search.');
  if (/^https?:\/\//i.test(text)) return webURL(text).href;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(?:file|javascript|data|about|blob|chrome):/i.test(text)) throw new Error('Only web addresses can be opened here.');
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(text)) return webURL(`http://${text}`).href;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text)) return webURL(`https://${text}`).href;
  return searchURL(text);
}
const isWeb = url => /^https?:\/\//i.test(url);
export function cleanBounds(value, limits) {
  const number = key => Math.max(0, Math.round(Number(value?.[key]) || 0));
  const x = Math.min(number('x'), limits.width), y = Math.min(number('y'), limits.height);
  return { x, y, width: Math.min(number('width'), limits.width - x), height: Math.min(number('height'), limits.height - y) };
}
// A page in its own view and storage, with no bridge to the app. Logins stay in this browser only.
// When hidden beyond idleMs (or when the main window enters idle reclamation), its WebContentsView is closed
// while remembering lastUrl so Chromium frees its renderer + GPU buffers until the panel opens again.
export class BrowserPane {
  constructor({ getWindow, WebContentsView, session, onState, idleMs = 120_000, schedule = setTimeout, clear = clearTimeout, busy = () => false }) {
    Object.assign(this, { getWindow, WebContentsView, session, onState, idleMs, schedule, clear, busy });
    this.view = null; this.visible = false; this.note = ''; this.lastUrl = ''; this.needsRestore = false; this.idleTimer = null;
  }
  get window() { return this.getWindow(); }
  cancelIdle() {
    if (this.idleTimer !== null) {
      this.clear(this.idleTimer);
      this.idleTimer = null;
    }
  }
  scheduleIdle() {
    this.cancelIdle();
    if (this.visible || !this.view || !(this.idleMs > 0)) return;
    this.idleTimer = this.schedule(() => {
      this.idleTimer = null;
      this.reclaimIfHidden();
    }, this.idleMs);
    this.idleTimer?.unref?.();
  }
  destroyView() {
    if (!this.view) return;
    try {
      this.window?.contentView?.removeChildView?.(this.view);
      this.view.webContents?.close?.();
    } catch {}
    this.view = null;
  }
  release({ keepUrl = true } = {}) {
    this.cancelIdle();
    if (!this.view) {
      if (!keepUrl) { this.lastUrl = ''; this.needsRestore = false; }
      return false;
    }
    if (keepUrl) {
      const url = this.view.webContents?.getURL?.() || '';
      if (isWeb(url)) this.lastUrl = url;
      this.needsRestore = Boolean(this.lastUrl);
    } else {
      this.lastUrl = '';
      this.needsRestore = false;
    }
    this.destroyView();
    this.publish();
    return true;
  }
  reclaimIfHidden() {
    if (this.visible || !this.view || this.busy()) return false;
    return this.release({ keepUrl: true });
  }
  ensure() {
    if (this.view) return this.view;
    const pages = this.session.fromPartition('persist:fairy-browser');
    pages.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    pages.setPermissionCheckHandler(() => false);
    pages.on('will-download', event => { event.preventDefault(); this.note = 'Downloads aren’t available in this browser. Open the page in your own browser instead.'; this.publish(); });
    this.view = new this.WebContentsView({ webPreferences: { session: pages, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    const { webContents: page } = this.view;
    // Keys go to the page while it has focus, so ⌘K has to be caught here to still open the palette.
    page.on('before-input-event', (event, input) => { if (input.type === 'keyDown' && input.meta && !input.shift && !input.alt && input.key.toLowerCase() === 'k') { event.preventDefault(); this.window?.webContents.focus(); this.window?.webContents.send('fairy:palette'); } });
    page.setWindowOpenHandler(({ url }) => { if (isWeb(url)) void page.loadURL(url).catch(() => {}); return { action: 'deny' }; });
    const keepToWeb = event => { if (!isWeb(event.url)) event.preventDefault(); };
    page.on('will-navigate', keepToWeb); page.on('will-redirect', keepToWeb);
    page.on('did-start-loading', () => { this.note = ''; this.publish(); });
    for (const name of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) page.on(name, () => this.publish());
    page.on('did-fail-load', (_event, code, description, _url, isMain) => { if (isMain && code !== -3) { this.note = `Couldn’t load this page: ${description}`; this.publish(); } });
    this.window.contentView.addChildView(this.view);
    this.view.setVisible(this.visible);
    return this.view;
  }
  state() {
    const page = this.view?.webContents;
    return { url: page?.getURL() || this.lastUrl || '', title: page?.getTitle() || '', loading: page?.isLoading() || false, canBack: page?.navigationHistory.canGoBack() || false, canForward: page?.navigationHistory.canGoForward() || false, note: this.note };
  }
  publish() { if (this.window && !this.window.isDestroyed()) this.onState(this.state()); }
  async go(input) {
    const url = browserAddress(input), page = this.ensure().webContents;
    this.cancelIdle();
    this.lastUrl = url;
    this.needsRestore = false;
    this.note = '';
    page.loadURL(url).catch(() => {});
    return this.state();
  }
  command(name) {
    const page = this.view?.webContents;
    if (!page) return this.state();
    if (name === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
    if (name === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
    if (name === 'reload') page.reload();
    if (name === 'stop') page.stop();
    return this.state();
  }
  place(bounds) {
    const [width, height] = this.window.getContentSize();
    this.ensure().setBounds(cleanBounds(bounds, { width, height }));
  }
  show(value) {
    this.visible = value === true;
    if (this.visible) {
      this.cancelIdle();
      if (this.needsRestore && this.lastUrl) {
        this.needsRestore = false;
        this.ensure().webContents.loadURL(this.lastUrl).catch(() => {});
      }
      this.view?.setVisible(true);
      return;
    }
    this.view?.setVisible(false);
    this.scheduleIdle();
  }
  close() {
    this.cancelIdle();
    this.lastUrl = '';
    this.needsRestore = false;
    this.destroyView();
  }
}
