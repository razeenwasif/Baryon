import { searchURL, webURL } from './browser.mjs';

export interface BrowserPaneBounds {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface BrowserPaneState {
  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;
  note: string;
}

export interface BrowserPaneWebContents {
  on(event: string, listener: (...args: any[]) => void): unknown;
  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' | 'allow' }): void;
  loadURL(url: string): Promise<unknown>;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  reload(): void;
  stop(): void;
  focus(): void;
  send(channel: string, ...args: unknown[]): void;
  close?(): void;
  navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
}

export interface BrowserPaneView {
  webContents: BrowserPaneWebContents;
  setVisible(visible: boolean): void;
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void;
}

export interface BrowserPaneWindow {
  isDestroyed(): boolean;
  getContentSize(): number[];
  webContents: {
    focus(): void;
    send(channel: string, ...args: unknown[]): void;
  };
  contentView: {
    addChildView(view: BrowserPaneView): void;
    removeChildView?(view: BrowserPaneView): void;
  };
}

export interface BrowserPaneSessionPartition {
  setPermissionRequestHandler(handler: (contents: unknown, permission: unknown, callback: (granted: boolean) => void) => void): void;
  setPermissionCheckHandler(handler: () => boolean): void;
  on(event: string, listener: (event: { preventDefault(): void }) => void): unknown;
}

export interface BrowserPaneSession {
  fromPartition(partition: string): BrowserPaneSessionPartition;
}

export type BrowserPaneViewCtor = new (options: {
  webPreferences: {
    session: BrowserPaneSessionPartition;
    sandbox: boolean;
    contextIsolation: boolean;
    nodeIntegration: boolean;
    webviewTag: boolean;
  };
}) => BrowserPaneView;

export interface BrowserPaneTimerHandle {
  unref?: () => void;
}

export interface BrowserPaneOptions<TTimer = BrowserPaneTimerHandle> {
  getWindow: () => BrowserPaneWindow;
  WebContentsView: BrowserPaneViewCtor;
  session: BrowserPaneSession;
  onState: (state: BrowserPaneState) => void;
  idleMs?: number;
  schedule?: (fn: () => void, ms: number) => TTimer;
  clear?: (handle: TTimer) => void;
  busy?: () => boolean;
}

// What was typed into the address bar: an address, or else a search.
export function browserAddress(input: unknown): string {
  const text = String(input ?? '').trim();
  if (!text || text.length > 2048) throw new Error('Type an address or a search.');
  if (/^https?:\/\//i.test(text)) return webURL(text).href;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) || /^(?:file|javascript|data|about|blob|chrome):/i.test(text)) throw new Error('Only web addresses can be opened here.');
  if (/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(text)) return webURL(`http://${text}`).href;
  if (!/\s/.test(text) && /^[^\s/]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i.test(text)) return webURL(`https://${text}`).href;
  return searchURL(text);
}
const isWeb = (url: string): boolean => /^https?:\/\//i.test(url);
export function cleanBounds(
  value: BrowserPaneBounds | null | undefined,
  limits: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const number = (key: keyof BrowserPaneBounds): number => Math.max(0, Math.round(Number(value?.[key]) || 0));
  const x = Math.min(number('x'), limits.width), y = Math.min(number('y'), limits.height);
  return { x, y, width: Math.min(number('width'), limits.width - x), height: Math.min(number('height'), limits.height - y) };
}
// A page in its own view and storage, with no bridge to the app. Logins stay in this browser only.
// When hidden beyond idleMs (or when the main window enters idle reclamation), its WebContentsView is closed
// while remembering lastUrl so Chromium frees its renderer + GPU buffers until the panel opens again.
export class BrowserPane<TTimer extends BrowserPaneTimerHandle = BrowserPaneTimerHandle> {
  getWindow: () => BrowserPaneWindow;
  WebContentsView: BrowserPaneViewCtor;
  session: BrowserPaneSession;
  onState: (state: BrowserPaneState) => void;
  idleMs: number;
  schedule: (fn: () => void, ms: number) => TTimer;
  clear: (handle: TTimer) => void;
  busy: () => boolean;
  view: BrowserPaneView | null;
  visible: boolean;
  note: string;
  lastUrl: string;
  needsRestore: boolean;
  idleTimer: TTimer | null;

  constructor({
    getWindow,
    WebContentsView,
    session,
    onState,
    idleMs = 120_000,
    schedule = ((fn: () => void, ms: number) => setTimeout(fn, ms)) as unknown as (fn: () => void, ms: number) => TTimer,
    clear = ((handle: TTimer) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>)) as unknown as (handle: TTimer) => void,
    busy = () => false,
  }: BrowserPaneOptions<TTimer>) {
    this.getWindow = getWindow;
    this.WebContentsView = WebContentsView;
    this.session = session;
    this.onState = onState;
    this.idleMs = idleMs;
    this.schedule = schedule;
    this.clear = clear;
    this.busy = busy;
    this.view = null; this.visible = false; this.note = ''; this.lastUrl = ''; this.needsRestore = false; this.idleTimer = null;
  }
  get window(): BrowserPaneWindow { return this.getWindow(); }
  cancelIdle(): void {
    if (this.idleTimer !== null) {
      this.clear(this.idleTimer);
      this.idleTimer = null;
    }
  }
  scheduleIdle(): void {
    this.cancelIdle();
    if (this.visible || !this.view || !(this.idleMs > 0)) return;
    this.idleTimer = this.schedule(() => {
      this.idleTimer = null;
      this.reclaimIfHidden();
    }, this.idleMs);
    this.idleTimer?.unref?.();
  }
  destroyView(): void {
    if (!this.view) return;
    try {
      this.window?.contentView?.removeChildView?.(this.view);
      this.view.webContents?.close?.();
    } catch {}
    this.view = null;
  }
  release({ keepUrl = true }: { keepUrl?: boolean } = {}): boolean {
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
  reclaimIfHidden(): boolean {
    if (this.visible || !this.view || this.busy()) return false;
    return this.release({ keepUrl: true });
  }
  ensure(): BrowserPaneView {
    if (this.view) return this.view;
    const pages = this.session.fromPartition('persist:fairy-browser');
    pages.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    pages.setPermissionCheckHandler(() => false);
    pages.on('will-download', event => { event.preventDefault(); this.note = 'Downloads aren’t available in this browser. Open the page in your own browser instead.'; this.publish(); });
    this.view = new this.WebContentsView({ webPreferences: { session: pages, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    const { webContents: page } = this.view;
    // Keys go to the page while it has focus, so ⌘K has to be caught here to still open the palette.
    page.on('before-input-event', (event: { preventDefault(): void }, input: { type: string; meta: boolean; shift: boolean; alt: boolean; key: string }) => { if (input.type === 'keyDown' && input.meta && !input.shift && !input.alt && input.key.toLowerCase() === 'k') { event.preventDefault(); this.window?.webContents.focus(); this.window?.webContents.send('fairy:palette'); } });
    page.setWindowOpenHandler(({ url }) => { if (isWeb(url)) void page.loadURL(url).catch(() => {}); return { action: 'deny' }; });
    const keepToWeb = (event: { url: string; preventDefault(): void }): void => { if (!isWeb(event.url)) event.preventDefault(); };
    page.on('will-navigate', keepToWeb); page.on('will-redirect', keepToWeb);
    page.on('did-start-loading', () => { this.note = ''; this.publish(); });
    for (const name of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page', 'page-title-updated']) page.on(name, () => this.publish());
    page.on('did-fail-load', (_event: unknown, code: number, description: string, _url: string, isMain: boolean) => { if (isMain && code !== -3) { this.note = `Couldn’t load this page: ${description}`; this.publish(); } });
    this.window.contentView.addChildView(this.view);
    this.view.setVisible(this.visible);
    return this.view;
  }
  state(): BrowserPaneState {
    const page = this.view?.webContents;
    return { url: page?.getURL() || this.lastUrl || '', title: page?.getTitle() || '', loading: page?.isLoading() || false, canBack: page?.navigationHistory.canGoBack() || false, canForward: page?.navigationHistory.canGoForward() || false, note: this.note };
  }
  publish(): void { if (this.window && !this.window.isDestroyed()) this.onState(this.state()); }
  async go(input: unknown): Promise<BrowserPaneState> {
    const url = browserAddress(input), page = this.ensure().webContents;
    this.cancelIdle();
    this.lastUrl = url;
    this.needsRestore = false;
    this.note = '';
    page.loadURL(url).catch(() => {});
    return this.state();
  }
  command(name: string): BrowserPaneState {
    const page = this.view?.webContents;
    if (!page) return this.state();
    if (name === 'back' && page.navigationHistory.canGoBack()) page.navigationHistory.goBack();
    if (name === 'forward' && page.navigationHistory.canGoForward()) page.navigationHistory.goForward();
    if (name === 'reload') page.reload();
    if (name === 'stop') page.stop();
    return this.state();
  }
  place(bounds: BrowserPaneBounds | null | undefined): void {
    const [width = 0, height = 0] = this.window.getContentSize();
    this.ensure().setBounds(cleanBounds(bounds, { width, height }));
  }
  show(value: unknown): void {
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
  close(): void {
    this.cancelIdle();
    this.lastUrl = '';
    this.needsRestore = false;
    this.destroyView();
  }
}
