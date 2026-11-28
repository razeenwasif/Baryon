import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupSidePane } from '../src/side-pane.js';
import { formatReplyTime } from '../src/reply-time.js';
import { SessionStore } from '../desktop/sessions.mjs';
import { WorkCompactor } from '../desktop/work-compact.mjs';

function makeEl(tag = 'div'): any {
  const classes = new Set<string>();
  const attrs: Record<string, string> = {};
  const el: any = {
    tagName: tag.toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    hidden: false,
    className: '',
    title: '',
    textContent: '',
    type: '',
    classList: {
      toggle(name: string, force?: boolean) {
        if (force === undefined) {
          if (classes.has(name)) { classes.delete(name); return false; }
          classes.add(name); return true;
        }
        if (force) classes.add(name); else classes.delete(name);
        return Boolean(force);
      },
      contains: (name: string) => classes.has(name),
    },
    setAttribute(k: string, v: unknown) { attrs[k] = String(v); },
    getAttribute(k: string) { return attrs[k] ?? null; },
    addEventListener() {},
    remove() { el.removed = true; },
    append(...nodes: any[]) { el.children.push(...nodes); },
    replaceChildren(...nodes: any[]) { el.children = nodes; },
    querySelector(sel: string) {
      if (sel === '.pane-layout') return el._paneLayout || null;
      return null;
    },
    querySelectorAll() { return []; },
  };
  Object.defineProperty(el, 'innerHTML', {
    set(html: string) {
      if (html.includes('pane-layout')) {
        const host = makeEl('div');
        host.className = 'pane-layout';
        el._paneLayout = host;
      }
    },
    get() { return ''; },
  });
  return el;
}

test('sidePane close() and toggle(fallbackId) manage open/closed transitions cleanly', () => {
  const prevDoc = globalThis.document;
  (globalThis as any).document = {
    documentElement: makeEl('html'),
    createElement: (tag: string) => makeEl(tag),
  };
  try {
    const changes: any[] = [];
    const renders: string[] = [];
    const resets: string[] = [];
    const root = makeEl('aside');
    const rail = makeEl('nav');
    const ctrl = setupSidePane({
      root,
      rail,
      panes: [
        { id: 'outline', title: 'Outline', render: () => renders.push('outline'), reset: () => resets.push('outline') },
        { id: 'changes', title: 'Changes', render: () => renders.push('changes'), reset: () => resets.push('changes') },
      ],
      onChange: state => changes.push(state),
    });

    // First toggle before any pane opened uses fallbackId.
    ctrl.toggle('changes');
    assert.equal(ctrl.current(), 'changes');
    assert.equal(root.hidden, false);
    assert.deepEqual(renders, ['changes']);

    // Toggle while open closes and resets active panes.
    ctrl.toggle('outline');
    assert.equal(ctrl.current(), '');
    assert.equal(root.hidden, true);
    assert.deepEqual(resets, ['changes']);

    // Subsequent toggle reopens previously focused pane instead of fallback.
    ctrl.toggle('outline');
    assert.equal(ctrl.current(), 'changes');

    // Explicit close() resets and collapses; calling again is a no-op.
    const countBefore = changes.length;
    ctrl.close();
    assert.equal(ctrl.current(), '');
    assert.equal(changes.length, countBefore + 1);
    ctrl.close();
    assert.equal(changes.length, countBefore + 1);

    // Restoring an open session marks hasOpened so closing + toggling returns to that pane.
    ctrl.restore({ open: true, tab: 'outline' });
    assert.equal(ctrl.current(), 'outline');
    ctrl.close();
    ctrl.toggle('changes');
    assert.equal(ctrl.current(), 'outline');
  } finally {
    globalThis.document = prevDoc;
  }
});

test('imported Antigravity chat pane keeps Fairy blue accents and open-chat header/footer wiring', () => {
  const appJs = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  const repliesCss = readFileSync(new URL('../src/replies.css', import.meta.url), 'utf8');
  const panelsCss = readFileSync(new URL('../src/panels.css', import.meta.url), 'utf8');

  assert.match(appJs, /<header id="chat-header" class="chat-header"/);
  assert.match(appJs, /id="chat-header-title"/);
  assert.match(appJs, /id="chat-header-repo"/);
  assert.match(appJs, /id="chat-header-status"/);
  assert.match(appJs, /id="chat-header-pane"/);
  assert.match(appJs, /function syncChatHeader\(/);
  assert.match(appJs, /function messageFooter\(item[^)]*\)/);
  assert.match(appJs, /<button id="work-permission"/);
  assert.match(appJs, /id="permission-menu"/);
  assert.match(appJs, /function setPermissionMenu\(/);

  assert.doesNotMatch(appJs, /setupAvatarWrap\(/);
  assert.doesNotMatch(workspaceCss, /&:not\(\.home\) \.stage\{display:none\}/);
  assert.match(workspaceCss, /\.stage\{[^}]*pointer-events:none;z-index:20\}/);
  assert.match(workspaceCss, /&:not\(\.home\) \.stage\{grid-row:2\}/);
  assert.match(workspaceCss, /\.stage>\*\{pointer-events:none/);
  assert.match(workspaceCss, /&:not\(\.home\) \.stage footer\{display:none\}/);
  assert.match(workspaceCss, /\.avatar-float\{display:none\}/);
  assert.match(workspaceCss, /#chat-header\{[^}]*height:44px/);
  assert.match(workspaceCss, /\.conversation\{[^}]*width:min\(840px,calc\(100% - 88px\)\)/);
  assert.match(workspaceCss, /\.message-footer\{display:flex;flex-wrap:wrap;align-items:center/);
  assert.match(workspaceCss, /#app \.todo-head\{[^}]*height:36px/);
  assert.match(workspaceCss, /#work-folder\{flex:0 2 auto;min-width:48px;max-width:180px[^}]*height:27px;[^}]*border-radius:999px/);
  assert.match(workspaceCss, /--w-ground:#030304;[^}]*--w-accent:#3e5aec/);
  assert.match(workspaceCss, /#send\{[^}]*background:var\(--w-accent\)/);
  assert.match(workspaceCss, /&:not\(\.home\) #send\{[^}]*width:32px;height:32px;background:var\(--w-accent\)/);

  assert.match(workspaceCss, /#work-permission\[data-permission="ask"\]/);
  assert.match(workspaceCss, /#work-permission\[data-permission="plan"\]/);
  assert.match(workspaceCss, /#work-permission\[data-permission="auto"\]/);
  assert.match(workspaceCss, /#work-swarm-btn\{--icon:url\(/);
  assert.match(workspaceCss, /#work-permission\{[^}]*font-size:0/);
  assert.match(workspaceCss, /#work-swarm-btn\{[^}]*font-size:0/);

  assert.match(repliesCss, /\.thought-block\{margin:1px 0;border:0;border-radius:0;background:transparent/);
  assert.match(repliesCss, /\.thought-body\{[^}]*border-left:1\.5px solid #262831/);
  assert.match(panelsCss, /\.message-trace-btn\{display:inline-flex;align-items:center;height:22px/);

  const sessionListJs = readFileSync(new URL('../src/session-list.ts', import.meta.url), 'utf8');
  assert.match(appJs, /id="chat-header-to-work"/);
  assert.match(appJs, /id="convert-to-work"/);
  assert.match(appJs, /name: 'to-work'/);
  assert.match(appJs, /async function convertChatToWork\(/);
  assert.match(sessionListJs, /Convert to work session…/);
});

test('SessionStore.convertToWork converts regular chats in place and WorkCompactor.importSummary preserves notes', async () => {
  const files = new Map<string, any>();
  let seq = 0, tick = 0;
  const store = new SessionStore({
    dir: '/tmp/fake-sessions',
    legacyDir: '/tmp/fake-legacy',
    readJSON: async (path: string, fallback: any) => (files.has(path) ? structuredClone(files.get(path)) : fallback),
    writeJSON: async (path: string, value: any) => { files.set(path, structuredClone(value)); },
    trash: async () => {},
    now: () => new Date(Date.UTC(2026, 10, 22, 12, 0, tick++)).toISOString(),
    id: () => `chat-${++seq}`,
  });

  // Unsaved draft chat converts via createWork.
  const draftState = await store.convertToWork(null, '/projects/demo');
  assert.equal(draftState.active, null);
  assert.equal(draftState.work?.folder, '/projects/demo');

  // Create regular active chat + inactive regular chat.
  await store.create();
  await store.save([
    { role: 'user', content: 'Let us design an API', at: '2026-11-22T01:00:00Z' },
    { role: 'assistant', content: 'Here is the plan.', at: '2026-11-22T01:00:05Z' },
  ]);
  const firstId = store.active!;
  await store.rename(firstId, 'API Design');
  await store.pin(firstId, true);
  await store.setPane({ open: true, tab: 'outline', view: null, layout: null });
  await store.setSummarized(firstId, { through: 1, lastAt: '2026-11-22T01:00:00Z', at: '2026-11-22T01:01:00Z', chars: 42 });

  await store.create();
  await store.save([{ role: 'user', content: 'Second chat', at: '2026-11-22T02:00:00Z' }]);
  const secondId = store.active;

  // Convert inactive regular chat (firstId) into work session and open it automatically.
  const converted = await store.convertToWork(firstId, '/projects/api');
  assert.equal(converted.active, firstId);
  assert.equal(converted.work?.folder, '/projects/api');
  assert.equal(converted.work?.permission, 'ask');
  assert.equal(converted.pane?.tab, 'outline');
  const firstMeta = converted.sessions.find(s => s.id === firstId);
  assert.equal(firstMeta?.title, 'API Design');
  assert.equal(firstMeta?.pinned, true);
  assert.equal(firstMeta?.work, 'api');
  assert.equal(store.history.length, 2);

  // Rejects already-work session and unknown/traversal IDs.
  await assert.rejects(() => store.convertToWork(firstId, '/projects/other'), /already a work session/);
  await assert.rejects(() => store.convertToWork('../etc', '/projects/other'), /no longer here/);
  assert.equal(converted.sessions.find(s => s.id === secondId)?.work, '');

  // WorkCompactor.importSummary preserves compacted chat notes for the converted session.
  const dir = mkdtempSync(join(tmpdir(), 'fairy-compact-import-'));
  try {
    const compactor = new WorkCompactor({ dir, connection: (() => ({})) as any });
    const summary = { text: 'Goal: Build REST API', through: 1, lastAt: '2026-11-22T01:00:00Z', at: '2026-11-22T01:01:00Z' };
    await compactor.importSummary(firstId, summary);
    const notes = await compactor.notes(firstId, store.history as any);
    assert.equal(notes, 'Goal: Build REST API');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('formatReplyTime includes date and time on Fairy replies and is wired into history, live, proactive, and face chats', () => {
  const now = new Date(2026, 10, 22, 14, 30, 0);
  const sameYearLocal = new Date(2026, 10, 22, 9, 15, 0);
  const sameYear = formatReplyTime(sameYearLocal.toISOString(), { now, locale: 'en-AU' });
  assert.ok(sameYear);
  assert.match(sameYear.label, /\b22\b/);
  assert.match(sameYear.label, /Nov/);
  assert.match(sameYear.label, /9:15/);
  assert.doesNotMatch(sameYear.label, /2026/);
  assert.equal(sameYear.iso, sameYearLocal.toISOString());
  assert.ok(sameYear.title.length > 0);

  const priorYearLocal = new Date(2025, 1, 3, 18, 5, 0);
  const priorYear = formatReplyTime(priorYearLocal.toISOString(), { now, locale: 'en-AU' });
  assert.ok(priorYear);
  assert.match(priorYear.label, /2025/);
  assert.match(priorYear.label, /Feb/);
  assert.match(priorYear.label, /\b3\b/);

  const unixSec = formatReplyTime(1763781240, { now, locale: 'en-AU' });
  const unixMs = formatReplyTime(1763781240 * 1000, { now, locale: 'en-AU' });
  assert.ok(unixSec && unixMs);
  assert.equal(unixSec.iso, unixMs.iso);
  assert.equal(unixSec.label, unixMs.label);

  assert.equal(formatReplyTime(null as any, { now }), null);
  assert.equal(formatReplyTime(undefined as any, { now }), null);
  assert.equal(formatReplyTime('', { now }), null);
  assert.equal(formatReplyTime('not-a-date', { now }), null);

  const appJs = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
  const faceChatsJs = readFileSync(new URL('../src/face-chats.ts', import.meta.url), 'utf8');
  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');

  assert.match(appJs, /import \{ formatReplyTime \} from '\.\/reply-time\.js';/);
  assert.match(appJs, /function addReplyTime\(item[^)]*,\s*at[^)]*\)/);
  assert.match(appJs, /if \(entry\.role === 'assistant' && entry\.at\) addReplyTime\(drawn\.item, entry\.at\);/);
  assert.match(appJs, /const drawn = message\('assistant', result\.text, 'proactive'\);\s*addReplyTime\(drawn\.item,/);
  assert.match(appJs, /if \(drawnReply\?\.item\) addReplyTime\(drawnReply\.item, savedReply\?\.at \|\| new Date\(\)\.toISOString\(\)\);/);

  assert.match(faceChatsJs, /import \{ formatReplyTime \} from '\.\/reply-time\.js';/);
  assert.match(faceChatsJs, /function messageNode[\s\S]*?formatReplyTime\(at\)/);

  assert.match(workspaceCss, /\.message-time\{[^}]*font-variant-numeric:tabular-nums/);
});
