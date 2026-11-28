export interface QueueEntryInput<A = unknown, Q = unknown> {
  text?: string;
  attachments?: A[];
  quotes?: Q[];
  mode?: string;
}

export interface QueueEntry<A = unknown, Q = unknown> {
  id: string;
  text: string;
  attachments: A[];
  quotes: Q[];
  mode: string;
  createdAt: number;
}

export interface CreateComposerQueueOptions {
  maxVisible?: number;
  idFactory?: () => string;
  now?: () => number;
}

export interface ComposerQueue<A = unknown, Q = unknown> {
  maxVisible: number;
  enqueue: (sessionId: string | null | undefined, input?: QueueEntryInput<A, Q>) => QueueEntry<A, Q> | null;
  list: (sessionId: string | null | undefined) => QueueEntry<A, Q>[];
  count: (sessionId: string | null | undefined) => number;
  shift: (sessionId: string | null | undefined) => QueueEntry<A, Q> | null;
  remove: (sessionId: string | null | undefined, id: string) => QueueEntry<A, Q> | null;
  promoteToFront: (sessionId: string | null | undefined, id: string) => QueueEntry<A, Q> | null;
  clear: (sessionId: string | null | undefined) => void;
  setPaused: (sessionId: string | null | undefined, value: boolean) => void;
  isPaused: (sessionId: string | null | undefined) => boolean;
}

export interface SetupComposerQueueOptions<A = unknown, Q = unknown> {
  host?: HTMLElement | null;
  queue: ComposerQueue<A, Q>;
  activeSession?: () => string;
  onSteer?: (entry: QueueEntry<A, Q>, sessionId: string) => void;
  onEdit?: (entry: QueueEntry<A, Q>, sessionId: string) => void;
  onRunNext?: (sessionId: string) => void;
  onChange?: () => void;
}

const DEFAULT_KEY = '__default__';
const sessionKey = (id: unknown): string => (typeof id === 'string' && id.trim() ? id.trim() : DEFAULT_KEY);

/**
 * Pure per-session queue state for follow-up prompts and mid-turn steering.
 */
export function createComposerQueue<A = unknown, Q = unknown>({
  maxVisible = 3,
  idFactory = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  now = Date.now,
}: CreateComposerQueueOptions = {}): ComposerQueue<A, Q> {
  const queues = new Map<string, QueueEntry<A, Q>[]>();
  const paused = new Set<string>();

  const bucket = (sessionId: string): QueueEntry<A, Q>[] => {
    const key = sessionKey(sessionId);
    let list = queues.get(key);
    if (!list) {
      list = [];
      queues.set(key, list);
    }
    return list;
  };

  function enqueue(
    sessionId: string | null | undefined,
    { text = '', attachments = [], quotes = [], mode = 'chat' }: QueueEntryInput<A, Q> = {},
  ): QueueEntry<A, Q> | null {
    const clean = String(text ?? '');
    const atts = Array.isArray(attachments) ? [...attachments] : [];
    const qs = Array.isArray(quotes) ? [...quotes] : [];
    if (!clean.trim() && !atts.length && !qs.length) return null;
    const key = sessionKey(sessionId);
    paused.delete(key);
    const entry: QueueEntry<A, Q> = {
      id: idFactory(),
      text: clean,
      attachments: atts,
      quotes: qs,
      mode: mode || 'chat',
      createdAt: now(),
    };
    bucket(key).push(entry);
    return entry;
  }

  const list = (sessionId: string | null | undefined): QueueEntry<A, Q>[] => [
    ...(queues.get(sessionKey(sessionId)) || []),
  ];
  const count = (sessionId: string | null | undefined): number => (queues.get(sessionKey(sessionId)) || []).length;

  function shift(sessionId: string | null | undefined): QueueEntry<A, Q> | null {
    const key = sessionKey(sessionId);
    const items = queues.get(key);
    if (!items?.length) return null;
    const head = items.shift() ?? null;
    if (!items.length) queues.delete(key);
    return head;
  }

  function remove(sessionId: string | null | undefined, id: string): QueueEntry<A, Q> | null {
    const key = sessionKey(sessionId);
    const items = queues.get(key);
    if (!items?.length) return null;
    const idx = items.findIndex(item => item.id === id);
    if (idx < 0) return null;
    const [removed] = items.splice(idx, 1);
    if (!items.length) queues.delete(key);
    return removed ?? null;
  }

  function promoteToFront(sessionId: string | null | undefined, id: string): QueueEntry<A, Q> | null {
    const key = sessionKey(sessionId);
    const items = queues.get(key);
    if (!items?.length) return null;
    const idx = items.findIndex(item => item.id === id);
    if (idx < 0) return null;
    const [entry] = items.splice(idx, 1);
    items.unshift(entry);
    paused.delete(key);
    return entry;
  }

  function clear(sessionId: string | null | undefined): void {
    const key = sessionKey(sessionId);
    queues.delete(key);
    paused.delete(key);
  }

  function setPaused(sessionId: string | null | undefined, value: boolean): void {
    const key = sessionKey(sessionId);
    if (value) paused.add(key);
    else paused.delete(key);
  }

  const isPaused = (sessionId: string | null | undefined): boolean => paused.has(sessionKey(sessionId));

  return { maxVisible, enqueue, list, count, shift, remove, promoteToFront, clear, setPaused, isPaused };
}

/**
 * DOM strip rendered above `.composer` showing queued prompts with Steer, Edit, and Remove controls.
 */
export function setupComposerQueue<A = unknown, Q = unknown>(
  options: SetupComposerQueueOptions<A, Q>,
): { render: () => void } {
  const { host, queue, activeSession, onSteer, onEdit, onRunNext, onChange } = options;
  let expanded = false;

  const notify = (): void => onChange?.();

  function render(): void {
    if (!host) return;
    const sid = activeSession?.() || '';
    const items = queue.list(sid);
    const paused = queue.isPaused(sid);
    if (!items.length) {
      expanded = false;
      host.hidden = true;
      host.replaceChildren();
      return;
    }

    host.hidden = false;
    const head = document.createElement('div');
    head.className = 'composer-queue-head';

    const title = document.createElement('span');
    title.className = 'composer-queue-title';
    title.textContent = `Queued (${items.length})`;
    head.append(title);

    const headActions = document.createElement('div');
    headActions.className = 'composer-queue-head-actions';

    if (paused) {
      const resumeBtn = document.createElement('button');
      resumeBtn.type = 'button';
      resumeBtn.className = 'composer-queue-pill';
      resumeBtn.textContent = 'Paused · Run next';
      resumeBtn.title = 'Dispatch the next queued prompt now';
      resumeBtn.onclick = () => {
        queue.setPaused(sid, false);
        onRunNext?.(sid);
        render();
        notify();
      };
      headActions.append(resumeBtn);
    }

    const hiddenCount = Math.max(0, items.length - queue.maxVisible);
    if (hiddenCount > 0) {
      const toggleBtn = document.createElement('button');
      toggleBtn.type = 'button';
      toggleBtn.className = 'composer-queue-pill';
      toggleBtn.textContent = expanded ? 'Show less' : `Show ${hiddenCount} more`;
      toggleBtn.onclick = () => {
        expanded = !expanded;
        render();
      };
      headActions.append(toggleBtn);
    }

    head.append(headActions);

    const listEl = document.createElement('div');
    listEl.className = 'composer-queue-list';
    const visible = expanded ? items : items.slice(0, queue.maxVisible);

    for (const entry of visible) {
      const row = document.createElement('div');
      row.className = 'composer-queue-item';
      row.dataset.queueId = entry.id;

      const textEl = document.createElement('span');
      textEl.className = 'composer-queue-text';
      const summary = String(entry.text || '').replace(/\s+/g, ' ').trim();
      textEl.textContent = summary || (entry.attachments.length ? `[${entry.attachments.length} attachment(s)]` : '[Quoted prompt]');
      textEl.title = entry.text || textEl.textContent;
      row.append(textEl);

      const metaCount = (entry.attachments?.length || 0) + (entry.quotes?.length || 0);
      if (metaCount > 0) {
        const badge = document.createElement('span');
        badge.className = 'composer-queue-meta';
        const parts: string[] = [];
        if (entry.quotes?.length) parts.push(`${entry.quotes.length} quote${entry.quotes.length > 1 ? 's' : ''}`);
        if (entry.attachments?.length) parts.push(`${entry.attachments.length} file${entry.attachments.length > 1 ? 's' : ''}`);
        badge.textContent = parts.join(' · ');
        row.append(badge);
      }

      const actions = document.createElement('div');
      actions.className = 'composer-queue-actions';

      const steerBtn = document.createElement('button');
      steerBtn.type = 'button';
      steerBtn.className = 'composer-queue-btn steer';
      steerBtn.textContent = '⚡ Steer';
      steerBtn.title = 'Interrupt current turn and steer immediately with this prompt';
      steerBtn.setAttribute('aria-label', 'Steer current turn with queued prompt');
      steerBtn.onclick = () => onSteer?.(entry, sid);

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'composer-queue-btn';
      editBtn.textContent = 'Edit';
      editBtn.title = 'Move prompt back into composer to edit';
      editBtn.setAttribute('aria-label', 'Edit queued prompt');
      editBtn.onclick = () => {
        const removed = queue.remove(sid, entry.id);
        render();
        if (removed) onEdit?.(removed, sid);
        notify();
      };

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'composer-queue-btn remove';
      removeBtn.textContent = '×';
      removeBtn.title = 'Remove queued prompt';
      removeBtn.setAttribute('aria-label', 'Remove queued prompt');
      removeBtn.onclick = () => {
        queue.remove(sid, entry.id);
        render();
        notify();
      };

      actions.append(steerBtn, editBtn, removeBtn);
      row.append(actions);
      listEl.append(row);
    }

    host.replaceChildren(head, listEl);
  }

  return { render };
}
