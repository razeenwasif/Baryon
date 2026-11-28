export interface CalendarEventInput {
  start?: string;
  end?: string;
  title?: string;
  allDay?: boolean;
  url?: string;
  [key: string]: unknown;
}

export interface ParsedCalendarEvent extends CalendarEventInput {
  start: string;
  title: string;
  startAt: Date;
  endAt: Date;
}

export interface RoutineSchedule {
  enabled?: boolean;
  time?: string;
  days?: number[];
  lastRun?: string;
  title?: string;
}

export interface NextRoutineResult {
  title: string;
  at: Date;
  label: string;
}

export interface SessionsSummaryInput {
  sessions?: Array<{ id: string; title?: string }>;
  running?: Record<string, unknown>;
}

export interface RunningChatItem {
  id: string;
  title: string;
  waiting: boolean;
}

export interface TodayData {
  calendar?: {
    connected?: boolean;
    error?: unknown;
    events?: CalendarEventInput[];
  };
  email?: {
    connected?: boolean;
    error?: unknown;
    unread?: number;
  };
}

export interface HomeSummaryItem {
  kind: 'waiting' | 'working' | 'event' | 'email' | 'routine' | 'clear';
  badge: string;
  text: string;
  sessionId?: string;
  url?: string;
}

export interface HomeSummaryInput {
  data?: TodayData | null;
  sessions?: SessionsSummaryInput;
  routines?: RoutineSchedule[];
  now?: Date;
}

// Plain-language times for the Today panel, in the Mac's own time zone.
const time = (date: Date): string =>
  date.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }).replace(/\s?([ap])\.?m\.?$/i, ' $1m');

const startOfDay = (date: Date): Date => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
};

const daysApart = (date: Date, now: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86400000);

function dayName(date: Date, now: Date): string {
  const apart = daysApart(date, now);
  return apart === 0 ? 'Today' : apart === 1 ? 'Tomorrow' : date.toLocaleDateString('en-AU', { weekday: 'long' });
}

// All-day events come as dates, which mean midnight where you are, not in UTC.
const parse = (value: string, allDay?: boolean): Date =>
  new Date(allDay && /^\d{4}-\d\d-\d\d$/.test(value) ? `${value}T00:00:00` : value);

// Events still to come or happening now, timed ones in order, then all-day ones.
export function upcomingEvents(events: CalendarEventInput[] = [], now: Date = new Date()): ParsedCalendarEvent[] {
  return (Array.isArray(events) ? events : [])
    .filter((event): event is CalendarEventInput & { start: string; title: string } => Boolean(event?.start && event.title))
    .map(event => {
      const startAt = parse(event.start, event.allDay);
      return { ...event, startAt, endAt: event.end ? parse(event.end, event.allDay) : startAt };
    })
    .filter(event => !Number.isNaN(event.startAt.getTime()) && (event.endAt > now || (!event.allDay && event.startAt >= now)))
    .sort((a, b) => Number(Boolean(a.allDay)) - Number(Boolean(b.allDay)) || a.startAt.getTime() - b.startAt.getTime());
}

export function whenLabel(
  event: { allDay?: boolean; startAt: Date; endAt: Date },
  now: Date = new Date(),
): string {
  if (event.allDay) return event.startAt <= now ? 'All day' : `${dayName(event.startAt, now)} · all day`;
  if (event.startAt <= now) return `Now · until ${time(event.endAt)}`;
  const minutes = Math.max(1, Math.round((event.startAt.getTime() - now.getTime()) / 60000));
  if (minutes < 60) return `In ${minutes} min`;
  return daysApart(event.startAt, now) === 0 ? time(event.startAt) : `${dayName(event.startAt, now)} ${time(event.startAt)}`;
}

// The next time any enabled routine will run, within a week.
export function nextRoutine(schedules: RoutineSchedule[] = [], now: Date = new Date()): NextRoutineResult | null {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  let next: { title: string; at: Date } | null = null;
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    const timeStr = schedule?.time || '';
    if (!schedule?.enabled || !/^\d\d:\d\d$/.test(timeStr) || !Array.isArray(schedule.days)) continue;
    for (let ahead = 0; ahead <= 7; ahead++) {
      const at = new Date(now);
      at.setDate(at.getDate() + ahead);
      at.setHours(Number(timeStr.slice(0, 2)), Number(timeStr.slice(3)), 0, 0);
      if (!schedule.days.includes(at.getDay()) || at <= now || (ahead === 0 && schedule.lastRun === today)) continue;
      if (!next || at < next.at) next = { title: schedule.title || 'Routine', at };
      break;
    }
  }
  return next && { ...next, label: `${dayName(next.at, now)} at ${time(next.at)}` };
}

// Chats that are working or waiting for you, waiting ones first.
export function runningChats(sessions: SessionsSummaryInput = {}): RunningChatItem[] {
  const titles = new Map((sessions.sessions || []).map(session => [session.id, session.title]));
  return Object.entries(sessions.running || {})
    .filter(([, status]) => status)
    .map(([id, status]) => ({ id, title: titles.get(id) || 'A chat', waiting: status === 'waiting' }))
    .sort((a, b) => Number(b.waiting) - Number(a.waiting) || a.title.localeCompare(b.title));
}

// Compact at-a-glance pills for Home, derived purely from Today state (max 3 items).
export function homeSummary({
  data = null,
  sessions = {},
  routines = [],
  now = new Date(),
}: HomeSummaryInput = {}): HomeSummaryItem[] {
  const items: HomeSummaryItem[] = [];
  const chats = runningChats(sessions);
  const waiting = chats.filter(chat => chat.waiting);
  const working = chats.filter(chat => !chat.waiting);
  if (waiting.length) items.push({ kind: 'waiting', badge: waiting.length === 1 ? 'Needs OK' : `${waiting.length} waiting`, text: waiting[0].title, sessionId: waiting[0].id });
  if (working.length) items.push({ kind: 'working', badge: working.length === 1 ? 'Working' : `${working.length} working`, text: working[0].title, sessionId: working[0].id });

  const calOk = Boolean(data?.calendar?.connected && !data.calendar.error);
  const upcoming = calOk ? upcomingEvents(data?.calendar?.events, now) : [];
  if (upcoming.length && items.length < 3) {
    const next = upcoming[0];
    items.push({ kind: 'event', badge: whenLabel(next, now), text: next.title, url: next.url || '' });
  }

  const unread = data?.email?.unread;
  const emailOk = Boolean(data?.email?.connected && !data.email.error && typeof unread === 'number');
  if (emailOk && typeof unread === 'number' && unread > 0 && items.length < 3) {
    items.push({ kind: 'email', badge: String(unread), text: unread === 1 ? 'unread email' : 'unread emails' });
  }

  if (items.length < 3) {
    const routine = nextRoutine(routines, now);
    if (routine) items.push({ kind: 'routine', badge: routine.label, text: routine.title });
  }

  if (!items.length && (calOk || emailOk)) {
    items.push({ kind: 'clear', badge: 'Today', text: calOk && emailOk ? 'Calendar & inbox clear' : calOk ? 'Calendar clear' : 'Inbox clear' });
  }
  return items.slice(0, 3);
}
