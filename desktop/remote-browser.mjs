// Fairy away from the mini: the browser in Fairy's window on the face's Mac. That window has its own browser pane, with
// that Mac's own sign-ins (browser-pane.mjs there). When a turn started from that window uses the browser, each of her
// steps is sent to it over the link (face-link.mjs browserStep) and run there by its own AgentBrowser; what she sees comes
// back. A turn started on this Mac keeps this Mac's pane.
//
// RemoteBrowser is this Mac's side, with AgentBrowser's methods, so work-tools.mjs drives either. runBrowserStep is the
// face's side. cleanPage and cleanShot check what comes back before it reaches the model.
import { BROWSER_KEYS } from './agent-browser.mjs';
import { browserAddress } from './browser-pane.mjs';

// state, go and read are a plain chat's (chat-browser.mjs): no chat holds the browser for them.
export const STEPS = Object.freeze(['url', 'state', 'go', 'read', 'open', 'show', 'click', 'type', 'press_key', 'scroll', 'back', 'screenshot', 'release']);
const MAX_TEXT = 40000, MAX_ELEMENTS = 300, MAX_SHOT = 6 * 1024 * 1024;
const text = (value, limit) => String(typeof value === 'string' ? value : '').slice(0, limit);

// A page as AgentBrowser's read() gives it, with only the fields the model is shown.
export function cleanPage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Your MacBook sent a page that wasn’t understood.');
  const elements = (Array.isArray(value.elements) ? value.elements : []).slice(0, MAX_ELEMENTS)
    .filter(item => item && Number.isInteger(item.ref) && item.ref > 0)
    .map(item => ({ ref: item.ref, kind: text(item.kind, 40), name: text(item.name, 100), secret: item.secret === true }));
  return { url: text(value.url, 2048), title: text(value.title, 500), text: text(value.text, MAX_TEXT), elements };
}
export function cleanShot(value) {
  if (typeof value !== 'string' || value.length > MAX_SHOT || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/.test(value)) throw new Error('Your MacBook sent a picture that wasn’t understood.');
  return value;
}

export class RemoteBrowser {
  // step(tool, args, signal) runs one step on the face's Mac and resolves its result; shown(owner) says whether that chat
  // is the one open in the window, as this Mac's own browser only opens its panel for the chat on screen.
  constructor({ step, shown = () => true }) { Object.assign(this, { step, shown }); this.owner = null; this.lastUrl = ''; }
  address(value) { return browserAddress(value); }
  // The page open there now (the user may have opened it themselves), asked for each time.
  async url() {
    try { this.lastUrl = text(await this.step('url', {}), 2048); } catch {}
    return this.lastUrl;
  }
  release(owner) {
    if (this.owner !== owner) return;
    this.owner = null;
    void this.step('release', { owner }).catch(() => {});
  }
  async run(tool, owner, args, signal) {
    if (this.owner && this.owner !== owner) throw new Error('Another chat is using the browser. Wait for it to finish.');
    this.owner = owner;
    const result = await this.step(tool, { ...args, owner, reveal: this.shown(owner) === true }, signal);
    if (tool === 'screenshot') return cleanShot(result);
    const page = cleanPage(result);
    this.lastUrl = page.url;
    return page;
  }
  open(owner, address, signal) { return this.run('open', owner, { address: browserAddress(address) }, signal); }
  show(owner, signal) { return this.run('show', owner, {}, signal); }
  click(owner, ref, signal) { return this.run('click', owner, { ref }, signal); }
  type(owner, ref, value, submit, signal) { return this.run('type', owner, { ref, text: value, submit: submit === true }, signal); }
  press_key(owner, key, signal) { return this.run('press_key', owner, { key }, signal); }
  scroll(owner, amount, signal) { return this.run('scroll', owner, { amount }, signal); }
  back(owner, signal) { return this.run('back', owner, {}, signal); }
  screenshot(owner, signal) { return this.run('screenshot', owner, {}, signal); }
}

// The face's side: one step from the other Mac, run by this Mac's AgentBrowser on its own pane. reveal(owner) opens the
// panel in the window when the step says that chat is on screen.
export async function runBrowserStep(drive, { tool, args = {} } = {}, { signal, reveal = () => {} } = {}) {
  if (!STEPS.includes(tool)) throw new Error('That isn’t a browser step.');
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
  if (tool === 'type') return drive.type(owner, Number(args.ref), args.text, args.submit === true, signal);
  if (tool === 'press_key') { if (!BROWSER_KEYS.has(args.key)) throw new Error(`Use one of: ${[...BROWSER_KEYS].join(', ')}.`); return drive.press_key(owner, args.key, signal); }
  if (tool === 'scroll') return drive.scroll(owner, Number(args.amount) || 600, signal);
  if (tool === 'back') return drive.back(owner, signal);
  return drive.screenshot(owner, signal);
}
