// A compacted chat's older messages: Fairy reads notes on them instead, and here they stay tucked into a single
// compact history bar by default, opening to a T3 Code–style searchable/date-filterable drawer.

export interface CompactedEntry {
  role?: string;
  content?: unknown;
  at?: string | number;
  [key: string]: unknown;
}

export interface ExchangeGroup<T extends CompactedEntry = CompactedEntry> {
  title: string;
  at: string | number;
  items: T[];
}

export interface CompactedSectionGroup {
  title: string;
  at?: string | number;
  elements: Element[];
}

export interface CompactedSectionOptions {
  count?: number;
  note?: string;
  onNotes?: (() => void) | null;
}

export interface FoldCompactedOptions {
  onNotes?: (() => void) | null;
}

type SvgIconKind = 'chevron' | 'archive' | 'search' | 'clear' | 'sort';

// The first line of what was asked, short enough for one line.
export function questionLine(text: unknown, limit = 90): string {
  const line = String(text || '').split('\n').map(part => part.trim()).find(Boolean) || 'A message';
  return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
}

// Messages grouped by exchange: each user message and the replies after it. Messages before the first question make a
// group of their own.
export function exchanges<T extends CompactedEntry>(entries: T[]): ExchangeGroup<T>[] {
  const groups: ExchangeGroup<T>[] = [];
  for (const entry of entries) {
    if (entry.role === 'user' || !groups.length) {
      groups.push({ title: entry.role === 'user' ? questionLine(entry.content) : 'Earlier', at: entry.at || '', items: [] });
    }
    groups.at(-1)!.items.push(entry);
  }
  return groups;
}

const parseDate = (at: string | number | null | undefined): Date | null => {
  const date = at ? new Date(typeof at === 'number' ? at * 1000 : at) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
};

const when = (at: string | number | null | undefined): string => {
  const date = parseDate(at);
  return date ? date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
};

const dayKey = (at: string | number | null | undefined): string => {
  const date = parseDate(at);
  return date ? date.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '';
};

const svgIcon = (kind: SvgIconKind, size = 13): SVGSVGElement => {
  const svgNS = 'http://www.w3.org/2000/svg';
  const pic = document.createElementNS(svgNS, 'svg');
  for (const [k, v] of Object.entries({
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  })) {
    pic.setAttribute(k, String(v));
  }
  const add = (tag: string, attrs: Record<string, string | number>): void => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    pic.append(node);
  };
  if (kind === 'chevron') add('path', { d: 'm9 6 6 6-6 6' });
  else if (kind === 'archive') {
    add('rect', { x: 3, y: 4, width: 18, height: 4, rx: 1 });
    add('path', { d: 'M5 8v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4' });
  } else if (kind === 'search') {
    add('circle', { cx: 11, cy: 11, r: 7 });
    add('path', { d: 'm20 20-3.5-3.5' });
  } else if (kind === 'clear') add('path', { d: 'M18 6 6 18M6 6l12 12' });
  else if (kind === 'sort') add('path', { d: 'M7 15V5m0 0-3 3m3-3 3 3M17 9v10m0 0-3-3m3 3 3-3' });
  return pic;
};

// The folded section: a single sleek top bar (collapsed by default) opening to a searchable, bounded drawer of
// compacted exchanges so earlier context stays accessible without flooding the chat scroll.
// groups: [{ title, at, elements }], elements already drawn.
// onNotes: when given, a Notes button beside the heading opens the notes Fairy keeps on these messages (chat-notes.js).
export function compactedSection(
  groups: CompactedSectionGroup[],
  { count, note = 'Fairy keeps notes on them', onNotes = null }: CompactedSectionOptions = {},
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'compacted';
  section.setAttribute('aria-label', 'Compacted messages');

  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'compacted-head';
  head.setAttribute('aria-expanded', 'false');
  const chev = svgIcon('chevron', 13);
  chev.classList.add('compacted-chevron');
  const arch = svgIcon('archive', 13);
  arch.classList.add('compacted-ico');
  const label = document.createElement('span');
  label.className = 'compacted-label';
  label.textContent = `${count} earlier ${count === 1 ? 'message' : 'messages'}`;
  const badge = document.createElement('span');
  badge.className = 'compacted-badge';
  badge.textContent = `${groups.length} ${groups.length === 1 ? 'turn' : 'turns'}`;
  const hint = document.createElement('span');
  hint.className = 'compacted-hint';
  hint.textContent = note;
  head.append(chev, arch, label, badge, hint);

  const list = document.createElement('div');
  list.className = 'compacted-drawer';
  list.hidden = true;

  const entries = groups.map((group, idx) => {
    const turn = document.createElement('details');
    turn.className = 'compacted-turn';
    const summary = document.createElement('summary');
    const tChev = svgIcon('chevron', 12);
    tChev.classList.add('compacted-turn-chev');
    const num = document.createElement('span');
    num.className = 'compacted-num';
    num.textContent = `#${idx + 1}`;
    const title = document.createElement('span');
    title.className = 'compacted-title';
    title.textContent = group.title;
    title.title = group.title;
    const time = document.createElement('time');
    time.textContent = when(group.at);
    summary.append(tChev, num, title, time);
    const body = document.createElement('div');
    body.className = 'compacted-body';
    body.append(...group.elements);
    turn.append(summary, body);
    turn.addEventListener('toggle', () => {
      if (turn.open) turn.scrollIntoView({ block: 'nearest' });
    });
    const searchText = `${group.title} ${group.elements.map(e => e.textContent || '').join(' ')}`.toLowerCase();
    return { turn, day: dayKey(group.at), searchText };
  });

  const dayCounts = new Map<string, number>();
  for (const e of entries) {
    if (e.day) dayCounts.set(e.day, (dayCounts.get(e.day) || 0) + 1);
  }
  const dayList = [...dayCounts.entries()];

  let query = '';
  let selectedDay = 'all';
  let order: 'newest' | 'oldest' = groups.length > 5 ? 'newest' : 'oldest';
  let matchPill: HTMLSpanElement | null = null;

  const rows = document.createElement('div');
  rows.className = 'compacted-list';

  const renderRows = (): void => {
    rows.replaceChildren();
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = entries.filter(
      e => (selectedDay === 'all' || e.day === selectedDay) && tokens.every(tok => e.searchText.includes(tok)),
    );
    const ordered = order === 'newest' ? [...filtered].reverse() : filtered;
    if (matchPill) {
      matchPill.textContent = ordered.length === entries.length ? String(entries.length) : `${ordered.length} / ${entries.length}`;
    }
    if (!ordered.length) {
      const empty = document.createElement('p');
      empty.className = 'compacted-empty';
      empty.textContent = 'No earlier messages match your filter.';
      rows.append(empty);
      return;
    }
    let lastDay: string | null = null;
    for (const item of ordered) {
      if (dayList.length >= 2 && selectedDay === 'all' && item.day && item.day !== lastDay) {
        const sep = document.createElement('div');
        sep.className = 'compacted-day-sep';
        sep.textContent = item.day;
        rows.append(sep);
        lastDay = item.day;
      }
      rows.append(item.turn);
    }
  };

  if (groups.length > 5) {
    const toolbar = document.createElement('div');
    toolbar.className = 'compacted-toolbar';
    const searchWrap = document.createElement('div');
    searchWrap.className = 'compacted-search-wrap';
    const searchInput = document.createElement('input');
    searchInput.className = 'compacted-search';
    searchInput.type = 'text';
    searchInput.placeholder = 'Search earlier messages…';
    searchInput.setAttribute('aria-label', 'Search earlier messages');
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'compacted-search-clear';
    clearBtn.setAttribute('aria-label', 'Clear search');
    clearBtn.append(svgIcon('clear', 11));
    clearBtn.hidden = true;
    clearBtn.onclick = e => {
      e.stopPropagation();
      query = '';
      searchInput.value = '';
      clearBtn.hidden = true;
      renderRows();
      searchInput.focus();
    };
    searchWrap.onclick = e => {
      const target = e.target as Node | null;
      if (e.target !== clearBtn && !clearBtn.contains(target)) searchInput.focus();
    };
    searchInput.oninput = () => {
      query = searchInput.value;
      clearBtn.hidden = !query;
      renderRows();
    };
    searchWrap.append(svgIcon('search', 13), searchInput, clearBtn);

    const sortBtn = document.createElement('button');
    sortBtn.type = 'button';
    sortBtn.className = 'compacted-sort-btn';
    const sortText = document.createElement('span');
    const syncSort = (): void => {
      sortText.textContent = order === 'newest' ? 'Latest' : 'Oldest';
      sortBtn.title = order === 'newest' ? 'Showing newest compacted first (click for chronological)' : 'Showing oldest first (click for newest first)';
    };
    syncSort();
    sortBtn.append(svgIcon('sort', 12), sortText);
    sortBtn.onclick = () => {
      order = order === 'newest' ? 'oldest' : 'newest';
      syncSort();
      renderRows();
    };

    matchPill = document.createElement('span');
    matchPill.className = 'compacted-match-count';
    toolbar.append(searchWrap, sortBtn, matchPill);
    list.append(toolbar);
  }

  if (dayList.length >= 2) {
    const daysBar = document.createElement('div');
    daysBar.className = 'compacted-days';
    const renderDays = (): void => {
      daysBar.replaceChildren();
      const pills: Array<[string, string, number]> = [
        ['all', 'All', entries.length],
        ...dayList.map(([d, n]): [string, string, number] => [d, d, n]),
      ];
      for (const [key, lbl, cnt] of pills) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = `compacted-day-pill${selectedDay === key ? ' is-active' : ''}`;
        const t = document.createElement('span');
        t.textContent = lbl;
        const c = document.createElement('span');
        c.className = 'compacted-day-count';
        c.textContent = String(cnt);
        pill.append(t, c);
        pill.onclick = () => {
          selectedDay = key;
          renderDays();
          renderRows();
        };
        daysBar.append(pill);
      }
    };
    renderDays();
    list.append(daysBar);
  }

  list.append(rows);
  renderRows();

  head.onclick = () => {
    const open = Boolean(list.hidden);
    list.hidden = !open;
    head.setAttribute('aria-expanded', String(open));
    section.classList.toggle('is-open', open);
  };
  if (onNotes) {
    const bar = document.createElement('div'); bar.className = 'compacted-bar';
    const notes = document.createElement('button'); notes.type = 'button'; notes.className = 'compacted-notes';
    notes.textContent = 'Notes';
    notes.title = 'See and edit the notes Fairy keeps on these messages';
    notes.onclick = () => onNotes();
    bar.append(head, notes); section.append(bar, list);
  } else section.append(head, list);
  return section;
}

// The Mac chat: elements drawn for messages before `through` (tagged with data-entry) fold into the section, which takes
// the place of the first of them.
export function foldCompacted(
  scroller: Element,
  history: CompactedEntry[],
  through: number,
  { onNotes = null }: FoldCompactedOptions = {},
): HTMLElement | null {
  if (!through) return null;
  const drawn = [...scroller.children].filter(
    node => (node as HTMLElement).dataset?.entry !== undefined && Number((node as HTMLElement).dataset.entry) < through,
  );
  if (!drawn.length) return null;
  const byIndex = new Map<number, Element[]>();
  for (const node of drawn) {
    const index = Number((node as HTMLElement).dataset.entry);
    let list = byIndex.get(index);
    if (!list) {
      list = [];
      byIndex.set(index, list);
    }
    list.push(node);
  }
  const entries = [...byIndex.keys()].sort((a, b) => a - b).map(index => ({ ...history[index], index }));
  const groups: CompactedSectionGroup[] = exchanges(entries).map(group => ({
    ...group,
    elements: group.items.flatMap(entry => byIndex.get(entry.index) ?? []),
  }));
  // Building the section moves the drawn messages into it, so their place is marked first.
  const place = document.createComment('compacted'); scroller.insertBefore(place, drawn[0]);
  const section = compactedSection(groups, { count: through, onNotes });
  place.replaceWith(section);
  return section;
}
