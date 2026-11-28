import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RAIL, shorten, railPreview, activeMessage, tickWidth, railLayout, railScrollTop, railTargetTop, setupMessageRail } from '../src/message-rail.js';

test('a short message is the title and the reply after it the description', () => {
  const reply = 'Thursday’s the tight one: three meetings before lunch, then your supervisor at 2. Friday afternoon is wide open, so I’d move the reading group there.';
  const preview = railPreview('What’s on my calendar this week?', reply);
  assert.equal(preview.title, 'What’s on my calendar this week?');
  assert.ok(preview.description.endsWith('…') && preview.description.length <= RAIL.description + 1);
  assert.ok(reply.startsWith(preview.description.slice(0, -1)));
});

test('a long message is cut at a word into title and the rest', () => {
  const text = 'Could you look through the compaction branch and tell me whether the tests that failed yesterday still fail after the rebase onto main?';
  const { title, description } = railPreview(text);
  assert.ok(title.endsWith('…') && title.length <= RAIL.title + 1);
  assert.ok(!title.slice(0, -1).endsWith(' '));
  assert.ok(description.length > 0);
  assert.equal(shorten('short', 10), 'short');
  assert.equal(railPreview('', '').title, 'Message');
});

test('the message in view is the first at the top, the last at the bottom, else the nearest the middle', () => {
  const centres = [100, 600, 1100, 1600, 2100];
  assert.equal(activeMessage({ top: 0, height: 800, scrollHeight: 2400, centres }), 0);
  assert.equal(activeMessage({ top: 1590, height: 800, scrollHeight: 2400, centres }), 4);
  assert.equal(activeMessage({ top: 700, height: 800, scrollHeight: 2400, centres }), 2);
  assert.equal(activeMessage({ top: 0, height: 800, scrollHeight: 2400, centres: [] }), -1);
});

test('ticks swell round the pointer and the one in view stays long', () => {
  assert.equal(tickWidth(3, 3, -1), RAIL.wide);
  assert.equal(tickWidth(1, 3, -1), RAIL.tick);
  assert.equal(tickWidth(5, 3, 5), RAIL.wide);
  assert.ok(tickWidth(6, 3, 5) > RAIL.tick && tickWidth(6, 3, 5) < RAIL.wide);
  assert.equal(tickWidth(9, 3, 5), RAIL.tick);
});

test('chat scroll rail uses circular dots and user text bubbles use clean dark pill styling across views', () => {
  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  const wallpaperCss = readFileSync(new URL('../src/wallpaper.css', import.meta.url), 'utf8');
  const notebookCss = readFileSync(new URL('../src/notebook.css', import.meta.url), 'utf8');
  const faceCss = readFileSync(new URL('../src/face-chats.css', import.meta.url), 'utf8');
  const faceJs = readFileSync(new URL('../src/face-chats.ts', import.meta.url), 'utf8');
  assert.match(workspaceCss, /\.message-rail-tick span\{[^}]*border-radius:50%/);
  assert.match(workspaceCss, /\.message-rail-ticks\{[^}]*justify-content:flex-start[^}]*overflow-y:auto;overscroll-behavior:contain/);
  assert.match(workspaceCss, /\.message-rail-ticks\.has-more-top/);
  assert.match(workspaceCss, /\.message-rail-ticks\.has-more-bottom/);
  assert.match(faceCss, /\.message-rail-tick span\{[^}]*border-radius:50%/);
  assert.match(faceCss, /\.message-rail-ticks\{[^}]*justify-content:flex-start[^}]*overflow-y:auto;overscroll-behavior:contain/);
  assert.match(faceCss, /\.message-rail-ticks\.has-more-top/);
  assert.match(faceCss, /\.message-rail-ticks\.has-more-bottom/);
  assert.match(faceJs, /setupMessageRail\(/);
  assert.match(workspaceCss, /\.message\.user>div\{[^}]*border-radius:22px;background:#111114/);
  assert.match(wallpaperCss, /\.message\.user>div\{background:#111114/);
  assert.match(notebookCss, /\.nb-asked\{[^}]*border-radius:20px;background:#111114/);
  assert.match(faceCss, /\.msg\.user\{[^}]*border-radius:22px;background:#1a1b1f/);
  assert.match(workspaceCss, /--w-ground:#030304;[^}]*--w-accent:#3e5aec/);
  assert.match(wallpaperCss, /--w-ground:#030304;[^}]*--w-accent:#3e5aec/);
  assert.match(workspaceCss, /\.conversation\{[^}]*width:min\(840px,calc\(100% - 88px\)\)/);
  assert.match(workspaceCss, /#pane-rail\{[^}]*bottom:12px;[^}]*overflow-y:auto/);
  assert.match(workspaceCss, /#work-folder\{flex:0 2 auto;min-width:48px;max-width:180px/);
});

test('compact rail layout caps visible dots at 10 and computes centered scrollTop', () => {
  assert.deepEqual(railLayout({ count: 6, room: 600 }), { shown: 6, step: 18, dot: 7, height: 108, scrollable: false });
  assert.deepEqual(railLayout({ count: 35, room: 600 }), { shown: 10, step: 18, dot: 7, height: 180, scrollable: true });
  const compact = railLayout({ count: 20, room: 120 });
  assert.equal(compact.shown, 10);
  assert.ok(compact.height <= 120);
  assert.equal(compact.scrollable, true);
  assert.equal(railScrollTop({ index: 0, count: 6, step: 18, viewport: 108 }), 0);
  assert.equal(railScrollTop({ index: 0, count: 35, step: 18, viewport: 180 }), 0);
  assert.equal(railScrollTop({ index: 34, count: 35, step: 18, viewport: 180 }), 450);
  assert.equal(railScrollTop({ index: 17, count: 35, step: 18, viewport: 180 }), 225);

  const workspaceCss = readFileSync(new URL('../src/workspace.css', import.meta.url), 'utf8');
  assert.match(workspaceCss, /\.message-rail\{[^}]*right:2px;[^}]*-webkit-app-region:no-drag/);
  assert.match(workspaceCss, /#messages\.has-rail\{[^}]*padding-right:28px/);
});

test('railTargetTop centers normal messages, top-aligns tall messages, and clamps last message', () => {
  assert.equal(railTargetTop({ scrollTop: 300, itemTop: 100, scrollerTop: 100, clientHeight: 600, itemHeight: 120, scrollHeight: 2400, isLast: false }), 60);
  assert.equal(railTargetTop({ scrollTop: 300, itemTop: 800, scrollerTop: 100, clientHeight: 600, itemHeight: 120, scrollHeight: 2400, isLast: false }), 760);
  assert.equal(railTargetTop({ scrollTop: 300, itemTop: 800, scrollerTop: 100, clientHeight: 600, itemHeight: 900, scrollHeight: 2400, isLast: false }), 984);
  assert.equal(railTargetTop({ scrollTop: 300, itemTop: 2200, scrollerTop: 100, clientHeight: 600, itemHeight: 200, scrollHeight: 2400, isLast: true }), 1800);
});

test('setupMessageRail jumps scroller when a dot is clicked without focus-scrolling on mousedown', () => {
  const prevDoc = globalThis.document;
  const prevMatchMedia = globalThis.matchMedia;
  const prevMO = globalThis.MutationObserver;
  const prevRO = globalThis.ResizeObserver;
  const prevRAF = globalThis.requestAnimationFrame;
  const prevCAF = globalThis.cancelAnimationFrame;

  const makeMockEl = (tag = 'div'): any => {
    const classes = new Set<string>();
    const attrs: Record<string, string> = {};
    const props: Record<string, string> = {};
    const listeners: Record<string, Array<(...args: any[]) => void>> = {};
    const node: any = {
      tagName: tag.toUpperCase(),
      children: [] as any[],
      style: { setProperty(k: string, v: string) { props[k] = v; }, getPropertyValue: (k: string) => props[k] || '' },
      hidden: false,
      scrollTop: 0,
      clientHeight: 600,
      scrollHeight: 2400,
      offsetTop: 0,
      offsetHeight: 100,
      _rect: { top: 0, height: 100 },
      classList: {
        toggle(name: string, force?: boolean) {
          if (force === undefined) {
            if (classes.has(name)) { classes.delete(name); return false; }
            classes.add(name); return true;
          }
          if (force) classes.add(name); else classes.delete(name);
          return Boolean(force);
        },
        remove(...names: string[]) { for (const n of names) classes.delete(n); },
        contains: (name: string) => classes.has(name),
      },
      setAttribute(k: string, v: unknown) { attrs[k] = String(v); },
      getAttribute(k: string) { return attrs[k] ?? null; },
      removeAttribute(k: string) { delete attrs[k]; },
      addEventListener(type: string, fn: (...args: any[]) => void) { (listeners[type] ||= []).push(fn); },
      getBoundingClientRect: () => node._rect,
      querySelector: () => null,
      append(...items: any[]) { node.children.push(...items); },
      replaceChildren(...items: any[]) { node.children = items; },
      remove() {},
    };
    let cn = '';
    Object.defineProperty(node, 'className', {
      get: () => cn,
      set: (v: unknown) => { cn = String(v); classes.clear(); for (const c of cn.split(/\s+/).filter(Boolean)) classes.add(c); },
    });
    return node;
  };

  (globalThis as any).document = { createElement: (tag: string) => makeMockEl(tag) };
  (globalThis as any).matchMedia = () => ({ matches: false });
  (globalThis as any).MutationObserver = class { observe() {} disconnect() {} };
  (globalThis as any).ResizeObserver = class { observe() {} disconnect() {} };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => { fn(); return 1; };
  (globalThis as any).cancelAnimationFrame = () => {};

  try {
    const scroller = makeMockEl('div');
    scroller._rect = { top: 100, height: 600 };
    const host = makeMockEl('section');
    const scrolled: any[] = [];
    scroller.scrollTo = (opts: any) => { scrolled.push(opts); scroller.scrollTop = opts.top; };

    const msg0 = makeMockEl('article'); msg0.className = 'message user'; msg0._rect = { top: 100, height: 80 }; msg0.offsetHeight = 80; msg0.textContent = 'Hi';
    const msg1 = makeMockEl('article'); msg1.className = 'message assistant'; msg1._rect = { top: 900, height: 140 }; msg1.offsetHeight = 140; msg1.textContent = 'Hello there';
    const msg2 = makeMockEl('article'); msg2.className = 'message user'; msg2._rect = { top: 1800, height: 100 }; msg2.offsetHeight = 100; msg2.textContent = 'Later message';
    scroller.children = [msg0, msg1, msg2];

    const ctrl = setupMessageRail({ scroller, host });
    const rail = host.children[0];
    const ticks = rail.children[1];
    assert.equal(ticks.children.length, 3);

    let prevented = false;
    let stopped = false;
    ticks.children[1].onmousedown({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
    ticks.children[1].onclick({ stopPropagation: () => { stopped = true; } });
    assert.equal(stopped, true);
    assert.equal(scrolled.length, 1);
    assert.equal(scrolled[0].top, 570);
    assert.equal(scrolled[0].behavior, 'smooth');
    assert.equal(ticks.children[1].classList.contains('is-active'), true);
    assert.equal(ticks.children[1].getAttribute('aria-current'), 'true');
    ctrl.stop();
  } finally {
    globalThis.document = prevDoc;
    globalThis.matchMedia = prevMatchMedia;
    globalThis.MutationObserver = prevMO;
    globalThis.ResizeObserver = prevRO;
    globalThis.requestAnimationFrame = prevRAF;
    globalThis.cancelAnimationFrame = prevCAF;
  }
});
