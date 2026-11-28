export type ComposerTriggerKind = 'slash-command' | 'path' | 'skill' | 'pull-request';

export interface ComposerTrigger {
  kind: ComposerTriggerKind;
  query: string;
  rangeStart: number;
  rangeEnd: number;
}

export interface ComposerTriggerReplacement {
  text: string;
  cursor: number;
}

export interface ComposerTriggerItem {
  label?: string;
  hint?: string;
  insert?: string;
}

export type TriggerProvider = (query: string) => Promise<ComposerTriggerItem[]> | ComposerTriggerItem[];

export interface SetupMultiTriggerMenuOptions {
  input?: HTMLInputElement | HTMLTextAreaElement | null;
  parent?: HTMLElement | null;
  providers?: Partial<Record<ComposerTriggerKind, TriggerProvider>>;
  kinds?: ComposerTriggerKind[];
  onError?: (message: string) => void;
}

const isWhitespace = (ch: string): boolean => ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export function isCurrencyAmountQuery(query: unknown): boolean {
  return /^\.?[0-9][0-9,._]*(?:[kKmMbBtT]|[eE][0-9]+)?[.,;:!?)]*$/.test(String(query ?? ''));
}

export function isPathWord(text: string, wordStart: number, cursor: number): boolean {
  let end = cursor;
  while (end < text.length && !isWhitespace(text[end] ?? '')) end += 1;
  return /[/\\]/.test(text.slice(wordStart + 1, end));
}

export function serializeComposerFileLink(filePath: unknown): string {
  const raw = String(filePath ?? '');
  const sepIdx = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
  const base = (sepIdx >= 0 ? raw.slice(sepIdx + 1) : raw).replace(/[\\[\]*_&]/g, '\\$&');
  const dest = encodeURI(raw)
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
    .replaceAll('&', '%26')
    .replaceAll('#', '%23')
    .replaceAll('?', '%3F')
    .replaceAll('\\', '%5C');
  return `[${base || raw}](${dest})`;
}

/**
 * Detects an active composer autocomplete trigger (`/`, `@`, `$`, or `#`) around `cursorInput`,
 * ignoring paths starting with `/foo/bar` and currency amounts like `$5` or `$10k`.
 */
export function detectComposerTrigger(text: unknown, cursorInput?: number): ComposerTrigger | null {
  const src = String(text ?? '');
  const cursor = Number.isFinite(cursorInput) ? Math.max(0, Math.min(src.length, Math.floor(cursorInput!))) : src.length;
  let tokenIdx = cursor - 1;
  while (tokenIdx >= 0 && !isWhitespace(src[tokenIdx] ?? '')) tokenIdx -= 1;
  const tokenStart = tokenIdx + 1;
  const token = src.slice(tokenStart, cursor);
  if (!token) return null;

  if (token.startsWith('/')) {
    if (tokenStart > 0 || isPathWord(src, tokenStart, cursor)) return null;
    const query = token.slice(1);
    if (!/^[a-z0-9-]*$/i.test(query)) return null;
    return { kind: 'slash-command', query, rangeStart: tokenStart, rangeEnd: cursor };
  }

  if (token.startsWith('@')) {
    return { kind: 'path', query: token.slice(1), rangeStart: tokenStart, rangeEnd: cursor };
  }

  if (token.startsWith('$')) {
    const query = token.slice(1);
    if (isCurrencyAmountQuery(query)) return null;
    return { kind: 'skill', query, rangeStart: tokenStart, rangeEnd: cursor };
  }

  if (!/^[@\p{Sc}]/u.test(token)) {
    const match = /(?:^|\p{Ps})#([\p{L}\p{N}_-]*)?$/u.exec(token);
    if (match) {
      const query = match[1] ?? '';
      return {
        kind: 'pull-request',
        query,
        rangeStart: cursor - query.length - 1,
        rangeEnd: cursor,
      };
    }
  }

  return null;
}

export function replaceComposerTrigger(
  text: unknown,
  trigger: Pick<ComposerTrigger, 'rangeStart' | 'rangeEnd'>,
  replacement: string,
): ComposerTriggerReplacement {
  const src = String(text ?? '');
  const before = src.slice(0, trigger.rangeStart);
  const after = src.slice(trigger.rangeEnd);
  const insert = after && !/^\s/.test(after) && !/\s$/.test(replacement) ? `${replacement} ` : replacement;
  return {
    text: `${before}${insert}${after}`,
    cursor: before.length + insert.length,
  };
}

/**
 * Unified composer autocomplete popup for `@` files, `$` skills, and `#` PRs/runs/sessions.
 */
export function setupMultiTriggerMenu({
  input,
  parent,
  providers = {},
  kinds = ['path', 'skill', 'pull-request'],
  onError = () => {},
}: SetupMultiTriggerMenuOptions = {}): { close: () => void; refresh?: () => Promise<void> } {
  if (!input || !parent) return { close: () => {} };
  const allowed = new Set<ComposerTriggerKind>(kinds);
  const menu = document.createElement('div');
  menu.className = 'slash-menu trigger-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', 'Composer suggestions');
  parent.append(menu);

  let currentTrigger: ComposerTrigger | null = null;
  let shown: ComposerTriggerItem[] = [];
  let selected = 0;
  let querySeq = 0;

  const hide = (): void => {
    menu.hidden = true;
    shown = [];
    currentTrigger = null;
  };

  const choose = (item: ComposerTriggerItem): void => {
    if (!currentTrigger) return;
    const replacement = item.insert ?? item.label ?? '';
    const next = replaceComposerTrigger(input.value, currentTrigger, replacement);
    input.value = next.text;
    input.setSelectionRange(next.cursor, next.cursor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    hide();
    input.focus();
  };

  const draw = (): void => {
    menu.replaceChildren(
      ...shown.map((item, idx) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = idx === selected ? 'slash-item selected' : 'slash-item';
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(idx === selected));
        const nameEl = document.createElement('span');
        nameEl.className = 'slash-name';
        nameEl.textContent = item.label || '';
        const aboutEl = document.createElement('span');
        aboutEl.className = 'slash-about';
        aboutEl.textContent = item.hint || '';
        row.append(nameEl, aboutEl);
        row.onmousedown = ev => {
          ev.preventDefault();
          choose(item);
        };
        return row;
      }),
    );
    menu.hidden = !shown.length;
    menu.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
  };

  async function refresh(): Promise<void> {
    if (!input) return;
    const trigger = detectComposerTrigger(input.value, input.selectionStart ?? input.value.length);
    const provider = trigger ? providers[trigger.kind] : undefined;
    if (!trigger || !allowed.has(trigger.kind) || typeof provider !== 'function') {
      hide();
      return;
    }
    const seq = ++querySeq;
    currentTrigger = trigger;
    try {
      const results = await provider(trigger.query);
      if (seq !== querySeq) return;
      shown = Array.isArray(results) ? results.slice(0, 12) : [];
      selected = Math.min(selected, Math.max(0, shown.length - 1));
      draw();
    } catch (err) {
      if (seq === querySeq) onError(errorMessage(err));
      hide();
    }
  }

  input.addEventListener('input', () => {
    selected = 0;
    void refresh();
  });
  input.addEventListener('blur', hide);
  (input as HTMLElement).addEventListener(
    'keydown',
    ev => {
      if (menu.hidden || !shown.length) return;
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        selected = (selected + (ev.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
        draw();
      } else if (ev.key === 'Enter' || ev.key === 'Tab') {
        if (!ev.shiftKey && !ev.isComposing && shown[selected]) {
          ev.preventDefault();
          ev.stopPropagation();
          choose(shown[selected]);
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        hide();
      }
    },
    true,
  );

  return { close: hide, refresh };
}
