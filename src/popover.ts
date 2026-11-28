const SVG_NS = 'http://www.w3.org/2000/svg';

export type SvgIconPath = readonly [string, Readonly<Record<string, string | number>>];

export type PopoverAlign = 'below-left' | 'below-right' | 'right-of';

export interface CreatePopoverOptions {
  anchor?: HTMLElement | null;
  className?: string;
  label?: string;
  align?: PopoverAlign;
  width?: number;
  onOpen?: (panel: HTMLDivElement, position: () => void) => unknown;
  onClose?: () => void;
}

export interface PopoverController {
  panel: HTMLDivElement;
  open: () => void;
  close: () => void;
  toggle: () => void;
  position: () => void;
  isOpen: () => boolean;
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

export function svgIcon(paths: ReadonlyArray<SvgIconPath>, size = 14, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  if (className) svg.setAttribute('class', className);
  for (const [tag, attrs] of paths) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  }
  return svg;
}

export function inputRequiredSvg(size = 13): SVGSVGElement {
  return svgIcon([
    ['circle', { cx: 12, cy: 12, r: 9.5 }],
    ['line', { x1: 12, y1: 7.5, x2: 12, y2: 13 }],
    ['circle', { cx: 12, cy: 16.5, r: 0.9, fill: 'currentColor', stroke: 'none' }],
  ], size);
}

/**
 * Shared floating Obsidian popover helper with viewport clamping, Escape close, and outside-click dismissal.
 */
export function createPopover({
  anchor,
  className = '',
  label = 'Popup',
  align = 'below-left',
  width = 340,
  onOpen = () => {},
  onClose = () => {},
}: CreatePopoverOptions = {}): PopoverController {
  const panel = el('div', `fairy-popover ${className}`.trim());
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', label);
  panel.hidden = true;
  document.body.append(panel);

  let opened = false;

  const position = (): void => {
    if (!anchor || panel.hidden) return;
    const rect = anchor.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 24);
    panel.style.width = `${w}px`;
    const maxH = Math.min(520, window.innerHeight - 24);
    panel.style.maxHeight = `${maxH}px`;
    const h = panel.offsetHeight || Math.min(360, maxH);

    let left: number;
    let top: number;
    if (align === 'right-of') {
      left = rect.right + 10;
      if (left + w > window.innerWidth - 12) left = Math.max(12, rect.left - w - 10);
      top = Math.min(rect.top - 8, window.innerHeight - h - 12);
    } else if (align === 'below-right') {
      left = rect.right - w;
      top = rect.bottom + 8;
    } else {
      left = rect.left;
      top = rect.bottom + 8;
    }
    left = Math.max(12, Math.min(left, window.innerWidth - w - 12));
    top = Math.max(12, Math.min(top, window.innerHeight - h - 12));
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  };

  const close = (): void => {
    if (!opened) return;
    opened = false;
    panel.hidden = true;
    anchor?.classList.remove('is-open');
    anchor?.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', position);
    onClose();
  };

  const onOutside = (event: PointerEvent): void => {
    if (!opened) return;
    const target = event.target as Node | null;
    if (panel.contains(target) || anchor?.contains(target)) return;
    close();
  };

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      anchor?.focus?.();
    }
  };

  const open = (): void => {
    if (!anchor) return;
    opened = true;
    panel.hidden = false;
    anchor.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    void Promise.resolve(onOpen(panel, position)).then(() => {
      if (opened) position();
    });
    position();
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', position);
  };

  const toggle = (): void => (opened ? close() : open());

  return {
    panel,
    open,
    close,
    toggle,
    position,
    isOpen: () => opened,
  };
}
