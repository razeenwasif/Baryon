// Fairy away from the mini: the browser in Fairy's window on the face's Mac. That window has its own browser pane, with
// that Mac's own sign-ins (browser-pane.mjs there). When a turn started from that window uses the browser, each of her
// steps is sent to it over the link (face-link.mjs browserStep) and run there by its own AgentBrowser; what she sees comes
// back. A turn started on this Mac keeps this Mac's pane.
//
// RemoteBrowser is this Mac's side, with AgentBrowser's methods, so work-tools.mjs drives either. runBrowserStep is the
// face's side. cleanPage and cleanShot check what comes back before it reaches the model.
import { BROWSER_KEYS, type PageSnapshot } from './agent-browser.mjs';
import { browserAddress } from './browser-pane.mjs';

// state, go and read are a plain chat's (chat-browser.mjs): no chat holds the browser for them.
export const STEPS = Object.freeze(['url', 'state', 'go', 'read', 'open', 'show', 'click', 'type', 'press_key', 'scroll', 'back', 'screenshot', 'release'] as const);
export type BrowserStepName = (typeof STEPS)[number];

const MAX_TEXT = 40000, MAX_ELEMENTS = 300, MAX_SHOT = 6 * 1024 * 1024;
const text = (value: unknown, limit: number): string => String(typeof value === 'string' ? value : '').slice(0, limit);

export type RemoteBrowserStepFn = (tool: string, args: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;

export interface RemoteBrowserOptions {
  step: RemoteBrowserStepFn;
  shown?: (owner: unknown) => boolean;
}

export interface RemoteBrowserDrive {
  pane: {
    visible: boolean;
    go(address: unknown): Promise<unknown>;
  };
  page: unknown;
  owner: unknown;
  url(): string;
  read(): Promise<PageSnapshot>;
  release(owner: unknown): void;
  open(owner: unknown, address: unknown, signal?: AbortSignal): Promise<PageSnapshot>;
  show(owner: unknown, signal?: AbortSignal): Promise<PageSnapshot>;
  click(owner: unknown, ref: number | string, signal?: AbortSignal): Promise<PageSnapshot>;
  type(owner: unknown, ref: number | string, text: string, submit?: boolean, signal?: AbortSignal): Promise<PageSnapshot>;
  press_key(owner: unknown, name: string, signal?: AbortSignal): Promise<PageSnapshot>;
  scroll(owner: unknown, amount?: number, signal?: AbortSignal): Promise<PageSnapshot>;
  back(owner: unknown, signal?: AbortSignal): Promise<PageSnapshot>;
  screenshot(owner: unknown, signal?: AbortSignal): Promise<string>;
}

export interface BrowserStepPayload {
  tool?: string;
  args?: Record<string, unknown>;
}

export interface RunBrowserStepOptions {
  signal?: AbortSignal;
  reveal?: (owner: string) => void;
}

// A page as AgentBrowser's read() gives it, with only the fields the model is shown.
export function cleanPage(value: unknown): PageSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Your MacBook sent a page that wasn’t understood.');
  const raw = value as { url?: unknown; title?: unknown; text?: unknown; elements?: unknown };
  const elements = (Array.isArray(raw.elements) ? raw.elements : []).slice(0, MAX_ELEMENTS)
    .filter((item): item is { ref: number; kind?: unknown; name?: unknown; secret?: unknown } =>
      Boolean(item && typeof item === 'object' && Number.isInteger((item as { ref?: unknown }).ref) && (item as { ref: number }).ref > 0))
    .map(item => ({ ref: item.ref, kind: text(item.kind, 40), name: text(item.name, 100), secret: item.secret === true }));
  return { url: text(raw.url, 2048), title: text(raw.title, 500), text: text(raw.text, MAX_TEXT), elements };
}
export function cleanShot(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_SHOT || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('Your MacBook sent a picture that wasn’t understood.');
  return value;
}

export class RemoteBrowser {
  step: RemoteBrowserStepFn;
  shown: (owner: unknown) => boolean;
  owner: unknown;
  lastUrl: string;

  // step(tool, args, signal) runs one step on the face's Mac and resolves its result; shown(owner) says whether that chat
  // is the one open in the window, as this Mac's own browser only opens its panel for the chat on screen.
  constructor({ step, shown = () => true }: RemoteBrowserOptions) {
    this.step = step;
    this.shown = shown;
    this.owner = null;
    this.lastUrl = '';
  }
  address(value: unknown): string { return browserAddress(value); }
  // The page open there now (the user may have opened it themselves), asked for each time.
  async url(): Promise<string> {
    try { this.lastUrl = text(await this.step('url', {}), 2048); } catch {}
    return this.lastUrl;
  }
  release(owner: unknown): void {
    if (this.owner !== owner) return;
    this.owner = null;
    void this.step('release', { owner }).catch(() => {});
  }
  async run(tool: 'screenshot', owner: unknown, args: Record<string, unknown>, signal?: AbortSignal): Promise<string>;
  async run(tool: string, owner: unknown, args: Record<string, unknown>, signal?: AbortSignal): Promise<PageSnapshot>;
  async run(tool: string, owner: unknown, args: Record<string, unknown>, signal?: AbortSignal): Promise<PageSnapshot | string> {
    if (this.owner && this.owner !== owner) throw new Error('Another chat is using the browser. Wait for it to finish.');
    this.owner = owner;
    const result = await this.step(tool, { ...args, owner, reveal: this.shown(owner) === true }, signal);
    if (tool === 'screenshot') return cleanShot(result);
    const page = cleanPage(result);
    this.lastUrl = page.url;
    return page;
  }
  open(owner: unknown, address: unknown, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('open', owner, { address: browserAddress(address) }, signal); }
  show(owner: unknown, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('show', owner, {}, signal); }
  click(owner: unknown, ref: number | string, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('click', owner, { ref }, signal); }
  type(owner: unknown, ref: number | string, value: string, submit?: boolean, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('type', owner, { ref, text: value, submit: submit === true }, signal); }
  press_key(owner: unknown, key: string, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('press_key', owner, { key }, signal); }
  scroll(owner: unknown, amount?: number, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('scroll', owner, { amount }, signal); }
  back(owner: unknown, signal?: AbortSignal): Promise<PageSnapshot> { return this.run('back', owner, {}, signal); }
  screenshot(owner: unknown, signal?: AbortSignal): Promise<string> { return this.run('screenshot', owner, {}, signal); }
}

// The face's side: one step from the other Mac, run by this Mac's AgentBrowser on its own pane. reveal(owner) opens the
// panel in the window when the step says that chat is on screen.
export async function runBrowserStep(
  drive: RemoteBrowserDrive,
  { tool, args = {} }: BrowserStepPayload = {},
  { signal, reveal = () => {} }: RunBrowserStepOptions = {},
): Promise<unknown> {
  if (!tool || !(STEPS as readonly string[]).includes(tool)) throw new Error('That isn’t a browser step.');
  if (tool === 'url') return drive.url();
  if (tool === 'state') return { url: drive.url(), shown: drive.pane.visible === true };
  if (tool === 'go') { reveal(''); return drive.pane.go(browserAddress(args.address)); }
  if (tool === 'read') return drive.page ? drive.read() : null;
  const owner = typeof args.owner === 'string' && args.owner ? args.owner.slice(0, 200) : '';
  if (!owner) throw new Error('Say which chat this step is for.');
  if (tool === 'release') { drive.release(owner); return null; }
  if (args.reveal === true && (!drive.owner || drive.owner === owner)) reveal(owner);
  if (tool === 'open') return drive.open(owner, browserAddress(args.address), signal);
  if (tool === 'show') return drive.show(owner, signal);
  if (tool === 'click') return drive.click(owner, Number(args.ref), signal);
  if (tool === 'type') return drive.type(owner, Number(args.ref), args.text as string, args.submit === true, signal);
  if (tool === 'press_key') { if (typeof args.key !== 'string' || !BROWSER_KEYS.has(args.key)) throw new Error(`Use one of: ${[...BROWSER_KEYS].join(', ')}.`); return drive.press_key(owner, args.key, signal); }
  if (tool === 'scroll') return drive.scroll(owner, Number(args.amount) || 600, signal);
  if (tool === 'back') return drive.back(owner, signal);
  return drive.screenshot(owner, signal);
}
