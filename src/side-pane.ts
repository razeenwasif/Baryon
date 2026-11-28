import { leaves, MAX_PANELS, cleanLayout, single, split, remove, replace, resize, turn, groupAt, sideBySide, isLeaf } from './pane-layout.js';
import type { PaneGroup, PaneNode, SplitDir } from './pane-layout.js';
import { createProactivePanelGuard } from './proactive-panel-guard.js';

export interface PaneContext {
  readonly view: unknown;
  setView: (next: unknown) => void;
  redraw: () => void;
}

export interface SidePaneDefinition {
  id: string;
  title: string;
  render: (body: HTMLElement, context: PaneContext) => unknown;
  wide?: (view: unknown) => boolean;
  leave?: () => void;
  reset?: () => void;
}

export interface SidePaneState {
  open: boolean;
  tab: string;
  view: unknown;
  layout: PaneGroup | null;
}

export interface SetupSidePaneOptions {
  root: HTMLElement;
  rail: HTMLElement;
  panes: SidePaneDefinition[];
  onChange: (state: SidePaneState) => void;
  currentSession?: () => string;
}

export interface OpenProactiveOptions {
  sessionId?: string;
  expectedRevision?: number | null;
  view?: unknown;
}

export interface SidePaneController {
  restore: (savedState?: Partial<SidePaneState>) => void;
  refresh: () => void;
  current: () => string;
  isOpen: (id: string) => boolean;
  redraw: () => void;
  close: () => void;
  toggle: (fallbackId?: string) => void;
  show: (tab: string, next?: unknown) => void;
  getUserActionRevision: (sessionId?: string) => number;
  recordUserAction: (sessionId?: string) => number;
  openProactive: (tab: string, options?: OpenProactiveOptions) => boolean;
}

interface CellEntry {
  cell: HTMLDivElement;
  body: HTMLDivElement;
  context: PaneContext;
  drawn: boolean;
}

// The panel beside the chat, opened from a rail of icons. Each kind of pane registers here, and each chat remembers the
// panel: whether it was open, which panes (up to three, side by side or stacked, pane-layout.js) and which one you were
// last in.
//
// From the rail: a click shows that pane in place of the one you're in, ⌘-click opens it beside, ⇧⌘-click below, and a
// right-click offers the same; clicking an open pane's icon closes it. Drag the line between two panes to resize them;
// double-click it to turn them from side by side to stacked, or back.
export function setupSidePane({ root, rail, panes, onChange, currentSession = () => '' }: SetupSidePaneOptions): SidePaneController {
  root.innerHTML = '<div class="pane-layout"></div>';
  const host = root.querySelector('.pane-layout') as HTMLElement;
  // Each pane keeps its own open item, such as a page in Pages or a citation in Sources.
  let open = false;
  let layout: PaneGroup | null = null;
  let focused = panes[0].id;
  let menu: HTMLDivElement | null = null;
  let hasOpened = false;
  const guard = createProactivePanelGuard();
  const views: Record<string, unknown> = {};
  const cells = new Map<string, CellEntry>();
  const byId = (id: string): SidePaneDefinition | undefined => panes.find(entry => entry.id === id);
  const known = (id: string): boolean => Boolean(byId(id));
  const ids = (): string[] => (open && layout ? leaves(layout) : []);
  const focusedId = (): string => (ids().includes(focused) ? focused : ids()[0]) || focused;
  const saved = (): SidePaneState => ({ open, tab: focusedId(), view: views[focusedId()] ?? null, layout: open ? layout : null });
  const contextFor = (id: string): PaneContext => ({
    get view() { return views[id] ?? null; },
    setView(next: unknown) { views[id] = next; draw([id]); onChange(saved()); },
    redraw: () => draw([id]),
  });
  const changed = (rendered: string[] | null): void => { draw(rendered); onChange(saved()); };

  // A pane's box, kept while the pane stays open so what it shows survives a change of layout.
  function cellFor(id: string): CellEntry {
    let entry = cells.get(id);
    if (entry) return entry;
    const cell = document.createElement('div'), body = document.createElement('div');
    cell.className = 'pane-cell'; cell.dataset.pane = id;
    body.className = 'pane-body'; body.setAttribute('role', 'tabpanel'); body.setAttribute('aria-label', byId(id)?.title || id);
    cell.append(body);
    cell.addEventListener('pointerdown', () => { if (focused !== id) { focused = id; markFocus(); onChange(saved()); } }, true);
    entry = { cell, body, context: contextFor(id), drawn: false };
    cells.set(id, entry);
    return entry;
  }
  const markFocus = (): void => {
    for (const [id, { cell }] of cells) cell.classList.toggle('focused', id === focusedId() && ids().length > 1);
    document.documentElement.dataset.pane = open ? focusedId() : '';
  };

  // The line between two items of a group: drag to resize, double-click to turn the group.
  function divider(path: number[], index: number, dir: SplitDir): HTMLDivElement {
    const line = document.createElement('div');
    line.className = 'pane-divider'; line.setAttribute('role', 'separator'); line.tabIndex = 0;
    line.setAttribute('aria-orientation', dir === 'row' ? 'vertical' : 'horizontal');
    line.title = 'Drag to resize. Double-click to stack or put side by side.';
    line.addEventListener('pointerdown', event => {
      event.preventDefault(); line.setPointerCapture(event.pointerId);
      const box = line.parentElement!.getBoundingClientRect(), span = dir === 'row' ? box.width : box.height, start = dir === 'row' ? event.clientX : event.clientY;
      const before = layout;
      if (!before) return;
      document.documentElement.classList.add('pane-resizing');
      const move = (moved: PointerEvent): void => { layout = resize(before, path, index, ((dir === 'row' ? moved.clientX : moved.clientY) - start) / Math.max(1, span)); applySizes(); };
      const end = (): void => { document.documentElement.classList.remove('pane-resizing'); line.removeEventListener('pointermove', move); line.removeEventListener('pointerup', end); line.removeEventListener('pointercancel', end); onChange(saved()); };
      line.addEventListener('pointermove', move); line.addEventListener('pointerup', end); line.addEventListener('pointercancel', end);
    });
    line.addEventListener('dblclick', () => { if (!layout) return; layout = turn(layout, path); changed([]); });
    line.addEventListener('keydown', event => {
      const step = ({ ArrowLeft: -0.05, ArrowUp: -0.05, ArrowRight: 0.05, ArrowDown: 0.05 } as Record<string, number>)[event.key];
      if (step && layout) { event.preventDefault(); layout = resize(layout, path, index, step); applySizes(); onChange(saved()); }
      if (event.key === 'Enter' && layout) { event.preventDefault(); layout = turn(layout, path); changed([]); }
    });
    return line;
  }
  function build(node: PaneNode, path: number[]): HTMLElement {
    if (isLeaf(node)) return cellFor(node.tab).cell;
    const group = document.createElement('div');
    group.className = 'pane-split'; group.dataset.dir = node.dir; group.dataset.path = path.join('.');
    node.items.forEach((item, index) => {
      if (index) group.append(divider(path, index - 1, node.dir));
      const element = build(item, [...path, index]);
      element.style.flex = `${node.sizes[index]} 1 0`;
      group.append(element);
    });
    return group;
  }
  // Sizes change while a line is dragged without building the panel again.
  function applySizes(): void {
    for (const group of host.querySelectorAll<HTMLElement>('.pane-split')) {
      const node = groupAt(layout, group.dataset.path ? group.dataset.path.split('.').map(Number) : []);
      if (!node) continue;
      [...group.children].filter((child): child is HTMLElement => !child.classList.contains('pane-divider')).forEach((child, index) => { child.style.flex = `${node.sizes[index]} 1 0`; });
    }
  }

  // Draws the panel. rendered: the panes to draw again; all of them unless said.
  function draw(rendered: string[] | null = null): void {
    const showing = ids();
    document.documentElement.classList.toggle('pane-open', open);
    document.documentElement.classList.toggle('pane-wide', open && (sideBySide(layout) || showing.some(id => Boolean(byId(id)?.wide?.(views[id] ?? null)))));
    root.hidden = !open;
    root.classList.toggle('pane-single', showing.length === 1);
    root.classList.toggle('pane-multi', showing.length > 1);
    rail.replaceChildren(...panes.map(entry => {
      const tab = document.createElement('button'), selected = showing.includes(entry.id);
      tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.dataset.pane = entry.id; tab.setAttribute('aria-label', entry.title); tab.setAttribute('aria-selected', String(selected));
      tab.title = selected ? `Close ${entry.title}` : `${entry.title} · ⌘-click to open beside, ⇧⌘-click below`;
      tab.onclick = event => {
        closeMenu();
        guard.recordUserAction(currentSession());
        if (selected) { closePane(entry.id); return; }
        if (open && (event.metaKey || event.ctrlKey)) openBeside(entry.id, event.shiftKey ? 'col' : 'row');
        else showHere(entry.id);
      };
      tab.oncontextmenu = event => { event.preventDefault(); openMenu(entry, tab, selected); };
      return tab;
    }));
    // Panes that left: told they're out of sight (the browser's page sits on top of the window), their boxes let go.
    for (const [id, entry] of cells) {
      if (showing.includes(id)) continue;
      byId(id)?.leave?.(); entry.cell.remove(); cells.delete(id);
    }
    if (!open || !layout) { host.replaceChildren(); markFocus(); return; }
    host.replaceChildren(build(layout, []));
    markFocus();
    for (const id of showing) {
      const entry = cellFor(id);
      if (entry.drawn && rendered && !rendered.includes(id)) continue;
      entry.drawn = true;
      void byId(id)?.render(entry.body, entry.context);
    }
  }
  function showHere(id: string): void {
    if (!open || !layout) { layout = single(id); open = true; }
    else { byId(focusedId())?.reset?.(); layout = replace(layout, focusedId(), id); }
    focused = id; hasOpened = true; changed(null);
  }
  function openBeside(id: string, dir: SplitDir): void {
    if (!open || !layout) { showHere(id); return; }
    if (ids().length >= MAX_PANELS) { showHere(id); return; }
    layout = split(layout, focusedId(), id, dir); focused = id; changed([id]);
  }
  function closePane(id: string): void {
    byId(id)?.reset?.();
    layout = remove(layout, id);
    if (!layout) open = false;
    changed([]);
  }

  // A rail icon's right-click menu: where to open that pane.
  function closeMenu(): void { menu?.remove(); menu = null; }
  function openMenu(entry: SidePaneDefinition, anchor: HTMLButtonElement, selected: boolean): void {
    closeMenu();
    menu = document.createElement('div');
    menu.className = 'pane-menu'; menu.setAttribute('role', 'menu');
    const full = ids().length >= MAX_PANELS;
    const items: Array<[string, () => void]> = selected ? [['Close', () => closePane(entry.id)]]
      : [['Open here', () => showHere(entry.id)], ...(open && !full ? [['Open beside', () => openBeside(entry.id, 'row')], ['Open below', () => openBeside(entry.id, 'col')]] as Array<[string, () => void]> : [])];
    for (const [label, run] of items) {
      const item = document.createElement('button');
      item.type = 'button'; item.setAttribute('role', 'menuitem'); item.textContent = label;
      item.onclick = () => { closeMenu(); run(); };
      menu.append(item);
    }
    if (!selected && full) { const note = document.createElement('p'); note.textContent = `${MAX_PANELS} panels are open. Close one to add another.`; menu.append(note); }
    document.body.append(menu);
    const box = anchor.getBoundingClientRect();
    menu.style.top = `${Math.round(box.top)}px`;
    menu.style.right = `${Math.round(innerWidth - box.left + 6)}px`;
    menu.querySelector('button')?.focus();
    const away = (event: PointerEvent): void => { if (!menu?.contains(event.target as Node | null)) { closeMenu(); removeEventListener('pointerdown', away, true); } };
    addEventListener('pointerdown', away, true);
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { closeMenu(); anchor.focus(); } });
  }

  return {
    restore({ open: isOpen = false, tab = '', view: savedView = null, layout: savedLayout = null }: Partial<SidePaneState> = {}) {
      for (const id of ids()) byId(id)?.reset?.();
      for (const key of Object.keys(views)) delete views[key];
      layout = cleanLayout(savedLayout, known) ?? (known(tab) ? single(tab) : null);
      open = isOpen && Boolean(layout);
      if (open) hasOpened = true;
      if (known(tab)) { focused = tab; views[tab] = savedView; }
      draw(null);
    },
    // Draws the panes again that follow what happens in the chat (not the wide ones: a page or a browser).
    refresh() { if (open) draw(ids().filter(id => !byId(id)?.wide?.(views[id] ?? null))); },
    current: () => (open ? focusedId() : ''),
    isOpen: id => ids().includes(id),
    redraw: () => draw(null),
    close() {
      if (!open) return;
      for (const id of ids()) byId(id)?.reset?.();
      layout = null;
      open = false;
      changed([]);
    },
    toggle(fallbackId = panes[0].id) {
      guard.recordUserAction(currentSession());
      if (open) { this.close(); return; }
      const target = hasOpened && known(focused) ? focused : (known(fallbackId) ? fallbackId : panes[0].id);
      showHere(target);
    },
    // Shows a pane: where it already is, or in place of the one you're in.
    show(tab, next = null) {
      views[tab] = next;
      if (ids().includes(tab)) { focused = tab; changed([tab]); return; }
      showHere(tab);
    },
    getUserActionRevision(sessionId = currentSession()) { return guard.getRevision(sessionId); },
    recordUserAction(sessionId = currentSession()) { return guard.recordUserAction(sessionId); },
    openProactive(tab, { sessionId = currentSession(), expectedRevision = null, view = null }: OpenProactiveOptions = {}) {
      if (!guard.canAutoOpen({ sessionId, expectedRevision })) return false;
      this.show(tab, view);
      return true;
    },
  };
}

// Questions asked in this chat, to jump back to.
export function outlinePane(): SidePaneDefinition {
  return { id: 'outline', title: 'Outline', render(body: HTMLElement) {
    const asked = [...document.querySelectorAll('#messages .message.user')].map(item => ({ item, text: item.children[1]?.textContent?.trim() || '' })).filter(({ text }) => text);
    if (!asked.length) { const empty = document.createElement('p'); empty.className = 'pane-empty'; empty.textContent = 'Questions you ask in this chat show up here.'; body.replaceChildren(empty); return; }
    const list = document.createElement('ol'); list.className = 'outline-list';
    list.append(...asked.map(({ item, text }) => {
      const entry = document.createElement('li'), button = document.createElement('button');
      button.type = 'button'; button.textContent = text.slice(0, 160); button.title = text.slice(0, 300);
      button.onclick = () => item.scrollIntoView({ behavior: 'smooth', block: 'center' });
      entry.append(button); return entry;
    }));
    body.replaceChildren(list);
  } };
}
