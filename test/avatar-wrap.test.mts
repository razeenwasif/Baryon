import assert from 'node:assert/strict';
import { test } from 'node:test';
import { avatarZone, firstRowBelow, floatStyle, setupAvatarWrap } from '../src/avatar-wrap.js';

const avatar = { left: 500, top: 0, width: 100, height: 100 };
test('the zone covers the avatar and the status line under it', () => {
  const zone = avatarZone(avatar, { width: 60, bottom: 110 });
  assert.equal(zone.top, 8);
  assert.equal(zone.bottom, 114);
  assert.equal(zone.left, 550 - 40);
  const wide = avatarZone(avatar, { width: 160, bottom: 110 });
  assert.equal(wide.left, 550 - 84);
  assert.equal(avatarZone(avatar, { width: 0, bottom: 0 }).bottom, 76);
});
test('a float that starts above the avatar reaches down to it, and its shape starts there', () => {
  const zone = { left: 500, top: 20, bottom: 120, radius: 40 };
  assert.deepEqual(floatStyle({ zone, floatTop: -300, contentRight: 640 }), { width: '140px', height: '420px', shapeOutside: 'inset(320px 0 0 0 round 40px)', shapeMargin: '10px' });
});
test('a float that starts part way down the avatar is cut to fit', () => {
  const zone = { left: 500, top: 20, bottom: 120, radius: 40 };
  assert.equal(floatStyle({ zone, floatTop: 60, contentRight: 640 })!.shapeOutside, 'inset(0px 0 0 0 round 40px)');
  assert.equal(floatStyle({ zone, floatTop: 60, contentRight: 640 })!.height, '60px');
});
test('nothing is placed once it would have no size', () => {
  const zone = { left: 500, top: 20, bottom: 120, radius: 40 };
  assert.equal(floatStyle({ zone, floatTop: 120, contentRight: 640 }), null);
  assert.equal(floatStyle({ zone, floatTop: 0, contentRight: 500 }), null);
  assert.equal(floatStyle({ zone, floatTop: 0, contentRight: 640, opened: 0 }), null);
});
test('the text opens out as the shape grows', () => {
  const zone = { left: 500, top: 20, bottom: 120, radius: 40 };
  assert.equal(floatStyle({ zone, floatTop: 0, contentRight: 640, opened: 0.5 })!.width, '72px');
});
test('a slow scroll doesn’t change the float until it crosses a step', () => {
  const zone = { left: 500, top: 20, bottom: 120, radius: 40 }, style = (floatTop: number) => JSON.stringify(floatStyle({ zone, floatTop, contentRight: 640 }));
  assert.equal(style(-300), style(-301));
  assert.notEqual(style(-300), style(-304));
});
test('the row at the avatar is found by measuring only a few of them', () => {
  const rows = Array.from({ length: 1024 }, (_, index) => index);
  let measured = 0;
  const found = firstRowBelow(rows, 5000, row => { measured += 1; return (row + 1) * 10; });
  assert.equal(found, 500);
  assert.ok(measured <= 11, `measured ${measured}`);
  assert.equal(firstRowBelow([], 0, () => 0), 0);
  assert.equal(firstRowBelow(rows, 1e9, row => row), 1024);
});

// The wrap's frame loop on a page with no layout: a clock the test turns and frames it runs one refresh at a time.
function page({ classes = [], rows = 0 }: { classes?: string[]; rows?: number } = {}) {
  const box = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  const element = (extra: Record<string, unknown> = {}) => ({ style: {}, className: '', setAttribute() {}, remove() {}, addEventListener() {}, getBoundingClientRect: () => box, ...extra });
  const names = new Set<string>(classes), frames: Array<(time: number) => void> = [], observers: Array<() => void> = [];
  let clock = 1000;
  const stubs: Record<string, unknown> = {
    performance: { now: () => clock }, requestAnimationFrame: (fn: (time: number) => void) => frames.push(fn), addEventListener() {}, getComputedStyle: () => ({ paddingRight: '0' }),
    document: { createElement: () => element() },
    ResizeObserver: class { observe() {} },
    MutationObserver: class { constructor(fn: () => void) { observers.push(fn); } observe() {} },
  };
  const saved = Object.fromEntries(Object.keys(stubs).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(stubs)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const root = { classList: { contains: (name: string) => names.has(name), toggle: (name: string, on?: boolean) => { if (on) names.add(name); else names.delete(name); } } };
  const scroller = element({ children: Array.from({ length: rows }, () => element()), clientWidth: 600, clientHeight: 400, scrollTop: 0, scrollHeight: 400, insertBefore() {} });
  setupAvatarWrap({ scroller, avatar: element(), status: element(), tools: element(), conversation: element(), root, reduced: () => false } as unknown as Parameters<typeof setupAvatarWrap>[0]);
  return {
    names, observers,
    // Runs frames at 120 Hz until none is asked for, and says how many ran.
    refresh(limit = 2000) { let ran = 0; while (frames.length && ran < limit) { clock += 1000 / 120; frames.shift()!(clock); ran += 1; } return ran; },
    restore() { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete (globalThis as Record<string, unknown>)[key]; } },
  };
}

test('with no text beside Fairy the opening still ends, and so do the frames', () => {
  const p = page();
  try {
    const ran = p.refresh();
    assert.ok(ran <= 66, `the 0.52 s opening at 120 Hz, not every refresh while Fairy runs: ${ran} frames`);
  } finally { p.restore(); }
});

test('going home ends the opening at once, leaving only the 0.6 s slide', () => {
  const p = page();
  try {
    p.refresh(5);
    p.names.add('home');
    for (const changed of p.observers) changed();
    const ran = p.refresh();
    assert.ok(ran <= 74, `${ran} frames`);
    assert.equal(p.refresh(), 0, 'and nothing after');
  } finally { p.restore(); }
});
