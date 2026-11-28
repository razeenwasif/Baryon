import { providerLogo } from './provider-logos.js';

export type ArtifactOrigin = 'antigravity' | 'claude' | 'codex' | 'fairy';
export type ArtifactOriginFilter = 'all' | ArtifactOrigin;
export type ArtifactKind = 'doc' | 'slides' | 'dashboard' | 'canvas' | 'whiteboard' | 'sheet' | 'a2ui';
export type DashboardSource = 'calendar' | 'email';

export interface ArtifactConcept {
  name: string;
  src: string;
  [key: string]: unknown;
}

export interface ArtifactVersion {
  seq: number;
  src?: string | null;
  concepts?: ArtifactConcept[];
  [key: string]: unknown;
}

export interface ArtifactComment {
  id: string;
  concept?: string;
  text: string;
  [key: string]: unknown;
}

export interface ArtifactItem {
  id: string;
  title: string;
  description?: string;
  kind: ArtifactKind | (string & {});
  origin?: ArtifactOrigin | string;
  session?: string;
  sessionTitle?: string;
  url?: string;
  sources: Array<DashboardSource | (string & {})>;
  granted: Array<DashboardSource | (string & {})>;
  versions: ArtifactVersion[];
  comments: ArtifactComment[];
  [key: string]: unknown;
}

export interface ArtifactsState {
  items: ArtifactItem[];
  imported?: boolean;
  [key: string]: unknown;
}

export interface RelatedArtifacts {
  session: string[];
  folder: string[];
  suggested: string[];
  dismissed?: string[];
  pending?: boolean;
  [key: string]: unknown;
}

export interface ArtifactOriginItem {
  origin?: string | null;
  [key: string]: unknown;
}

export interface GroupableArtifact {
  id?: string;
  origin?: string | null;
  session?: string | null;
  sessionTitle?: string | null;
  [key: string]: unknown;
}

export interface GroupPagesOptions {
  current?: string | null;
  titleOf?: (session: string) => string;
}

export interface PageGroup<T extends GroupableArtifact = GroupableArtifact> {
  key: string;
  title: string;
  code: boolean;
  antigravity?: boolean;
  codex?: boolean;
  current: boolean;
  items: T[];
}

export interface ArtifactView {
  artifact?: string;
  seq?: number;
}

export interface ArtifactsPaneContext {
  view: ArtifactView | null;
  setView(next: ArtifactView | null): void;
  redraw(): void;
}

export interface A2UIActionEvent {
  item: ArtifactItem;
  versionSeq: number;
  action: unknown;
}

export interface ImportArtifactsCounts {
  copied: number;
  address?: number;
  found: number;
}

export interface ImportProviderArtifactsCounts {
  copied: number;
  updated: number;
  failed: number;
  found: number;
}

export interface ImportArtifactsResult {
  counts: ImportArtifactsCounts;
  artifacts: ArtifactsState;
}

export interface ImportProviderArtifactsResult {
  counts: ImportProviderArtifactsCounts;
  artifacts: ArtifactsState;
}

export interface ImportLinkResult {
  id: string;
  title: string;
  result: 'same' | 'updated' | 'imported' | (string & {});
  artifacts: ArtifactsState;
}

export interface CsvImportResult {
  artifacts: ArtifactsState;
  artifact: { id: string; seq: number };
}

export interface NotebookSummary {
  slug: string;
  title: string;
}

export interface ArtifactsPaneApi {
  onArtifactsRelated?(callback: (session: string, value: RelatedArtifacts | null) => void): unknown;
  artifactsRelated?(session: string): Promise<RelatedArtifacts | null>;
  artifactSaveData(id: string, data: unknown): Promise<ArtifactsState>;
  dashboardData(id: string): Promise<unknown>;
  artifactExport(id: string, seq: number, format: string, options?: { sheet?: string }): Promise<string | null | undefined>;
  artifactSource(id: string, seq?: number): Promise<{ text: string }>;
  artifactImportCSV(id: string | null): Promise<CsvImportResult | null | undefined>;
  artifactOpenOnline(id: string): Promise<unknown>;
  notebook?(name: 'list' | 'clipPage', ...args: unknown[]): Promise<{ notebooks?: NotebookSummary[] }>;
  captureRect?(rect: { x: number; y: number; width: number; height: number }): Promise<unknown>;
  artifactGrant(id: string, sources: readonly string[]): Promise<ArtifactsState>;
  artifactSaveDoc(id: string, text: string): Promise<ArtifactsState>;
  artifactCommentRemove(id: string, commentId: string): Promise<ArtifactsState>;
  artifactComment(id: string, comment: { concept: string; text: string }): Promise<ArtifactsState>;
  artifactRemove(id: string): Promise<ArtifactsState>;
  artifactRelatedDismiss(session: string, id: string): Promise<unknown>;
  artifactsImport(): Promise<ImportArtifactsResult>;
  artifactsImportAntigravity?(): Promise<ImportProviderArtifactsResult>;
  artifactsImportCodex?(): Promise<ImportProviderArtifactsResult>;
  artifactImportLink(link: string): Promise<ImportLinkResult>;
}

export interface ArtifactsPaneOptions {
  api?: ArtifactsPaneApi | null;
  currentSession: () => string | null | undefined;
  sessionTitle?: (id: string) => string;
  onError: (message: string) => void;
  onCompose: (words: string) => void;
  onApply: (item: ArtifactItem) => void;
  onSaved?: (note: string) => void;
  onA2UIAction?: ((payload: A2UIActionEvent) => void) | null;
}

export interface ArtifactsPaneController {
  id: 'artifacts';
  title: string;
  wide: (view: ArtifactView | null) => boolean;
  leave: () => void;
  reset: () => void;
  render: (body: HTMLElement, context: ArtifactsPaneContext) => void;
  update: (next: ArtifactsState | null | undefined, redraw: () => void) => void;
  view?: (id: string, seq: number) => void;
}

interface ArtifactEditingState {
  seq: number;
  text: string;
}

interface RelatedState {
  session: string;
  value: RelatedArtifacts | null;
  asked: string;
}

interface SelectionMessage {
  type: 'fairy-selection';
  id: number;
  text?: string;
  rect?: { x: number; y: number; w: number; h: number };
}

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const SANDBOX = ['sandbox', 'allow-scripts allow-forms allow-modals allow-downloads'] as const;

export const originLabel = (origin?: string | null): string =>
  (origin === 'antigravity' ? 'Antigravity' : origin === 'claude' ? 'Claude' : origin === 'codex' ? 'ChatGPT' : 'Fairy');

export const originDetail = (origin?: string | null): string =>
  (origin === 'antigravity' ? 'From Antigravity' : origin === 'claude' ? 'From Claude Code' : origin === 'codex' ? 'From ChatGPT (Codex)' : 'Made by Fairy');

export const filterByOrigin = <T extends ArtifactOriginItem>(items: readonly T[], origin: string = 'all'): T[] =>
  (origin === 'all' ? [...items] : items.filter(item => (item.origin || 'fairy') === origin));

// The Pages list grouped by the session each page came from: this chat first, then each other chat or Claude Code
// session, Antigravity and ChatGPT (Codex) artifacts in their own separate groups so duplicates never mix with Claude's,
// then pages with no known session. items come newest first.
// titleOf(session) names a Fairy chat; a page from Claude Code carries its session's title itself.
export function groupPages<T extends GroupableArtifact>(
  items: readonly T[],
  { current = '', titleOf = () => '' }: GroupPagesOptions = {},
): PageGroup<T>[] {
  const groups = new Map<string, PageGroup<T>>();
  for (const item of items) {
    const agy = item.origin === 'antigravity' || Boolean(item.session?.startsWith('antigravity:'));
    const cdx = item.origin === 'codex' || Boolean(item.session?.startsWith('codex:'));
    // Claude Code sessions with the same name (a fork and the session it came from) share one group.
    const key = agy
      ? 'antigravity:all'
      : cdx
        ? 'codex:all'
        : item.session?.startsWith('claude-code:') && item.sessionTitle
          ? `claude-code-named:${item.sessionTitle}`
          : item.session || '';
    let group = groups.get(key);
    if (!group) {
      const code = key.startsWith('claude-code');
      const title = agy
        ? 'Antigravity artifacts'
        : cdx
          ? 'ChatGPT (Codex) artifacts'
          : !key
            ? 'Other pages'
            : key === current
              ? 'This chat'
              : (code ? item.sessionTitle : titleOf(key)) || (code ? 'A Claude Code session' : 'An earlier chat');
      group = {
        key,
        title,
        code,
        ...(agy ? { antigravity: true } : {}),
        ...(cdx ? { codex: true } : {}),
        current: Boolean(key) && key === current,
        items: [],
      };
      groups.set(key, group);
    }
    group.items.push(item);
  }
  const list = [...groups.values()];
  return [...list.filter(group => group.current), ...list.filter(group => !group.current && group.key), ...list.filter(group => !group.key)];
}

const GROUPS_OPEN = 'fairy-pages-open-groups';
const openGroups = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(GROUPS_OPEN) || '[]') as string[]);
  } catch {
    return new Set();
  }
};
const keepOpen = (key: string, open: boolean): void => {
  try {
    const set = openGroups();
    if (open) set.add(key);
    else set.delete(key);
    localStorage.setItem(GROUPS_OPEN, JSON.stringify([...set].slice(-200)));
  } catch {}
};

// Pages beside the chat, each in a frame with its own origin that can't reach the app.
export function artifactsPane({
  api,
  currentSession,
  sessionTitle = () => '',
  onError,
  onCompose,
  onApply,
  onSaved,
  onA2UIAction = null,
}: ArtifactsPaneOptions): ArtifactsPaneController {
  let state: ArtifactsState = { items: [], imported: false };
  let note = '', importing = false, filter = '', originFilter: ArtifactOriginFilter = 'all';
  let redrawPane: ((force?: boolean) => void) | null = null;
  let link = '';
  // The open chat's related pages: { session, value: { session, folder, suggested, dismissed, pending } }.
  let related: RelatedState = { session: '', value: null, asked: '' };
  let redrawList: (() => void) | null = null;
  api?.onArtifactsRelated?.((session, value) => {
    if (session === related.session) {
      related.value = value;
      redrawList?.();
    }
  });
  const askRelated = (): void => {
    const session = currentSession() || '';
    if (!api?.artifactsRelated || !session || related.asked === `${session}:${state.items.length}`) return;
    related = { session, value: related.session === session ? related.value : null, asked: `${session}:${state.items.length}` };
    api.artifactsRelated(session).then(value => {
      if (related.session === session) {
        related.value = value;
        redrawList?.();
      }
    }).catch(() => {});
  };
  const button = (label: string, run: () => void, className = 'quiet'): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.onclick = run;
    return element;
  };
  const pane: ArtifactsPaneController = {
    id: 'artifacts',
    title: 'Pages',
    wide: view => Boolean(view?.artifact),
    leave() {
      setFull(false);
      shownFrame = null;
      document.documentElement.classList.remove('page-head-up');
    },
    reset() {
      editing = null;
      setFull(false);
    },
    render(body, context) {
      redrawPane = force => {
        if (force) body.replaceChildren();
        context.redraw();
      };
      const item = context.view?.artifact && state.items.find(entry => entry.id === context.view?.artifact);
      if (item) showPage(body, context, item);
      else showList(body, context);
      placeHead();
    },
    update(next, redraw) {
      if (next) state = next;
      redraw();
    },
  };
  const KIND_NAMES: Record<string, string> = {
    doc: 'Document',
    slides: 'Slides',
    dashboard: 'Dashboard',
    canvas: 'Design',
    whiteboard: 'Whiteboard',
    sheet: 'Sheet',
    a2ui: 'Interactive UI',
  };
  const EDITABLE = ['whiteboard', 'sheet', 'a2ui'];
  const SOURCE_NAMES: Record<string, string> = {
    calendar: 'upcoming calendar events',
    email: 'how many unread emails you have',
  };
  let editing: ArtifactEditingState | null = null;
  let shownFrame: HTMLIFrameElement | null = null;
  let shownItem: ArtifactItem | null = null;
  let shownSeq = 0;
  let unsaved = false;
  let shownSheet = '';
  // A whiteboard or sheet edited in its page and not yet saved. Leaving it asks first.
  const mayLeave = (): boolean => !unsaved || confirm('Leave without saving your changes? They’ll be lost.');
  const setFull = (value: boolean): boolean => document.documentElement.classList.toggle('pane-full', value);
  // An open page's title row moves up beside the window's tools when it fits there with room for its title, so the page
  // gets that height. It's checked again whenever the pane or the tools change size.
  let headObserver: ResizeObserver | null = null;
  function placeHead(): void {
    const root = document.documentElement;
    const paneEl = document.querySelector('#side-pane');
    const head = paneEl?.querySelector<HTMLElement>('.page-head');
    const tools = document.querySelector<HTMLElement>('.window-tools');
    if (paneEl && tools && !headObserver) {
      headObserver = new ResizeObserver(placeHead);
      headObserver.observe(paneEl);
      headObserver.observe(tools);
    }
    if (!head?.offsetParent || !tools?.offsetParent) {
      root.classList.remove('page-head-up');
      return;
    }
    // With the tools on the left rail, the title row has the top of the window to itself.
    const edge = (tools.closest('#action-rail') ? window.innerWidth : tools.getBoundingClientRect().left) - 12;
    const box = head.getBoundingClientRect();
    const others = [...head.children]
      .filter(child => child.tagName !== 'H4')
      .reduce((sum, child) => sum + child.getBoundingClientRect().width + 6, 0);
    root.style.setProperty('--page-head-room', `${Math.max(0, Math.ceil(box.right - edge))}px`);
    root.classList.toggle('page-head-up', edge - box.left >= others + 140);
  }
  // Only the frame on screen, only if it's a dashboard, and it gets only what you allowed.
  // A whiteboard or sheet on screen may be edited, and hands back only its own data to keep as a new version.
  window.addEventListener('message', async event => {
    const data = event.data as { type?: string; dirty?: boolean; sheet?: unknown; data?: unknown } | null | undefined;
    const type = data?.type, frame = shownFrame, item = shownItem;
    if (!frame || event.source !== frame.contentWindow || !item || !EDITABLE.includes(item.kind) || !type || !['fairy-ready', 'fairy-save', 'fairy-dirty', 'fairy-view'].includes(type)) return;
    if (type === 'fairy-ready') frame.contentWindow?.postMessage({ type: 'fairy-edit' }, '*');
    else if (type === 'fairy-dirty') unsaved = data?.dirty === true;
    else if (type === 'fairy-view') shownSheet = typeof data?.sheet === 'string' ? data.sheet.slice(0, 40) : '';
    else {
      if (!api) return;
      try {
        state = await api.artifactSaveData(item.id, data?.data);
        unsaved = false;
        frame.contentWindow?.postMessage({ type: 'fairy-saved' }, '*');
        const latest = state.items.find(entry => entry.id === item.id)?.versions.at(-1);
        if (latest) pane.view?.(item.id, latest.seq);
      } catch (error) {
        const message = errorMessage(error);
        frame.contentWindow?.postMessage({ type: 'fairy-save-failed', message }, '*');
        onError(message);
      }
    }
  });
  window.addEventListener('message', async event => {
    const dataPayload = event.data as { type?: string; id?: unknown } | null | undefined;
    if (dataPayload?.type !== 'fairy-data-request' || !shownFrame || event.source !== shownFrame.contentWindow || shownItem?.kind !== 'dashboard') return;
    if (!api) return;
    const frame = shownFrame;
    try {
      const data = await api.dashboardData(shownItem.id);
      frame.contentWindow?.postMessage({ type: 'fairy-data', id: dataPayload.id, data }, '*');
    } catch (error) {
      onError(errorMessage(error));
    }
  });
  window.addEventListener('message', event => {
    const dataPayload = event.data as { type?: string; action?: unknown } | null | undefined;
    if (dataPayload?.type !== 'fairy-a2ui-action' || !shownFrame || event.source !== shownFrame.contentWindow || shownItem?.kind !== 'a2ui') return;
    onA2UIAction?.({ item: shownItem, versionSeq: shownSeq, action: dataPayload.action });
  });
  function frameFor(src: string, title: string): HTMLIFrameElement {
    const frame = document.createElement('iframe');
    frame.className = 'page-frame';
    frame.title = title;
    if (!/\.pdf(?:$|[?#])/i.test(String(src || ''))) frame.setAttribute(...SANDBOX);
    frame.dataset.src = src;
    frame.src = src;
    return frame;
  }
  function showPage(body: HTMLElement, context: ArtifactsPaneContext, item: ArtifactItem): void {
    const version = item.versions.find(entry => entry.seq === context.view?.seq) || item.versions.at(-1);
    if (!version) return;
    const head = document.createElement('div');
    head.className = 'page-head';
    pane.view = (id, seq) => context.setView({ artifact: id, seq });
    if (shownItem?.id !== item.id || shownSeq !== version.seq) {
      unsaved = false;
      shownSheet = '';
    }
    shownSeq = version.seq;
    const back = button('‹', () => {
      if (!mayLeave()) return;
      unsaved = false;
      editing = null;
      setFull(false);
      context.setView(null);
    }, 'page-back');
    back.setAttribute('aria-label', 'All pages');
    back.title = 'All pages';
    const title = document.createElement('h4');
    title.textContent = item.title;
    title.title = item.description || item.title;
    head.append(back, title);
    if (item.origin === 'antigravity' || item.origin === 'claude' || item.origin === 'codex') {
      const badge = document.createElement('span');
      badge.className = `page-origin ${item.origin}`;
      badge.textContent = originLabel(item.origin);
      badge.title = originDetail(item.origin);
      head.append(badge);
    }
    if (item.versions.length > 1) {
      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Version');
      for (const entry of [...item.versions].reverse()) select.append(new Option(`v${entry.seq}`, String(entry.seq), false, entry.seq === version.seq));
      select.onchange = () => {
        if (!mayLeave()) {
          select.value = String(version.seq);
          return;
        }
        unsaved = false;
        editing = null;
        context.setView({ artifact: item.id, seq: Number(select.value) });
      };
      head.append(select);
    }
    const exported = async (format: string, options?: { sheet?: string }): Promise<void> => {
      if (!api) return;
      try {
        const path = await api.artifactExport(item.id, version.seq, format, options);
        if (path) {
          note = `Saved to ${path}`;
          onSaved?.(note);
        }
      } catch (error) {
        onError(errorMessage(error));
      }
    };
    if (item.kind === 'doc' && version.src && !editing) head.append(button('Edit', async () => {
      if (!api) return;
      try {
        editing = { seq: version.seq, text: (await api.artifactSource(item.id, version.seq)).text };
        context.redraw();
      } catch (error) {
        onError(errorMessage(error));
      }
    }, 'page-link'));
    if (version.src && !version.concepts && item.kind !== 'whiteboard') head.append(button('PDF', () => void exported('pdf'), 'page-link'));
    if (item.kind === 'whiteboard' && version.src) head.append(button('PNG', () => void exported('png'), 'page-link'), button('SVG', () => void exported('svg'), 'page-link'));
    if (item.kind === 'sheet' && version.src) {
      head.append(button('CSV', () => void exported('csv', { sheet: shownSheet }), 'page-link'));
      const adder = button('Add CSV', async () => {
        if (!mayLeave() || !api) return;
        try {
          const done = await api.artifactImportCSV(item.id);
          if (done) {
            state = done.artifacts;
            unsaved = false;
            context.setView({ artifact: item.id, seq: done.artifact.seq });
          }
        } catch (error) {
          onError(errorMessage(error));
        }
      }, 'page-link');
      adder.title = 'Add a CSV file as a new tab, in a new version';
      head.append(adder);
    }
    if (item.kind === 'doc' && version.src) head.append(button('Markdown', () => void exported('markdown'), 'page-link'));
    if (item.kind === 'a2ui' && version.src) head.append(button('JSON', () => void exported('json'), 'page-link'));
    // Pin a part of the page to a notebook's shelf (the plan's follow-on): what you selected, with a picture of it.
    if (!version.concepts && !editing) {
      const pin: HTMLButtonElement = button('Pin to a notebook', () => void pinPart(item, version, pin), 'page-link');
      pin.title = 'Select a part of the page, then keep it on a notebook’s clippings shelf';
      head.append(pin);
    }
    if (item.url) head.append(button('Open online', () => void api?.artifactOpenOnline(item.id).catch(error => onError(errorMessage(error))), 'page-link'));
    const full = button('⤢', () => {
      setFull(!document.documentElement.classList.contains('pane-full'));
    }, 'page-back');
    full.setAttribute('aria-label', 'Fill the window');
    full.title = 'Fill the window';
    head.append(full);
    if (!version.src) {
      const gone = document.createElement('p');
      gone.className = 'pane-empty';
      gone.textContent = 'This page’s file is no longer on this Mac, so only its address was kept. Open it online to see it.';
      body.replaceChildren(head, gone);
      shownFrame = null;
      return;
    }
    if (editing) {
      showEditor(body, context, item, head);
      return;
    }
    if (version.concepts) {
      showCanvas(body, context, item, version, head);
      return;
    }
    const parts: HTMLElement[] = [head];
    if (item.kind === 'dashboard' && item.sources.some(name => !item.granted.includes(name))) parts.push(grantCard(item));
    const existing = body.querySelector('iframe');
    if (existing?.dataset.src === version.src && parts.length === 1) {
      body.querySelector('.page-head')?.replaceWith(head);
      body.querySelector('.grant-card')?.remove();
      shownItem = item;
      return;
    }
    const frame = existing?.dataset.src === version.src ? existing : frameFor(version.src, item.title);
    shownFrame = frame;
    shownItem = item;
    body.replaceChildren(...parts, frame);
  }
  // What's selected in the page's frame: { text, rect } from the page's own script (desktop/artifacts.mjs SELECTION), or
  // null when it doesn't answer.
  function selectionOf(frame: HTMLIFrameElement): Promise<SelectionMessage | null> {
    const id = Math.random();
    return new Promise(resolve => {
      const on = (event: MessageEvent): void => {
        const msg = event.data as SelectionMessage | null | undefined;
        if (event.source !== frame.contentWindow || msg?.type !== 'fairy-selection' || msg.id !== id) return;
        removeEventListener('message', on);
        clearTimeout(timer);
        resolve(msg);
      };
      const timer = setTimeout(() => {
        removeEventListener('message', on);
        resolve(null);
      }, 1500);
      addEventListener('message', on);
      frame.contentWindow?.postMessage({ type: 'fairy-selection-request', id }, '*');
    });
  }
  let pinMenu: HTMLDivElement | null = null;
  const closePinMenu = (): void => {
    pinMenu?.remove();
    pinMenu = null;
  };
  async function pinPart(item: ArtifactItem, version: ArtifactVersion, anchor: HTMLElement): Promise<void> {
    closePinMenu();
    const frame = shownFrame;
    if (!frame || !api?.notebook) return;
    const picked = await selectionOf(frame);
    if (!picked?.text?.trim()) {
      onError('Select a part of the page first, then pin it.');
      return;
    }
    let books: NotebookSummary[];
    try {
      books = (await api.notebook('list')).notebooks || [];
    } catch (error) {
      onError(errorMessage(error));
      return;
    }
    if (!books.length) {
      onError('Make a study notebook first: a part of a page is pinned to a notebook’s shelf.');
      return;
    }
    const menu = pinMenu = document.createElement('div');
    menu.className = 'page-pin-menu';
    menu.setAttribute('role', 'menu');
    const label = document.createElement('p');
    label.textContent = 'Pin to the shelf of';
    menu.append(label);
    for (const book of books) {
      const choice = button(book.title, async () => {
        closePinMenu();
        // A picture of the part selected, without the selection's highlight, clipped to what's showing: where it sits
        // is asked again now the menu's gone, as the frame has moved since.
        let picture: unknown = null;
        const now = api.captureRect ? await selectionOf(frame) : null;
        if (now?.rect) {
          frame.contentWindow?.postMessage({ type: 'fairy-selection-clear' }, '*');
          await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
          const box = frame.getBoundingClientRect(), pad = 10, at = now.rect;
          const left = Math.max(box.left, box.left + at.x - pad), top = Math.max(box.top, box.top + at.y - pad);
          const right = Math.min(box.right, box.left + at.x + at.w + pad), bottom = Math.min(box.bottom, box.top + at.y + at.h + pad);
          if (right - left > 8 && bottom - top > 8 && api.captureRect) {
            picture = await api.captureRect({ x: left, y: top, width: right - left, height: bottom - top }).catch(() => null);
          }
        }
        try {
          await api.notebook?.('clipPage', book.slug, { artifact: { id: item.id, seq: version.seq, title: item.title }, words: picked.text, picture });
          onSaved?.(`Pinned to ${book.title}’s shelf`);
        } catch (error) {
          onError(errorMessage(error));
        }
      }, 'page-pin-choice');
      choice.setAttribute('role', 'menuitem');
      menu.append(choice);
    }
    const head = anchor.closest('.page-head');
    head?.after(menu);
    const away = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!menu.contains(target) && target !== anchor) {
        closePinMenu();
        removeEventListener('pointerdown', away, true);
      }
    };
    addEventListener('pointerdown', away, true);
    menu.querySelector<HTMLButtonElement>('button')?.focus();
  }
  function grantCard(item: ArtifactItem): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'work-approval grant-card';
    const heading = document.createElement('h4');
    heading.textContent = 'Let this dashboard read your data?';
    const words = document.createElement('p');
    words.textContent = `It wants ${item.sources.map(name => SOURCE_NAMES[name]).join(' and ')}. This stays on your Mac: the page can’t send anything out, and the model that made it never sees it.`;
    const buttons = document.createElement('div');
    buttons.className = 'work-buttons';
    const decide = (sources: readonly string[]) => async () => {
      if (!api) return;
      try {
        state = await api.artifactGrant(item.id, sources);
        shownFrame = null;
        redrawPane?.(true);
      } catch (error) {
        onError(errorMessage(error));
      }
    };
    buttons.append(button('Allow', () => void decide(item.sources)(), 'primary'), button('Not now', () => card.remove(), 'quiet'));
    card.append(heading, words, buttons);
    return card;
  }
  function showEditor(body: HTMLElement, context: ArtifactsPaneContext, item: ArtifactItem, head: HTMLElement): void {
    if (!editing) return;
    const currentEditing = editing;
    const box = document.createElement('textarea');
    box.className = 'doc-editor';
    box.value = currentEditing.text;
    box.setAttribute('aria-label', 'Document text in Markdown');
    box.spellcheck = true;
    box.oninput = () => {
      currentEditing.text = box.value;
    };
    const save = button('Save as a new version', async () => {
      if (!api) return;
      save.disabled = true;
      try {
        state = await api.artifactSaveDoc(item.id, box.value);
        editing = null;
        const latest = state.items.find(entry => entry.id === item.id)?.versions.at(-1);
        if (latest) context.setView({ artifact: item.id, seq: latest.seq });
      } catch (error) {
        onError(errorMessage(error));
        save.disabled = false;
      }
    }, 'changes-commit');
    const cancel = button('Cancel', () => {
      editing = null;
      context.redraw();
    }, 'quiet doc-cancel');
    const tools = document.createElement('div');
    tools.className = 'work-buttons';
    tools.append(save, cancel);
    shownFrame = null;
    body.replaceChildren(head, box, tools);
    box.focus();
  }
  function showCanvas(body: HTMLElement, context: ArtifactsPaneContext, item: ArtifactItem, version: ArtifactVersion, head: HTMLElement): void {
    const grid = document.createElement('div');
    grid.className = 'concept-grid';
    for (const concept of version.concepts || []) {
      const card = document.createElement('section');
      card.className = 'concept';
      const name = document.createElement('h5');
      name.textContent = concept.name;
      const frame = frameFor(concept.src, `${item.title}: ${concept.name}`);
      const list = document.createElement('ul');
      list.className = 'concept-comments';
      for (const comment of item.comments.filter(entry => entry.concept === concept.name)) {
        const line = document.createElement('li');
        line.textContent = comment.text;
        const remove = button('×', async () => {
          if (!api) return;
          try {
            state = await api.artifactCommentRemove(item.id, comment.id);
            context.redraw();
          } catch (error) {
            onError(errorMessage(error));
          }
        }, 'page-remove');
        remove.setAttribute('aria-label', 'Remove comment');
        line.append(remove);
        list.append(line);
      }
      const input = document.createElement('input');
      input.className = 'concept-input';
      input.placeholder = 'Comment on this concept';
      input.setAttribute('aria-label', `Comment on ${concept.name}`);
      input.maxLength = 1000;
      input.onkeydown = async event => {
        if (event.key !== 'Enter' || !input.value.trim() || !api) return;
        event.preventDefault();
        try {
          state = await api.artifactComment(item.id, { concept: concept.name, text: input.value });
          context.redraw();
        } catch (error) {
          onError(errorMessage(error));
        }
      };
      card.append(name, frame, list, input);
      grid.append(card);
    }
    const parts: HTMLElement[] = [head, grid];
    const latestVersion = item.versions.at(-1);
    if (item.comments.length && latestVersion && version.seq === latestVersion.seq) {
      parts.push(button(`Apply ${item.comments.length} ${item.comments.length === 1 ? 'comment' : 'comments'}`, () => onApply(item), 'changes-commit'));
    }
    shownFrame = null;
    body.replaceChildren(...parts);
  }
  function row(
    item: ArtifactItem,
    context: ArtifactsPaneContext,
    { suggested = false, onDismiss = null }: { suggested?: boolean; onDismiss?: (() => void) | null } = {},
  ): HTMLDivElement {
    const line = document.createElement('div');
    line.className = `page-row${suggested ? ' suggested' : ''}`;
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'page-open';
    const titleRow = document.createElement('span');
    titleRow.className = 'page-title-line';
    const name = document.createElement('span');
    name.className = 'page-title-text';
    name.textContent = item.title;
    titleRow.append(name);
    if (item.origin === 'antigravity' || item.origin === 'claude' || item.origin === 'codex') {
      const badge = document.createElement('span');
      badge.className = `page-origin ${item.origin}`;
      badge.textContent = originLabel(item.origin);
      titleRow.append(badge);
    }
    const latest = item.versions.at(-1);
    const detail = document.createElement('span');
    detail.className = 'page-detail';
    detail.textContent = [
      KIND_NAMES[item.kind],
      originDetail(item.origin),
      item.versions.length > 1 ? `${item.versions.length} versions` : '',
      latest?.src ? '' : 'Online only',
      suggested ? 'Suggested' : '',
    ].filter(Boolean).join(' · ');
    open.append(titleRow, detail);
    open.title = item.description || item.title;
    open.onclick = () => {
      if (latest) context.setView({ artifact: item.id, seq: latest.seq });
    };
    const remove = button('×', async () => {
      if (!confirm(`Move “${item.title}” to the Trash? Anything published online stays there.`) || !api) return;
      try {
        state = await api.artifactRemove(item.id);
        context.redraw();
      } catch (error) {
        onError(errorMessage(error));
      }
    }, 'page-remove');
    remove.setAttribute('aria-label', `Move ${item.title} to the Trash`);
    remove.title = 'Move to Trash';
    if (onDismiss) {
      const away = button('–', onDismiss, 'page-remove');
      away.setAttribute('aria-label', `${item.title} isn’t related to this chat`);
      away.title = 'Not related to this chat';
      line.append(open, away, remove);
    } else line.append(open, remove);
    return line;
  }
  function showList(body: HTMLElement, context: ArtifactsPaneContext): void {
    const parts: HTMLElement[] = [];
    const tools = document.createElement('div');
    tools.className = 'page-tools';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter pages';
    search.setAttribute('aria-label', 'Filter pages');
    search.value = filter;
    const list = document.createElement('div');
    list.className = 'page-list';
    const draw = (): void => {
      const query = filter.trim().toLowerCase();
      const found = filterByOrigin(state.items, originFilter).filter(item => !query || `${item.title} ${item.description}`.toLowerCase().includes(query));
      const rows: HTMLElement[] = [], opened = openGroups(), session = currentSession() || '';
      // The open chat's own pages, those from its project folder, then the small model's suggestions.
      const value = related.session === session ? related.value : null;
      const byId = new Map(found.map(item => [item.id, item]));
      const mine = value ? [...value.session, ...value.folder].map(id => byId.get(id)).filter((item): item is ArtifactItem => Boolean(item)) : [];
      const suggested = value ? value.suggested.map(id => byId.get(id)).filter((item): item is ArtifactItem => Boolean(item)) : [];
      const relatedIds = new Set([...mine, ...suggested].map(item => item.id));
      if (session && (mine.length || suggested.length || value?.pending)) {
        const box = document.createElement('details');
        box.className = 'page-group related';
        box.open = true;
        const summary = document.createElement('summary');
        summary.className = 'page-heading';
        const name = document.createElement('span');
        name.textContent = 'Related to this chat';
        const count = document.createElement('span');
        count.className = 'page-count';
        count.textContent = String(mine.length + suggested.length);
        summary.append(name, count);
        summary.title = 'Made in this chat or its project folder, and pages a small model thinks are about the same thing';
        box.append(
          summary,
          ...mine.map(item => row(item, context)),
          ...suggested.map(item => row(item, context, {
            suggested: true,
            onDismiss: async () => {
              if (!value) return;
              related.value = { ...value, suggested: value.suggested.filter(id => id !== item.id) };
              draw();
              try {
                await api?.artifactRelatedDismiss(session, item.id);
              } catch (error) {
                onError(errorMessage(error));
              }
            },
          })),
        );
        if (value?.pending) {
          const wait = document.createElement('p');
          wait.className = 'page-note';
          wait.textContent = 'Looking for related pages…';
          box.append(wait);
        }
        rows.push(box);
      }
      const rest = relatedIds.size ? found.filter(item => !relatedIds.has(item.id)) : found;
      const groups = groupPages(rest, { current: session, titleOf: sessionTitle });
      const into: HTMLDetailsElement | null = relatedIds.size || value?.pending ? (() => {
        const all = document.createElement('details');
        all.className = 'page-group all';
        all.open = Boolean(query) || opened.has('*all');
        const summary = document.createElement('summary');
        summary.className = 'page-heading';
        const name = document.createElement('span');
        name.textContent = 'All pages';
        const count = document.createElement('span');
        count.className = 'page-count';
        count.textContent = String(rest.length);
        summary.append(name, count);
        all.append(summary);
        all.addEventListener('toggle', () => {
          if (!query) keepOpen('*all', all.open);
        });
        if (rest.length) rows.push(all);
        return all;
      })() : null;
      const add = (element: HTMLElement): void => {
        if (into) into.append(element);
        else rows.push(element);
      };
      // With one group there's nothing to sort, so its pages are listed as they are.
      if (groups.length === 1) groups[0].items.forEach(item => add(row(item, context)));
      else for (const group of groups) {
        const box = document.createElement('details');
        box.className = 'page-group';
        // This chat's pages are open; others are as you left them, and all open while filtering.
        box.open = group.current || Boolean(query) || opened.has(group.key || '-');
        const summary = document.createElement('summary');
        summary.className = 'page-heading';
        const name = document.createElement('span');
        name.textContent = group.title;
        const count = document.createElement('span');
        count.className = 'page-count';
        count.textContent = String(group.items.length);
        summary.append(name, count);
        summary.title = group.antigravity
          ? 'Imported from Antigravity (~/.gemini/antigravity/brain)'
          : group.codex
            ? 'Imported from ChatGPT / Codex (~/.codex & ~/Documents/Codex)'
            : group.code
              ? 'Published from this Claude Code session'
              : group.key
                ? 'Made in this chat'
                : 'Pages with no known session';
        box.append(summary, ...group.items.map(item => row(item, context)));
        box.addEventListener('toggle', () => {
          if (!query && !group.current) keepOpen(group.key || '-', box.open);
        });
        add(box);
      }
      if (!rows.length) {
        const empty = document.createElement('p');
        empty.className = 'pane-empty';
        empty.textContent = state.items.length ? 'No pages match.' : 'Ask Fairy to make a page, a whiteboard or a sheet, or import from Claude Code, Antigravity, or ChatGPT.';
        rows.push(empty);
      }
      list.replaceChildren(...rows);
    };
    search.oninput = () => {
      filter = search.value;
      draw();
    };
    redrawList = draw;
    askRelated();
    const importArrowSvg = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2v6.5M3.5 6.2 6 8.8l2.5-2.6M2.5 10.5h7"/></svg>';
    const makeImportButton = (family: string, title: string, run: () => void): HTMLButtonElement => {
      const btn = button('', run, 'page-import-btn');
      btn.title = title;
      btn.setAttribute('aria-label', title);
      const logo = providerLogo(family);
      if (logo) btn.append(logo);
      const badge = document.createElement('span');
      badge.className = 'page-import-badge';
      badge.setAttribute('aria-hidden', 'true');
      badge.innerHTML = importArrowSvg;
      btn.append(badge);
      return btn;
    };
    const importer = makeImportButton('claude', importing ? 'Importing…' : 'Import from Claude Code', async () => {
      if (!api) return;
      importing = true;
      note = 'Looking through Claude Code’s sessions…';
      context.redraw();
      try {
        const { counts, artifacts } = await api.artifactsImport();
        state = artifacts;
        note = counts.copied || counts.address
          ? `Imported ${counts.copied} ${counts.copied === 1 ? 'page' : 'pages'}${counts.address ? `, and ${counts.address} that ${counts.address === 1 ? 'is' : 'are'} only online` : ''}.`
          : `Nothing new. ${counts.found} found, all already here.`;
      } catch (error) {
        note = errorMessage(error);
      }
      importing = false;
      context.redraw();
    });
    importer.disabled = importing || !api;
    const agyImporter = makeImportButton('antigravity', importing ? 'Importing…' : 'Import from Antigravity', async () => {
      if (!api?.artifactsImportAntigravity) return;
      importing = true;
      note = 'Looking through Antigravity’s artifacts…';
      context.redraw();
      try {
        const { counts, artifacts } = await api.artifactsImportAntigravity();
        state = artifacts;
        const added: string[] = [];
        if (counts.copied) added.push(`imported ${counts.copied} new`);
        if (counts.updated) added.push(`updated ${counts.updated}`);
        note = added.length
          ? `Antigravity: ${added.join(', ')}${counts.failed ? ` (${counts.failed} failed)` : ''}.`
          : counts.found ? `Antigravity pages are up to date (${counts.found} found).` : 'No user-facing Antigravity artifacts found.';
      } catch (error) {
        note = errorMessage(error);
      }
      importing = false;
      context.redraw();
    });
    agyImporter.disabled = importing || !api?.artifactsImportAntigravity;
    const codexImporter = makeImportButton('codex', importing ? 'Importing…' : 'Import from ChatGPT (Codex)', async () => {
      if (!api?.artifactsImportCodex) return;
      importing = true;
      note = 'Looking through ChatGPT / Codex artifacts…';
      context.redraw();
      try {
        const { counts, artifacts } = await api.artifactsImportCodex();
        state = artifacts;
        const added: string[] = [];
        if (counts.copied) added.push(`imported ${counts.copied} new`);
        if (counts.updated) added.push(`updated ${counts.updated}`);
        note = added.length
          ? `ChatGPT (Codex): ${added.join(', ')}${counts.failed ? ` (${counts.failed} failed)` : ''}.`
          : counts.found ? `ChatGPT (Codex) pages are up to date (${counts.found} found).` : 'No ChatGPT (Codex) artifacts or PDFs found.';
      } catch (error) {
        note = errorMessage(error);
      }
      importing = false;
      context.redraw();
    });
    codexImporter.disabled = importing || !api?.artifactsImportCodex;
    const importsRow = document.createElement('div');
    importsRow.className = 'page-imports';
    importsRow.append(importer, agyImporter, codexImporter);
    const originCounts: Record<ArtifactOriginFilter, number> = {
      all: state.items.length,
      antigravity: state.items.filter(item => item.origin === 'antigravity').length,
      claude: state.items.filter(item => item.origin === 'claude').length,
      codex: state.items.filter(item => item.origin === 'codex').length,
      fairy: state.items.filter(item => !item.origin || item.origin === 'fairy').length,
    };
    const originSvgs: Record<'all' | 'fairy', string> = {
      all: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="2" width="4.8" height="4.8" rx="1.2"/><rect x="9.2" y="2" width="4.8" height="4.8" rx="1.2"/><rect x="2" y="9.2" width="4.8" height="4.8" rx="1.2"/><rect x="9.2" y="9.2" width="4.8" height="4.8" rx="1.2"/></svg>',
      fairy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.6 9.5 6.5 14.4 8 9.5 9.5 8 14.4 6.5 9.5 1.6 8 6.5 6.5Z"/></svg>',
    };
    const originTabs = document.createElement('div');
    originTabs.className = 'page-origin-tabs';
    originTabs.setAttribute('role', 'tablist');
    originTabs.setAttribute('aria-label', 'Filter by source');
    const originEntries: ReadonlyArray<readonly [ArtifactOriginFilter, string]> = [
      ['all', 'All'],
      ['antigravity', 'Antigravity'],
      ['claude', 'Claude'],
      ['codex', 'ChatGPT'],
      ['fairy', 'Fairy'],
    ];
    for (const [key, label] of originEntries) {
      if (key !== 'all' && !originCounts[key] && originFilter !== key) continue;
      const tab = button('', () => {
        originFilter = key;
        context.redraw();
      }, `page-origin-tab${originFilter === key ? ' active' : ''}`);
      const iconWrap = document.createElement('span');
      iconWrap.className = 'page-origin-icon';
      iconWrap.setAttribute('aria-hidden', 'true');
      const logo = key === 'antigravity' || key === 'claude' || key === 'codex' ? providerLogo(key) : null;
      if (logo) iconWrap.append(logo);
      else if (key === 'all' || key === 'fairy') iconWrap.innerHTML = originSvgs[key];
      const num = document.createElement('span');
      num.className = 'page-origin-num';
      num.textContent = String(originCounts[key]);
      tab.append(iconWrap, num);
      tab.title = `${label} (${originCounts[key]})`;
      tab.setAttribute('aria-label', `${label} (${originCounts[key]})`);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(originFilter === key));
      originTabs.append(tab);
    }
    // A page published anywhere else (claude.ai, the phone, the other Mac) has no record here, so it comes in by its link.
    const fromLink = document.createElement('form');
    fromLink.className = 'page-from-link';
    const linkBox = document.createElement('input');
    linkBox.type = 'url';
    linkBox.placeholder = 'Or paste a claude.ai page link';
    linkBox.setAttribute('aria-label', 'claude.ai page link to import');
    linkBox.value = link;
    linkBox.disabled = importing || !api;
    linkBox.oninput = () => {
      link = linkBox.value;
    };
    const linkGo = document.createElement('button');
    linkGo.type = 'submit';
    linkGo.textContent = 'Import';
    linkGo.disabled = importing || !api;
    fromLink.onsubmit = async event => {
      event.preventDefault();
      if (!link.trim() || importing || !api) return;
      importing = true;
      note = 'Fetching the page from claude.ai…';
      context.redraw();
      try {
        const done = await api.artifactImportLink(link.trim());
        state = done.artifacts;
        link = '';
        note = done.result === 'same' ? `“${done.title}” is already here, unchanged.` : `${done.result === 'updated' ? 'Updated' : 'Imported'} “${done.title}”.`;
        importing = false;
        context.setView({ artifact: done.id });
      } catch (error) {
        note = errorMessage(error);
        importing = false;
      }
      context.redraw();
    };
    fromLink.append(linkBox, linkGo);
    const creators = document.createElement('div');
    creators.className = 'page-create';
    // One icon each, named in its tooltip, that starts the request in the message box.
    const svg = (paths: string): string => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    const KINDS_TO_MAKE: ReadonlyArray<readonly [string, string, string]> = [
      ['Document', 'Write a document about ', svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 9h2M9 13h6M9 17h6"/>')],
      ['Slides', 'Make a slide deck about ', svg('<rect x="2.5" y="3.5" width="19" height="12.5" rx="2"/><path d="M12 16v5M8 21h8"/>')],
      ['Dashboard', 'Make a dashboard that shows ', svg('<rect x="3" y="3" width="7.5" height="9" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="5" rx="1.5"/><rect x="13.5" y="11" width="7.5" height="10" rx="1.5"/><rect x="3" y="15" width="7.5" height="6" rx="1.5"/>')],
      ['Design', 'Make design concepts for ', svg('<path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><path d="M2 2l7.6 7.6"/><circle cx="11" cy="11" r="2"/>')],
      ['Whiteboard', 'Sketch on a whiteboard ', svg('<rect x="3" y="3.5" width="18" height="12.5" rx="1.5"/><path d="M8 20.5l1.5-4.5M16 20.5L14.5 16M7 11.5l3-3 3 2.5 4-4"/>')],
      ['Sheet', 'Make a sheet of ', svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9.5h18M3 14.5h18M9 4v16"/>')],
      ['Interactive UI', 'Make an interactive UI for ', svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h4M7 13h10M15 9h2"/>')],
    ];
    for (const [label, words, icon] of KINDS_TO_MAKE) {
      const make = button('', () => onCompose(words), 'page-make');
      make.innerHTML = icon;
      make.title = `New ${label.toLowerCase()}`;
      make.setAttribute('aria-label', `New ${label.toLowerCase()}`);
      creators.append(make);
    }
    // A CSV file opened as a sheet straight away, with no model involved.
    const fromCSV = button('', async () => {
      if (!api) return;
      try {
        const done = await api.artifactImportCSV(null);
        if (done) {
          state = done.artifacts;
          context.setView({ artifact: done.artifact.id, seq: done.artifact.seq });
        }
      } catch (error) {
        onError(errorMessage(error));
      }
    }, 'page-make');
    fromCSV.innerHTML = svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 11v6M9 14l3 3 3-3"/>');
    fromCSV.title = 'New sheet from a CSV file';
    fromCSV.setAttribute('aria-label', 'New sheet from a CSV file');
    creators.append(fromCSV);
    tools.append(creators);
    if (state.items.length > 6) tools.append(search);
    const sourceBar = document.createElement('div');
    sourceBar.className = 'page-source-bar';
    if (originTabs.children.length > 2) sourceBar.append(originTabs);
    sourceBar.append(importsRow);
    tools.append(sourceBar, fromLink);
    parts.push(tools);
    if (note) {
      const status = document.createElement('p');
      status.className = 'page-note';
      status.setAttribute('role', 'status');
      status.textContent = note;
      parts.push(status);
    }
    parts.push(list);
    draw();
    body.replaceChildren(...parts);
  }
  return pane;
}
