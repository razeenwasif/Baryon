// The side panel's left edge drags to make it wider or narrower, as the sidebar's right edge does. Until it's dragged,
// each panel keeps its own width; once dragged, every panel uses yours. Double-click the edge to go back.
export const PANE_MIN = 300;
export const CHAT_ROOM = 360;
const KEY = 'fairy-pane-width';

export function paneWidth(value: unknown, windowWidth = Infinity, sidebarColumn = 0): number | null {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(Math.max(PANE_MIN, Math.min(number, windowWidth - sidebarColumn - CHAT_ROOM)));
}

export interface SetupPaneResizeOptions {
  pane: HTMLElement;
  root?: HTMLElement;
}

export function setupPaneResize({ pane, root = document.documentElement }: SetupPaneResizeOptions): void {
  const handle = document.createElement('div');
  handle.id = 'pane-resize'; handle.tabIndex = 0;
  Object.entries({ role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Resize side panel', title: 'Drag to resize. Double-click to reset.', 'aria-valuemin': String(PANE_MIN) })
    .forEach(([name, value]) => handle.setAttribute(name, value));
  pane.append(handle);
  const sidebarColumn = (): number => root.querySelector('.sidebar')?.getBoundingClientRect().right || 0;
  let width: number | null = null;
  const apply = (value: unknown, save = true): void => {
    width = paneWidth(value, innerWidth, sidebarColumn());
    root.classList.toggle('pane-sized', width != null);
    if (width != null) { root.style.setProperty('--pane-width', `${width}px`); handle.setAttribute('aria-valuenow', String(width)); }
    else { root.style.removeProperty('--pane-width'); handle.removeAttribute('aria-valuenow'); }
    if (save) try { width == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, String(width)); } catch {}
  };
  try { apply(localStorage.getItem(KEY), false); } catch { apply(null, false); }
  handle.addEventListener('pointerdown', (event: PointerEvent) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    root.classList.add('pane-resizing');
    const startX = event.clientX, startWidth = pane.getBoundingClientRect().width;
    const move = (moved: PointerEvent) => apply(startWidth - (moved.clientX - startX));
    const end = () => { root.classList.remove('pane-resizing'); handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  });
  handle.addEventListener('dblclick', () => apply(null));
  handle.addEventListener('keydown', (event: KeyboardEvent) => {
    const step = ({ ArrowLeft: 24, ArrowRight: -24 } as Record<string, number>)[event.key];
    if (step) { event.preventDefault(); apply((width ?? pane.getBoundingClientRect().width) + step); }
    if (event.key === 'Home') { event.preventDefault(); apply(null); }
  });
  // A smaller window can't keep a width it no longer has room for.
  addEventListener('resize', () => { if (width != null) apply(width, false); });
}
