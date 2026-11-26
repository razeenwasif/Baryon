// The companion's window is bigger than what it shows (the eye, its ring, a reply, an approval), so its see-through
// parts let clicks through to the windows behind it: over them the window ignores the mouse, and macOS still tells the
// page where the pointer is (setIgnoreMouseEvents with forward), so it takes the mouse again over what it shows.
// Floating mode does the same in app.js.

// The page's own frame, which shows nothing: the document, and the two full-window boxes everything sits in.
const FRAME = new Set(['companion', 'floating-ui']);
export function showsHere(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  if (target.tagName === 'HTML' || target.tagName === 'BODY') return false;
  return !FRAME.has(target.id);
}

// The eye is the window's drag handle, a part of the window macOS may not report the pointer over, so the window takes
// the mouse a little before the pointer reaches it: within `margin` of its box, in its glow.
export const EYE_MARGIN = 28;
export function nearBox(box, x, y, margin = EYE_MARGIN) {
  return Boolean(box) && x >= box.left - margin && x <= box.right + margin && y >= box.top - margin && y <= box.bottom + margin;
}

// Tells the window to let clicks through, or not, when that changes, and again now and then, as the window can be set
// back to taking clicks without the page knowing (Ride along or hiding her ending). send(value) asks the window;
// near(x, y) says whether the pointer is close to the eye.
export function clickThrough(send, { near = () => false, now = Date.now, every = 1000 } = {}) {
  let passing = null, sentAt = 0;
  return ({ target, clientX, clientY } = {}) => {
    const next = !showsHere(target) && !near(clientX, clientY);
    if (next === passing && now() - sentAt < every) return passing;
    passing = next; sentAt = now();
    Promise.resolve(send(next)).catch(() => {});
    return passing;
  };
}
