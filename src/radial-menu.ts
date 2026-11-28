// The floating controls as a radial menu that blooms out of Fairy's eye.
// Left half: action segments; group segments open an outer arc of sub-actions.
// Right half: the message ring, whose text follows the curve. Existing buttons
// and the composer textarea keep their ids and handlers; this module only moves
// them into the menu and lays them out as clipped ring sectors.
const NS = 'http://www.w3.org/2000/svg';
const rad = (deg: number): number => deg * Math.PI / 180;
// Screen coordinates: y grows downward, so angle a maps to (cos a, -sin a).
export const polar = (r: number, a: number, c: number): [number, number] => [c + r * Math.cos(rad(a)), c - r * Math.sin(rad(a))];

// Annular sector between radii r1 < r2, from angle a1 to a2 (either direction), in a box centred at c.
export function sectorPath(r1: number, r2: number, a1: number, a2: number, c: number): string {
  const f = (n: number): string => n.toFixed(2);
  const large = Math.abs(a2 - a1) > 180 ? 1 : 0;
  const ccw = a2 > a1 ? 0 : 1;
  const [o1x, o1y] = polar(r2, a1, c), [o2x, o2y] = polar(r2, a2, c), [i2x, i2y] = polar(r1, a2, c), [i1x, i1y] = polar(r1, a1, c);
  return `M${f(o1x)} ${f(o1y)}A${f(r2)} ${f(r2)} 0 ${large} ${ccw} ${f(o2x)} ${f(o2y)}L${f(i2x)} ${f(i2y)}A${f(r1)} ${f(r1)} 0 ${large} ${1 - ccw} ${f(i1x)} ${f(i1y)}Z`;
}

export interface RingGeometry {
  inner: number;
  outer: number;
  subInner: number;
  subOuter: number;
  size: number;
}

// Rings start just outside the eye's glow (about 1.14 × the disc radius), never over the sprite.
export function ringGeometry(r: number): RingGeometry {
  const inner = r * 1.14 + 3, outer = inner + 42, subInner = outer + 4, subOuter = subInner + 38;
  return { inner, outer, subInner, subOuter, size: Math.ceil(subOuter + 4) * 2 };
}

// Left half for actions, top to bottom; the right half holds the message ring and send.
export const ACTION_ARC: readonly [number, number] = [96, 264];
export const MESSAGE_ARC: readonly [number, number] = [84, -62];
export const SEND_ARC: readonly [number, number] = [-66, -86];

export interface SegmentAngle {
  a1: number;
  a2: number;
  mid: number;
}

export function segmentAngles(n: number, [start, end]: readonly [number, number] = ACTION_ARC, gap = 1.2): SegmentAngle[] {
  const step = (end - start) / n;
  return Array.from({ length: n }, (_, i) => {
    const a1 = start + i * step + gap / 2;
    const a2 = start + (i + 1) * step - gap / 2;
    return { a1, a2, mid: (a1 + a2) / 2 };
  });
}

export const shortLabel = (button: HTMLElement): string => String(button.dataset.label || button.getAttribute('aria-label') || button.title || button.textContent || '')
  .replace(/\s*\([^)]*\)/g, '').split(/[:·]/)[0].trim().slice(0, 40);

export interface RadialAnchor {
  x: number;
  y: number;
  r: number;
}

export interface RadialActionGroup {
  label: string;
  icon: string;
  items: string[];
}

export type RadialActionItem = string | RadialActionGroup;

export interface SetupRadialMenuOptions {
  container: HTMLElement;
  anchor?: () => RadialAnchor | null | undefined;
  actions: RadialActionItem[];
  input: HTMLTextAreaElement | HTMLInputElement;
  send: HTMLElement;
  status?: HTMLElement | null;
  pointer?: () => Promise<{ x: number; y: number } | null | undefined>;
}

export interface RadialMenuController {
  place: () => void;
  spriteHover: (value: unknown) => void;
  retract: () => void;
  layout: () => void;
  close: (force?: boolean) => void;
  render: () => void;
}

interface RadialEntry {
  button: HTMLElement;
  group?: HTMLElement[];
  mid?: number;
}

export function setupRadialMenu({ container, anchor, actions, input, send, status, pointer }: SetupRadialMenuOptions): RadialMenuController {
  container.classList.add('radial-menu');
  const handle = container.querySelector('.floating-handle');
  handle?.classList.add('radial-centre');
  if (handle) handle.textContent = '';
  const label = Object.assign(document.createElement('div'), { className: 'radial-label', role: 'status' });
  const svg = document.createElementNS(NS, 'svg');
  svg.classList.add('radial-art');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path class="radial-backdrop" fill-rule="evenodd"/><path class="radial-message-ring"/><path class="radial-message-path" id="radial-message-path" fill="none"/><text class="radial-message-text"><textPath href="#radial-message-path"></textPath></text>';
  const textPath = svg.querySelector<SVGTextPathElement>('textPath')!;
  container.prepend(svg);
  container.append(label);

  // Primary segments: existing buttons, or new group buttons that open a sub-arc.
  const entries: RadialEntry[] = actions.map((item): RadialEntry | null => {
    if (typeof item === 'string') {
      const button = document.querySelector<HTMLElement>(item);
      return button ? { button } : null;
    }
    const button = Object.assign(document.createElement('button'), { type: 'button' as const, className: 'radial-group', innerHTML: item.icon });
    button.dataset.label = item.label;
    button.setAttribute('aria-label', item.label);
    button.setAttribute('aria-expanded', 'false');
    return {
      button,
      group: item.items.map(id => document.querySelector<HTMLElement>(id)).filter((b): b is HTMLElement => Boolean(b)),
    };
  }).filter((entry): entry is RadialEntry => entry !== null);
  for (const { button, group } of entries) {
    container.append(button);
    button.classList.add('radial-segment');
    for (const sub of group || []) {
      container.append(sub);
      sub.classList.add('radial-segment', 'radial-sub');
    }
  }
  input.classList.add('radial-input');
  send.classList.add('radial-segment', 'radial-send');
  container.append(input, send);

  let geometry: RingGeometry | null = null;
  let openGroup: RadialEntry | null = null;
  const clip = (el: HTMLElement, r1: number, r2: number, a1: number, a2: number): void => {
    const geom = geometry!;
    const c = geom.size / 2, mid = (a1 + a2) / 2, [x, y] = polar((r1 + r2) / 2, mid, c), size = geom.size;
    el.style.clipPath = `path('${sectorPath(r1, r2, a1, a2, c)}')`;
    // Centre the element's content on the sector's midpoint.
    el.style.padding = `${Math.max(0, 2 * y - size)}px ${Math.max(0, size - 2 * x)}px ${Math.max(0, size - 2 * y)}px ${Math.max(0, 2 * x - size)}px`;
  };
  const visible = (el: HTMLElement): boolean => !el.hidden;

  // The status line sits just under the eye's glow, following it if the eye moves or resizes.
  function placeStatus(a: RadialAnchor | null | undefined): void {
    if (!status || !a) return;
    status.classList.add('radial-status');
    Object.assign(status.style, { left: `${Math.round(a.x)}px`, top: `${Math.round(a.y + a.r * 1.14 + 8)}px` });
  }
  let placing = 0;
  function place(): void {
    cancelAnimationFrame(placing);
    const a = anchor?.();
    // The eye's position is known after its first frame; retry until then.
    if (!a || !a.r) { placing = requestAnimationFrame(place); return; }
    placeStatus(a);
  }

  let centre: RadialAnchor | null = null;
  function layout(): void {
    const a = anchor?.();
    if (!a || !a.r) return;
    centre = a;
    placeStatus(a);
    geometry = ringGeometry(a.r);
    const { size, inner, outer, subInner, subOuter } = geometry, c = size / 2;
    Object.assign(container.style, { left: `${Math.round(a.x - c)}px`, top: `${Math.round(a.y - c)}px`, width: `${size}px`, height: `${size}px` });
    container.style.setProperty('--centre', `${(inner - 4) * 2}px`);
    const shown = entries.filter(e => visible(e.button));
    segmentAngles(shown.length).forEach(({ a1, a2, mid }, i) => {
      const entry = shown[i];
      entry.mid = mid;
      entry.button.style.setProperty('--i', String(i));
      clip(entry.button, inner, outer, a1, a2);
      const subs = (entry.group || []).filter(visible);
      if (!subs.length) return;
      // The sub-arc fans around its group, kept inside the action half.
      const width = 17, from = Math.max(ACTION_ARC[0], Math.min(ACTION_ARC[1] - subs.length * width, mid - subs.length * width / 2));
      subs.forEach((sub, k) => {
        sub.style.setProperty('--i', String(k));
        clip(sub, subInner, subOuter, from + k * width + .7, from + (k + 1) * width - .7);
      });
    });
    clip(send, inner, outer, ...SEND_ARC);
    input.style.clipPath = `path('${sectorPath(inner, outer, ...MESSAGE_ARC, c)}')`;
    svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
    // A dark annulus behind the segments, so their gaps never show the eye's blue disc.
    const ring = (rr: number): string => `M${c - rr} ${c}a${rr} ${rr} 0 1 0 ${rr * 2} 0a${rr} ${rr} 0 1 0 ${-rr * 2} 0Z`;
    svg.querySelector('.radial-backdrop')!.setAttribute('d', `${ring(outer + 1)}${ring(inner - 1)}`);
    svg.querySelector('.radial-message-ring')!.setAttribute('d', sectorPath(inner, outer, ...MESSAGE_ARC, c));
    const r = (inner + outer) / 2, [sx, sy] = polar(r, MESSAGE_ARC[0] - 3, c), [ex, ey] = polar(r, MESSAGE_ARC[1] + 3, c);
    svg.querySelector('.radial-message-path')!.setAttribute('d', `M${sx} ${sy}A${r} ${r} 0 0 1 ${ex} ${ey}`);
    // The name of what's under the pointer goes above the ring: the groups' outer arcs fan out below and to the left,
    // and would cover it there.
    label.style.top = `${c - outer - 8}px`;
    renderMessage();
  }

  // The real textarea sits invisibly over the ring; the SVG shows its text along the curve.
  function renderMessage(): void {
    const focused = document.activeElement === input, value = input.value.replace(/\s*\n\s*/g, ' ⏎ ');
    textPath.textContent = value || (focused ? '' : input.placeholder || 'Message');
    svg.classList.toggle('is-placeholder', !value);
    svg.classList.toggle('is-focused', focused);
    const caret = document.createElementNS(NS, 'tspan');
    caret.classList.add('radial-caret');
    caret.textContent = '▏';
    if (focused) textPath.append(caret);
    // Keep the end of long drafts in view: trim from the start until the text fits the arc.
    const path = svg.querySelector<SVGPathElement>('.radial-message-path')!;
    const room = path.getTotalLength?.() || 0;
    const text = svg.querySelector<SVGTextElement>('text')!;
    if (!value || !room || !text.getComputedTextLength) return;
    let shown = value;
    while (shown.length > 1 && text.getComputedTextLength() > room) {
      shown = shown.slice(Math.max(1, Math.ceil(shown.length * .08)));
      textPath.firstChild!.textContent = `…${shown}`;
    }
  }
  input.addEventListener('input', () => { renderMessage(); if (!input.value.trim()) queueClose(); });
  input.addEventListener('focus', renderMessage);
  input.addEventListener('blur', () => { renderMessage(); queueClose(); });

  // Open while Fairy is hovered or the pointer is on the menu. Focus only holds it open for an
  // unsent draft or keyboard navigation: a clicked button keeps focus, which must not pin the menu.
  let spriteHovered = false, inside = false, keyboard = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchdog: ReturnType<typeof setInterval> | null = null;
  const holds = (): boolean => (document.activeElement === input && Boolean(input.value.trim())) || (keyboard && container.contains(document.activeElement));
  const open = (): void => {
    clearTimeout(timer);
    if (container.classList.contains('is-open')) return;
    layout();
    container.classList.add('is-open');
    status?.classList.add('is-covered');
    // Transparent windows can miss the pointer leaving; confirm with the real cursor position.
    if (pointer) watchdog = setInterval(async () => {
      const p = await pointer().catch(() => null);
      if (!p || !centre || !geometry || !container.classList.contains('is-open')) return;
      if (Math.hypot(p.x - centre.x, p.y - centre.y) > geometry.subOuter + 8) {
        spriteHovered = false;
        inside = false;
        if (!holds()) close();
      }
    }, 300);
  };
  function close(force = false): void {
    clearTimeout(timer);
    if (watchdog !== null) clearInterval(watchdog);
    watchdog = null;
    if (force && container.contains(document.activeElement) && !(document.activeElement === input && input.value.trim())) {
      (document.activeElement as HTMLElement).blur();
    }
    container.classList.remove('is-open');
    status?.classList.remove('is-covered');
    showGroup(null);
    label.textContent = '';
  }
  const queueClose = (): void => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!spriteHovered && !inside && !holds()) close(); }, 380);
  };
  container.addEventListener('keydown', event => {
    if (['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) keyboard = true;
  });
  document.addEventListener('pointerdown', () => { keyboard = false; }, true);
  // Mouse clicks should not leave a segment focused (keyboard activation keeps focus).
  container.addEventListener('click', event => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>('button.radial-segment');
    if (button && event.detail > 0) setTimeout(() => button.blur());
  });
  function showGroup(entry: RadialEntry | null): void {
    openGroup = entry;
    for (const e of entries) {
      if (!e.group) continue;
      const on = e === entry;
      e.button.setAttribute('aria-expanded', String(on));
      e.group.forEach(sub => sub.classList.toggle('is-shown', on));
    }
  }
  const describe = (el: HTMLElement): void => {
    label.textContent = el === input ? (input.placeholder || 'Message') : shortLabel(el);
  };
  container.addEventListener('pointerover', event => {
    inside = true;
    open();
    const el = (event.target as Element | null)?.closest<HTMLElement>('.radial-segment, .radial-input');
    if (!el) return;
    describe(el);
    const entry = entries.find(e => e.button === el);
    if (entry) showGroup(entry.group ? entry : null);
    else if (!el.classList.contains('radial-sub')) showGroup(null);
  });
  container.addEventListener('pointerout', event => {
    if (!container.contains(event.relatedTarget as Node | null)) {
      inside = false;
      label.textContent = '';
      queueClose();
    }
  });
  container.addEventListener('focusin', event => {
    open();
    const el = (event.target as Element | null)?.closest<HTMLElement>('.radial-segment, .radial-input');
    if (!el) return;
    describe(el);
    const entry = entries.find(e => e.button === el || e.group?.includes(el));
    showGroup(entry?.group ? entry : null);
  });
  container.addEventListener('focusout', queueClose);
  for (const { button, group } of entries) {
    if (group) button.addEventListener('click', () => showGroup(openGroup?.button === button ? null : (entries.find(e => e.button === button) ?? null)));
  }
  container.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      (document.activeElement as HTMLElement | null)?.blur?.();
      close();
    }
  });

  // Buttons appear and disappear (stop, meeting); re-space the ring when they do.
  new MutationObserver(() => { if (geometry) layout(); }).observe(container, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  addEventListener('resize', () => { if (container.classList.contains('is-open')) layout(); else place(); });
  place();
  return {
    place,
    spriteHover(value: unknown) { spriteHovered = Boolean(value); if (spriteHovered) open(); else queueClose(); },
    // Fairy starting work retracts the menu so her thinking bulb and reply stay visible.
    retract() { spriteHovered = false; inside = false; close(true); },
    layout,
    close,
    render: renderMessage,
  };
}
