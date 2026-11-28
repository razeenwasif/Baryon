// The notebook's paper view (docs: "Notebook paper view and clippings", stage 1): a PDF opened beside the tutor turns
// the notebook into the paper on the left and the tutor on the right, with the window's sidebar folded; closing the PDF
// puts everything back. Switching is one move each way, a view transition, which animates pictures of the two views,
// so the tutor's words wrap once instead of on every frame. notebook.css has the move's names and timing.

export interface PaperTransitionHandle {
  finished: Promise<unknown>;
  skipTransition: () => void;
}

export interface PaperSwitchOptions {
  root: HTMLElement;
  transition?: ((update: () => Promise<void> | void) => PaperTransitionHandle) | null;
  reduced?: () => boolean;
  show: (on: boolean) => Promise<unknown> | void;
  rowFor?: (id: string | null) => Element | null;
}

export interface PaperSwitchController {
  readonly open: boolean;
  readonly moving: boolean;
  to: (on: boolean, source?: string | null) => boolean;
  leave: (fold: (on: boolean) => void) => void;
}

// paperSwitch moves between the views. root: the document element, whose classes name the move for the CSS;
// transition(update): document.startViewTransition, or null where there's none; reduced(): Reduce Motion is on;
// show(on): fold or open the sidebar and draw the view asked for (perhaps answering with a promise to wait for); rowFor(id): the source's row in the sidebar, which
// the paper grows out of and shrinks back into (it's marked data-paper-origin for the move).
export function paperSwitch({ root, transition = null, reduced = () => false, show, rowFor = () => null }: PaperSwitchOptions): PaperSwitchController {
  let open = false;
  let from: string | null = null;
  let moving: PaperTransitionHandle | null = null;
  const settle = () => {
    moving = null;
    root.classList.remove('nb-moving', 'nb-opening', 'nb-closing');
    for (const row of root.querySelectorAll('[data-paper-origin]')) row.removeAttribute('data-paper-origin');
  };
  return {
    get open() { return open; },
    get moving() { return Boolean(moving); },
    // on: whether a PDF is beside the tutor now; source: the source it is, when it's a source.
    to(on, source = null) {
      if (on === open) return false;
      open = on;
      if (on) from = source;
      moving?.skipTransition();
      settle();
      if (!transition || reduced()) { void show(on); return true; }
      if (on) rowFor(from)?.setAttribute('data-paper-origin', '');
      root.classList.add('nb-moving', on ? 'nb-opening' : 'nb-closing');
      // Closing: the paper shrinks back into the row it came from, once the sidebar has it again.
      // show may answer with a promise (the paper's first page), which the move waits for before it starts.
      const step = transition(async () => { await show(on); if (!on) rowFor(from)?.setAttribute('data-paper-origin', ''); });
      moving = step;
      step.finished.finally(() => { if (moving === step) settle(); });
      return true;
    },
    // Leaving the notebook, or hiding it, with the paper open: the sidebar comes back at once, with no move.
    leave(fold) {
      if (!open) return;
      moving?.skipTransition(); settle();
      open = false; fold(false);
    },
  };
}

export interface SidebarFoldOptions {
  isFolded: () => boolean;
  setFolded: (value: boolean) => void;
}

export interface SidebarFoldController {
  paper: (on: boolean) => void;
  changed: () => void;
  readonly ours: boolean;
}

// sidebarFold folds the window's sidebar for the paper view and opens it again after, unless it was folded already or
// you folded or opened it yourself meanwhile, which then stands. isFolded() and setFolded(value) work the sidebar
// without saving how it opens next time.
export function sidebarFold({ isFolded, setFolded }: SidebarFoldOptions): SidebarFoldController {
  let ours = false;
  return {
    paper(on) {
      if (on && !isFolded()) { setFolded(true); ours = true; }
      else if (!on && ours) { ours = false; if (isFolded()) setFolded(false); }
    },
    // You changed it: from now on it's yours.
    changed() { ours = false; },
    get ours() { return ours; },
  };
}

export interface PaperLocation {
  source?: string;
  file?: string;
  page?: number;
}

export interface PaperTabEntry {
  key: string;
  source?: string;
  file?: string;
  page: number;
}

export interface PaperTabsController {
  readonly list: PaperTabEntry[];
  open: (at: PaperLocation | null | undefined) => PaperTabEntry | null;
  remember: (key: string, page: number) => void;
  close: (key: string) => PaperTabEntry | null;
  keep: (exists: (entry: PaperTabEntry) => boolean) => void;
  clear: () => void;
}

// The papers open in the paper view, as tabs along its top (like the mockup's header): each opened PDF joins them,
// switching keeps the page you were on, closing one shows its neighbour, and closing the last one leaves the paper
// view. An entry is { key, source } or { key, file }, with the page it was left at.
export const paperKey = (at: PaperLocation | null | undefined): string => (at?.source ? `source:${at.source}` : at?.file ? `file:${at.file}` : '');

export function paperTabs(): PaperTabsController {
  let list: PaperTabEntry[] = [];
  return {
    get list() { return list; },
    // What's beside the tutor now: added if it's new, its page noted if it's already there.
    open(at) {
      const key = paperKey(at);
      if (!key || !at) return null;
      let entry = list.find(e => e.key === key);
      if (!entry) { entry = { key, ...(at.source ? { source: at.source } : { file: at.file }), page: Number(at.page) || 1 }; list = [...list, entry]; }
      return entry;
    },
    remember(key, page) { const entry = list.find(e => e.key === key); if (entry && Number.isInteger(page) && page > 0) entry.page = page; },
    // Closes one; answers with what to show instead: the one after it, else the one before, else nothing.
    close(key) {
      const at = list.findIndex(e => e.key === key);
      if (at < 0) return null;
      list = list.filter(e => e.key !== key);
      return list[at] || list[at - 1] || null;
    },
    // Only the ones still there (a source removed, a file gone).
    keep(exists) { list = list.filter(exists); },
    clear() { list = []; },
  };
}
