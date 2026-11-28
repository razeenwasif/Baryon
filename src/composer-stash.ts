export interface StashEntryInput<A = unknown, Q = unknown> {
  text?: string;
  attachments?: A[];
  quotes?: Q[];
}

export interface StashEntry<A = unknown, Q = unknown> {
  id: string;
  text: string;
  attachments: A[];
  quotes: Q[];
  stashedAt: number;
}

export interface StashStorage {
  getItem?: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
}

export interface CreateComposerStashOptions {
  storage?: StashStorage | null;
  key?: string;
  maxEntries?: number;
  idFactory?: () => string;
  now?: () => number;
}

export interface ComposerStash<A = unknown, Q = unknown> {
  maxEntries: number;
  list: (sessionId: string | null | undefined) => StashEntry<A, Q>[];
  count: (sessionId: string | null | undefined) => number;
  push: (sessionId: string | null | undefined, input?: StashEntryInput<A, Q>) => StashEntry<A, Q> | null;
  pop: (sessionId: string | null | undefined, id?: string | null) => StashEntry<A, Q> | null;
  remove: (sessionId: string | null | undefined, id: string) => boolean;
}

export interface SetupComposerStashOptions<A = unknown, Q = unknown> {
  button?: HTMLElement | null;
  dock?: HTMLElement | null;
  stash: ComposerStash<A, Q>;
  activeSession?: () => string;
  getDraft?: () => StashEntryInput<A, Q> | null | undefined;
  clearDraft?: () => void;
  onRestore?: (entry: StashEntry<A, Q>) => void;
}

const DEFAULT_KEY = '__default__';
const sessionKey = (id: unknown): string => (typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_KEY);

/**
 * Pure per-session prompt stash ("git stash" for composer drafts, persisted to Storage).
 */
export function createComposerStash<A = unknown, Q = unknown>({
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  key = 'fairy.composerStash.v1',
  maxEntries = 8,
  idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  now = Date.now,
}: CreateComposerStashOptions = {}): ComposerStash<A, Q> {
  let state: Record<string, StashEntry<A, Q>[]> = {};
  try {
    const raw = storage?.getItem?.(key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        state = parsed as Record<string, StashEntry<A, Q>[]>;
      }
    }
  } catch {
    state = {};
  }

  const save = (): void => {
    try {
      storage?.setItem?.(key, JSON.stringify(state));
    } catch {}
  };

  function list(sessionId: string | null | undefined): StashEntry<A, Q>[] {
    const k = sessionKey(sessionId);
    return Array.isArray(state[k]) ? [...state[k]] : [];
  }

  function count(sessionId: string | null | undefined): number {
    const k = sessionKey(sessionId);
    return Array.isArray(state[k]) ? state[k].length : 0;
  }

  function push(
    sessionId: string | null | undefined,
    { text = '', attachments = [], quotes = [] }: StashEntryInput<A, Q> = {},
  ): StashEntry<A, Q> | null {
    const clean = String(text ?? '');
    const atts = Array.isArray(attachments) ? [...attachments] : [];
    const qs = Array.isArray(quotes) ? [...quotes] : [];
    if (!clean.trim() && !atts.length && !qs.length) return null;
    const k = sessionKey(sessionId);
    const entry: StashEntry<A, Q> = {
      id: idFactory(),
      text: clean,
      attachments: atts,
      quotes: qs,
      stashedAt: now(),
    };
    const next = [entry, ...list(k)].slice(0, maxEntries);
    state[k] = next;
    save();
    return entry;
  }

  function pop(sessionId: string | null | undefined, id: string | null = null): StashEntry<A, Q> | null {
    const k = sessionKey(sessionId);
    const items = list(k);
    if (!items.length) return null;
    const idx = id ? items.findIndex(item => item.id === id) : 0;
    if (idx < 0) return null;
    const [entry] = items.splice(idx, 1);
    if (items.length) state[k] = items;
    else delete state[k];
    save();
    return entry;
  }

  function remove(sessionId: string | null | undefined, id: string): boolean {
    const k = sessionKey(sessionId);
    const items = list(k);
    const idx = items.findIndex(item => item.id === id);
    if (idx < 0) return false;
    items.splice(idx, 1);
    if (items.length) state[k] = items;
    else delete state[k];
    save();
    return true;
  }

  return { maxEntries, list, count, push, pop, remove };
}

function relativeTime(ts: number, now = Date.now()): string {
  const diffSec = Math.max(0, Math.round((now - Number(ts || now)) / 1000));
  if (diffSec < 45) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * DOM controller for the Prompt Stash button, pulse badge, and restore popover menu.
 */
export function setupComposerStash<A = unknown, Q = unknown>(
  options: SetupComposerStashOptions<A, Q>,
): {
  syncBadge: () => void;
  stashCurrent: () => StashEntry<A, Q> | null;
  openMenu: () => boolean;
  closeMenu: () => void;
} {
  const { button, dock, stash, activeSession, getDraft, clearDraft, onRestore } = options;
  let menu: HTMLDivElement | null = null;
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;

  function ensureMenu(): HTMLDivElement {
    if (menu) return menu;
    menu = document.createElement('div');
    menu.className = 'stash-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Stashed drafts');
    menu.hidden = true;
    dock?.append(menu);
    return menu;
  }

  function syncBadge(): void {
    if (!button) return;
    const sid = activeSession?.() || '';
    const n = stash.count(sid);
    button.dataset.count = n > 0 ? String(n) : '';
    let badge = button.querySelector('.stash-badge');
    if (n > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'stash-badge';
        button.append(badge);
      }
      badge.textContent = String(n);
    } else if (badge) {
      badge.remove();
    }
    button.title = n > 0
      ? `Stash draft (⌥⇧S) · ${n} stashed (click when empty to restore)`
      : 'Stash current draft for later (⌥⇧S)';
  }

  function pulseBadge(): void {
    if (!button) return;
    button.classList.remove('is-pulsing');
    void button.offsetWidth;
    button.classList.add('is-pulsing');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => button.classList.remove('is-pulsing'), 650);
  }

  function closeMenu(): void {
    if (menu) {
      menu.hidden = true;
      menu.replaceChildren();
    }
    button?.setAttribute('aria-expanded', 'false');
  }

  function openMenu(): boolean {
    const sid = activeSession?.() || '';
    const items = stash.list(sid);
    const el = ensureMenu();
    if (!items.length) {
      closeMenu();
      return false;
    }
    const head = document.createElement('div');
    head.className = 'stash-menu-head';
    head.textContent = `Stashed drafts (${items.length})`;

    const listEl = document.createElement('div');
    listEl.className = 'stash-menu-list';

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'stash-menu-row';

      const restoreBtn = document.createElement('button');
      restoreBtn.type = 'button';
      restoreBtn.className = 'stash-menu-restore';
      const snippet =
        String(item.text || '').replace(/\s+/g, ' ').trim() ||
        (item.attachments?.length ? `${item.attachments.length} attachment(s)` : `${item.quotes?.length || 0} quote(s)`);
      const textSpan = document.createElement('span');
      textSpan.className = 'stash-menu-snippet';
      textSpan.textContent = snippet.length > 72 ? `${snippet.slice(0, 71).trim()}…` : snippet;
      const metaSpan = document.createElement('small');
      metaSpan.className = 'stash-menu-meta';
      const bits = [relativeTime(item.stashedAt)];
      if (item.attachments?.length) bits.push(`${item.attachments.length} file${item.attachments.length > 1 ? 's' : ''}`);
      if (item.quotes?.length) bits.push(`${item.quotes.length} quote${item.quotes.length > 1 ? 's' : ''}`);
      metaSpan.textContent = bits.join(' · ');
      restoreBtn.append(textSpan, metaSpan);
      restoreBtn.onclick = () => {
        const current = getDraft?.();
        const popped = stash.pop(sid, item.id);
        if (popped && current && (String(current.text || '').trim() || current.attachments?.length || current.quotes?.length)) {
          stash.push(sid, current);
          clearDraft?.();
        }
        closeMenu();
        if (popped) onRestore?.(popped);
        syncBadge();
      };

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'stash-menu-delete';
      delBtn.textContent = '×';
      delBtn.setAttribute('aria-label', 'Delete stashed draft');
      delBtn.onclick = () => {
        stash.remove(sid, item.id);
        syncBadge();
        if (stash.count(sid) === 0) closeMenu();
        else openMenu();
      };

      row.append(restoreBtn, delBtn);
      listEl.append(row);
    }

    el.replaceChildren(head, listEl);
    el.hidden = false;
    button?.setAttribute('aria-expanded', 'true');
    return true;
  }

  function stashCurrent(): StashEntry<A, Q> | null {
    const sid = activeSession?.() || '';
    const current = getDraft?.();
    if (!current || (!String(current.text || '').trim() && !current.attachments?.length && !current.quotes?.length)) {
      return null;
    }
    const entry = stash.push(sid, current);
    if (!entry) return null;
    clearDraft?.();
    closeMenu();
    syncBadge();
    pulseBadge();
    return entry;
  }

  if (button) {
    button.onclick = () => {
      if (menu && !menu.hidden) {
        closeMenu();
        return;
      }
      const current = getDraft?.();
      const hasDraft = Boolean(
        current && (String(current.text || '').trim() || current.attachments?.length || current.quotes?.length),
      );
      if (hasDraft) {
        stashCurrent();
      } else {
        openMenu();
      }
    };
    button.oncontextmenu = event => {
      event.preventDefault();
      if (menu && !menu.hidden) closeMenu();
      else openMenu();
    };
  }

  document.addEventListener('pointerdown', event => {
    if (!menu || menu.hidden) return;
    const target = event.target as Node | null;
    if (menu.contains(target) || button?.contains(target)) return;
    closeMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu && !menu.hidden) {
      closeMenu();
      button?.focus();
    }
  });

  return { syncBadge, stashCurrent, openMenu, closeMenu };
}
