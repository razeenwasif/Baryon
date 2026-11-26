const OPENING_MS = 520, NARROWEST = 440, GAP = 10, STEP = 4, OPENING_STEP = 8, FAST_SCROLL = 40, FAST_EVERY_MS = 120;
const snap = (value, step) => Math.round(value / step) * step;
// The part of the avatar's square that's really occupied, and the status line under it.
export function avatarZone(avatar, status) {
  const hasStatus = status && status.width > 0, width = Math.max(avatar.width * 0.72, hasStatus ? status.width : 0) + 8, middle = avatar.left + avatar.width / 2;
  const top = avatar.top + avatar.height * 0.08, bottom = Math.max(hasStatus ? status.bottom : 0, avatar.top + avatar.height * 0.72) + 4;
  return { left: middle - width / 2, top, bottom, radius: Math.min(width, bottom - top) / 2 };
}
// One float, placed where the first row at the avatar starts. Lines flow around its shape,
// and anything after it wraps too, since the rows don't contain floats of their own.
// Sizes move in small steps, so a slow scroll only lays text out when a step is crossed.
export function floatStyle({ zone, floatTop, contentRight, opened = 1 }) {
  const height = snap(zone.bottom - floatTop, STEP), width = snap(Math.max(0, contentRight - zone.left) * opened, opened < 1 ? OPENING_STEP : 1);
  if (height <= 0 || width <= 0) return null;
  return { width: `${width}px`, height: `${height}px`, shapeOutside: `inset(${Math.max(0, snap(zone.top - floatTop, STEP))}px 0 0 0 round ${Math.round(zone.radius)}px)`, shapeMargin: `${GAP}px` };
}
// Rows are in order down the page, so the one at the avatar can be found without measuring them all.
export function firstRowBelow(rows, y, bottomOf) {
  let low = 0, high = rows.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (bottomOf(rows[middle]) > y) high = middle; else low = middle + 1;
  }
  return low;
}
const ease = value => 1 - (1 - value) ** 3;
const bottomOf = row => row.getBoundingClientRect().bottom;
export function setupAvatarWrap({ scroller, avatar, status, tools, conversation, root = document.documentElement, reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches }) {
  const float = document.createElement('div');
  float.className = 'avatar-float'; float.setAttribute('aria-hidden', 'true');
  let frame = 0, settle = 0, openedAt = 0, wasOn = false, moving = 0, lastTop = 0, lastPlaced = 0, inner = 0;
  const on = () => !root.classList.contains('home') && !root.classList.contains('floating') && !root.classList.contains('wrap-off') && scroller.clientWidth > 0;
  function measureRoom() {
    const toolsBox = tools.getBoundingClientRect(), box = conversation.getBoundingClientRect();
    root.classList.toggle('wrap-off', box.width > 0 && box.width < NARROWEST);
    root.classList.toggle('avatar-low', toolsBox.width > 0 && toolsBox.left < box.right && toolsBox.right > box.left);
    inner = parseFloat(getComputedStyle(scroller).paddingRight) || 0;
  }
  function place() {
    if (!on()) { float.remove(); wasOn = false; openedAt = 0; return; }
    if (!wasOn) { wasOn = true; openedAt = reduced() ? 0 : performance.now(); }
    const zone = avatarZone(avatar.getBoundingClientRect(), status.getBoundingClientRect());
    // On a narrower window the Pin and Float buttons sit above Fairy, and the text goes around them too.
    if (root.classList.contains('avatar-low')) { const buttons = tools.getBoundingClientRect(); zone.top = Math.min(zone.top, buttons.top); zone.left = Math.min(zone.left, buttons.left); }
    const rows = float.parentNode ? [...scroller.children].filter(row => row !== float) : [...scroller.children];
    const index = firstRowBelow(rows, zone.top, bottomOf), first = rows[index];
    if (!first || first.getBoundingClientRect().top >= zone.bottom) { float.remove(); return; }
    // The first row wholly below Fairy stays where it is, so the text being read doesn't jump when a line wraps differently.
    let anchor = first;
    for (let next = index + 1; next < rows.length; next += 1) {
      if (rows[next].getBoundingClientRect().top >= zone.bottom) { anchor = rows[next]; break; }
      if (rows[next].getBoundingClientRect().top > scroller.clientHeight) break;
    }
    const before = anchor.getBoundingClientRect().top, following = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 4;
    if (float.nextElementSibling !== first) scroller.insertBefore(float, first);
    const opened = openedAt ? ease(Math.min(1, (performance.now() - openedAt) / OPENING_MS)) : 1;
    const next = floatStyle({ zone, floatTop: float.getBoundingClientRect().top, contentRight: scroller.getBoundingClientRect().left + scroller.clientWidth - inner, opened });
    if (!next) { float.remove(); return; }
    let changed = false;
    for (const [key, value] of Object.entries(next)) if (float.style[key] !== value) { float.style[key] = value; changed = true; }
    if (opened >= 1) openedAt = 0;
    if (!changed && float.nextElementSibling === first) return;
    const shift = anchor.getBoundingClientRect().top - before;
    if (following) scroller.scrollTop = scroller.scrollHeight;
    else if (Math.abs(shift) >= 1 && scroller.scrollTop > 0) scroller.scrollTop += shift;
  }
  function run() {
    frame = 0;
    clearTimeout(settle);
    const now = performance.now(), speed = Math.abs(scroller.scrollTop - lastTop);
    lastTop = scroller.scrollTop;
    // Nobody reads text going past this fast, so it waits until the scrolling slows or stops.
    if (speed > FAST_SCROLL && now - lastPlaced < FAST_EVERY_MS) { settle = setTimeout(schedule, FAST_EVERY_MS); return; }
    lastPlaced = now;
    place();
    lastTop = scroller.scrollTop;
    // The opening lasts OPENING_MS however place() returned. With no text beside Fairy it returns before the opening
    // finishes, and this asked for a frame on every refresh for as long as Fairy ran (efficiency audit, fix 4).
    if (openedAt && now - openedAt >= OPENING_MS) openedAt = 0;
    if (openedAt || now < moving) schedule();
  }
  function schedule() { frame ||= requestAnimationFrame(run); }
  const resized = () => { measureRoom(); schedule(); };
  // Fairy slides across when a chat begins, and the text follows her.
  const classChanged = () => { measureRoom(); moving = performance.now() + (reduced() ? 0 : 600); schedule(); };
  scroller.addEventListener('scroll', schedule, { passive: true });
  addEventListener('resize', resized);
  new ResizeObserver(resized).observe(scroller);
  new MutationObserver(schedule).observe(scroller, { childList: true, subtree: true, characterData: true });
  new MutationObserver(classChanged).observe(root, { attributes: true, attributeFilter: ['class'] });
  new ResizeObserver(schedule).observe(status);
  measureRoom();
  schedule();
  return { update: schedule };
}
