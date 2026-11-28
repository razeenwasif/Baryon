import './today.css';
import { ConditionalTask } from './conditional-task.js';
import { nextRoutine, runningChats, upcomingEvents, whenLabel } from './today.js';
import type { ParsedCalendarEvent, RoutineSchedule, SessionsSummaryInput, TodayData } from './today.js';

export interface TodayPanePaperNotice {
  id: string;
  title: string;
  url?: string;
  at?: string;
}

export interface TodayPaneBriefData {
  summaryLine?: string;
  runs?: {
    regressions?: unknown[];
  };
}

export interface TodayPaneBriefResult {
  brief: TodayPaneBriefData;
  artifact?: unknown;
}

export interface TodayPaneSnapshot {
  data: TodayData | null;
  routines: RoutineSchedule[];
  paperNotices: TodayPanePaperNotice[];
  briefData: TodayPaneBriefData | null;
  fetchedAt: number;
}

export interface TodayPaneApi {
  openSource?: (url: string) => unknown;
  todayData?: (force?: boolean) => Promise<TodayData>;
  automationState?: () => Promise<{
    schedules?: RoutineSchedule[];
    watchers?: Array<{
      event?: string;
      state?: { recentPapers?: TodayPanePaperNotice[] };
    }>;
  } | null>;
  researchBriefData?: () => Promise<TodayPaneBriefData | null>;
  researchBriefGenerate?: (options?: { refreshPapers?: boolean }) => Promise<TodayPaneBriefResult>;
}

export interface TodayPaneOptions {
  api?: TodayPaneApi | null;
  sessions: () => SessionsSummaryInput;
  openSession: (id: string) => void;
  ask: (text: string) => void;
  openSettings: (tab: string) => void;
  onReproduce?: ((paperId: string) => unknown) | null;
  openPage?: ((artifact: unknown) => void) | null;
  onBrief?: ((result: TodayPaneBriefResult) => void) | null;
  onChange?: ((snapshot: TodayPaneSnapshot) => void) | null;
  backgroundAllowed?: () => boolean;
  backgroundDelayMs?: number;
}

export interface TodayPaneController {
  id: 'today';
  title: 'Today';
  snapshot: () => TodayPaneSnapshot;
  refresh: (force?: boolean) => Promise<void>;
  syncBackground: () => void;
  render: (body: HTMLElement) => void;
  leave: () => void;
  dispose: () => void;
}

const errMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Your next events, unread count and what's running, at a glance. The calendar and inbox are read
// for this panel only and never go to a model. The main process keeps them for two minutes.
export function todayPane({
  api,
  sessions,
  openSession,
  ask,
  openSettings,
  onReproduce = null,
  openPage = null,
  onBrief = null,
  onChange = null,
  backgroundAllowed = () => typeof document === 'undefined' ? true : !document.hidden,
  backgroundDelayMs = 180000,
}: TodayPaneOptions): TodayPaneController {
  let data: TodayData | null = null;
  let routines: RoutineSchedule[] = [];
  let paperNotices: TodayPanePaperNotice[] = [];
  let briefData: TodayPaneBriefData | null = null;
  let briefBusy = false;
  let briefError = '';
  let lastBrief: unknown = null;
  let fetchedAt = 0;
  let fetching: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let shownBody: HTMLElement | null = null;
  const snapshot = (): TodayPaneSnapshot => ({ data, routines, paperNotices, briefData, fetchedAt });
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string | null): HTMLElementTagNameMap[K] => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const button = (className: string, text: string, onclick: ((ev: MouseEvent) => void) | null): HTMLButtonElement => {
    const node = el('button', className, text);
    node.type = 'button';
    node.onclick = onclick;
    return node;
  };
  const block = (title: string, ...children: Array<Node | string>): HTMLElement => {
    const section = el('section', 'today-block');
    section.append(el('h3', '', title), ...children);
    return section;
  };
  const connect = (text: string, service: string): HTMLParagraphElement => {
    const p = el('p', 'today-note', text);
    p.append(' ', button('today-link', `Connect ${service}`, () => openSettings('integrations')));
    return p;
  };

  function calendar(now: Date): HTMLElement {
    if (!data) return block('Calendar', el('p', 'today-note', 'Checking your calendar…'));
    const c = data.calendar;
    if (!c?.connected) return block('Calendar', connect('Connect Google Calendar to see what’s next.', 'Calendar'));
    if (c.error) return block('Calendar', el('p', 'today-note', String(c.error)));
    const events = upcomingEvents(c.events, now), timed = events.filter(e => !e.allDay), allDay = events.filter(e => e.allDay);
    if (!events.length) return block('Calendar', el('p', 'today-note', 'Nothing on your calendar for the rest of today or tomorrow.'));
    const open = (event: ParsedCalendarEvent): (() => void) | null => (event.url ? () => api?.openSource?.(event.url!) : null);
    const parts: HTMLElement[] = [];
    const next = timed[0];
    if (next) {
      const card = button('today-next', '', open(next));
      card.disabled = !next.url; card.title = next.url ? 'Open in Google Calendar' : '';
      card.append(el('span', 'today-when', whenLabel(next, now)), el('b', '', next.title));
      parts.push(card);
    }
    const rest = [...timed.slice(1, 5), ...allDay.slice(0, 3)];
    if (rest.length) {
      const list = el('ul', 'today-list');
      list.append(...rest.map(event => { const row = button('', '', open(event)); row.disabled = !event.url; row.append(el('span', 'today-when', whenLabel(event, now)), el('span', 'today-title', event.title)); const item = el('li'); item.append(row); return item; }));
      parts.push(list);
    }
    return block('Calendar', ...parts);
  }

  function inbox(): HTMLElement {
    if (!data) return block('Inbox', el('p', 'today-note', 'Checking your inbox…'));
    const e = data.email;
    if (!e?.connected) return block('Inbox', connect('Connect Gmail to see your unread count.', 'Gmail'));
    if (e.error || e.unread == null) return block('Inbox', el('p', 'today-note', String(e.error || 'Couldn’t read your inbox.')));
    const count = el('p', 'today-count');
    count.append(el('b', '', String(e.unread)), e.unread === 1 ? ' unread email' : ' unread emails');
    return block('Inbox', count, ...(e.unread ? [button('today-ask', 'Ask Fairy about them', () => ask('Check my unread email'))] : []));
  }

  function running(now: Date): HTMLElement {
    const chats = runningChats(sessions()), parts: HTMLElement[] = [];
    if (chats.length) {
      const list = el('ul', 'today-list');
      list.append(...chats.map(chat => {
        const row = button(chat.waiting ? 'waiting' : 'working', '', () => openSession(chat.id));
        row.append(el('span', 'today-dot'), el('span', 'today-title', chat.title), el('span', 'today-status', chat.waiting ? 'Needs your OK' : 'Working'));
        const item = el('li'); item.append(row); return item;
      }));
      parts.push(list);
    } else parts.push(el('p', 'today-note', 'No chats are working right now.'));
    const routine = nextRoutine(routines, now);
    if (routine) { const p = el('p', 'today-note today-routine'); p.append('Next routine: ', el('b', '', routine.title), ` · ${routine.label}`); parts.push(p); }
    return block('Running', ...parts);
  }

  function arXivNotices(): HTMLElement | null {
    if (!paperNotices.length) return null;
    const list = el('ul', 'today-list');
    for (const notice of paperNotices.slice(0, 5)) {
      const item = el('li', 'today-paper-notice');
      const open = button('', '', () => { if (notice.url) api?.openSource?.(notice.url); });
      open.append(el('span', 'today-when', `arXiv:${notice.id}`), el('span', 'today-title', notice.title));
      item.append(open);
      if (onReproduce) item.append(button('today-link', 'Reproduce', () => void onReproduce(notice.id)));
      list.append(item);
    }
    return block('arXiv notices', list);
  }

  function researchBriefBlock(): HTMLElement | null {
    const apiClient = api;
    if (!apiClient?.researchBriefGenerate) return null;
    const parts: HTMLElement[] = [];
    if (briefData?.summaryLine) parts.push(el('p', 'today-note', briefData.summaryLine));
    else parts.push(el('p', 'today-note', 'Papers, overnight runs, open PRs & today’s schedule in one morning page.'));
    if (briefData?.runs?.regressions?.length) {
      parts.push(el('p', 'today-brief-warn', `${briefData.runs.regressions.length} benchmark ${briefData.runs.regressions.length === 1 ? 'regression' : 'regressions'} flagged`));
    }
    if (briefError) parts.push(el('p', 'today-brief-warn', briefError));
    const actions = el('div', 'today-brief-actions');
    const genBtn = button('today-ask', briefBusy ? 'Generating…' : lastBrief ? 'Refresh brief' : 'Generate brief page', async () => {
      if (briefBusy) return;
      briefBusy = true; briefError = '';
      if (shownBody) draw(shownBody);
      try {
        const res = await apiClient.researchBriefGenerate!({ refreshPapers: true });
        briefData = res.brief;
        lastBrief = res.artifact;
        onBrief?.(res);
        if (openPage && res.artifact) openPage(res.artifact);
      } catch (error: unknown) {
        briefError = String((error as { message?: unknown } | null)?.message || 'Could not generate Research brief.');
      } finally {
        briefBusy = false;
        if (shownBody) draw(shownBody);
      }
    });
    genBtn.disabled = briefBusy;
    actions.append(genBtn);
    if (lastBrief && openPage) {
      actions.append(button('today-link', 'Open page', () => openPage(lastBrief)));
    }
    parts.push(actions);
    return block('Research brief', ...parts);
  }

  function draw(body: HTMLElement): void {
    const now = new Date(), head = el('header', 'today-head');
    head.append(el('h2', '', 'Today'), el('span', 'today-date', now.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })));
    const refresh = button('today-refresh', '', () => void load(body, true));
    refresh.setAttribute('aria-label', 'Refresh'); refresh.title = 'Refresh';
    head.append(refresh);
    const root = el('div', 'today');
    const briefCard = researchBriefBlock();
    const notices = arXivNotices();
    root.append(head, calendar(now), inbox(), running(now), ...(briefCard ? [briefCard] : []), ...(notices ? [notices] : []));
    body.replaceChildren(root);
  }

  async function load(body: HTMLElement | null = shownBody, force = false): Promise<void> {
    if (!api?.todayData) return;
    if (!force && (fetching || Date.now() - fetchedAt < 60000)) return fetching ?? undefined;
    fetching = Promise.all([api.todayData(force), api.automationState?.().catch(() => null), api.researchBriefData?.().catch(() => null)]).then(([next, automation, nextBrief]) => {
      data = next; routines = automation?.schedules || [];
      if (nextBrief) briefData = nextBrief;
      const seen = new Set<string>();
      paperNotices = (automation?.watchers || [])
        .filter(w => w.event === 'paper' && Array.isArray(w.state?.recentPapers))
        .flatMap(w => w.state!.recentPapers!)
        .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
        .filter(p => p?.id && !seen.has(p.id) && seen.add(p.id))
        .slice(0, 8);
      fetchedAt = Date.now();
      onChange?.(snapshot());
    }).catch((error: unknown) => {
      const msg = errMessage(error);
      data = { calendar: { connected: true, error: msg }, email: { connected: true, error: msg } };
      onChange?.(snapshot());
    }).finally(() => {
      fetching = null;
      if (shownBody && (body === shownBody || !body)) draw(shownBody);
      bgTask.sync();
    });
    return fetching;
  }

  const bgTask = new ConditionalTask({
    enabled: () => Boolean(api?.todayData) && Boolean(backgroundAllowed()),
    delay: () => shownBody ? 60000 : backgroundDelayMs,
    run: () => load(shownBody, false),
  });

  return {
    id: 'today', title: 'Today',
    snapshot,
    refresh: (force = false) => load(shownBody, force),
    syncBackground() {
      bgTask.sync();
      if (api?.todayData && backgroundAllowed() && !fetching && (!fetchedAt || Date.now() - fetchedAt >= backgroundDelayMs)) void load(shownBody, false);
    },
    render(body) {
      shownBody = body;
      draw(body);
      void load(body);
      // Times like "in 5 min" move on while the panel is open; the data itself refreshes at most every minute.
      clearInterval(timer ?? undefined);
      timer = setInterval(() => { if (shownBody !== body || !body.isConnected) return; draw(body); void load(body); }, 30000);
      bgTask.sync();
    },
    leave() { shownBody = null; clearInterval(timer ?? undefined); timer = null; bgTask.sync(); },
    dispose() { bgTask.dispose(); clearInterval(timer ?? undefined); timer = null; shownBody = null; },
  };
}
