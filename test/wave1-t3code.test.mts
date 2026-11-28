import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createComposerQueue } from '../src/composer-queue.js';
import { createComposerStash } from '../src/composer-stash.js';
import { createSideChatStore } from '../src/side-chat-pane.js';
import { extractAssistantQuote, formatQuotedPrompt } from '../src/quote-selection.js';
import { railWheelDelta } from '../src/message-rail.js';
import { createSidebarShiftGuard } from '../src/sidebar-shift-guard.js';

const require = createRequire(import.meta.url);
const { makeQuitShortcutHandler, QUIT_HOLD_DURATION_MS } = require('../desktop/quit-hold.cjs');

test('composerQueue isolates sessions, promotes steered items, and pauses cleanly', () => {
  let seq = 0;
  const q = createComposerQueue({ idFactory: () => `q-${++seq}`, now: () => 1000 });
  assert.equal(q.enqueue('s1', { text: '   ' }), null);

  const a = q.enqueue('s1', { text: 'first follow-up' })!;
  const b = q.enqueue('s1', { text: 'second follow-up', quotes: [{ snippet: 'quoted' }] })!;
  const c = q.enqueue('s2', { text: 'other chat' })!;

  assert.equal(q.count('s1'), 2);
  assert.equal(q.count('s2'), 1);
  assert.equal(a.id, 'q-1');
  assert.equal(c.id, 'q-3');

  // Promoting b brings it ahead of a and clears paused state.
  q.setPaused('s1', true);
  assert.equal(q.isPaused('s1'), true);
  q.promoteToFront('s1', b.id);
  assert.equal(q.isPaused('s1'), false);
  assert.deepEqual(q.list('s1').map(x => x.id), [b.id, a.id]);

  assert.equal(q.shift('s1')!.id, b.id);
  assert.equal(q.remove('s1', a.id)!.id, a.id);
  assert.equal(q.count('s1'), 0);
  assert.equal(q.count('s2'), 1);
  q.clear('s2');
  assert.equal(q.count('s2'), 0);
});

test('composerStash persists drafts per session up to maxEntries and pops cleanly', () => {
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => { mem.set(k, v); },
  };
  let seq = 0;
  const stash = createComposerStash({ storage, maxEntries: 2, idFactory: () => `st-${++seq}`, now: () => 5000 });
  assert.equal(stash.push('s1', { text: '' }), null);

  const s1a = stash.push('s1', { text: 'draft one' })!;
  const s1b = stash.push('s1', { text: 'draft two', attachments: [{ id: 'a1', name: 'notes.md' }] })!;
  const s1c = stash.push('s1', { text: 'draft three', quotes: [{ snippet: 'passage' }] })!;
  stash.push('s2', { text: 'other session draft' });

  // Bounded to maxEntries=2 (newest first).
  assert.deepEqual(stash.list('s1').map(x => x.id), [s1c.id, s1b.id]);
  assert.equal(s1a.id, 'st-1');

  // Rehydrate from storage.
  const reloaded = createComposerStash({ storage });
  assert.equal(reloaded.count('s1'), 2);
  assert.equal(reloaded.count('s2'), 1);

  const popped = reloaded.pop('s1', s1b.id)!;
  assert.equal(popped.text, 'draft two');
  assert.equal(popped.attachments.length, 1);
  assert.equal(reloaded.count('s1'), 1);
  assert.equal(reloaded.remove('s1', s1c.id), true);
  assert.equal(reloaded.count('s1'), 0);
});

test('sideChatStore tracks disposable turns per session and formats quotes cleanly', () => {
  const store = createSideChatStore({ now: () => 42 });
  store.append('chat-1', { question: 'Why does X fail?', answer: 'Because Y is null.', quote: 'TypeError: Y' });
  const prompt = store.buildPrompt('chat-1', 'How do I fix it?', 'line 12');
  assert.match(prompt, /Earlier in this side chat:/);
  assert.match(prompt, /Why does X fail\?/);
  assert.match(prompt, /> line 12/);
  assert.match(prompt, /How do I fix it\?/);

  const mainInsert = store.formatForMainChat(store.turns('chat-1')[0]);
  assert.match(mainInsert, /> Side question: Why does X fail\?/);
  assert.match(mainInsert, /> Because Y is null\./);

  store.clear('chat-1');
  assert.equal(store.turns('chat-1').length, 0);

  const trimmed = extractAssistantQuote('word '.repeat(80), 40);
  assert.ok(trimmed.endsWith('…'));
  assert.ok(trimmed.length <= 41);

  const combined = formatQuotedPrompt([{ snippet: 'Line A\nLine B', comment: 'check this' }], 'Explain?');
  assert.equal(combined, '> Line A\n> Line B\nNote: check this\n\nExplain?');
});

test('railWheelDelta forwards wheel events at edges or when unscrollable', () => {
  assert.equal(railWheelDelta({ deltaY: 30, ticksScrollTop: 0, ticksScrollHeight: 100, ticksClientHeight: 100 }), 30);
  assert.equal(railWheelDelta({ deltaY: -20, ticksScrollTop: 0, ticksScrollHeight: 300, ticksClientHeight: 100 }), -20);
  assert.equal(railWheelDelta({ deltaY: 20, ticksScrollTop: 0, ticksScrollHeight: 300, ticksClientHeight: 100 }), 0);
  assert.equal(railWheelDelta({ deltaY: 20, ticksScrollTop: 200, ticksScrollHeight: 300, ticksClientHeight: 100 }), 20);
});

test('sidebarShiftGuard suppresses clicks after unexpected background row shift but allows user-driven reordering', () => {
  const listeners = new Map<string, Array<(ev?: any) => void>>();
  let rows = [
    { dataset: { sessionId: 'a' }, offsetTop: 0, offsetHeight: 40 },
    { dataset: { sessionId: 'b' }, offsetTop: 40, offsetHeight: 40 },
  ];
  let clock = 10_000;
  const container = {
    addEventListener(type: string, fn: (ev?: any) => void) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(fn);
    },
    removeEventListener() {},
    querySelectorAll: () => rows,
  };
  const guard = createSidebarShiftGuard({ container: container as any, now: () => clock });
  assert.equal(guard.afterRender(), false);
  assert.equal(guard.isSuppressed(), false);

  // Background reorder moves row 'b' above 'a' -> >50% shift without user input -> suppressed.
  clock = 12_000;
  rows = [
    { dataset: { sessionId: 'b' }, offsetTop: 0, offsetHeight: 40 },
    { dataset: { sessionId: 'a' }, offsetTop: 40, offsetHeight: 40 },
  ];
  assert.equal(guard.afterRender(), true);
  assert.equal(guard.isSuppressed(), true);

  let prevented = false, stopped = false;
  for (const fn of listeners.get('click') || []) {
    fn({ preventDefault: () => { prevented = true; }, stopPropagation: () => { stopped = true; } });
  }
  assert.equal(prevented, true);
  assert.equal(stopped, true);

  // Expires after suppressMs (500ms).
  clock = 12_600;
  assert.equal(guard.isSuppressed(), false);

  // Within own input window, row shift does NOT suppress.
  for (const fn of listeners.get('pointerdown') || []) fn({});
  clock = 12_700;
  rows = [
    { dataset: { sessionId: 'a' }, offsetTop: 0, offsetHeight: 40 },
    { dataset: { sessionId: 'b' }, offsetTop: 40, offsetHeight: 40 },
  ];
  assert.equal(guard.afterRender(), false);
  assert.equal(guard.isSuppressed(), false);
});

test('makeQuitShortcutHandler guards accidental Cmd+Q and quits on hold or double-press', async () => {
  let ts = 1000;
  let concealed = 0;
  let quits = 0;
  const hints: any[] = [];
  let timers: any[] = [];
  const handler = makeQuitShortcutHandler({
    platform: 'darwin',
    getMode: async () => 'hold',
    notify: (ev: any) => hints.push(ev),
    concealWindow: () => { concealed += 1; },
    quit: () => { quits += 1; },
    now: () => ts,
    setTimer: (fn: () => void, ms: number) => { const id = { fn, ms, active: true }; timers.push(id); return id; },
    clearTimer: (id: any) => { if (id) id.active = false; },
  });

  let prevented = false;
  handler({ preventDefault: () => { prevented = true; } }, { type: 'keyDown', key: 'q', meta: true, control: false, alt: false, shift: false, isAutoRepeat: false });
  assert.equal(prevented, true);
  await Promise.resolve();
  assert.equal(hints.at(-1)?.state, 'down');
  assert.equal(quits, 0);

  // Auto-repeat past hold duration arms conceal & quit-on-release.
  ts += QUIT_HOLD_DURATION_MS + 50;
  handler({ preventDefault: () => {} }, { type: 'keyDown', key: 'q', meta: true, control: false, alt: false, shift: false, isAutoRepeat: true });
  assert.equal(concealed, 1);
  assert.equal(quits, 0);

  // Release Q -> quits immediately.
  handler({ preventDefault: () => {} }, { type: 'keyUp', key: 'q', meta: false, control: false, alt: false, shift: false, isAutoRepeat: false });
  assert.equal(quits, 1);

  // Double-press within 500ms quits cleanly too.
  ts = 5000;
  handler({ preventDefault: () => {} }, { type: 'keyDown', key: 'q', meta: true, control: false, alt: false, shift: false, isAutoRepeat: false });
  await Promise.resolve();
  ts = 5200;
  handler({ preventDefault: () => {} }, { type: 'keyDown', key: 'q', meta: true, control: false, alt: false, shift: false, isAutoRepeat: false });
  assert.equal(quits, 2);

  // Verify preload zoom-proof traffic lights + quit listener wiring.
  const preload = readFileSync(new URL('../desktop/preload.cts', import.meta.url), 'utf8');
  assert.match(preload, /syncWindowControlInset/);
  assert.match(preload, /--desktop-window-controls-inset/);
  assert.match(preload, /--desktop-zoom-inverse/);
  assert.match(preload, /onQuitShortcut/);
});
