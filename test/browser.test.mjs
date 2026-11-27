import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { ordinaryWebURL, webURL, searchURL, assertDesktopContext, desktopContextText } from '../desktop/browser.mjs';
import { BrowserPane } from '../desktop/browser-pane.mjs';
import { validateActions, runDesktop, DEFAULTS } from '../desktop/core.mjs';
import { actionReview } from '../desktop/action-review.mjs';
import { runSubscriptionDesktop } from '../desktop/codex.mjs';
const focus = { pid: 12, bundleId: 'com.apple.Safari', bundlePath: '/Applications/Safari.app', window: { standard: true, hasSheet: false, id: 'tab-window', title: 'Example', x: 0, y: 0, width: 1000, height: 800 }, browser: { url: 'https://example.com/', title: 'Example', text: 'Example Domain' } };
const dimensions = { focus, width: 1000, height: 800, bounds: { x: 0, y: 0, width: 1000, height: 800 }, url: 'data:image/png;base64,test' };
const navigate = url => ({ type: 'browser_navigate', url });
test('web addresses reject executable schemes, credentials and injected keystrokes', () => {
  for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,hi', 'https://user:pass@example.com', 'https://example.com\n', 'calculator', 'https://example.com/\u0000']) assert.throws(() => webURL(url));
  assert.equal(webURL('https://example.com').hostname, 'example.com');
});
test('normal research pages are automatic while consequential, local and unfamiliar query URLs need review', () => {
  for (const url of ['https://example.com/', 'https://science.nasa.gov/universe/', 'https://www.google.com/search?q=astronomy']) assert.equal(ordinaryWebURL(url), true, url);
  for (const url of ['http://example.com', 'https://localhost/', 'https://127.1/', 'https://[::1]/', 'https://192.168.1.1/', 'https://intranet/', 'https://foo.local/', 'https://example.com/logout', 'https://example.com/%2564elete/item', 'https://example.com/checkout', 'https://example.com/api/run', 'https://example.com/tool.dmg', 'https://example.com/?action=delete', 'https://example.com/?token=secret']) assert.equal(ordinaryWebURL(url), false, url);
});
test('search encodes text as one query rather than interpreting URLs or commands', () => {
  const query = 'stars & galaxies? + "space"';
  const url = new URL(searchURL(query)); assert.equal(url.origin, 'https://www.google.com'); assert.equal(url.searchParams.get('q'), query); assert.equal([...url.searchParams].length, 1);
  for (const invalid of ['', 'x\ny', 'x'.repeat(301)]) assert.throws(() => searchURL(invalid));
});
test('Safari browser actions require genuine observed app context and one action per batch', () => {
  for (const action of [navigate('https://example.com'), { type: 'browser_search', query: 'stars' }, { type: 'browser_tab', direction: 'previous' }]) {
    assert.equal(actionReview([action], dimensions).required, false);
    assert.equal(actionReview([action], { ...dimensions, focus: { ...focus, bundlePath: '/tmp/Safari.app' } }).required, true);
    assert.equal(actionReview([action], { ...dimensions, focus: { ...focus, window: { ...focus.window, hasSheet: true } } }).required, true);
  }
  assert.equal(actionReview([navigate('https://example.com'), { type: 'keypress', keys: ['ENTER'] }], dimensions).required, true);
  for (const action of [{ type: 'click', button: 'left', x: 50, y: 50 }, { type: 'type', text: 'message' }, { type: 'keypress', keys: ['ENTER'] }, navigate('https://example.com/checkout')]) assert.equal(actionReview([action], dimensions).required, true);
  assert.throws(() => validateActions([{ type: 'browser_tab', direction: 'close' }], 1000, 800));
});
test('focus, window and tab changes invalidate automatic execution; loading text alone does not', () => {
  assert.doesNotThrow(() => assertDesktopContext(focus, { ...focus, browser: { ...focus.browser, text: 'loaded more' } }));
  for (const changed of [{ ...focus, pid: 33 }, { ...focus, window: { ...focus.window, id: 'other-window' } }, { ...focus, browser: { ...focus.browser, url: 'https://example.org' } }]) assert.throws(() => assertDesktopContext(focus, changed), { code: 'DESKTOP_CONTEXT_CHANGED' });
  const context = desktopContextText({ focus: { ...focus, browser: { ...focus.browser, text: 'x'.repeat(20000) } } }); assert(context.length < 13000); assert.match(context, /untrusted/);
});
function fixture() {
  return { settings: DEFAULTS, task: 'Search Safari', signal: new AbortController().signal, onProgress() {}, capture: async () => dimensions, approve: async () => true, execute: async () => {} };
}
test('subscription returns a fresh observation after stale context and allows a newly chosen action', async () => {
  let executions = 0;
  const args = fixture(); args.execute = async () => { if (++executions === 1) throw Object.assign(new Error('focus moved'), { code: 'DESKTOP_CONTEXT_CHANGED' }); };
  args.provider = { turn: async ({ toolHandler, input }) => {
    assert.match(input[0].text, /Example Domain/);
    const call = { tool: 'fairy_desktop', arguments: { actions: [navigate('https://example.com/')] } };
    const first = await toolHandler(call); assert.equal(first.success, false); assert.match(first.contentItems[0].text, /focus moved/); assert.equal(first.contentItems[1].type, 'inputImage');
    const second = await toolHandler(call); assert.equal(second.success, true); return 'Verified Example Domain';
  } };
  assert.equal(await runSubscriptionDesktop(args), 'Verified Example Domain'); assert.equal(executions, 2);
});
test('repeated focus failures stop; cancellation and ordinary errors are not retried', async () => {
  for (const code of ['DESKTOP_CONTEXT_CHANGED', 'OTHER']) {
    let attempts = 0; const args = fixture(); args.execute = async () => { attempts++; throw Object.assign(new Error('paused'), { code }); };
    args.provider = { turn: async ({ toolHandler }) => { for (let i = 0; i < 4; i++) await toolHandler({ tool: 'fairy_desktop', arguments: { actions: [navigate('https://example.com')] } }); } };
    await assert.rejects(runSubscriptionDesktop(args), /paused/); assert.equal(attempts, code === 'OTHER' ? 1 : 3);
  }
});
test('API browser function uses the same validation, review, execution and observation path', async () => {
  const args = fixture(); let calls = 0, executed = 0;
  args.execute = async actions => { assert.equal(actions[0].type, 'browser_search'); executed++; };
  args.provider = { response: async body => {
    assert(body.tools.some(tool => tool.name === 'fairy_browser'));
    if (++calls === 1) return { output: [{ type: 'function_call', name: 'fairy_browser', call_id: 'browser-1', arguments: JSON.stringify({ actions: [{ type: 'browser_search', query: 'stars' }] }) }] };
    assert(body.input.some(item => item.type === 'function_call_output' && /Example Domain/.test(item.output)));
    return { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Verified page' }] }] };
  } };
  assert.equal(await runDesktop(args), 'Verified page'); assert.equal(executed, 1);
});

test('BrowserPane reclaims hidden WebContentsView after idle timeout and reloads lastUrl when shown again', async () => {
  const views = [], timers = [], states = [];
  let isBusy = false;
  const win = {
    destroyed: false,
    isDestroyed: () => win.destroyed,
    getContentSize: () => [1200, 800],
    webContents: { focus() {}, send() {} },
    contentView: {
      children: [],
      addChildView(v) { this.children.push(v); },
      removeChildView(v) { this.children = this.children.filter(c => c !== v); },
    },
  };
  class FakeWebContentsView {
    constructor() {
      const wc = new EventEmitter();
      Object.assign(wc, {
        currentUrl: '', closed: false,
        setWindowOpenHandler() {},
        loadURL: async url => { wc.currentUrl = url; },
        getURL: () => wc.currentUrl,
        getTitle: () => 'Example',
        isLoading: () => false,
        navigationHistory: { canGoBack: () => false, canGoForward: () => false, goBack() {}, goForward() {} },
        close: () => { wc.closed = true; },
      });
      this.webContents = wc; this.visible = false; this.bounds = null;
      views.push(this);
    }
    setVisible(v) { this.visible = v; }
    setBounds(b) { this.bounds = b; }
  }
  const fakeSession = { fromPartition: () => Object.assign(new EventEmitter(), { setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }) };
  const pane = new BrowserPane({
    getWindow: () => win, WebContentsView: FakeWebContentsView, session: fakeSession,
    onState: s => states.push(s), idleMs: 5000,
    schedule: (fn, ms) => { const entry = { fn, ms }; timers.push(entry); return entry; },
    clear: entry => { const i = timers.indexOf(entry); if (i >= 0) timers.splice(i, 1); },
    busy: () => isBusy,
  });

  await pane.go('https://example.com/');
  assert.equal(views.length, 1);
  assert.equal(pane.state().url, 'https://example.com/');

  // Hiding schedules reclamation; busy agent blocks reclamation.
  pane.show(false);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 5000);
  isBusy = true;
  assert.equal(pane.reclaimIfHidden(), false);
  assert.ok(pane.view);

  isBusy = false;
  timers.shift().fn();
  assert.equal(pane.view, null);
  assert.equal(views[0].webContents.closed, true);
  assert.equal(win.contentView.children.length, 0);
  assert.equal(pane.state().url, 'https://example.com/');
  assert.equal(states.at(-1).url, 'https://example.com/');

  // Simulate place() followed by show(true) as browser-pane-view.js does.
  pane.place({ x: 10, y: 20, width: 600, height: 400 });
  pane.show(true);
  assert.equal(views.length, 2);
  assert.equal(views[1].webContents.currentUrl, 'https://example.com/');
  assert.equal(views[1].visible, true);

  // close() clears remembered URL and idle timer.
  pane.show(false);
  assert.equal(timers.length, 1);
  pane.close();
  assert.equal(timers.length, 0);
  assert.equal(pane.state().url, '');
});
