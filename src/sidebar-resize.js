export const SIDEBAR_DEFAULT = 272, SIDEBAR_MIN = 200, SIDEBAR_MAX = 440;
const KEY = 'fairy-sidebar-width', CHAT_ROOM = 432;
// Keeps the sidebar readable, and leaves the chat room to work beside it.
export function sidebarWidth(value, windowWidth = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number)) return SIDEBAR_DEFAULT;
  return Math.round(Math.max(SIDEBAR_MIN, Math.min(number, SIDEBAR_MAX, windowWidth - CHAT_ROOM)));
}
export function setupSidebarResize({ handle, root = document.documentElement }) {
  let width = SIDEBAR_DEFAULT;
  const apply = (value, save = true) => {
    width = sidebarWidth(value, innerWidth);
    root.style.setProperty('--sidebar-width', `${width}px`);
    handle.setAttribute('aria-valuenow', String(width));
    if (save) try { localStorage.setItem(KEY, String(width)); } catch {}
  };
  try { apply(localStorage.getItem(KEY) ?? SIDEBAR_DEFAULT, false); } catch { apply(SIDEBAR_DEFAULT, false); }
  handle.setAttribute('aria-valuemin', String(SIDEBAR_MIN)); handle.setAttribute('aria-valuemax', String(SIDEBAR_MAX));
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    root.classList.add('sidebar-resizing');
    const startX = event.clientX, startWidth = width;
    const move = moved => apply(startWidth + moved.clientX - startX);
    const end = () => { root.classList.remove('sidebar-resizing'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => apply(SIDEBAR_DEFAULT));
  handle.addEventListener('keydown', event => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
    if (step) { event.preventDefault(); apply(width + step); }
    if (event.key === 'Home') { event.preventDefault(); apply(SIDEBAR_DEFAULT); }
  });
}
