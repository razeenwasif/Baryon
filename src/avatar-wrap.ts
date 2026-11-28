const OPENING_MS = 520;
const NARROWEST = 440;
const GAP = 10;
const STEP = 4;
const OPENING_STEP = 8;
const FAST_SCROLL = 40;
const FAST_EVERY_MS = 120;

const snap = (value: number, step: number): number => Math.round(value / step) * step;

export interface AvatarRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface StatusRect {
  width: number;
  bottom: number;
}

export interface AvatarZone {
  left: number;
  top: number;
  bottom: number;
  radius: number;
}

export interface FloatStyleInput {
  zone: AvatarZone;
  floatTop: number;
  contentRight: number;
  opened?: number;
}

export interface FloatStyle {
  width: string;
  height: string;
  shapeOutside: string;
  shapeMargin: string;
}

export interface AvatarWrapRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AvatarWrapElementLike {
  getBoundingClientRect(): AvatarWrapRectLike;
}

export interface AvatarWrapScrollerLike extends AvatarWrapElementLike {
  clientWidth: number;
  clientHeight: number;
  scrollTop: number;
  scrollHeight: number;
  children: ArrayLike<AvatarWrapElementLike>;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
  insertBefore<T extends Node>(node: T, child: Node | null): T;
}

export interface AvatarWrapRootLike {
  classList: {
    contains(token: string): boolean;
    toggle(token: string, force?: boolean): boolean | void;
  };
}

export interface SetupAvatarWrapOptions {
  scroller: AvatarWrapScrollerLike;
  avatar: AvatarWrapElementLike;
  status: AvatarWrapElementLike;
  tools: AvatarWrapElementLike;
  conversation: AvatarWrapElementLike;
  root?: AvatarWrapRootLike;
  reduced?: () => boolean;
}

export interface AvatarWrapController {
  update: () => void;
}

// The part of the avatar's square that's really occupied, and the status line under it.
export function avatarZone(avatar: AvatarRect, status?: StatusRect | null): AvatarZone {
  const hasStatus = Boolean(status && status.width > 0);
  const width = Math.max(avatar.width * 0.72, hasStatus && status ? status.width : 0) + 8;
  const middle = avatar.left + avatar.width / 2;
  const top = avatar.top + avatar.height * 0.08;
  const bottom = Math.max(hasStatus && status ? status.bottom : 0, avatar.top + avatar.height * 0.72) + 4;
  return { left: middle - width / 2, top, bottom, radius: Math.min(width, bottom - top) / 2 };
}

// One float, placed where the first row at the avatar starts. Lines flow around its shape,
// and anything after it wraps too, since the rows don't contain floats of their own.
// Sizes move in small steps, so a slow scroll only lays text out when a step is crossed.
export function floatStyle({ zone, floatTop, contentRight, opened = 1 }: FloatStyleInput): FloatStyle | null {
  const height = snap(zone.bottom - floatTop, STEP);
  const width = snap(Math.max(0, contentRight - zone.left) * opened, opened < 1 ? OPENING_STEP : 1);
  if (height <= 0 || width <= 0) return null;
  return {
    width: `${width}px`,
    height: `${height}px`,
    shapeOutside: `inset(${Math.max(0, snap(zone.top - floatTop, STEP))}px 0 0 0 round ${Math.round(zone.radius)}px)`,
    shapeMargin: `${GAP}px`,
  };
}

// Rows are in order down the page, so the one at the avatar can be found without measuring them all.
export function firstRowBelow<T>(rows: ArrayLike<T>, y: number, bottomOf: (row: T) => number): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bottomOf(rows[middle]) > y) high = middle;
    else low = middle + 1;
  }
  return low;
}

const ease = (value: number): number => 1 - (1 - value) ** 3;
const bottomOf = (row: AvatarWrapElementLike): number => row.getBoundingClientRect().bottom;

export function setupAvatarWrap({
  scroller,
  avatar,
  status,
  tools,
  conversation,
  root = document.documentElement,
  reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches,
}: SetupAvatarWrapOptions): AvatarWrapController {
  const float = document.createElement('div');
  float.className = 'avatar-float';
  float.setAttribute('aria-hidden', 'true');
  let frame = 0;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let openedAt = 0;
  let wasOn = false;
  let moving = 0;
  let lastTop = 0;
  let lastPlaced = 0;
  let inner = 0;
  const on = (): boolean => (
    !root.classList.contains('home')
    && !root.classList.contains('floating')
    && !root.classList.contains('wrap-off')
    && scroller.clientWidth > 0
  );

  function measureRoom(): void {
    const toolsBox = tools.getBoundingClientRect();
    const box = conversation.getBoundingClientRect();
    root.classList.toggle('wrap-off', box.width > 0 && box.width < NARROWEST);
    root.classList.toggle('avatar-low', toolsBox.width > 0 && toolsBox.left < box.right && toolsBox.right > box.left);
    inner = parseFloat(getComputedStyle(scroller as unknown as Element).paddingRight) || 0;
  }

  function place(): void {
    if (!on()) { float.remove(); wasOn = false; openedAt = 0; return; }
    if (!wasOn) { wasOn = true; openedAt = reduced() ? 0 : performance.now(); }
    const zone = avatarZone(avatar.getBoundingClientRect(), status.getBoundingClientRect());
    // On a narrower window the Pin and Float buttons sit above Fairy, and the text goes around them too.
    if (root.classList.contains('avatar-low')) {
      const buttons = tools.getBoundingClientRect();
      zone.top = Math.min(zone.top, buttons.top);
      zone.left = Math.min(zone.left, buttons.left);
    }
    const children = [...Array.from(scroller.children)];
    const rows = float.parentNode ? children.filter(row => row !== (float as unknown as AvatarWrapElementLike)) : children;
    const index = firstRowBelow(rows, zone.top, bottomOf);
    const first = rows[index];
    if (!first || first.getBoundingClientRect().top >= zone.bottom) { float.remove(); return; }
    // The first row wholly below Fairy stays where it is, so the text being read doesn't jump when a line wraps differently.
    let anchor = first;
    for (let next = index + 1; next < rows.length; next += 1) {
      if (rows[next].getBoundingClientRect().top >= zone.bottom) { anchor = rows[next]; break; }
      if (rows[next].getBoundingClientRect().top > scroller.clientHeight) break;
    }
    const before = anchor.getBoundingClientRect().top;
    const following = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
    if (float.nextElementSibling !== (first as unknown as Element)) scroller.insertBefore(float, first as unknown as Node);
    const opened = openedAt ? ease(Math.min(1, (performance.now() - openedAt) / OPENING_MS)) : 1;
    const next = floatStyle({
      zone,
      floatTop: float.getBoundingClientRect().top,
      contentRight: scroller.getBoundingClientRect().left + scroller.clientWidth - inner,
      opened,
    });
    if (!next) { float.remove(); return; }
    let changed = false;
    const floatStyleObj = float.style as unknown as Record<string, string>;
    for (const [key, value] of Object.entries(next)) {
      if (floatStyleObj[key] !== value) { floatStyleObj[key] = value; changed = true; }
    }
    if (opened >= 1) openedAt = 0;
    if (!changed && float.nextElementSibling === (first as unknown as Element)) return;
    const shift = anchor.getBoundingClientRect().top - before;
    if (following) scroller.scrollTop = scroller.scrollHeight;
    else if (Math.abs(shift) >= 1 && scroller.scrollTop > 0) scroller.scrollTop += shift;
  }

  function run(): void {
    frame = 0;
    clearTimeout(settle);
    const now = performance.now();
    const speed = Math.abs(scroller.scrollTop - lastTop);
    lastTop = scroller.scrollTop;
    // Nobody reads text going past this fast, so it waits until the scrolling slows or stops.
    if (speed > FAST_SCROLL && now - lastPlaced < FAST_EVERY_MS) {
      settle = setTimeout(schedule, FAST_EVERY_MS);
      return;
    }
    lastPlaced = now;
    place();
    lastTop = scroller.scrollTop;
    // The opening lasts OPENING_MS however place() returned. With no text beside Fairy it returns before the opening
    // finishes, and this asked for a frame on every refresh for as long as Fairy ran (efficiency audit, fix 4).
    if (openedAt && now - openedAt >= OPENING_MS) openedAt = 0;
    if (openedAt || now < moving) schedule();
  }

  function schedule(): void { frame ||= requestAnimationFrame(run); }
  const resized = (): void => { measureRoom(); schedule(); };
  // Fairy slides across when a chat begins, and the text follows her.
  const classChanged = (): void => { measureRoom(); moving = performance.now() + (reduced() ? 0 : 600); schedule(); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', resized);
  new ResizeObserver(resized).observe(scroller as unknown as Element);
  new MutationObserver(schedule).observe(scroller as unknown as Node, { childList: true, subtree: true, characterData: true });
  new MutationObserver(classChanged).observe(root as unknown as Node, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(schedule).observe(status as unknown as Element);
  measureRoom();
  schedule();
  return { update: schedule };
}
